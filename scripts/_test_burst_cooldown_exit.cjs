/**
 * T189 burst 承接冷盘两批卖出——单测（零 DB 零网络）
 *
 * 覆盖：
 * 1. locateBurstCrew 波窗定位 + crew 冻结（四主案夹具：577c 同块捆绑波/583a fire
 *    在波中段/6bd2 单块农场/c97a 波尾延续+跟进承接）
 * 2. buildBurstCooldownView 承接分桶（crew 剔除/ownWallet 排除/null wallet 行/
 *    defer 乱序容忍）
 * 3. evaluateBurstCooldown 状态机（批1 触发/免疫、批2 快线 c97a 反证、批2 兜底
 *    583a 反证、release、未到时点 none）
 * 4. FA 集成（ring 记录开关/arm/view/clearBuyState 同步清理/defer 两段喂食）
 * 5. 配置缺省（BURST_COOLDOWN_DEFAULTS 甜点线值锁定 X=0.1/Y=0.05——Y=0.1 会
 *    误杀 c97a〔nb2=0.098〕，线值敏感点留档）
 */
'use strict';

const assert = require('assert');
const path = require('path');
const {
  BURST_COOLDOWN_DEFAULTS,
  locateBurstCrew,
  buildBurstCooldownView,
  evaluateBurstCooldown,
} = require('../src/trading-engine/core/burst-cooldown-exit');

