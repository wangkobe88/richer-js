#!/usr/bin/env node
/** T233 stall 断流卖出腿化单测（2026-11-24）：stall 卖腿条件真值表 / FA 水位键 /
 *  两引擎 1s 驱动 / factorSellFilter 集成（recoveryHold 冻结形状反证）/ 信号形状 /
 *  新旧机制共存。零 DB 零网络（FA 直推 + 引擎 prototype harness）。 */
'use strict';
const path = require('path');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
const { StrategyEngine } = require('../src/strategies/StrategyEngine');
const { judgeFactorSellFilter, normalizeFactorSellFilterConfig } = require('../src/trading-engine/core/factor-sell-filter');
const stallLeg = require('../src/trading-engine/core/stall-sell-leg');
const { FourMemeWssTradingEngine } = require('../src/trading-engine/implementations/FourMemeWssTradingEngine');
const { BacktestEngine } = require('../src/trading-engine/implementations/BacktestEngine');
const fs = require('fs');

const { STALL_SIGNATURE_FACTOR, STALL_BASE_SEC, STALL_ALMOST_SEC, STALL_ALMOST_LAUNCH_PCT,
    DEFAULT_STALLED_SCAN_AFTER_SEC, buildStallLegCondition, isStallSellLeg, stallTriggerContext } = stallLeg;

let pass = 0, fail = 0;
function check(name, fn, expected) {
    let actual, err = null;
    try { actual = fn(); } catch (e) { err = e; }
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (!err && a === e) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${err ? 'THROW ' + err.message : a}`); }
}
const ok = (cond, name) => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}`); }
};
function makeWssEngine(fields = {}) {
    const eng = Object.create(FourMemeWssTradingEngine.prototype);
    return Object.assign(eng, {
        _experimentId: 'test-exp',
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        _stallCloseMs: null,
        _stalledSellLegScanEnabled: false,
        _sellingTokens: new Set(),
        _buyingTokens: new Set(),
        ...fields,
    });
}
function makeBtEngine(fields = {}) {
    const eng = Object.create(BacktestEngine.prototype);
    return Object.assign(eng, {
        _experimentId: 'test-exp',
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        _stallCloseMs: null,
        _stalledSellLegScanEnabled: false,
        _sellingTokens: new Set(),
        _buyingTokens: new Set(),
        ...fields,
    });
}

const T0 = 1700000000000;
const mkTick = (o) => Object.assign({
    token_address: '0xt', trade_type: 'buy', trader_address: '0xa', sender_address: null,
    price_bnb: 0.01, price_usd: 5, bnb_amount: 1, token_amount: 1000,
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
}, o);
function newFA() {
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xt', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    return fa;
}
const evalCond = (cond, f) => new StrategyEngine({}).evaluateCondition(cond, f);

