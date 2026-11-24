'use strict';

/**
 * FP47 holder_concentration 观察因子单测（2026-11-24 用户裁定「A 档四题全搞」
 * 第四题）——零 DB 零网络纯函数：BP69 holder 题分层线机械翻译（≥10 免佐证/
 * 6~9 佐证/≤5 豁免域+一人控盘）+ 价格豁免 + null 容缺。
 * 运行：node scripts/_test_holder_concentration_factor.cjs（断言失败退出非零）
 */

const assert = require('assert');
const path = require('path');
const M = require(path.join(__dirname, '..', 'src', 'market-analysis', 'holder-concentration-factor.js'));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const LV = { none: 0, weak: 1, moderate: 2, strong: 3 };
// 锚夹具（cheat 投影锚同口径：null=该键证据缺失）
const A = (o) => ({
  posHolderCount: 20, top1HoldCircPct: 20, top1Top2HoldCircPct: 30, top3HoldCircPct: 40,
  sameBlockHoldCircPct: null, equalBandHoldCircPct: null, buyerWalletCount: 25,
  ...(o || {}),
});

console.log('A. 持有者 ≥10 分层（免佐证域）');
{
  check('A1 top1 46%>45 过线 → strong 垄断坐实', () => {
    const r = M.judgeHolderConcentration(A({ top1HoldCircPct: 46 }), 60);
    assert.strictEqual(r.level, LV.strong);
    assert.strictEqual(r.branch, 'monopoly_sat');
  });
  check('A2 前二 56%>55 过线 → strong（任一轴过线即可）', () => {
    assert.strictEqual(M.judgeHolderConcentration(A({ top1Top2HoldCircPct: 56 }), 60).level, LV.strong);
  });
  check('A3 前三 71%>70 过线 → strong', () => {
    assert.strictEqual(M.judgeHolderConcentration(A({ top3HoldCircPct: 71 }), 60).level, LV.strong);
  });
  check('A4 恰线不过（45/55/70 严格大于）', () => {
    assert.strictEqual(M.judgeHolderConcentration(A({ top1HoldCircPct: 45, top1Top2HoldCircPct: 55, top3HoldCircPct: 70 }), 60).level, LV.weak);
  });
  check('A5 未过线 top1 二成上下 → weak（ⓟ 分界线 ≥15）', () => {
    assert.strictEqual(M.judgeHolderConcentration(A(), 60).level, LV.weak);
  });
  check('A6 未过线 top1 低个位数 → none（健康分散）', () => {
    assert.strictEqual(M.judgeHolderConcentration(A({ top1HoldCircPct: 8, top1Top2HoldCircPct: 15 }), 60).level, LV.none);
  });
  check('A7 轴键 null=该轴不立（top1 null 但前二过线照坐实）', () => {
    const r = M.judgeHolderConcentration(A({ top1HoldCircPct: null, top1Top2HoldCircPct: 60 }), 60);
    assert.strictEqual(r.level, LV.strong);
  });
}

console.log('B. 持有者 6~9 分层（佐证域）');
{
  check('B1 过线 ∧ 同块簇佐证 ≥50 → strong（monopoly_cluster）', () => {
    const r = M.judgeHolderConcentration(A({ posHolderCount: 7, top1HoldCircPct: 50, sameBlockHoldCircPct: 55 }), 60);
    assert.strictEqual(r.level, LV.strong);
    assert.strictEqual(r.branch, 'monopoly_cluster');
  });
  check('B2 过线 ∧ 等额带簇佐证 ≥50 → strong（两佐证轴任一）', () => {
    assert.strictEqual(M.judgeHolderConcentration(A({ posHolderCount: 7, top1HoldCircPct: 50, equalBandHoldCircPct: 60 }), 60).level, LV.strong);
  });
  check('B3 过线无佐证 → moderate', () => {
    const r = M.judgeHolderConcentration(A({ posHolderCount: 7, top1HoldCircPct: 50 }), 60);
    assert.strictEqual(r.level, LV.moderate);
    assert.strictEqual(r.branch, 'monopoly_unsupported');
  });
  check('B4 佐证键 null=无佐证（不过 strong）', () => {
    assert.strictEqual(M.judgeHolderConcentration(A({ posHolderCount: 7, top1HoldCircPct: 50, sameBlockHoldCircPct: null, equalBandHoldCircPct: null }), 60).level, LV.moderate);
  });
}

