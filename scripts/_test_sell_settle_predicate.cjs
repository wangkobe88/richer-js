#!/usr/bin/env node
/**
 * 卖出余额差谓词事故反证（2026-10-25 v36 实收三笔记错事故）零网络单测
 *
 * 事故：BUDDY 0x6cac…7777 / 传奇之路 0x121a…7777 / BNB传奇 0xbd2a…7777 三笔卖出，
 * 引擎记的实收恰=本笔 gas（0.0000269 / 0.0000181 / 0.0000315），链上余额差真值
 * 分别为 0.002564 / 0.003099 / 0.000989 BNB。根因：_settleBalanceRead 卖出侧谓词
 * `after - bnbBefore + gasCost > 0n`——after 读撞 RPC 负载均衡的滞后节点答出旧值
 * （=bnbBefore）时 diff=0、+gasCost 恒正 → 「读零」被判有效不重读 → 实收=纯 gas。
 * 买入侧谓词 `diff > 0` 无此问题（滞后读 diff=0 会触发重读）。
 *
 * 锁定：
 *   1. 行为：新谓词 (after)=>after>bnbBefore 对「滞后读回 before」判定无效并重读，
 *      拿到真实 after 后差值正确
 *   2. 事故反证：旧谓词形状下同一读序列会把滞后值当有效（用当场复刻证明旧形状必错）
 *   3. 源码口径：两个 trader 卖出读点的谓词字面量=after > bnbBefore，
 *      不再含 `+ gasCost > 0n`
 *
 * 运行：node scripts/_test_sell_settle_predicate.cjs
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BaseTrader = require(path.join(ROOT, 'src/trading-engine/traders/core/BaseTrader'));

let passed = 0, failed = 0;
function ok(cond, label, detail) {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.error(`  ❌ ${label}${detail ? ` | ${detail}` : ''}`); }
}

function mkTrader(readSeq) {
    // readSeq: BigInt[] 按次弹出的 getBalance 返回序列（滞后读=与 before 相同的旧值）
    const t = Object.create(BaseTrader.prototype);
    t.balanceSettleRetryMs = 1; // 缩时（默认 1500ms）
    t.log = () => {};
    let i = 0;
    t.provider = { getBalance: async () => readSeq[Math.min(i++, readSeq.length - 1)] };
    return t;
}

async function main() {
    const BEFORE = 1_000_000_000n;          // 卖出前余额
    const RECEIVED = 2_563_882_346_484_946n; // 事故真值（BUDDY）
    const GAS = 26_866_300_000_000n;         // 事故 gas（=引擎误记的"实收"）
    const AFTER = BEFORE + RECEIVED - GAS;   // 卖出后真实余额

    console.log('\n[1] 行为：滞后读回 before → 判无效重读 → 差值=真值');
    {
        const t = mkTrader([AFTER.clone ? AFTER : AFTER, BEFORE, AFTER]); // [首读滞后旧值, 重读真值]
        const bnbAfter = await t._settleBalanceRead(
            () => t.provider.getBalance(t.address),
            (after) => after > BEFORE,
            '卖出 BNB 余额差 test');
        const received = bnbAfter - BEFORE + GAS;
        ok(received === RECEIVED, `新谓词重读后实收=${received}（=链上真值 ${RECEIVED}）`);
    }

    console.log('\n[2] 事故反证：旧谓词形状在同一读序列下把滞后值当有效');
    {
        const t = mkTrader([BEFORE, AFTER]); // 滞后节点首读回 before
        const bnbAfter = await t._settleBalanceRead(
            () => t.provider.getBalance(t.address),
            (after) => after - BEFORE + GAS > 0n, // 旧形状（当场复刻）
            '卖出 BNB 余额差 test');
        const received = bnbAfter - BEFORE + GAS;
        ok(received === GAS,
            `旧谓词实收=${received}（=纯 gas，事故形状复现：真值 ${RECEIVED} 被吞）`);
    }

    console.log('\n[3] 源码口径：两个 trader 卖出读点谓词');
    {
        for (const file of ['FlapPortalTrader.js', 'FourMemeDirectTrader.js']) {
            const src = fs.readFileSync(path.join(ROOT, 'src/trading-engine/traders/implementations', file), 'utf8');
            ok(src.includes('(after) => after > bnbBefore'), `${file}: 卖出谓词 = after > bnbBefore`);
            ok(!src.includes('+ gasCost > 0n'), `${file}: 旧形状 (+ gasCost > 0n) 已退役`);
        }
        // 买入侧谓词不动（diff>0 本就正确）
        const flap = fs.readFileSync(path.join(ROOT, 'src/trading-engine/traders/implementations/FlapPortalTrader.js'), 'utf8');
        ok(flap.includes('(after) => after - balanceBefore > 0n'), '买入谓词保持 diff>0（无事故不动）');
    }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('测试执行异常:', err); process.exit(1); });
