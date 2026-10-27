#!/usr/bin/env node
/**
 * live 卖出全清腿记账精确清零 + 粉尘残仓清理门单测（2026-10-27 ELON2028
 * 0xf5f3…7777 幽灵仓永动熔断案；零 DB 零网络）
 *
 * 案情：P11 全清腿链上成功，但卖量经 `new Decimal(Number(holding.amount)).mul(1)
 * .toNumber()` Number 往返——账面 Decimal …9063 变 …906 → PM remaining 3e-11 ≠ 0 →
 * eq(0) 删仓判据不成立 → 幽灵仓常驻（status=bought）；链上真粉尘 1.7684893e-11 > 0
 * → externalDisposal 臂（只认链上=0）接不住 → 「按链上数量卖出」1.77e-11 个 →
 * flap Portal 必 revert（产出 ~3e-19 BNB）→ 23:26-03:01 共 11 笔 ×337k gas，
 * 熔断 30min 冷却 + 卖腿重试 = ~31min 一轮永动。E5d 当年只修了虚拟路径的 Decimal
 * 直通（2807 行），live 路径漏了同款。
 *
 * 修复两件：
 *   (a) 全清腿（sellPct>=1）记账量=账面 Decimal 原值精确归零（ledgerQty）；
 *   (b) 粉尘残仓清理门：expectedNativeOut < dustCloseValueBnb（默认 1e-4 BNB，
 *       显式 0 关门）→ 不发链上卖单，_closeDustPosition 就地清账+落 trade+告警。
 *
 * 覆盖：
 *   T1 事故现场反证：…9063 账面全清 → PM 精确删仓；旧 Number 往返形状重放 → 残仓
 *      恰 3e-11（日志账面值）不删仓
 *   T2 粉尘门命中（事故实数）：不发 tx + success=true + dustClose 留痕 + PM 删仓 +
 *      trade 行 inputAmount=账面原值 + 告警恰一次
 *   T3 正常仓照发：expectedNativeOut=5e-3 > 线 → 走链上卖单（bit 一致）
 *   T4 锚缺失 fail-open：bnbUsd=0 → expectedNativeOut=null → 粉尘仓也照发（不误杀）
 *   T5 externalDisposal 语义不变：链上=0 照旧外部处置臂（先于粉尘门）
 *   T6 部分腿记账量=链上请求量（余仓语义不变）
 *   T7 显式 0 关门：粉尘仓照发
 *
 * 手法：FourMemeWssTradingEngine.prototype._executeSellLive.call(fakeThis)——真 PM
 * （纯内存账本）+ 打桩 trader/balanceOf/告警，entities.Trade 原型打桩落库捕获
 * （同 _test_live_record_trade_clamp）。
 *
 * 用法：node scripts/_test_live_dust_close.cjs
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const Decimal = require(path.join(ROOT, 'node_modules/decimal.js'));
const { PortfolioManager } = require(path.join(ROOT, 'src/portfolio/core/PortfolioManager'));
const { FourMemeWssTradingEngine } = require(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine'));
const entities = require(path.join(ROOT, 'src/trading-engine/entities'));

let passed = 0, failed = 0;
const failures = [];
function ok(cond, msg, got) {
    if (cond) { passed++; return; }
    failed++;
    const line = `  ✗ ${msg}${got !== undefined ? ` | got=${typeof got === 'string' ? got : JSON.stringify(got)}` : ''}`;
    failures.push(line);
    console.error(line);
}

const ADDR = '0xf5f3f01bacbfc2a8f08451eee501712693377777'; // 事故票 ELON2028（小写=PM 规范化键）

// entities.Trade 打桩：捕获构造入参，save() 返回假 id（重放/审计口径断言用）
const savedTrades = [];
const RealTrade = entities.Trade;
entities.Trade = class {
    constructor(d) { Object.assign(this, new RealTrade(d)); savedTrades.push(this); }
    async save() { return this.id; }
};

/**
 * fakeThis + 真 PM：按入参串精确入账（事故精度差在 double 中不可构造，必须字符串）
 */
