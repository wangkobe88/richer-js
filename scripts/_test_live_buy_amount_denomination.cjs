#!/usr/bin/env node
/**
 * live 买入成交数量估算量纲 + 余额差读零重读单测（2026-10-15 妹珠 0xa4b8…7777 案；
 * 零 DB 零网络）
 *
 * 案情：flap 非 BNB 计价票（quote≈$34 稳定币）signal.price=4.72e-6（USD/token）。
 * FlapPortalTrader 买入 balanceOf 余额差撞上 LB RPC 滞后节点答 pre-buy 状态 → 实得 0.0
 * → 引擎 fallback 旧公式 amountInBNB÷signal.price（BNB÷USD价）→ 数量低估 bnbUsd=719.66
 * 倍：链上实收 603,940.39 记账 847.27 → PM 按账面只卖 847.27 → 残仓 603,093.12 滞留
 * 钱包、token-returns 页误显 -99%（真实约 -25%）。
 *
 * 修复：①引擎 fallback 补 ×bnbUsd（_estimateBuyTokenOut，与 expectedTokenOut 同公式）；
 * ②trader 余额差 after 读零延迟重读一次（BaseTrader._settleBalanceRead，四处接线：
 * 两 trader × 买 token 差/卖 BNB 差）。
 *
 * 覆盖：
 *   T1 事故现场反证（妹珠实数）：0.004 BNB × 719.655 ÷ 4.7209e-6 ≈ 609,777（万级，
 *      与链上真值 603,940 差 <1%）——旧公式值 847.27 在 double 下构造不出同量级
 *   T2 量纲比例锁定：新值/旧公式值 = bnbUsd（719.66 ± 1e-6 相对）
 *   T3 锚缺失 fail-closed：price=0 或 bnbUsd=0 → 0（上游记「成交数量无效」失败）
 *   T4 trader 读零重读：首次 0n、重读 603940n → 取重读值 + warn 留痕（妹珠案现场形状）
 *   T5 重读仍零：两次均 0n → 原样返回 0n + error 留痕（不静默造数）
 *   T6 正常路径零扰动：首读即有效 → 不等待不重读零告警
 *   T7 卖侧判定形状：isOk 含 gas 补偿语义（after−before+gasCost>0）——滞后节点卖后
 *      读回 pre-trade 余额时 diff=−gasCost 仍判无效触发重读
 *
 * 手法：_estimateBuyTokenOut 以原型 call 驱动（方法体纯计算）；_settleBalanceRead 以
 * 假 this（log 收集 + balanceSettleRetryMs=1 缩时）打桩 readAfter 序列。
 *
 * 用法：node scripts/_test_live_buy_amount_denomination.cjs
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { FourMemeWssTradingEngine } = require(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine'));
const BaseTrader = require(path.join(ROOT, 'src/trading-engine/traders/core/BaseTrader'));

let passed = 0, failed = 0;
const failures = [];
function ok(cond, msg, got) {
    if (cond) { passed++; return; }
    failed++;
    const line = `  ✗ ${msg}${got !== undefined ? ` | got=${typeof got === 'string' ? got : JSON.stringify(got)}` : ''}`;
    failures.push(line);
    console.error(line);
}

// 妹珠案实数（DB trades 行 / 买入 metadata factors / 链上 receipt）
const AMOUNT_IN_BNB = 0.004;
const SIGNAL_PRICE_USD = 4.7209265e-6;     // 0.004/847.2719479480497（fire 时刻 FA currentPrice，USD）
const BNB_USD = 719.6552834306269;        // 买入 metadata.bnbUsd
const CHAIN_TRUTH = 603940.3899219258;    // 链上 Transfer →钱包 raw/1e18
const OLD_FORMULA = AMOUNT_IN_BNB / SIGNAL_PRICE_USD; // 847.27…（事故账面值）

/** 假 trader this：log 收集 + 重读延迟缩到 1ms */
function mkTraderSelf() {
    const logs = { warn: [], error: [] };
    return {
        balanceSettleRetryMs: 1,
        log: (_msg, type = 'info') => {
            if (type === 'warning') logs.warn.push(_msg);
            if (type === 'error') logs.error.push(_msg);
        },
        logs,
    };
}

