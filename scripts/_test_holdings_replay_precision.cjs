#!/usr/bin/env node
/**
 * _loadHoldings 重放精度钳制 + 单票隔离单测（2026-09-29 Adventures 案；零 DB）
 *
 * 案情：DB 金额列是 double，实时链路 PM 20 位 Decimal 余量 Number 化落库后与重放
 * Decimal 累加值有 ~1e-12 相对尾差——全清腿卖量恰好略超持有量被 PM 严格 lt 校验
 * throw，旧代码 throw 逃出循环 →「加载持仓失败」→ 全部持仓丢失（一票尾差全灭 49 票）。
 *
 * 覆盖：
 *   T1 精度钳制（Adventures 复现）：双 buy Decimal 累加 …720157 vs 全清卖 double …72016
 *      （差 3e-12 ≤ 相对 1e-9）→ 钳到持有量重试 → 删仓 + 无 error log
 *   T2 真超卖不钳制：Required 150 vs Available 100（差异远超容差）→ 不钳制、error log 留痕
 *   T3 单票隔离：票 A 真超卖失败 + 票 B 正常 → B 持仓照常恢复（旧代码会整体中断）
 *   T4 正常路径回归：无尾差的 buy/部分卖/全清 → 余仓/删仓/cash 精确
 *   T5 卡账本重放回归：cardTrade.after 绝对值 set/delete 独立于成交精度门
 *
 * 手法：FourMemeWssTradingEngine.prototype._loadHoldings.call(fakeThis)——真 PM 实例
 * （纯内存账本），dataService/logger 打桩（同 _test_live_hardening 实例级打桩风格）。
 *
 * 用法：node scripts/_test_holdings_replay_precision.cjs
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

/** 构造 fakeThis + 真 PM（每用例独立账本） */
async function mkSelf(trades) {
    const pm = new PortfolioManager();
    const portfolioId = await pm.createPortfolio(100, { blockchain: 'bsc' });
    const errorLogs = [];
    const infoLogs = [];
    const self = {
        dataService: { getTrades: async () => trades },
        _portfolioManager: pm,
        _portfolioId: portfolioId,
        _tokenCards: new Map(),
        _restoreAnchors: new Map(),
        logger: {
            info: (...a) => infoLogs.push(a.join(' ')),
            error: (...a) => errorLogs.push(a.join(' ')),
        },
    };
    return { self, pm, portfolioId, errorLogs, infoLogs };
}

const T = (dir, token, outAmt, inAmt, price, extra = {}) => ({
    success: true,
    createdAt: extra.created_at || '2026-09-29T00:00:00Z',
    tradeDirection: dir,
    tokenAddress: token,
    outputAmount: outAmt,
    inputAmount: inAmt,
    unitPrice: price,
    metadata: extra.metadata || {},
});