let passed = 0, failed = 0;
function T(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

const CFG = { ...BURST_COOLDOWN_DEFAULTS };
const t0 = 1_700_000_000_000;

// ── 夹具工厂：tick 行（ms 偏移、钱包、方向、额）──
const rows = (arr) => arr.map(([dms, side, w, bnb]) => ({ ms: t0 + dms, side, w, bnb }));
const B = (dms, w, bnb) => [dms, 'buy', w, bnb];
const S = (dms, w, bnb) => [dms, 'sell', w, bnb];

console.log('== 1. locateBurstCrew 波窗定位 ==');

T('577c 形状：fire 前静默后同块捆绑波 → crew=波内买钱包（fire 后波尾 1 笔也在窗内）', () => {
  // 历史：t-90s 首买/首卖；波：t-1s~t+1s 7 笔（fire=波第 6 笔=t0）；fire 后砸盘卖
  const ring = rows([
    S(-90000, 'w_early', 0.288), B(-90000, 'w_first', 0.3),
    // 波（3 块 7 笔）
    B(-1000, 'w_c1', 0.1485), B(-1000, 'w_c2', 0.1485),
    B(-500, 'w_b1', 0.10), B(-500, 'w_b2', 0.15), B(-500, 'w_b3', 0.0594), B(-500, 'w_b4', 0.13),
    B(+1000, 'w_top', 0.177), // fire 后 1s 波尾（END_GRACE 5s 内）
    S(+4000, 'w_top', 0.17), B(+5000, 'w_late', 0.069),
  ]);
  const crew = locateBurstCrew(ring, t0);
  assert.ok(crew, '应定位到波窗');
  assert.strictEqual(crew.crewSet.size, 7, `波成员 7（含 fire 后 1s 波尾），实际 ${crew.crewSet.size}`);
  assert.ok(crew.crewSet.has('w_top'), '波尾笔钱包在 crew（fire+5s 宽限内）');
  assert.ok(!crew.crewSet.has('w_first'), '60s 外的首买不进 crew');
});

T('583a 形状：fire 在波中段 → 波后半段的续买钱包全是 crew（自拉延续不算承接）', () => {
  const ring = rows([
    B(-2000, 'w_p1', 0.55), B(-1000, 'w_p2', 0.22),
    // fire=t0 后波继续（同波钱包续买 + 新成员——全部在 fire+5s 宽限窗内=crew）
    B(+500, 'w_p3', 0.30), B(+1500, 'w_p4', 0.28), B(+2000, 'w_p2', 0.22),
    S(+30000, 'w_dump', 0.5),
  ]);
  const crew = locateBurstCrew(ring, t0);
  assert.ok(crew.crewSet.has('w_p3') && crew.crewSet.has('w_p4'), 'fire 后 2s 内的波成员在 crew');
  // +2s 的 w_p2 续买在窗内（同波）；承接视图应把这些全部剔除
  const arm = { t0Ms: t0, ownWallets: new Set() };
  const view = buildBurstCooldownView(ring, arm, CFG);
  assert.strictEqual(view.w1Bnb, 0, `fire 后波内续买被 crew 剔除，w1 承接=0，实际 ${view.w1Bnb}`);
});

T('fire 前无行、fire+1s 单行 → 宽限窗内单行成窗（crew=该钱包，承接空=量门兜底）', () => {
  const ring = rows([B(+1000, 'w_a', 0.01)]); // fire 后才有行（宽限窗内）
  const crew = locateBurstCrew(ring, t0);
  assert.ok(crew && crew.crewSet.size === 1, '宽限窗内行参与波窗定位（fire 波中段语义）');
  const view = buildBurstCooldownView(ring, { t0Ms: t0, ownWallets: new Set() }, CFG);
  assert.strictEqual(view.w1Bnb, 0, '唯一行是 crew 自身 → 承接 0（量门兜底判定，宁不拦不冒充由放行余量保障）');
});

console.log('== 2. buildBurstCooldownView 承接分桶 ==');

T('crew/own/null-wallet 三重排除 + w1/w2 分桶 + lastAbs 时刻', () => {
  const ring = rows([
    B(-1000, 'crew_a', 0.5),            // 波成员（crew）
    B(+2000, 'crew_a', 0.2),            // crew 续买 → 不计
    B(+3000, 'own_me', 0.25),           // 自己的钱包 → 不计（live 自买防豁免）
    B(+4000, null, 0.3),                // null wallet 行 → 计量不计人（不进承接）
    B(+10000, 'absorb1', 0.12),         // w1 承接
    B(+12000, 'absorb1', 0.06),         // w1 承接（lastAbs1=12s）
    B(+20000, 'absorb2', 0.07),         // w2 承接（lastAbs2=20s）
  ]);
  const view = buildBurstCooldownView(ring, { t0Ms: t0, ownWallets: new Set(['own_me']) }, CFG);
  assert.strictEqual(view.w1Bnb, 0.18, `w1=0.12+0.06，实际 ${view.w1Bnb}`);
  assert.strictEqual(view.w2Bnb, 0.07, `w2=0.07，实际 ${view.w2Bnb}`);
  assert.strictEqual(view.lastAbs1Ms, t0 + 12000);
  assert.strictEqual(view.lastAbs2Ms, t0 + 20000);
  // crew 窗=[-1000,+4000]（宽限 5s 内 4 行）→ crew_a+own_me 都在窗内（own 进 crew
  // 无碍——own 集合本就排除）；null wallet 行计量不计人不进
  assert.strictEqual(view.crewSize, 2);
});

T('defer 乱序容忍：ring 无序排列 → 按 ms 过滤分桶不变', () => {
  const mk = (d, w, b) => ({ ms: t0 + d, side: 'buy', w, bnb: b });
  const ordered = [mk(-1000, 'crew', 0.5), mk(5000, 'a1', 0.1), mk(16000, 'a2', 0.2)];
  const shuffled = [mk(16000, 'a2', 0.2), mk(-1000, 'crew', 0.5), mk(5000, 'a1', 0.1)];
  const v1 = buildBurstCooldownView(ordered, { t0Ms: t0, ownWallets: new Set() }, CFG);
  const v2 = buildBurstCooldownView(shuffled, { t0Ms: t0, ownWallets: new Set() }, CFG);
  assert.deepStrictEqual({ w1: v1.w1Bnb, w2: v1.w2Bnb }, { w1: v2.w1Bnb, w2: v2.w2Bnb });
  assert.strictEqual(v1.w1Bnb, 0.1);
});

console.log('== 3. evaluateBurstCooldown 状态机 ==');

T('批1：15s 承接 0.069<0.1 → sell-w1（577c 案）', () => {
  const view = { t0Ms: t0, crewSize: 7, crewBnb: 0.91, w1Bnb: 0.069, w2Bnb: 0.05, w2SoFarBnb: 0.05, lastAbs1Ms: t0 + 5000, lastAbs2Ms: null };
  const v = evaluateBurstCooldown(view, t0 + 15000, CFG);
  assert.ok(v && v.action === 'sell' && v.batch === 'w1');
  assert.strictEqual(v.info.w1Bnb, 0.069);
});

T('批1 免疫：c97a w1=0.17≥0.1 → 不触发批1（回落其它分支判定）', () => {
  const view = { t0Ms: t0, crewSize: 5, crewBnb: 0.8, w1Bnb: 0.17, w2Bnb: 0.098, w2SoFarBnb: 0.098, lastAbs1Ms: t0 + 3000, lastAbs2Ms: t0 + 19000 };
  const v = evaluateBurstCooldown(view, t0 + 15000, CFG);
  assert.strictEqual(v, null, '15s 时点：w1 过线 → 无动作（未到 23s 快线）');
});

T('批2 快线 c97a 反证：t+19s 承接 0.098≥Y → 23s 枯竭判定不触发（量门免疫）', () => {
  // 23s 时点：w2 累计（截至 ring 末）=0.098（t+19 已发生）≥0.05 → 快线量门拦截
  const view = { t0Ms: t0, crewSize: 5, crewBnb: 0.8, w1Bnb: 0.17, w2Bnb: 0.098, w2SoFarBnb: 0.098, lastAbs1Ms: t0 + 3000, lastAbs2Ms: t0 + 19000 };
  const v = evaluateBurstCooldown(view, t0 + 23000, CFG);
  assert.strictEqual(v, null, `23s：lastAbs2=19s 距 23s 仅 4s<8s 且量 0.098≥0.05 → none，实际 ${JSON.stringify(v)}`);
});

T('批2 快线命中：段内承接 0.02<Y ∧ 枯竭 8s → 23s sell-w2-fast', () => {
  const view = { t0Ms: t0, crewSize: 6, crewBnb: 1.8, w1Bnb: 0.25, w2Bnb: 0.02, w2SoFarBnb: 0.02, lastAbs1Ms: t0 + 4000, lastAbs2Ms: t0 + 16000 };
  const v = evaluateBurstCooldown(view, t0 + 24000, CFG);
  assert.ok(v && v.action === 'sell' && v.batch === 'w2-fast', `实际 ${JSON.stringify(v)}`);
});

T('批2 兜底：30s 段末承接 0<0.05 → sell-w2-final（583a 案两窗全零）', () => {
  const view = { t0Ms: t0, crewSize: 8, crewBnb: 1.34, w1Bnb: 0, w2Bnb: 0, w2SoFarBnb: 0, lastAbs1Ms: null, lastAbs2Ms: null };
  // 注意 w1=0<0.1 → 批1 先触发（583a 实际形状 fire 在波中段 w1 被 crew 吃光）
  const v1 = evaluateBurstCooldown(view, t0 + 15000, CFG);
  assert.ok(v1 && v1.batch === 'w1', '583a 形状批1 即触发');
  // w1 过线的兜底形状（w1=0.15、w2=0）：
  const view2 = { ...view, w1Bnb: 0.15 };
  const v2 = evaluateBurstCooldown(view2, t0 + 30000, CFG);
  assert.ok(v2 && v2.action === 'sell' && v2.batch === 'w2-final', `实际 ${JSON.stringify(v2)}`);
});

T('release：30s 段末承接 0.098≥0.05 → 解除（c97a 案）', () => {
  const view = { t0Ms: t0, crewSize: 5, crewBnb: 0.8, w1Bnb: 0.17, w2Bnb: 0.098, w2SoFarBnb: 0.098, lastAbs1Ms: t0 + 3000, lastAbs2Ms: t0 + 19000 };
  const v = evaluateBurstCooldown(view, t0 + 30000, CFG);
  assert.ok(v && v.action === 'release');
});

T('未到时点：14s → null（含批1 前）', () => {
  const view = { t0Ms: t0, crewSize: 7, crewBnb: 0.9, w1Bnb: 0, w2Bnb: 0, w2SoFarBnb: 0, lastAbs1Ms: null, lastAbs2Ms: null };
  assert.strictEqual(evaluateBurstCooldown(view, t0 + 14000, CFG), null);
});

T('批1 迟到扫描仍有效：20s 扫描点 w1 仍不足 → sell-w1（1s 粒度不丢批1）', () => {
  const view = { t0Ms: t0, crewSize: 7, crewBnb: 0.9, w1Bnb: 0.03, w2Bnb: 0, w2SoFarBnb: 0, lastAbs1Ms: t0 + 2000, lastAbs2Ms: null };
  const v = evaluateBurstCooldown(view, t0 + 20000, CFG);
  assert.ok(v && v.batch === 'w1');
});

T('线值锁定：默认 X=0.1/Y=0.05/15s/8s/30s（c97a nb2=0.098 与 Y 间余量 0.048——Y=0.1 误杀 c97a 案）', () => {
  assert.strictEqual(BURST_COOLDOWN_DEFAULTS.check1Sec, 15);
  assert.strictEqual(BURST_COOLDOWN_DEFAULTS.check1MinAbsorbBnb, 0.1);
  assert.strictEqual(BURST_COOLDOWN_DEFAULTS.check2ConfirmSec, 8);
  assert.strictEqual(BURST_COOLDOWN_DEFAULTS.check2Sec, 30);
  assert.strictEqual(BURST_COOLDOWN_DEFAULTS.check2MinAbsorbBnb, 0.05);
});

console.log('== 4. FA 集成（ring/arm/view/clear） ==');

const FA_PATH = path.join(__dirname, '..', 'src', 'services', 'FourMemeFactorAggregator.js');
const FourMemeFactorAggregator = require(FA_PATH);

const mkFa = (enabled) => {
  const fa = new FourMemeFactorAggregator({}, null);
  if (enabled) fa.setBurstCrewRingEnabled(true);
  return fa;
};
const tk = (fa, token, ms, side, wallet, bnb) => fa.processTick({
  token_address: token, timestamp: ms, trade_type: side,
  sender_address: wallet, trader_address: wallet || 'fallback_trader',
  bnb_amount: bnb, token_amount: 1, block_number: 1, price_bnb: 5e-9,
}, { emitFactors: false });

T('FA ring 记录 + arm + view 全链（577c 夹具端到端）', () => {
  const fa = mkFa(true);
  const tok = 'tok_a';
  tk(fa, tok, t0 - 90000, 'sell', 'w_early', 0.288);
  for (const [w, b] of [['w_c1', 0.1485], ['w_c2', 0.1485]]) tk(fa, tok, t0 - 1000, 'buy', w, b);
  for (const [w, b] of [['w_b1', 0.10], ['w_b2', 0.15], ['w_b3', 0.0594], ['w_b4', 0.13]]) tk(fa, tok, t0 - 500, 'buy', w, b);
  tk(fa, tok, t0 + 1000, 'buy', 'w_top', 0.177);
  // 买入成交（t0）→ arm
  fa.setBuyState(tok, { buyPriceBnb: 6.9e-9, buyPriceUsd: 1, buyTime: t0 });
  assert.strictEqual(fa.armBurstCooldown(tok, t0, []), true);
  // fire 后承接：0.069（新钱包）+ 卖单
  tk(fa, tok, t0 + 4000, 'sell', 'w_top', 0.17);
  tk(fa, tok, t0 + 5000, 'buy', 'w_late', 0.069);
  const view = fa.getBurstCooldownView(tok, CFG);
  assert.strictEqual(view.crewSize, 7, `波成员 7，实际 ${view.crewSize}`);
  assert.strictEqual(view.w1Bnb, 0.069, `承接=0.069（波尾 0.177 是 crew 不计），实际 ${view.w1Bnb}`);
  const v = evaluateBurstCooldown(view, t0 + 15000, CFG);
  assert.ok(v && v.batch === 'w1', '577c 案批1 触发');
});

T('FA ownWallet 排除（live 自买 0.2B 不豁免机制）', () => {
  const fa = mkFa(true);
  const tok = 'tok_b';
  tk(fa, tok, t0 - 1000, 'buy', 'w_crew', 0.5);
  fa.setBuyState(tok, { buyPriceBnb: 5e-9, buyPriceUsd: 1, buyTime: t0 });
  fa.armBurstCooldown(tok, t0, ['0xOWN']);
  tk(fa, tok, t0 + 2000, 'buy', '0xOWN', 0.2); // 自己的链上买
  const view = fa.getBurstCooldownView(tok, CFG);
  assert.strictEqual(view.w1Bnb, 0, 'own 买不计承接（若计入 0.2>0.1 直接豁免）');
});

T('FA defer 两段喂食：wallet 段（applyWalletTick）后 ring/crew 正确', () => {
  const fa = mkFa(true);
  const tok = 'tok_c';
  // 价格段先行（sender null → wallet=trader 不可靠——ring 挂 wallet 段）
  fa.processTick({ token_address: tok, timestamp: t0 - 1000, trade_type: 'buy', sender_address: null, trader_address: 'agg_router', bnb_amount: 0.4, token_amount: 1, block_number: 1, price_bnb: 5e-9 }, { emitFactors: false, deferWallet: true });
  // wallet 段补喂（sender 真值）
  fa.applyWalletTick({ token_address: tok, timestamp: t0 - 1000, trade_type: 'buy', sender_address: 'w_real', trader_address: 'agg_router', bnb_amount: 0.4, token_amount: 1, block_number: 1, price_bnb: 5e-9 });
  fa.setBuyState(tok, { buyPriceBnb: 5e-9, buyPriceUsd: 1, buyTime: t0 });
  fa.armBurstCooldown(tok, t0, []);
  const view = fa.getBurstCooldownView(tok, CFG);
  assert.strictEqual(view.crewSize, 1, 'ring 记的是 wallet 段行（sender 真值 w_real）');
  assert.ok(view.crewBnb > 0);
});

T('FA clearBuyState 全清 → arm 同步解除（卖出后不再观测）', () => {
  const fa = mkFa(true);
  const tok = 'tok_d';
  tk(fa, tok, t0 - 1000, 'buy', 'w_crew', 0.5);
  fa.setBuyState(tok, { buyPriceBnb: 5e-9, buyPriceUsd: 1, buyTime: t0 });
  fa.armBurstCooldown(tok, t0, []);
  assert.ok(fa.getBurstCooldownView(tok, CFG));
  fa.clearBuyState(tok);
  assert.strictEqual(fa.getBurstCooldownView(tok, CFG), null, '清仓解除观测');
});

T('FA 机制关（ring 未启用）→ view 无 crew（null crew 退化为全量承接判定）', () => {
  const fa = mkFa(false);
  const tok = 'tok_e';
  tk(fa, tok, t0 - 1000, 'buy', 'w_crew', 0.5);
  fa.setBuyState(tok, { buyPriceBnb: 5e-9, buyPriceUsd: 1, buyTime: t0 });
  fa.armBurstCooldown(tok, t0, []);
  const view = fa.getBurstCooldownView(tok, CFG);
  assert.strictEqual(view.crewSize, 0, 'ring 空 → crew 空（引擎关=不 arm 不扫，此形状不会出现，防御性断言）');
});

console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