(async () => {
    const est = (inBnb, price, usd) =>
        FourMemeWssTradingEngine.prototype._estimateBuyTokenOut.call({}, inBnb, price, usd);

    // ---- T1 事故现场反证：估算值回到链上真值量级 ----
    {
        const v = est(AMOUNT_IN_BNB, SIGNAL_PRICE_USD, BNB_USD);
        ok(v > 600000 && v < 620000, 'T1a 估算 ≈609,7xx（万级，与链上 603,940 同量级）', v);
        ok(Math.abs(v - CHAIN_TRUTH) / CHAIN_TRUTH < 0.01, 'T1b 与链上真值差 <1%', Math.abs(v - CHAIN_TRUTH) / CHAIN_TRUTH);
        ok(v / OLD_FORMULA > 700, 'T1c 旧公式值 847 已不可达（比例 >700×）', v / OLD_FORMULA);
    }
    // ---- T2 量纲比例锁定：新值 = 旧公式值 × bnbUsd ----
    {
        const v = est(AMOUNT_IN_BNB, SIGNAL_PRICE_USD, BNB_USD);
        ok(Math.abs(v / OLD_FORMULA / BNB_USD - 1) < 1e-9, 'T2 新旧比恰 = bnbUsd', v / OLD_FORMULA / BNB_USD);
    }
    // ---- T3 锚缺失 fail-closed ----
    {
        ok(est(AMOUNT_IN_BNB, 0, BNB_USD) === 0, 'T3a price=0 → 0');
        ok(est(AMOUNT_IN_BNB, SIGNAL_PRICE_USD, 0) === 0, 'T3b bnbUsd=0 → 0');
        ok(est(AMOUNT_IN_BNB, -1, BNB_USD) === 0, 'T3c 负锚 → 0');
    }
    // ---- T4 trader 读零重读（妹珠案现场形状：before=0，after 滞后答 0 重读答真值） ----
    {
        const self = mkTraderSelf();
        const reads = [0n, 603940389921925808276077n];
        let i = 0;
        const after = await BaseTrader.prototype._settleBalanceRead.call(
            self, () => Promise.resolve(reads[i++]), (a) => a - 0n > 0n, '买入 token 余额差 0xa4b89cd6');
        ok(after === 603940389921925808276077n, 'T4a 重读取到链上真值', after.toString());
        ok(self.logs.warn.some(w => w.includes('重读一次')), 'T4b 重读 warn 留痕', self.logs.warn.join('; '));
        ok(self.logs.error.length === 0, 'T4c 无 error（恢复正常）');
    }
    // ---- T5 重读仍零：原样返回 + error 留痕 ----
    {
        const self = mkTraderSelf();
        let i = 0;
        const after = await BaseTrader.prototype._settleBalanceRead.call(
            self, () => Promise.resolve(0n), (a) => a - 0n > 0n, '买入 token 余额差');
        ok(after === 0n, 'T5a 仍 0 原样返回（不造数）', after.toString());
        ok(self.logs.error.some(e => e.includes('重读仍无效')), 'T5b error 留痕', self.logs.error.join('; '));
    }
    // ---- T6 正常路径零扰动 ----
    {
        const self = mkTraderSelf();
        const after = await BaseTrader.prototype._settleBalanceRead.call(
            self, () => Promise.resolve(123n), (a) => a - 100n > 0n, '买入 token 余额差');
        ok(after === 123n, 'T6a 首读即用');
        ok(self.logs.warn.length === 0 && self.logs.error.length === 0, 'T6b 零告警零等待路径');
    }
    // ---- T7 卖侧判定形状：滞后读回 pre-trade 余额（diff=−gasCost）触发重读 ----
    {
        const self = mkTraderSelf();
        const before = 1000000n, gasCost = 500n, realReceived = 4074391498375n; // 4.074e-6 BNB 案值量级
        const reads = [before - gasCost, before - gasCost + realReceived]; // 首读滞后、重读含实收
        let i = 0;
        const after = await BaseTrader.prototype._settleBalanceRead.call(
            self, () => Promise.resolve(reads[i++]),
            (a) => a - before + gasCost > 0n, '卖出 BNB 余额差');
        ok(after - before + gasCost === realReceived, 'T7a 卖侧实收恢复真值', (after - before + gasCost).toString());
        ok(self.logs.warn.length === 1, 'T7b 恰一次重读', self.logs.warn.length);
    }

    console.log(`\n${failed === 0 ? '✅' : '❌'} _test_live_buy_amount_denomination: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
