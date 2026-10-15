#!/usr/bin/env node
/**
 * _liveRecordTrade 卖出记账精度钳制单测（2026-10-15 GROK P11 幽灵持仓案；零 DB 零网络）
 *
 * 案情：GROK 0x5279…7777 P11 全清卖出链上成功，qtySold 链上 formatEther→parseEther
 * 往返 = 162508.04552909007 vs 账面 Decimal 162508.04552909006（相对差 ~6e-17）被
 * PM 以 Insufficient token balance 拒绝；旧 _liveRecordTrade 对账重试只修 cash 不修
 * token 持仓 → 二次同错 → null → 账面 162508 永久挂账（experiment_tokens 停留
 * bought），SyncHoldings 每 5min 误报「外部处置」。
 *
 * 修复：卖出方向 Insufficient token balance 且相对差 ≤1e-9 → 钳到账面持有量
 * （Decimal 原值）重试——与执行层重放精度钳制同语义。
 *
 * 覆盖：
 *   T1 事故现场反证（GROK 实数）：…907 vs 账面 …906 → 钳制 → 记账成功 + 持仓删仓
 *      （幽灵持仓消灭）+ 无 error log
 *   T2 真超卖不钳：卖 150 vs 账面 100（差 50%）→ 二次失败 → null + error log 留痕
 *   T3 部分卖正常回归：卖量 < 账面 → 一次成功（不进 catch）
 *   T4 cash 不足语义不变：Insufficient cash（非 token）→ 不进钳制分支 →
 *      _reconcileLiveCash 被调 → 重试仍失败 → null（原对账路径原样）
 *   T5 钳制阈值边界：相对差恰 1e-9 钳；1.0000001e-9 不钳
 *
 * 手法：FourMemeWssTradingEngine.prototype._liveRecordTrade.call(fakeThis)——真 PM
 * 实例（纯内存账本），_reconcileLiveCash/logger 打桩（同 _test_holdings_replay_precision）。
 *
 * 用法：node scripts/_test_live_record_trade_clamp.cjs
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const Decimal = require(path.join(ROOT, 'node_modules/decimal.js'));
const { PortfolioManager } = require(path.join(ROOT, 'src/portfolio/core/PortfolioManager'));
const { FourMemeWssTradingEngine } = require(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine'));

let passed = 0, failed = 0;
const failures = [];
function ok(cond, msg, got) {
    if (cond) { passed++; return; }
    failed++;
    const line = `  ✗ ${msg}${got !== undefined ? ` | got=${typeof got === 'string' ? got : JSON.stringify(got)}` : ''}`;
    failures.push(line);
    console.error(line);
}

const ADDR = '0x5279a679b7a703cbb9974e4abb4fdaab33ac7777';

/**
 * fakeThis + 真 PM：账面买入 amount 一次（字符串传 Decimal 精确入账——GROK 实数
 * …906/…907 差 1e-11 在 double 中同值，Number 传参构造不出精度差，必须字符串）
 */
async function mkSelf(buyAmount, initialCash = 1e8) {
    const pm = new PortfolioManager();
    const portfolioId = await pm.createPortfolio(initialCash, { blockchain: 'bsc' });
    await pm.executeTrade(portfolioId, ADDR, 'buy', buyAmount, 0.1, 0);
    const logs = { warn: [], error: [] };
    let reconciles = 0;
    const self = {
        _portfolioManager: pm,
        _portfolioId: portfolioId,
        _reconcileLiveCash: async () => { reconciles++; },
        logger: {
            info: () => {},
            warn: (...a) => logs.warn.push(a.join(' ')),
            error: (...a) => logs.error.push(a.join(' ')),
        },
    };
    return { self, pm, portfolioId, logs, reconciled: () => reconciles };
}

const posAmount = (pm, pid) => pm.getPortfolio(pid)?.positions?.get(ADDR)?.amount;