async function mkSelf({ buyAmount, partialSellAmount, onChainQty, bnbUsd = 600, dustLine = 0.0001 }) {
    const pm = new PortfolioManager();
    const portfolioId = await pm.createPortfolio(1e8, { blockchain: 'bsc' });
    await pm.executeTrade(portfolioId, ADDR, 'buy', buyAmount, 0.1, 0);
    if (partialSellAmount != null) {
        await pm.executeTrade(portfolioId, ADDR, 'sell', partialSellAmount, 0.1, 0);
    }
    const holding = pm.getPortfolio(portfolioId).positions.get(ADDR);

    let sellCalls = 0, alerts = 0;
    const trader = {
        sellToken: async () => { sellCalls++; return { success: true, actualReceived: '0.0029', transactionHash: '0xabc', gasUsed: '150000', gasPrice: '50000000' }; },
    };
    const logs = { warn: [], error: [], info: [] };
    const self = {
        _portfolioManager: pm,
        _portfolioId: portfolioId,
        _liveRecordTrade: FourMemeWssTradingEngine.prototype._liveRecordTrade, // 真 PM 记账路径（End-to-End 精确清零断言）
        _closeDustPosition: FourMemeWssTradingEngine.prototype._closeDustPosition,
        _reconcileLiveCash: async () => {},
        _experimentId: 'test-exp',
        _dustCloseValueBnb: dustLine,
        _liveSlippagePct: 20,
        _liveMaxGasPriceGwei: 10,
        _liveMinOutRatio: 0.5,
        logger: {
            info: (...a) => logs.info.push(a.join(' ')),
            warn: (...a) => logs.warn.push(a.join(' ')),
            error: (...a) => logs.error.push(a.join(' ')),
        },
        _getOnChainTokenBalance: async () => onChainQty,
        _getBnbUsd: () => bnbUsd,
        _liveGraduatedInfo: async () => ({ graduated: false, quoteToken: null }),
        _liveTraderFor: () => trader,
        _notifyLiveAlert: () => { alerts++; },
    };
    return { self, pm, portfolioId, holding, trader, logs, sellCount: () => sellCalls, alertCount: () => alerts };
}

const posAmount = (pm, pid) => pm.getPortfolio(pid)?.positions?.get(ADDR)?.amount;
const mkSignal = (price) => ({ tokenAddress: ADDR, symbol: 'ELON2028', price });