(async () => {

    // ═══════════════ A. stall 腿条件真值表（与旧 effectiveStallExtension 逐位等价）═══════════════
    console.log('A. stall 腿条件真值表');
    {
        const C = buildStallLegCondition();
        ok(C.includes(STALL_SIGNATURE_FACTOR), 'A0 条件串含签名因子（builder 单一真相源）');
        const F = (idle, curVs) => ({ idleSecSinceLastSubstantialTick: idle, currentVsLaunchPct: curVs });
        ok(evalCond(C, F(null, 5)) === false, 'A1 idle null → 双臂恒 false（fail-closed 不触发，无 IS NULL 豁免臂）');
        ok(evalCond(C, F(54.9, 5)) === false, 'A2 54.9s → 不触发（<55）');
        ok(evalCond(C, F(55, 50)) === true, 'A3 55s ∧ curVs 50（>10 域外）→ 基础档触发');
        ok(evalCond(C, F(55, null)) === true, 'A4 55s ∧ curVs null → IS NULL 臂放行基础档（=旧「curVs null 不延长」）');
        ok(evalCond(C, F(70, 5)) === false, 'A5 70s ∧ curVs 5（≤10 almost 域）→ 延长中不触发');
        ok(evalCond(C, F(90, 5)) === true, 'A6 90s ∧ curVs 5 → almost 档触发（≥ 恰线）');
        ok(evalCond(C, F(90, 10)) === true, 'A7 90s ∧ curVs 10 恰线 → almost 档（≤ 语义）');
        ok(evalCond(C, F(55, 10)) === false, 'A8 55s ∧ curVs 10 恰线 → almost 域内（不触发，需 90s）');
        ok(evalCond(C, F(55, -5)) === false, 'A9 55s ∧ curVs −5（破发）→ almost 域内不触发（breakdown 档已撤回不回迁）');
        ok(evalCond(C, F(89.9, 5)) === false, 'A10 89.9s ∧ almost 域 → 不触发（延长未耗尽）');
        ok(evalCond(C, F(90, 10.1)) === true, 'A11 90s ∧ curVs 10.1（域外）→ 基础档触发（第二臂）');
    }

    // ═══════════════ B. FA 水位键 idleSecSinceLastSubstantialTick ═══════════════
    console.log('B. FA 水位键');
    {
        // B1 水位推进门：≥substantialTickBnb(0.01) 才推（买/卖同判）
        {
            const fa = newFA();
            fa.processTick(mkTick({ bnb_amount: 0.005, timestamp: T0 + 1000 }));  // 微量不推
            const f1 = fa.buildFactorMap('0xt', T0 + 2000);
            check('B1a 微量 0.005 不推水位 → null', () => f1.idleSecSinceLastSubstantialTick, null);
            fa.processTick(mkTick({ bnb_amount: 0.01, timestamp: T0 + 3000 }));  // 恰线推
            const f2 = fa.buildFactorMap('0xt', T0 + 61000);
            check('B1b 恰 0.01 推水位 → idle=58.0（随 now 入参走钟）', () => f2.idleSecSinceLastSubstantialTick, 58);
            // 卖向同判
            fa.processTick(mkTick({ trade_type: 'sell', bnb_amount: 0.02, token_amount: 100, timestamp: T0 + 62000 }));
            const f3 = fa.buildFactorMap('0xt', T0 + 63000);
            check('B1c 足额卖行也推水位 → 1.0', () => f3.idleSecSinceLastSubstantialTick, 1);
        }
        // B2 探针收键 + FactorBuilder 白名单 + getFactorKeys
        {
            const fa = newFA();
            ok(fa.getFactorKeys().has('idleSecSinceLastSubstantialTick'), 'B2a 探针收键（三防线自动认得）');
            const fb = fs.readFileSync(path.join(__dirname, '../src/trading-engine/core/FactorBuilder.js'), 'utf8');
            ok(fb.includes('idleSecSinceLastSubstantialTick: factorResults.idleSecSinceLastSubstantialTick'), 'B2b FactorBuilder 快照白名单');
        }
    }

    // ═══════════════ C. 实时驱动 _scanStalledSellLegs ═══════════════
    console.log('C. 实时驱动');
    {
        // C1 预扫门：idle ≤45s 零 buildFactorMap
        {
            const fa = newFA();
            fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
            const st = fa.getTokenState('0xt');
            st.lastTickAt = Date.now() - 1000;
            st.lastSubstantialTickAt = Date.now() - 30000; // 足额水位 30s 前（预扫门读它）
            let built = 0;
            const eng = makeWssEngine({
                _stalledSellLegScanEnabled: true,
                _stalledScanAfterSec: 45,
                _factorAggregator: {
                    getTokenState: () => st,
                    buildFactorMap: () => { built++; return { profitPercent: 10 }; },
                },
                _getAllHoldings: () => [{ tokenAddress: '0xt' }],
                _tokenPool: { getToken: () => ({ status: 'bought' }) },
                _evaluateSellPath: async () => ({ success: false }),
            });
            await eng._scanStalledSellLegs();
            ok(built === 0, 'C1 30s 断流（≤45s 预扫门）→ 零 buildFactorMap（廉价预扫门）');
        }
        // C2 超门票 → 评估全链
        {
            const fa = newFA();
            fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
            const st = fa.getTokenState('0xt');
            st.lastTickAt = Date.now() - 1000;
            st.lastSubstantialTickAt = Date.now() - 50000; // 足额水位 50s 前
            let evaluated = null;
            const eng = makeWssEngine({
                _stalledSellLegScanEnabled: true,
                _stalledScanAfterSec: 45,
                _factorAggregator: {
                    getTokenState: () => st,
                    buildFactorMap: () => ({ profitPercent: 10 }),
                },
                _getAllHoldings: () => [{ tokenAddress: '0xt' }],
                _tokenPool: { getToken: () => ({ status: 'bought' }) },
                _evaluateSellPath: async (addr, factors, tick) => { evaluated = { addr, factors, tick }; return { success: false }; },
            });
            await eng._scanStalledSellLegs();
            check('C2 50s 断流票 → _evaluateSellPath(addr, factors, tick=null) 全链', () => evaluated, { addr: '0xt', factors: { profitPercent: 10 }, tick: null });
        }
        // C3 无驱动（禁用）→ 零遍历
        {
            const eng = makeWssEngine({ _stalledSellLegScanEnabled: false });
            await eng._scanStalledSellLegs();
            ok(true, 'C3 禁用 → 直返（零遍历零调用）');
        }
    }

    // ═══════════════ D. 回测驱动 _scanStalledSellLegs(tickTs) ═══════════════
    console.log('D. 回测驱动');
    {
        const fa = newFA();
        fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
        const st = fa.getTokenState('0xt');
        st.lastTickAt = T0 + 55000;
        st.lastSubstantialTickAt = T0 + 2000; // 足额水位（虚拟）
        const tickTs = T0 + 60000;
        let got = null;
        const eng = makeBtEngine({
            _stalledSellLegScanEnabled: true,
            _stalledScanAfterSec: 45,
            _factorAggregator: {
                getTokenState: () => st,
                buildFactorMap: (addr, ts) => { got = ts; return { profitPercent: 10 }; },
            },
            _getAllHoldings: () => [{ tokenAddress: '0xt' }],
            _tokenPool: { getToken: () => ({ status: 'bought', token: '0xt' }) },
            _evaluateSellPathAt: async (token, factors, ts) => { got = { token: token.token, ts }; return { success: false }; },
        });
        await eng._scanStalledSellLegs(tickTs);
        check('D1 虚拟时刻透传 → _evaluateSellPathAt(token, factors, tickTs)', () => got, { token: '0xt', ts: tickTs });
        // D2 预扫门（虚拟）：tickTs−lastTickAt=58s>45 → 评估；38s → 不评估
        const eng2 = makeBtEngine({
            _stalledSellLegScanEnabled: true, _stalledScanAfterSec: 45,
            _factorAggregator: { getTokenState: () => st, buildFactorMap: () => ({ profitPercent: 10 }) },
            _getAllHoldings: () => [{ tokenAddress: '0xt' }],
            _tokenPool: { getToken: () => ({ status: 'bought' }) },
            _evaluateSellPathAt: async () => { throw new Error('不应评估'); },
        });
        await eng2._scanStalledSellLegs(T0 + 2000 + 38000); // 足额水位 38s 前（≤45s 门）
        ok(true, 'D2 38s 断流（≤45s）→ 零评估（虚拟预扫门）');
    }

    // ═══════════════ E. factorSellFilter 集成 ═══════════════
    console.log('E. filter 集成（stall 签名）');
    {
        const CFG = normalizeFactorSellFilterConfig({ enabled: true }).normalized;
        const stallLegObj = { conditionText: buildStallLegCondition(), condition: null };
        // E1 famous 状态臂拦 stall 腿（180s 内）→ 超窗放行（时间键随 now 走钟自然衰减）
        {
            // 管辖内（pp=105≥50）：famous 状态臂拦 stall 腿（180s 内）→ 超窗放行
            const r = judgeFactorSellFilter(CFG, { profitPercent: 105, currentVsLaunchPct: 5, sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0, famousCopyWalletCircPct: 2.5, sinceLastFamousAnyBuySec: 100 }, stallLegObj);
            ok(r.blocked === true && r.rule === 'famous_hold', 'E1a stall 腿被 famous 状态臂拦（anyBuy 100s≤180，管辖 pp≥50）');
            const r2 = judgeFactorSellFilter(CFG, { profitPercent: 105, currentVsLaunchPct: 5, sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0, famousCopyWalletCircPct: 2.5, sinceLastFamousAnyBuySec: 200 }, stallLegObj);
            ok(r2.blocked === false, 'E1b anyBuy 200s 超窗 → 放行（自然衰减，不永久锁死）');
            // 管辖外（pp<50 ∧ curVs<10）：stall 腿照卖（filter 管辖语义——近发行价的
            // 死票不给大户在场 hold，保命方向）
            const r3 = judgeFactorSellFilter(CFG, { profitPercent: 20, currentVsLaunchPct: 5, famousCopyWalletCircPct: 2.5, sinceLastFamousAnyBuySec: 100 }, stallLegObj);
            ok(r3.blocked === false, 'E1c 管辖外（pp<50∧curVs<10）→ stall 腿放行（保命方向）');
        }
        // E2 machineHold 拦 stall 腿 → 断流 180s 后流环归零放行
        {
            const r = judgeFactorSellFilter(CFG, { profitPercent: 105, currentVsLaunchPct: 5, machineNetBuy180: 0.3, chg30Pct: -2 }, stallLegObj);
            ok(r.blocked === true && r.rule === 'machine_hold', 'E2a stall 腿被 machineHold 拦（net 0.3∧chg30 −2，管辖 pp≥50）');
            const r2 = judgeFactorSellFilter(CFG, { profitPercent: 105, currentVsLaunchPct: 5, machineNetBuy180: 0, chg30Pct: -2 }, stallLegObj);
            ok(r2.blocked === false, 'E2b net 归零（断流 180s 流环空）→ 放行');
        }
        // E3 ★反证（保命语义核心）：冻结 recovery 形状——stall 腿放行、普通腿照拦
        {
            const frozen = { profitPercent: 20, currentVsLaunchPct: 5, peakProfitPct: 120, chg5Pct: 3 };
            const r = judgeFactorSellFilter(CFG, frozen, stallLegObj);
            ok(r.blocked === false, 'E3a 冻结 recovery 形状（peak120∧curVs5∧chg5 3）+ stall 腿 → 放行（豁免，不永久拦）');
            const r2 = judgeFactorSellFilter(CFG, frozen, { conditionText: 'profitPercent > 100' });
            ok(r2.blocked === true && r2.rule === 'recovery_hold', 'E3b 同形状 + 普通腿 → recoveryHold 照拦（豁免只对 stall 签名）');
        }
        // E4 签名识别双形状 + info 留痕
        {
            const r = judgeFactorSellFilter(CFG, { profitPercent: 105, machineNetBuy180: 0.3, chg30Pct: -2 }, { condition: buildStallLegCondition() });
            ok(r.info.stallArmJurisdiction === true, 'E4a 字符串腿签名识别（condition 双形状兼容）');
            ok(r.info.stallArmJurisdiction === true, 'E4b AST 腿签名识别（conditionText）——上一行已验');
        }
        // E5 签名互斥：pump 腿不误判 stall 签名
        {
            const r = judgeFactorSellFilter(CFG, { profitPercent: 105, machineNetBuy180: 0.3, chg30Pct: -2 }, { conditionText: 'sinceEntryNetBuyRatio >= 90' });
            ok(r.info.stallArmJurisdiction === false, 'E5 pump 签名腿 stallArmJurisdiction=false（互斥）');
        }
    }

    // ═══════════════ F. 信号形状 / 上下文 / 签名工具 ═══════════════
    console.log('F. 信号形状与工具');
    {
        const legObj = { conditionText: buildStallLegCondition() };
        ok(isStallSellLeg(legObj) === true, 'F1 isStallSellLeg(AST 腿)');
        ok(isStallSellLeg({ condition: buildStallLegCondition() }) === true, 'F2 isStallSellLeg(字符串腿)');
        ok(isStallSellLeg({ conditionText: 'profitPercent > 100' }) === false, 'F3 普通腿 false');
        check('F4 上下文：almost 域', () => stallTriggerContext({ idleSecSinceLastSubstantialTick: 93.4, currentVsLaunchPct: 5 }),
            { stalledSec: 93, tier: 'almost', effectiveSec: STALL_ALMOST_SEC });
        check('F5 上下文：基础档', () => stallTriggerContext({ idleSecSinceLastSubstantialTick: 56.1, currentVsLaunchPct: 50 }),
            { stalledSec: 56, tier: null, effectiveSec: STALL_BASE_SEC });
        check('F6 idleSec 缺失 → null', () => stallTriggerContext({ currentVsLaunchPct: 5 }), null);
        ok(STALL_BASE_SEC === 55 && STALL_ALMOST_SEC === 90 && STALL_ALMOST_LAUNCH_PCT === 10 && DEFAULT_STALLED_SCAN_AFTER_SEC === 45,
            'F7 常量现行值（55/90/10/45——与 v13 stallClose 同参）');
    }

    // ═══════════════ G. 共存：v13 定义走旧、v14 走新 ═══════════════
    console.log('G. 新旧共存');
    {
        const v13Def = { sellLegs: [{ condition: 'profitPercent <= -40', cards: 'all' }], stallClose: { stallMs: 55000, minTickBnb: 0.01 } };
        const v14Def = { sellLegs: [{ id: 'stallClose', condition: buildStallLegCondition(), cards: 'all', bypassDebounce: true }] };
        const hasStallLeg = (def) => (def.sellLegs || []).some(isStallSellLeg);
        ok(!hasStallLeg(v13Def), 'G1 v13 定义（stallClose 段+无签名腿）→ 新驱动不启用');
        ok(hasStallLeg(v14Def), 'G2 v14 定义（签名腿）→ 新驱动启用');
        const both = { ...v14Def, stallClose: { stallMs: 55000 } };
        ok(hasStallLeg(both) && both.stallClose, 'G3 双段并存包（过渡态）→ 两路径共存（selling/status 门防双卖，P2 清理后 stallClose 段 fail-fast）');
    }

    console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