(async () => {
    // ---- T1 事故现场反证（GROK 实数；双字符串构造真实 1e-11 精度差） ----
    {
        const { self, pm, portfolioId, logs } = await mkSelf('162508.04552909006');
        const res = await FourMemeWssTradingEngine.prototype._liveRecordTrade.call(
            self, 'sell', { tokenAddress: ADDR }, '162508.04552909007', 0.0000152);
        ok(res && res.success, 'T1a GROK 现场钳制后记账成功（非 null）', res);
        ok(posAmount(pm, portfolioId) === undefined, 'T1b 持仓删仓（幽灵持仓消灭）', String(posAmount(pm, portfolioId)));
        ok(logs.error.length === 0, 'T1c 无 error log', logs.error.join('; '));
        ok(logs.warn.some(w => w.includes('钳到账面持有量')), 'T1d 钳制留痕 warn', logs.warn.join('; '));
    }
    // ---- T2 真超卖不钳 ----
    {
        const { self, pm, portfolioId, logs } = await mkSelf(100);
        const res = await FourMemeWssTradingEngine.prototype._liveRecordTrade.call(
            self, 'sell', { tokenAddress: ADDR }, 150, 0.1);
        ok(res === null, 'T2a 真超卖返回 null（不掩盖）', res);
        ok(Number(posAmount(pm, portfolioId)) === 100, 'T2b 账面原样保留', String(posAmount(pm, portfolioId)));
        ok(logs.error.some(e => e.includes('Insufficient token balance')), 'T2c error log 留痕', logs.error.join('; '));
    }
    // ---- T3 部分卖正常回归 ----
    {
        const { self, pm, portfolioId, logs } = await mkSelf(200);
        const res = await FourMemeWssTradingEngine.prototype._liveRecordTrade.call(
            self, 'sell', { tokenAddress: ADDR }, 50, 0.1);
        ok(res && res.success, 'T3a 部分卖一次成功', res);
        ok(Number(posAmount(pm, portfolioId)) === 150, 'T3b 余仓 150', String(posAmount(pm, portfolioId)));
        ok(logs.warn.length === 0 && logs.error.length === 0, 'T3c 零告警（未进 catch）');
    }
    // ---- T4 cash 不足语义不变 ----
    {
        const { self, logs, reconciled } = await mkSelf(10, 100); // 初始 100：买入 10 花 1 剩 99
        // cash 不足触发 PM buy 路径的 Insufficient cash balance；sell 方向构造 cash 不足无直接
        // 路径，以买入方向回归「对账重试 → 仍失败 → null」原路径（stub 不修 cash 二次同错）
        const res = await FourMemeWssTradingEngine.prototype._liveRecordTrade.call(
            self, 'buy', { tokenAddress: ADDR }, 100000, 0.1);
        ok(res === null, 'T4a buy cash 不足 → 对账重试仍失败 → null', res);
        ok(reconciled() === 1, 'T4b _reconcileLiveCash 恰调用一次', reconciled());
        ok(logs.error.some(e => e.includes('Insufficient cash')), 'T4c 原对账路径留痕不变', logs.error.join('; '));
        ok(!logs.warn.some(w => w.includes('钳到账面')), 'T4d 非token类错误不进钳制分支');
    }
    // ---- T5 钳制阈值边界（字符串构造精确边界，double 运算 1000*(1+1e-9) 有舍入漂移） ----
    {
        const held = '1000';
        // 恰 1e-9（1000.000001）：钳
        {
            const { self, pm, portfolioId } = await mkSelf(held);
            const res = await FourMemeWssTradingEngine.prototype._liveRecordTrade.call(
                self, 'sell', { tokenAddress: ADDR }, '1000.000001', 0.1);
            ok(res && res.success && posAmount(pm, portfolioId) === undefined, 'T5a 相对差恰 1e-9 → 钳制成功', res);
        }
        // 1.1e-9（1000.0000011）：不钳（真超卖语义）
        {
            const { self, pm, portfolioId, logs } = await mkSelf(held);
            const res = await FourMemeWssTradingEngine.prototype._liveRecordTrade.call(
                self, 'sell', { tokenAddress: ADDR }, '1000.0000011', 0.1);
            ok(res === null && Number(posAmount(pm, portfolioId)) === 1000, 'T5b 超 1e-9 一丝 → 不钳（fail-loud）', res);
            ok(logs.error.length > 0, 'T5c error 留痕');
        }
    }

    console.log(`\n_live_record_trade_clamp: ${passed} passed, ${failed} failed`);
    if (failed > 0) { failures.forEach(f => console.error(f)); process.exit(1); }
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