(async () => {
    // ---- T1 事故现场反证（ELON2028 实数）：全清腿记账精确清零 ----
    {
        savedTrades.length = 0;
        const { self, pm, portfolioId, holding, sellCount } = await mkSelf({
            buyAmount: '394712.54130685417',
            partialSellAmount: '98678.13532671354', // P9 25% 腿
            onChainQty: null, // 链上查询失败 → 用账面量（隔离记账路径）
        });
        ok(holding.amount.toString() === '296034.40598014063', 'T1pre 账面 Decimal 原值 …9063', holding.amount.toString());
        const res = await FourMemeWssTradingEngine.prototype._executeSellLive.call(
            self, mkSignal(1.1327349e-5), 'sig1', {}, holding, 1, null);
        ok(res && res.success && res.dustClose !== true, 'T1a 全清腿链上成交 success', res && res.success);
        ok(sellCount() === 1, 'T1b 正常仓走了链上卖单（量 296034 不触粉尘门）', sellCount());
        ok(posAmount(pm, portfolioId) === undefined, 'T1c PM 精确删仓（幽灵仓消灭）', String(posAmount(pm, portfolioId)));
        // 旧代码形状重放反证：同样的账面经 Number 往返记账 → 残仓恰 3e-11（日志账面值）
        const pm2 = new PortfolioManager();
        const pid2 = await pm2.createPortfolio(1e8, { blockchain: 'bsc' });
        await pm2.executeTrade(pid2, ADDR, 'buy', '394712.54130685417', 0.1, 0);
        await pm2.executeTrade(pid2, ADDR, 'sell', '98678.13532671354', 0.1, 0);
        const rem = pm2.getPortfolio(pid2).positions.get(ADDR).amount;
        const oldShape = new Decimal(Number(rem)).mul(1); // 旧代码：new Decimal(Number(holding.amount)).mul(sellPct)
        await pm2.executeTrade(pid2, ADDR, 'sell', oldShape, 0.1, 0);
        const residual = pm2.getPortfolio(pid2).positions.get(ADDR).amount;
        ok(residual.toString() === '3e-11' && !residual.eq(0),
            'T1d 反证：旧 Number 往返形状残仓恰 3e-11 不删仓（事故现场）', residual.toString());
    }
    // ---- T2 粉尘门命中（事故实数：账面 3e-11 / 链上 1.7684893e-11）----
    {
        savedTrades.length = 0;
        const { self, pm, portfolioId, holding, sellCount, alertCount, logs } = await mkSelf({
            buyAmount: '3e-11',
            onChainQty: 1.7684893e-11,
        });
        const res = await FourMemeWssTradingEngine.prototype._executeSellLive.call(
            self, mkSignal(1.1327349e-5), 'sig2', {}, holding, 1, null);
        ok(res && res.success === true && res.dustClose === true, 'T2a 粉尘门命中返回 success+dustClose', res);
        ok(sellCount() === 0, 'T2b 链上卖单未发（0 tx）', sellCount());
        ok(posAmount(pm, portfolioId) === undefined, 'T2c PM 就地清账删仓', String(posAmount(pm, portfolioId)));
        const dustRow = savedTrades.find(t => t.metadata && t.metadata.dustClose);
        ok(!!dustRow, 'T2d 清仓 trade 行落库留痕');
        ok(dustRow && dustRow.inputAmount === '3e-11' && dustRow.outputAmount === '0',
            'T2e trade 行 inputAmount=账面原值/outputAmount=0（重放钳 0 防复活）',
            dustRow && `${dustRow.inputAmount}/${dustRow.outputAmount}`);
        ok(alertCount() === 1, 'T2f 告警恰一次', alertCount());
        ok(logs.warn.some(w => w.includes('粉尘残仓清理')), 'T2g warn 留痕', logs.warn.join('; '));
    }
    // ---- T3 正常仓照发（门不误杀）----
    {
        savedTrades.length = 0;
        const { self, pm, portfolioId, holding, sellCount } = await mkSelf({
            buyAmount: '300000',
            onChainQty: 300000, // 链上充足
        });
        // 价 1e-5 USD/bnbUsd 600 → expectedNativeOut = 300000×1e-5/600 = 5e-3 > 1e-4
        const res = await FourMemeWssTradingEngine.prototype._executeSellLive.call(
            self, mkSignal(1e-5), 'sig3', {}, holding, 1, null);
        ok(res && res.success && res.dustClose !== true, 'T3a 正常仓正常成交', res && res.success);
        ok(sellCount() === 1, 'T3b 链上卖单照发', sellCount());
        ok(posAmount(pm, portfolioId) === undefined, 'T3c 全清后 PM 删仓');
        ok(savedTrades.every(t => !(t.metadata || {}).dustClose), 'T3d 无 dustClose 留痕');
    }
    // ---- T4 锚缺失 fail-open：bnbUsd=0 → expectedNativeOut=null → 照发 ----
    {
        savedTrades.length = 0;
        const { self, holding, sellCount } = await mkSelf({
            buyAmount: '3e-11',
            onChainQty: 1.7684893e-11,
            bnbUsd: 0,
        });
        const res = await FourMemeWssTradingEngine.prototype._executeSellLive.call(
            self, mkSignal(1.1327349e-5), 'sig4', {}, holding, 1, null);
        ok(res && res.success, 'T4a 锚缺失照常走链上（fail-open）', res && res.success);
        ok(sellCount() === 1, 'T4b 链上卖单发了（不误杀）', sellCount());
    }
    // ---- T5 externalDisposal 语义不变（链上=0 先于粉尘门）----
    {
        savedTrades.length = 0;
        const { self, pm, portfolioId, holding, sellCount } = await mkSelf({
            buyAmount: '100',
            onChainQty: 0,
        });
        const res = await FourMemeWssTradingEngine.prototype._executeSellLive.call(
            self, mkSignal(1e-5), 'sig5', {}, holding, 1, null);
        ok(res && res.success === false && res.externalDisposal === true, 'T5a 外部处置臂原样', res);
        ok(sellCount() === 0, 'T5b 未发 tx', sellCount());
        ok(posAmount(pm, portfolioId) !== undefined, 'T5c 账面不动（人工核查语义不变）', String(posAmount(pm, portfolioId)));
        // 告警在 _executeSell 上层（externalDisposal 分流臂），本层只验原路径形状
        ok(savedTrades.length === 0, 'T5d 本层零 trade 行（告警归上游分流臂）', savedTrades.length);
    }
    // ---- T6 部分腿记账量=链上请求量（余仓语义不变）----
    {
        savedTrades.length = 0;
        const { self, pm, portfolioId, holding } = await mkSelf({
            buyAmount: '400',
            onChainQty: 400,
        });
        const res = await FourMemeWssTradingEngine.prototype._executeSellLive.call(
            self, mkSignal(1e-3), 'sig6', {}, holding, 0.25, null);
        ok(res && res.success, 'T6a 部分腿成交', res && res.success);
        const after = posAmount(pm, portfolioId);
        ok(after && after.eq(300), 'T6b 余仓=账面 400−请求 100=300（部分卖不动 Decimal 原值）', after && after.toString());
        const row = savedTrades[savedTrades.length - 1];
        ok(row && row.inputAmount === '100' && Number(row.metadata.sellPercentage) === 0.25,
            'T6c trade 行 inputAmount=链上请求量 100', row && row.inputAmount);
    }
    // ---- T7 显式 0 关门 ----
    {
        savedTrades.length = 0;
        const { self, holding, sellCount } = await mkSelf({
            buyAmount: '3e-11',
            onChainQty: 1.7684893e-11,
            dustLine: 0,
        });
        const res = await FourMemeWssTradingEngine.prototype._executeSellLive.call(
            self, mkSignal(1.1327349e-5), 'sig7', {}, holding, 1, null);
        ok(res && res.success === true && res.dustClose !== true, 'T7a 关门后粉尘仓照走链上', res && res.success);
        ok(sellCount() === 1, 'T7b 链上卖单发了', sellCount());
    }

    entities.Trade = RealTrade; // 还原打桩
    console.log(`\n_live_dust_close: ${passed} passed, ${failed} failed`);
    if (failed > 0) { failures.forEach(f => console.error(f)); process.exit(1); }
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