console.log('C. 持有者 ≤5 分层（筹码少豁免域）');
{
  check('C1 一人控盘（top1 95>90 ∧ 买过 12 只 2 人拿货）→ strong（solo_control）', () => {
    const r = M.judgeHolderConcentration(A({ posHolderCount: 2, top1HoldCircPct: 95, top1Top2HoldCircPct: null, top3HoldCircPct: null, buyerWalletCount: 12 }), 60);
    assert.strictEqual(r.level, LV.strong);
    assert.strictEqual(r.branch, 'solo_control');
  });
  check('C2 ≤5 过线但非一人控盘（买过 5 人）→ 至多 moderate（豁免域）', () => {
    const r = M.judgeHolderConcentration(A({ posHolderCount: 3, top1HoldCircPct: 95, buyerWalletCount: 5 }), 60);
    assert.strictEqual(r.level, LV.moderate);
  });
  check('C3 ≤5 过线但 top1 仅 50（未达一人控盘 90 线）→ moderate', () => {
    assert.strictEqual(M.judgeHolderConcentration(A({ posHolderCount: 3, top1HoldCircPct: 50, buyerWalletCount: 30 }), 60).level, LV.moderate);
  });
  check('C4 极早窗筹码集中自然分散（≤5 未过线）→ none/weak 不误伤', () => {
    assert.strictEqual(M.judgeHolderConcentration(A({ posHolderCount: 3, top1HoldCircPct: 20 }), 60).level, LV.weak);
  });
}

console.log('D. 价格豁免（题面⑥：贴发行价不坐实 strong）');
{
  check('D1 vsLaunch +8（≤+10 含破发）strong 降 moderate（price_exempt）', () => {
    const r = M.judgeHolderConcentration(A({ top1HoldCircPct: 46 }), 8);
    assert.strictEqual(r.level, LV.moderate);
    assert.strictEqual(r.branch, 'price_exempt');
  });
  check('D2 破发 -5 同豁免（含破发）', () => {
    assert.strictEqual(M.judgeHolderConcentration(A({ top1HoldCircPct: 46 }), -5).level, LV.moderate);
  });
  check('D3 vsLaunch +10.5（>+10 脱离发行价区）不豁免照 strong', () => {
    assert.strictEqual(M.judgeHolderConcentration(A({ top1HoldCircPct: 46 }), 10.5).level, LV.strong);
  });
  check('D4 vsLaunch null=缺席不豁免（fail-closed 方向）', () => {
    assert.strictEqual(M.judgeHolderConcentration(A({ top1HoldCircPct: 46 }), null).level, LV.strong);
  });
  check('D5 豁免只压 strong（moderate/weak 不动）', () => {
    assert.strictEqual(M.judgeHolderConcentration(A({ top1HoldCircPct: 50, posHolderCount: 7 }), 5).level, LV.moderate);
  });
}

console.log('E. null 容缺');
{
  check('E1 原料全缺失 → null 不可评（fail-closed 不冒充）', () => {
    const r = M.judgeHolderConcentration({}, null);
    assert.strictEqual(r.level, null);
    assert.strictEqual(r.branch, 'unrated');
  });
  check('E2 posHolderCount null → null（分层前提缺失）', () => {
    assert.strictEqual(M.judgeHolderConcentration(A({ posHolderCount: null }), 60).level, null);
  });
  check('E3 a=null → null 不 throw', () => {
    assert.strictEqual(M.judgeHolderConcentration(null, 60).level, null);
  });
  check('E4 档位域锁（LEVEL_BUCKETS 四桶序）', () => {
    assert.deepStrictEqual(M.LEVEL_BUCKETS, ['none', 'weak', 'moderate', 'strong']);
  });
}

console.log(`\n结果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
