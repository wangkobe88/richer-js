'use strict';

/**
 * FP47 影子档位预判单测（2026-11-24 用户裁定「A 档四题全搞」第二批）——
 * 零 DB 零网络纯函数：wash_pair 占比轴机械线 + insider 双口径/单钱包豁免/
 * 网络资格 + null 容缺。**门侧零消费**（A 主判/L 通道仍读 Jev 档位）——
 * 本单测锁的是「对拍口径」：档位线与题面判据的机械翻译逐字一致。
 * 运行：node scripts/_test_cheat_shadow_judge.cjs（断言失败退出非零）
 */

const assert = require('assert');
const path = require('path');
const M = require(path.join(__dirname, '..', 'src', 'market-analysis', 'cheat-shadow-judge.js'));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

// 档位数值序锁（与 CHEAT_LEVEL_SCORES.level 同序：none=0/weak=1/moderate=2/strong=3）
const LV = { none: 0, weak: 1, moderate: 2, strong: 3 };

console.log('A. judgeWashPairLevel（占比轴机械线）');
{
  check('A1 无配对（三键 null）→ 有证据 none（washPairCount=0）', () => {
    const r = M.judgeWashPairLevel({ washPairCount: 0, washPairSellPct: null, washPairBuyPct: null });
    assert.strictEqual(r.level, LV.none);
    assert.strictEqual(r.branch, 'zero_pair');
  });
  check('A2 键缺失（旧档/无 derived）→ null 不可评不冒充', () => {
    const r = M.judgeWashPairLevel({});
    assert.strictEqual(r.level, null);
    assert.strictEqual(r.bucket, null);
  });
  check('A3 偶发 1~2 对=碰撞 → none（题面「偶发 1~2 对可以是碰撞」）', () => {
    const r = M.judgeWashPairLevel({ washPairCount: 2, washPairSellPct: 40 });
    assert.strictEqual(r.bucket, 'none');
    assert.strictEqual(r.branch, 'collision');
  });
  check('A4 占比不足不为据（3 对 9%）→ none（题面反例 1.9%）', () => {
    const r = M.judgeWashPairLevel({ washPairCount: 3, washPairSellPct: 9 });
    assert.strictEqual(r.bucket, 'none');
  });
  check('A5 3 对 15% → weak', () => {
    assert.strictEqual(M.judgeWashPairLevel({ washPairCount: 3, washPairSellPct: 15 }).bucket, 'weak');
  });
  check('A6 5 对 30% → moderate（25 线过）', () => {
    assert.strictEqual(M.judgeWashPairLevel({ washPairCount: 5, washPairSellPct: 30 }).bucket, 'moderate');
  });
  check('A7 10 对 95% → strong（题面正例：配对额占全部卖出 95%、占全部买入 27%）', () => {
    const r = M.judgeWashPairLevel({ washPairCount: 10, washPairSellPct: 95, washPairBuyPct: 27 });
    assert.strictEqual(r.bucket, 'strong');
    assert.strictEqual(r.level, LV.strong);
  });
  check('A8 4 对 60%（对数不足 5 对）→ weak 不上跳（count 与占比双门槛）', () => {
    assert.strictEqual(M.judgeWashPairLevel({ washPairCount: 4, washPairSellPct: 60 }).bucket, 'weak');
  });
}

