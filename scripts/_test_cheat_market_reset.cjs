#!/usr/bin/env node
/**
 * CD382 盘面重置截窗单测（2026-11-08，用户裁定「cheat 的判定也要改一下，如果
 * 代币到过了 almost_launch 又起来，那么对它的判定也是从 almost_launch 之后的
 * 最低点开始」）——零 DB 零网络。
 *
 * 纯函数 computeMarketResetIndex（cheat-snapshot.js）四形状+边界，与 BP44
 * minVsLaunchPct（buy-point-snapshot.js 涨起后定义，案号 BP39）**双向口径锁**
 * （两侧独立实现防循环依赖——cheat-snapshot 已被 buy-point-snapshot 依赖，
 * 反向 import 成环；口径漂移由本文件对拍锁定）。Service 接线断言在
 * _test_cheat_detection_service.cjs Z2 段。失败 exit 非零。
 */

const { computeMarketResetIndex } = require('../src/market-analysis/cheat-snapshot');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot');

let passed = 0;
function ok(cond, label) {
  if (!cond) {
    console.error(`\n❌ FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`  ✓ ${label}`);
}
const near = (a, b, eps = 1e-12) => Math.abs(a - b) < eps;

// ── 行工厂（DB 形状；与 _test_buy_point_lib.row 同款——双向锁喂同一构造）──
const E9 = 1e-9;
const T0 = '2026-11-03T10:00:00.000Z';
const at = (dt) => new Date(Date.parse(T0) + dt * 1000).toISOString();
function row(dt, price, opts = {}) {
  return {
    block_time: at(dt), block_number: 1000 + dt, log_index: 0,
    trade_type: 'buy', bnb_amount: 0.1, token_amount: 1e8,
    price_bnb: price, price_outlier: opts.outlier === true,
    trader_address: `0x${String(dt % 7)}`.padEnd(42, '0'),
    sender_address: `0x${String(dt % 7)}`.padEnd(42, '0'),
    tx_hash: '0x' + String(dt), quote_token: null,
  };
}
/** 价格轨迹 → 行集（dt 递增=链上真序） */
function traj(prices) { return prices.map((p, i) => row((i + 1) * 10, p)); }

const metaBP = { address: '0x' + 'ab'.repeat(20), symbol: 'T', name: 'T', platform: 'fourmeme', createdAt: T0, creatorAddress: null, totalSupply: 1e9 };

// ═══════════════ A. 纯函数四形状+边界 ═══════════════
console.log('A. computeMarketResetIndex 纯函数');
{
  // A1 回到过重置（dR 形状 1.0→1.4→2.0→1.3→1.05→1.3）：launch=1.0；首个严格
  // >1.2=行2(1.4)；涨起后段最低 1.05@行4 → 重置 idx=4、minVsLaunchPct=+5
  const r1 = computeMarketResetIndex(traj([1.0 * E9, 1.4 * E9, 2.0 * E9, 1.3 * E9, 1.05 * E9, 1.3 * E9]));
  ok(r1 !== null && r1.resetIdx === 4 && near(r1.minPriceBnb, 1.05 * E9) && r1.minVsLaunchPct === 5,
    `回到过重置：resetIdx=4（1.05 行）/minVsLaunchPct=+5.0（实际 ${r1 && r1.resetIdx}/${r1 && r1.minVsLaunchPct}）`);
  ok(r1.sortedRows.length === 6 && r1.resetAt === at(50) && r1.exitAt === at(20),
    `sortedRows 全行+resetAt/exitAt（实际 ${r1.sortedRows.length}/${r1.resetAt}/${r1.exitAt}）`);
  ok(near(r1.launchPriceBnb, 1.0 * E9), 'launchPriceBnb=首可靠价 1.0e-9');

  // A2 从未离开（1.0→1.1→1.05→1.15 全程 ≤+20%；1.2 恰等=在 almost_launch 桶界内
  // 不算离开——严格 >）→ null
  ok(computeMarketResetIndex(traj([1.0 * E9, 1.1 * E9, 1.05 * E9, 1.15 * E9])) === null,
    '从未离开 almost_launch（全程 ≤+20）→ null 不冒充「回到过」');
  // A2b 恰 +20 不触发离开：1.0→1.2→1.3→1.18——1.2 恰等不算（严格 >），1.3 触发；
  // 段最低 1.18 → 重置（判据 ≤ 含恰等与破发）
  const r2b = computeMarketResetIndex(traj([1.0 * E9, 1.2 * E9, 1.3 * E9, 1.18 * E9]));
  ok(r2b !== null && r2b.resetIdx === 3 && r2b.minVsLaunchPct === 18,
    `恰 +20 不算离开（1.2 恰等）但回到 ≤+20 算（1.18=+18 重置；实际 ${r2b && r2b.minVsLaunchPct}）`);

  // A3 刚离开无后续（突破点即末位——无回落证据）→ null
  ok(computeMarketResetIndex(traj([1.0 * E9, 1.0 * E9, 1.5 * E9])) === null,
    '刚离开（突破点=末位）→ null（无「回到」证据）');
  // A4 没回到过（dMono 1.0→1.2→1.5→1.8 单调涨；涨起后最低 1.5=+50 >+20）→ null
  ok(computeMarketResetIndex(traj([1.0 * E9, 1.2 * E9, 1.5 * E9, 1.8 * E9])) === null,
    '涨起后最低 +50 >+20（没回到过）→ null');
  // A5 破发回到（1.0→1.5→0.9）→ 重置，minVsLaunchPct=-10（含破发）
  const r5 = computeMarketResetIndex(traj([1.0 * E9, 1.5 * E9, 0.9 * E9]));
  ok(r5 !== null && r5.resetIdx === 2 && r5.minVsLaunchPct === -10,
    `破发回到：-10.0%（含破发；实际 ${r5 && r5.minVsLaunchPct}）`);
  // A6 恰回到 +20（1.0→1.5→1.2：段最低恰=上界）→ 重置（≤ 含恰等）
  const r6 = computeMarketResetIndex(traj([1.0 * E9, 1.5 * E9, 1.2 * E9]));
  ok(r6 !== null && r6.minVsLaunchPct === 20, `恰 +20.0=回到（≤ 含恰等；实际 ${r6 && r6.minVsLaunchPct}）`);

  // A7 创新高不遮蔽回落（BP44 案核心形状 1.0→1.5→1.1→1.05→1.6，ATH 在末位）：
  // 涨起后段=突破点之后全段——最低 1.05@行3（重置窗起点），创新高不重置 exit
  const r7 = computeMarketResetIndex(traj([1.0 * E9, 1.5 * E9, 1.1 * E9, 1.05 * E9, 1.6 * E9]));
  ok(r7 !== null && r7.resetIdx === 3 && r7.minVsLaunchPct === 5 && r7.exitAt === at(20),
    `创新高不遮蔽：resetIdx=3（1.05 行非末段创新高行；实际 ${r7 && r7.resetIdx}/${r7 && r7.minVsLaunchPct}）`);

  // A8 outlier 行不进可靠价链：首行 outlier 天价 → launch=首个非 outlier；
  // exit 段内 outlier 也不作最低候选
  const r8 = computeMarketResetIndex([
    row(10, 99 * E9, { outlier: true }), row(20, 1.0 * E9), row(30, 1.5 * E9),
    row(40, 0.5 * E9, { outlier: true }), row(50, 1.1 * E9),
  ]);
  ok(r8 !== null && near(r8.launchPriceBnb, 1.0 * E9) && r8.resetIdx === 4 && near(r8.minPriceBnb, 1.1 * E9),
    `outlier 不进可靠价链（launch=1.0 非 99；段最低=1.1 非 outlier 0.5；实际 ${r8 && r8.resetIdx}）`);
  // A9 无可靠价 → null
  ok(computeMarketResetIndex([row(10, 99 * E9, { outlier: true }), row(20, 0)]) === null,
    '无可靠价（全 outlier/0）→ null');
  // A10 乱序到达（到达序≠链上真序）→ 内部排序，resetIdx 相对 sortedRows 正确
  const shuffled = traj([1.0 * E9, 1.5 * E9, 1.1 * E9, 1.05 * E9, 1.6 * E9]).slice().reverse();
  const r10 = computeMarketResetIndex(shuffled);
  ok(r10 !== null && r10.resetIdx === 3 && r10.sortedRows[0].block_number < r10.sortedRows[4].block_number,
    `乱序到达：sortedRows 链上真序+resetIdx 相对正确（实际 idx=${r10 && r10.resetIdx}）`);
  // A11 空/null 输入 → null（不 throw）
  ok(computeMarketResetIndex([]) === null && computeMarketResetIndex(null) === null,
    '空/null 行集 → null 不 throw');
}

// ═══════════════ B. BP44 双向口径锁（同行集喂 buy-point-snapshot）═══════════════
console.log('B. BP44 minVsLaunchPct 双向口径锁（两侧独立实现）');
{
  // BP 侧锚窗=近窗（buildBuyPointSnapshot 内部再截 launchCovered 判出生段覆盖）；
  // 本段构造首行 dt≤90 全程短窗=launchCovered 恒真，两侧同视图。
  // 判据：BP minVsLaunchPct ≤20 ⟺ CD 非 null 且数值相等；BP >20 或 null ⟺ CD null。
  const shapes = [
    { name: 'dR 回到 +5', prices: [1.0, 1.4, 2.0, 1.3, 1.05, 1.3], expectBp: 5 },
    { name: 'dMono 没回到 +50', prices: [1.0, 1.2, 1.5, 1.8], expectBp: 50 },
    { name: 'dNH 创新高重启 +5', prices: [1.0, 1.5, 1.1, 1.05, 1.6], expectBp: 5 },
    { name: 'dStay 从未离开 null', prices: [1.0, 1.1, 1.05, 1.15], expectBp: null },
    { name: 'dA 涨起后最低 +30', prices: [1.0, 1.0, 1.2, 1.3, 1.4, 1.5], expectBp: 30 },
    { name: '恰回到 +20', prices: [1.0, 1.5, 1.2], expectBp: 20 },
    { name: '破发回到 −10', prices: [1.0, 1.5, 0.9], expectBp: -10 },
  ];
  for (const s of shapes) {
    const rows = traj(s.prices.map((p) => p * E9));
    const bp = buildBuyPointSnapshot(rows, metaBP).buyDerived.minVsLaunchPct;
    const cd = computeMarketResetIndex(rows);
    ok(bp === s.expectBp,
      `BP 侧 ${s.name}：minVsLaunchPct=${s.expectBp}（实际 ${bp}）`);
    if (s.expectBp === null || s.expectBp > 20) {
      ok(cd === null,
        `CD 侧 ${s.name}：null（BP ${s.expectBp === null ? 'null=从未离开' : '>20=没回到'} ⟺ 不重置；实际 ${cd && cd.minVsLaunchPct}）`);
    } else {
      ok(cd !== null && cd.minVsLaunchPct === s.expectBp,
        `CD 侧 ${s.name}：重置 minVsLaunchPct=${s.expectBp}（≤20 ⟺ 重置且数值同；实际 ${cd && cd.minVsLaunchPct}）`);
    }
  }
  // 方向差异说明（非断言）：BP 侧 launchCovered=false（截窗不含出生段）时给 null，
  // CD 侧不看出生段（capped 由调用方拦截，不满帽=全史必含出生段）——CD 判据刻
  // 意收窄为 capped 单防线，见 Service 5b。
}

console.log(`\n✅ _test_cheat_market_reset 全过（${passed} 断言）`);
