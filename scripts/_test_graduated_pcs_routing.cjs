#!/usr/bin/env node
/**
 * 毕业票 PCS 路由——本地零 DB 零网络单测
 *
 * 背景（2026-10-24 豆皮 0x1fad…7777 / 水 0x25e2…7777 案，用户裁定
 * 「FA.graduated 票也走 PCS 路由」）：
 *   ① PancakeSwapV2Trader 构造崩溃修复：BaseTrader.initProvider 构造期调
 *      this.log，本类缺该方法 → 构造 throw（this.log is not a function）——
 *      毕业票手工卖自 2026-10-22 上线起从未成功过（两次按钮清仓全失败，
 *      豆皮 88,371.62 / 水 69,836.99 滞留钱包）
 *   ② flap 非 BNB 计价盘毕业对 = token/quote（非 WBNB）→ 卖出二跳
 *      [token, quote, WBNB]（swapExactTokensForETH 终点解包原生 BNB）
 *   ③ 引擎 _executeSellLive：FA graduated 票自动卖（策略腿/止损/扫描兜底）
 *      路由 PCS + options 分流——PCS 分支不带 minOutRatio/expectedNativeOut
 *      （旧 L1 锚=毕业断流后恒陈旧信号价，quote 活报价对陈旧锚必拒 →
 *      30min 熔断循环 7 连败事故形状）
 *
 * 用法：node scripts/_test_graduated_pcs_routing.cjs
 */
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function ok(cond, name, actual) {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}${actual !== undefined ? ' | 实际 ' + JSON.stringify(actual) : ''}`); }
}

// ═══════════════ 1. PCS trader 构造（事故反证）═══════════════
console.log('[1] PancakeSwapV2Trader 构造修复（this.log is not a function 反证）');
{
    const PancakeSwapV2Trader = require(path.join(ROOT, 'src/trading-engine/traders/implementations/PancakeSwapV2Trader'));
    let trader = null, threw = null;
    try { trader = new PancakeSwapV2Trader({ network: { rpcUrl: 'http://localhost:1' } }); } // JsonRpcProvider 构造不发请求
    catch (e) { threw = e.message; }
    ok(trader !== null && threw === null,
        '构造不再抛（修复前：Failed to initialize provider: this.log is not a function）', threw);

    // log/setLogger 三参标准形状（进实验日志文件）
    const lines = [];
    const fakeLogger = {
        info: (exp, mod, msg) => lines.push(['info', exp, mod, msg]),
        warn: (exp, mod, msg) => lines.push(['warn', exp, mod, msg]),
        error: (exp, mod, msg) => lines.push(['error', exp, mod, msg]),
    };
    trader.setLogger(fakeLogger, 'exp-test');
    trader.log('普通行');
    trader.log('警告行', 'warning');
    trader.log('错误行', 'error');
    ok(lines.length === 3
        && lines[0][0] === 'info' && lines[2][0] === 'error'
        && lines.every(l => l[1] === 'exp-test' && l[2] === 'PancakeSwapV2Trader'),
        'log 走三参标准形状（experimentId, module, message）', lines);

    // logger 抛异常 → console 兜底不崩
    let survived = true;
    try { trader.setLogger({ info() { throw new Error('logger dead'); }, error() { throw new Error('logger dead'); } }, 'x'); trader.log('兜底行'); }
    catch { survived = false; }
    ok(survived, 'logger 异常 → console 兜底不崩');

    // 无 logger（web/脚本裸用）→ console 路径不崩
    const bare = new PancakeSwapV2Trader({ network: { rpcUrl: 'http://localhost:1' } });
    let bareOk = true;
    try { bare.log('裸用'); } catch { bareOk = false; }
    ok(bareOk, '无 logger 裸用不崩');
}

// ═══════════════ 2. 卖出路由路径（buildSellPath 纯函数）═══════════════
console.log('[2] buildSellPath（WBNB 单跳 / quote 盘二跳）');
{
    const PancakeSwapV2Trader = require(path.join(ROOT, 'src/trading-engine/traders/implementations/PancakeSwapV2Trader'));
    const trader = new PancakeSwapV2Trader({ network: { rpcUrl: 'http://localhost:1' } });
    const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
    const TOKEN = '0x1fad9e01ed7632b8bfc99e2a5193087cd26a7777'; // 豆皮
    const QUOTE = '0x55d398326f99059ff775485246999027b3197955'.toUpperCase(); // 大小写故意不同（归一判定）

    ok(JSON.stringify(trader.buildSellPath(TOKEN)) === JSON.stringify([TOKEN, WBNB]),
        '无 quote → WBNB 单跳（four.meme 毕业 / flap BNB 盘）', trader.buildSellPath(TOKEN));
    ok(JSON.stringify(trader.buildSellPath(TOKEN, QUOTE)) === JSON.stringify([TOKEN, QUOTE, WBNB]),
        'quote 盘 → 二跳 [token, quote, WBNB]（豆皮案形状）', trader.buildSellPath(TOKEN, QUOTE));
    ok(JSON.stringify(trader.buildSellPath(TOKEN, WBNB)) === JSON.stringify([TOKEN, WBNB]),
        'quote=WBNB（大小写不敏感）→ 仍单跳不绕环', trader.buildSellPath(TOKEN, WBNB));
    ok(JSON.stringify(trader.buildSellPath(TOKEN, WBNB.toUpperCase())) === JSON.stringify([TOKEN, WBNB]),
        'quote=WBNB 大写形态 → 仍单跳', trader.buildSellPath(TOKEN, WBNB.toUpperCase()));
}

// ═══════════════ 3. 引擎 _executeSellLive 毕业路由 + options 分流 ═══════════════
console.log('[3] _executeSellLive 毕业票路由 PCS + options 分流');
{
    // Trade 实体打桩（_executeSellLive 收尾 new Trade().save()）
    const ENTITIES_PATH = require.resolve(path.join(ROOT, 'src/trading-engine/entities'));
    require.cache[ENTITIES_PATH] = {
        id: ENTITIES_PATH, filename: ENTITIES_PATH, loaded: true,
        exports: {
            Trade: class {
                constructor(fields) { Object.assign(this, fields); this.txHash = fields.txHash || null; }
                async save() { return 1; }
            },
        },
    };

    // dbManager 打桩（_liveGraduatedInfo 持久回查：FA state 缺失时查 wss_events）
    let dbRows = [];        // 回查返回行（kind/payload）
    let dbError = null;     // 回查错误（fail-closed 按未毕业）
    const dbCalls = [];     // 查询审计
    const DBM_PATH = require.resolve(path.join(ROOT, 'src/services/dbManager'));
    require.cache[DBM_PATH] = {
        id: DBM_PATH, filename: DBM_PATH, loaded: true,
        exports: {
            dbManager: {
                getClient: () => ({
                    from(table) {
                        const call = { table, eqs: [], ins: [] };
                        dbCalls.push(call);
                        return {
                            select(cols) { call.select = cols; return this; },
                            eq(c, v) { call.eqs.push([c, v]); return this; },
                            in(c, vs) { call.ins.push([c, vs]); return this; },
                            limit(n) { call.limit = n; return this; },
                            then(resolve) { resolve({ data: dbError ? null : dbRows, error: dbError }); },
                        };
                    },
                }),
            },
        },
    };
    const { FourMemeWssTradingEngine } = require(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine'));

    const MARKER_PCS = { _pcs: true, async sellToken(addr, amount, options) { return { success: true, txHash: '0xpcs', actualReceived: '1.5', gasUsed: 1n }; } };
    const MARKER_PLATFORM = { _platform: true, async sellToken(addr, amount, options) { return { success: true, txHash: '0xfm', actualReceived: '1.5', gasUsed: 1n }; } };

    function mkEngine(gradState) {
        const calls = { traders: [], options: [] };
        const eng = Object.assign(Object.create(FourMemeWssTradingEngine.prototype), {
            _experimentId: 'test-exp',
            logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
            _isLive: true,
            _liveSlippagePct: 20, _liveMaxGasPriceGwei: 10, _liveMinOutRatio: 0.5,
            _factorAggregator: { getTokenState: () => gradState },
            _getOnChainTokenBalance: async () => null,
            _getBnbUsd: () => 600,
            _ensurePcsTrader: async function () { this._pcsTrader = MARKER_PCS; return MARKER_PCS; },
            _liveTraderFor: () => MARKER_PLATFORM,
            _liveRecordTrade: async () => {},
        });
        eng._pcsTrader = null;
        // 记录真实 sellToken 调用（包装两个 marker）
        MARKER_PCS.sellToken = async (addr, amount, options) => { calls.traders.push('pcs'); calls.options.push(options); return { success: true, txHash: '0xpcs', actualReceived: '1.5', gasUsed: 1n }; };
        MARKER_PLATFORM.sellToken = async (addr, amount, options) => { calls.traders.push('platform'); calls.options.push(options); return { success: true, txHash: '0xfm', actualReceived: '1.5', gasUsed: 1n }; };
        return { eng, calls };
    }
    const signal = { tokenAddress: '0x1fad9e01ed7632b8bfc99e2a5193087cd26a7777', symbol: '豆皮', price: 1e-7, chain: 'bsc' };

    (async () => {
        // 3.1 FA graduated + quote 盘 → PCS + 二跳 quoteToken + PCS 形状 options（无 L1 陈旧锚）
        const q1 = mkEngine({ graduated: true, quoteToken: '0x55d398326f99059ff775485246999027b3197955' });
        const r1 = await q1.eng._executeSellLive(signal, null, {}, { amount: 1000 }, 1);
        ok(r1.success === true && q1.calls.traders[0] === 'pcs', '毕业票自动卖路由 PCS（非平台内盘 trader）', q1.calls.traders);
        const o1 = q1.calls.options[0];
        ok(o1 && o1.slippage === 0.2 && o1.quoteToken === '0x55d398326f99059ff775485246999027b3197955',
            'PCS options：滑点 20%→0.2 小数 + quoteToken 二跳', o1);
        ok(!('minOutRatio' in o1) && !('expectedNativeOut' in o1) && !('slippageTolerance' in o1),
            'PCS 分支不带 L1 陈旧锚键（毕业断流票 30min 熔断循环事故形状反证）', o1);

        // 3.2 毕业票 BNB 盘（quoteToken null）→ PCS 单跳
        const q2 = mkEngine({ graduated: true, quoteToken: null });
        await q2.eng._executeSellLive(signal, null, {}, { amount: 1000 }, 1);
        ok(q2.calls.traders[0] === 'pcs' && q2.calls.options[0].quoteToken === null,
            '毕业票 BNB 盘 → PCS 单跳（quoteToken null）', q2.calls.options[0]);

        // 3.3 未毕业 → 平台 trader + 平台形状 options（含 L1 键，行为不变）
        const q3 = mkEngine({ graduated: false, quoteToken: null });
        await q3.eng._executeSellLive(signal, null, {}, { amount: 1000 }, 1);
        ok(q3.calls.traders[0] === 'platform', '未毕业票照走平台内盘 trader（行为不变）', q3.calls.traders);
        const o3 = q3.calls.options[0];
        ok(o3 && o3.slippageTolerance === 20 && o3.minOutRatio === 0.5 && o3.maxGasPrice === 10
            && typeof o3.expectedNativeOut === 'number',
            '平台 options 形状不变（slippageTolerance/minOutRatio/expectedNativeOut）', o3);

        // 3.4 FA 无 state（getTokenState null）→ 持久回查空 → 平台 trader（null 安全）
        dbRows = []; dbError = null; dbCalls.length = 0;
        const q4 = mkEngine(null);
        await q4.eng._executeSellLive(signal, null, {}, { amount: 1000 }, 1);
        ok(q4.calls.traders[0] === 'platform', 'FA state 缺失+回查空 → 平台 trader（null 安全）', q4.calls.traders);

        // 3.5 手工卖 traderOverride（=this._pcsTrader）→ PCS options 分流同款
        const q5 = mkEngine({ graduated: true, quoteToken: null });
        q5.eng._pcsTrader = MARKER_PCS;
        await q5.eng._executeSellLive(signal, null, {}, { amount: 1000 }, 1, MARKER_PCS);
        ok(q5.calls.traders[0] === 'pcs' && q5.calls.options[0].slippage === 0.2,
            'traderOverride（手工 PCS）同走 PCS options 分流（默认滑点修复：旧路径 1%）', q5.calls.options[0]);

        // ═══ 4. 毕业判定持久回查（2026-10-24 豆皮/水重启后手工卖案）═══
        // FA state 是进程内存态：重启后毕业票不再有 token_create/tick，state 不重建
        // → 旧读法 st?.graduated 恒 falsy → 平台内盘 trader 必 revert；quoteToken
        //（二跳路由依据）同丢。持久源=wss_events（graduation=毕业事实；
        // token_quote_set=flap 非 BNB 计价终态）
        console.log('[4] _liveGraduatedInfo 持久回查（FA 缺失 → wss_events）');
        const QUOTE = '0x55d398326f99059ff775485246999027b3197955';

        // 4.1 FA 缺失 + graduation 行带 quoteToken → PCS + 二跳（豆皮重启后形状）
        dbRows = [{ kind: 'graduation', payload: { token: signal.tokenAddress, fundsBnb: 16.0, quoteToken: QUOTE } }];
        dbError = null; dbCalls.length = 0;
        const q6 = mkEngine(null);
        await q6.eng._executeSellLive(signal, null, {}, { amount: 1000 }, 1);
        ok(q6.calls.traders[0] === 'pcs' && q6.calls.options[0].quoteToken === QUOTE,
            'FA 缺失+回查命中 graduation → PCS + quoteToken 二跳（重启后豆皮）', q6.calls.options[0]);
        ok(dbCalls.length === 1 && dbCalls[0].table === 'wss_events'
            && dbCalls[0].eqs.some(([c, v]) => c === 'token_address' && v === signal.tokenAddress)
            && dbCalls[0].ins.some(([c, vs]) => c === 'kind' && vs.includes('graduation') && vs.includes('token_quote_set')),
            '回查形状：token_address 等值 + kind in (graduation, token_quote_set)', dbCalls[0]);

        // 4.2 FA 缺失 + graduation 行 quoteToken null（BNB 盘/水）→ PCS 单跳
        dbRows = [{ kind: 'graduation', payload: { token: signal.tokenAddress, fundsBnb: 16.0, quoteToken: null } }];
        const q7 = mkEngine(null);
        await q7.eng._executeSellLive(signal, null, {}, { amount: 1000 }, 1);
        ok(q7.calls.traders[0] === 'pcs' && q7.calls.options[0].quoteToken === null,
            'FA 缺失+回查 graduation 无 quote → PCS 单跳（重启后水）', q7.calls.options[0]);

        // 4.3 FA 缺失 + 仅 token_quote_set 行（未毕业）→ 平台 trader（quote 盘未毕业走内盘正确）
        dbRows = [{ kind: 'token_quote_set', payload: { token: signal.tokenAddress, quoteToken: QUOTE } }];
        const q8 = mkEngine(null);
        await q8.eng._executeSellLive(signal, null, {}, { amount: 1000 }, 1);
        ok(q8.calls.traders[0] === 'platform', '回查无 graduation 行 → 未毕业走平台（不误路由）', q8.calls.traders);

        // 4.4 FA 缺失 + 回查 DB 错误 → fail-closed 按未毕业平台路径（revert 可见不冒充）
        dbRows = []; dbError = { message: 'vpn timeout' };
        const q9 = mkEngine(null);
        await q9.eng._executeSellLive(signal, null, {}, { amount: 1000 }, 1);
        ok(q9.calls.traders[0] === 'platform', '回查失败 → 平台路径（fail-closed 可见）', q9.calls.traders);

        // 4.5 FA state graduated=true（活跃进程内毕业票）→ 零 DB 查询（write-once 可信短路）
        dbRows = [{ kind: 'graduation', payload: { quoteToken: QUOTE } }];
        dbError = null; dbCalls.length = 0;
        const q10 = mkEngine({ graduated: true, quoteToken: null });
        await q10.eng._executeSellLive(signal, null, {}, { amount: 1000 }, 1);
        ok(q10.calls.traders[0] === 'pcs' && q10.calls.options[0].quoteToken === null
            && dbCalls.length === 0,
            'FA graduated=true → 内存答案零 DB（活跃进程毕业票 quoteToken 以内存为准）', { traders: q10.calls.traders, db: dbCalls.length });

        // 4.5b FA state graduated=false + DB 空（活跃未毕业票常态）→ 平台 + 一次复核
        dbRows = []; dbError = null; dbCalls.length = 0;
        const q10b = mkEngine({ graduated: false, quoteToken: null });
        await q10b.eng._executeSellLive(signal, null, {}, { amount: 1000 }, 1);
        ok(q10b.calls.traders[0] === 'platform' && dbCalls.length === 1,
            'FA graduated=false → 仍 DB 复查一次（卖出低频可接受）', { traders: q10b.calls.traders, db: dbCalls.length });

        // 4.7 事故反证（2026-10-24 05:28 豆皮/水）：重启后持仓回放重建 state
        // （graduated=false）+ wss_events 有 graduation 行 → 必须 PCS——旧实现
        // `if (st) return 内存答案` 短路回查误走平台路径（flap Portal 侥幸成交，
        // four.meme TM2 必 revert）
        dbRows = [{ kind: 'graduation', payload: { token: signal.tokenAddress, quoteToken: QUOTE } }];
        dbError = null; dbCalls.length = 0;
        const q12 = mkEngine({ graduated: false, quoteToken: null });
        await q12.eng._executeSellLive(signal, null, {}, { amount: 1000 }, 1);
        ok(q12.calls.traders[0] === 'pcs' && q12.calls.options[0].quoteToken === QUOTE && dbCalls.length === 1,
            '事故反证：state 在场 graduated=false + graduation 行 → PCS 二跳（不再短路）',
            { traders: q12.calls.traders, options: q12.calls.options[0], db: dbCalls.length });

        // 4.6 手工卖路由（_executeManualSell）同样走持久回查：FA 缺失+graduation → PCS
        dbRows = [{ kind: 'graduation', payload: { token: signal.tokenAddress, quoteToken: QUOTE } }];
        dbError = null;
        const q11 = mkEngine(null);
        q11.eng._manualSellLocks = new Set();
        q11.eng._sellingTokens = new Set();
        q11.eng._saveManualSignal = async () => ({ signalId: 'sig-1', signalRow: null });
        q11.eng._finalizeManualSignal = async () => {};
        q11.eng._executeSell = async (sig, signalId, meta, traderOverride) => {
            q11.calls.traders.push(traderOverride === MARKER_PCS ? 'pcs' : 'platform');
            return { success: true, txHash: '0xpcs' };
        };
        const r11 = await q11.eng._executeManualSell(
            { token_address: signal.tokenAddress, sell_pct: 1, cards: null, id: 'req-1' }, '豆皮', 0, {});
        ok(r11.success === true && q11.calls.traders[0] === 'pcs',
            '_executeManualSell FA 缺失+回查毕业 → traderOverride=PCS（重启后按钮清仓路径）', q11.calls.traders);

        console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
        process.exitCode = fail === 0 ? 0 : 1;
    })().catch(e => { console.error('CRASH', e); process.exitCode = 1; });
}