console.log('B. judgeInsiderLevel（双口径+单钱包豁免+网络资格）');
{
  const D = (o) => ({ insiderSellPct: 30, insiderSellBuyPct: 30, insiderSellWallets: 3, noBuySellWalletsExCreator: 2, noBuySellVolumePctExCreator: 20, ...(o || {}) });
  check('B1 组不在场（0 钱包）→ none 有证据零值', () => {
    const r = M.judgeInsiderLevel({ insiderSellPct: 0, insiderSellBuyPct: 0, insiderSellWallets: 0, noBuySellWalletsExCreator: 0, noBuySellVolumePctExCreator: 0 });
    assert.strictEqual(r.bucket, 'none');
    assert.strictEqual(r.branch, 'no_group');
  });
  check('B2 锚全缺失 → null 不可评', () => {
    assert.strictEqual(M.judgeInsiderLevel({}).level, null);
  });
  check('B3 双口径 ≥25 ∧ 组 ≥2 钱包（网络）→ strong', () => {
    const r = M.judgeInsiderLevel(D());
    assert.strictEqual(r.bucket, 'strong');
    assert.strictEqual(r.branch, 'network_dominant');
  });
  check('B4 占比高但冲击 <25 → 至多 moderate（题面「给 strong 须两口径都高」）', () => {
    const r = M.judgeInsiderLevel(D({ insiderSellBuyPct: 10 }));
    assert.strictEqual(r.bucket, 'moderate');
  });
  check('B5 组 1 钱包（单点无网络）双口径高 → 至多 moderate（strong 须分发网络形状）', () => {
    const r = M.judgeInsiderLevel(D({ insiderSellWallets: 1 }));
    assert.strictEqual(r.bucket, 'moderate');
  });
  check('B6 占比 15% → moderate（10~25 明显在场）', () => {
    assert.strictEqual(M.judgeInsiderLevel(D({ insiderSellPct: 15, insiderSellBuyPct: 5 })).bucket, 'moderate');
  });
  check('B7 占比 <10 → weak', () => {
    assert.strictEqual(M.judgeInsiderLevel(D({ insiderSellPct: 6, insiderSellBuyPct: 4 })).bucket, 'weak');
  });
  check('B8 单钱包隐藏筹码豁免（零买纯卖 1 个 ∧ 总量 <15%）→ 至多 weak（题面「连 moderate 也不给」）', () => {
    const r = M.judgeInsiderLevel(D({ insiderSellPct: 75, insiderSellBuyPct: 20, insiderSellWallets: 1, noBuySellWalletsExCreator: 1, noBuySellVolumePctExCreator: 14 }));
    assert.strictEqual(r.bucket, 'weak');
    assert.strictEqual(r.branch, 'solo_exempt');
  });
  check('B9 单钱包但总量 ≥15%（近 1 BNB 级倾倒占两成）→ 至多 moderate 不豁免', () => {
    const r = M.judgeInsiderLevel(D({ insiderSellPct: 75, insiderSellBuyPct: 20, insiderSellWallets: 1, noBuySellWalletsExCreator: 1, noBuySellVolumePctExCreator: 20 }));
    assert.strictEqual(r.bucket, 'moderate');
  });
  check('B10 单钱包豁免 + 占比 <10 → none（solo_exempt_none）', () => {
    const r = M.judgeInsiderLevel(D({ insiderSellPct: 8, insiderSellBuyPct: 5, insiderSellWallets: 1, noBuySellWalletsExCreator: 1, noBuySellVolumePctExCreator: 10 }));
    assert.strictEqual(r.bucket, 'none');
  });
  check('B11 零买纯卖 ≥2=分发网络 → 不适用单钱包豁免（题面⑤）', () => {
    const r = M.judgeInsiderLevel(D({ insiderSellPct: 75, insiderSellBuyPct: 20, insiderSellWallets: 2, noBuySellWalletsExCreator: 2, noBuySellVolumePctExCreator: 10 }));
    // 占比 ≥10 → moderate（豁免不适用；网络但冲击 20<25 不上 strong）
    assert.strictEqual(r.bucket, 'moderate');
  });
}

console.log('C. judgeCodeLevels 总入口');
{
  check('C1 两题并算形状', () => {
    const r = M.judgeCodeLevels({
      washPairCount: 0, washPairSellPct: null, washPairBuyPct: null,
      insiderSellPct: 30, insiderSellBuyPct: 30, insiderSellWallets: 3,
      noBuySellWalletsExCreator: 2, noBuySellVolumePctExCreator: 20,
    });
    assert.strictEqual(r.washPair.bucket, 'none');
    assert.strictEqual(r.insiderSupplySell.bucket, 'strong');
  });
  check('C2 空 derived → 两题 null（不可评不冒充）', () => {
    const r = M.judgeCodeLevels({});
    assert.strictEqual(r.washPair.level, null);
    assert.strictEqual(r.insiderSupplySell.level, null);
  });
  check('C3 档位域锁（LEVEL_BUCKETS 四桶序）', () => {
    assert.deepStrictEqual(M.LEVEL_BUCKETS, ['none', 'weak', 'moderate', 'strong']);
  });
}

console.log(`\n结果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