(async () => {
    // ═══ T0 案发现场反证：同款账本直接 executeTrade 全清卖确实被 PM 拒 ═══
    {
        const pm = new PortfolioManager();
        const pid = await pm.createPortfolio(100, { blockchain: 'bsc' });
        await pm.executeTrade(pid, '0xeee0', 'buy', new Decimal(62897.7087967201), new Decimal(0.00000477), 0.001);
        await pm.executeTrade(pid, '0xeee0', 'buy', new Decimal(5.7e-11), new Decimal(0.00000477), 0.001);
        let msg = null;
        try {
            await pm.executeTrade(pid, '0xeee0', 'sell', new Decimal(62897.70879672016), new Decimal(0.00000605), 0.001);
        } catch (e) { msg = e.message; }
        ok(msg !== null && msg.includes('Insufficient token balance'),
            'T0 双 buy Decimal 累加 …720157 < 全清 double …72016 → PM 严格 lt 拒绝（案发现场）', msg);
        ok(new Decimal(62897.7087967201).plus(5.7e-11).toString() === '62897.708796720157',
            'T0 Decimal 累加值 = 62897.708796720157（与落库 double 差 3e-12）',
            new Decimal(62897.7087967201).plus(5.7e-11).toString());
    }

    // ═══ T1 精度钳制（Adventures 62897.70879672016 vs …720157 复现）═══
    {
        const TOK = '0xaaa1';
        // buy1 + buy2 的 Decimal 精确和 = 62897.708796720157（17 位，非任何 double 的最短表示）；
        // 实时链路全清 Y 同值 → Number(Y) 落库为 double 最短表示 62897.70879672016
        const buy1 = 62897.7087967201;   // toString() = '62897.7087967201'（最短表示，Decimal 直取）
        const buy2 = 5.7e-11;            // 与 buy1 相加 = ...720157
        const sellFull = 62897.70879672016; // Number(精确余量) 的 double 表示，比重放和恰大 3e-12
        const trades = [
            T('buy', TOK, buy1, 0.4, 0.00000477),
            T('buy', TOK, buy2, 0.0000000003, 0.00000477),
            T('sell', TOK, 0.38, sellFull, 0.00000605, { metadata: { cardTrade: { before: 3, cards: 3, after: 0 } } }),
        ];
        const { self, pm, portfolioId, errorLogs } = await mkSelf(trades);
        let threw = null;
        try { await FourMemeWssTradingEngine.prototype._loadHoldings.call(self); } catch (e) { threw = e; }
        ok(threw === null, 'T1 尾差场景 _loadHoldings 整体不抛', threw && threw.message);
        const pos = pm.getPortfolio(portfolioId).positions.get(TOK);
        ok(pos === undefined, 'T1 钳制后全清删仓（与实时 sellPct=1 语义一致）', pos && pos.amount.toString());
        ok(errorLogs.length === 0, 'T1 尾差被钳制吸收、无 error log', errorLogs);
        ok(!self._tokenCards.has(TOK), 'T1 卡账本 after=0 删卡', [...self._tokenCards.keys()]);
        // 现金：100 - 0.4 - 0.0000000003 + 卖出所得（钳制量差 3e-12 价差可忽略）
        const cash = pm.getPortfolio(portfolioId).cashBalance;
        ok(cash.gt(99.9) && cash.lt(100.1), 'T1 现金量级正确', cash.toString());
    }

    // ═══ T2 真超卖不钳制（数据异常不被掩盖）═══
    {
        const TOK = '0xbbb2';
        const trades = [
            T('buy', TOK, 100, 0.5, 0.005),
            T('sell', TOK, 0.9, 150, 0.006), // Required 150 >> Available 100
        ];
        const { self, pm, portfolioId, errorLogs } = await mkSelf(trades);
        let threw = null;
        try { await FourMemeWssTradingEngine.prototype._loadHoldings.call(self); } catch (e) { threw = e; }
        ok(threw === null, 'T2 单票失败不逃出（整体仍正常返回）', threw && threw.message);
        ok(errorLogs.length === 1 && errorLogs[0].includes('持仓重放单票失败已跳过'),
            'T2 真超卖 error log 留痕', errorLogs);
        const pos = pm.getPortfolio(portfolioId).positions.get(TOK);
        ok(pos !== undefined && pos.amount.eq(100), 'T2 超卖票保持 buy 后持仓（未误钳制）',
            pos && pos.amount.toString());
    }

    // ═══ T3 单票隔离：票 A 失败不阻断票 B 恢复 ═══
    {
        const A = '0xaaa3', B = '0xbbb3';
        const trades = [
            T('buy', B, 50000, 0.3, 0.000006),
            T('buy', A, 100, 0.5, 0.005),
            T('sell', A, 0.9, 150, 0.006),   // A 真超卖失败
            T('sell', B, 0.2, 20000, 0.000007, { metadata: { cardTrade: { before: 4, cards: 1, after: 3 } } }), // B 部分卖
        ];
        const { self, pm, portfolioId, errorLogs } = await mkSelf(trades);
        await FourMemeWssTradingEngine.prototype._loadHoldings.call(self);
        const posA = pm.getPortfolio(portfolioId).positions.get(A);
        const posB = pm.getPortfolio(portfolioId).positions.get(B);
        ok(posA !== undefined && posA.amount.eq(100), 'T3 票 A 保持持仓（失败跳过）', posA && posA.amount.toString());
        ok(posB !== undefined && posB.amount.eq(30000), 'T3 票 B 部卖后余仓 30000（不受 A 影响）',
            posB && posB.amount.toString());
        ok(self._tokenCards.get(B) === 3, 'T3 票 B 卡账本 after=3', self._tokenCards.get(B));
        ok(errorLogs.length === 1, 'T3 仅 A 一条 error', errorLogs.length);
    }

    // ═══ T4 正常路径回归（无尾差）═══
    {
        const TOK = '0xccc4';
        const trades = [
            T('buy', TOK, 10000, 0.4, 0.00004),
            T('sell', TOK, 0.15, 4000, 0.00005), // 卖 40%
        ];
        const { self, pm, portfolioId, errorLogs } = await mkSelf(trades);
        await FourMemeWssTradingEngine.prototype._loadHoldings.call(self);
        const pos = pm.getPortfolio(portfolioId).positions.get(TOK);
        ok(pos !== undefined && pos.amount.eq(6000), 'T4 余仓精确 6000', pos && pos.amount.toString());
        ok(errorLogs.length === 0, 'T4 正常路径零 error', errorLogs);
        ok(self._restoreAnchors.has(TOK), 'T4 最后买价锚点已记录', [...self._restoreAnchors.keys()]);
        // 全清后删仓 + 锚点仍在（positions 才写锚点——全清票不写，下一 buy 重写）
        const trades2 = [...trades, T('sell', TOK, 0.45, 6000, 0.00006)];
        const { self: s2, pm: pm2, portfolioId: pid2, errorLogs: e2 } = await mkSelf(trades2);
        await FourMemeWssTradingEngine.prototype._loadHoldings.call(s2);
        ok(pm2.getPortfolio(pid2).positions.get(TOK) === undefined, 'T4 全清删仓', pm2.getPortfolio(pid2).positions.get(TOK));
        ok(e2.length === 0, 'T4 全清零 error', e2);
    }

    // ═══ T5 卡账本重放独立于成交精度门 ═══
    {
        const TOK = '0xddd5';
        const trades = [
            T('buy', TOK, 100, 0.5, 0.005, { metadata: { cardTrade: { before: 0, cards: 4, after: 4 } } }),
            T('sell', TOK, 0.9, 150, 0.006, { metadata: { cardTrade: { before: 4, cards: 4, after: 0 } } }), // 超卖但 after=0
        ];
        const { self, errorLogs } = await mkSelf(trades);
        await FourMemeWssTradingEngine.prototype._loadHoldings.call(self);
        ok(!self._tokenCards.has(TOK), 'T5 卡账本照常重放（after=0 删卡，先于成交门执行）', [...self._tokenCards.keys()]);
        ok(errorLogs.length === 1, 'T5 成交重放仍失败留痕（两者独立）', errorLogs.length);
    }

    console.log(`\n_holdings_replay_precision: ${passed} passed, ${failed} failed`);
    if (failed > 0) { console.error(failures.join('\n')); process.exit(1); }
    process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
