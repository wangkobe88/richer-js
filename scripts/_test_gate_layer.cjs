#!/usr/bin/env node
/**
 * 因子过滤门层（T253，2026-11-28 用户裁定三层模型归位）单测——零 DB 零网络
 *
 *   A. FP 纯函数层：全臂恒算 + 门行三元组 hit/activated/blocked
 *      - 决策不变量「结论 === 策略过滤(原始命中)」：对夹具与模糊生成的数百份快照 × 四种
 *        policy，按旧 else-if 链语义重建命中集（独立臂全量 + 链序首命中 + act/tail/famous），
 *        断言 arms/reason 与 filterArmsByClass 参考逐位相等——旧链决策逐位不变的结构性证明
 *      - 不变式：pass === !gates.some(blocked)、blocked ⇒ hit ∧ activated、policy 不改原始判定
 *      - 三元组真值表（cheatOnly / 多码门部分豁免 / 双豁免 / cheatOnly+差集）
 *      - 短路等价守卫（原链不可达的判定抛错=吞；可达=上抛，与旧链同向）
 *      - 上涨趋势值门行形状；GATE_ARM_CODES 与门行 id 集合一致
 *
 * 用法：node scripts/_test_gate_layer.cjs
 */
'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..');
const FP = require(path.join(ROOT, 'src/market-analysis/factor-pre-buy-check.js'));

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` | ${JSON.stringify(detail)}` : ''}`); }
}

// ── 臂码分族（臂链同序）──
const CHAIN_ORDER = [
  'cd400_dump_no_absorption', 'cd403_dump_low_absorption', 'dump_pair_low_absorption',
  'cd401_burst_exit_sell_pressure', 'cd405_burst_bundled_wave', 'malicious_dump', 'crash_numeric',
  'burst_weak_wave', 'lifecycle_burst_residual', 'lifecycle_sell_residual', 'tail_dip_knife',
  'cd412_extreme_dump_sellers', 'cd414_dense_dump', 'tail_no_buyer_pressure', 'launch_fail_dead',
  'holder_quiet_unload', 'slow_pump_unload', 'fam_harvested_final', 'fam_burst_wave',
  'fam_low_exit_cooldown', 'crash_form', 'fam_early_flip_partial', 'fam_early_flip_exit',
];
const INDEP_ORDER = ['launch_squad_dominance', 'big_buy_defer', 'holder_scatter', 'even_split_crew', 'oversell_residual', 'arb_bot_holdings'];
const FAMOUS_CODES = new Set(['fam_holding_thin', 'fam_holding_dumping', 'fam_harvested_dump']);
const PVP_CODE = 'pvp_no_big_participation';
const POLICIES = [
  { name: '缺省', armClass: null, armExempt: null },
  { name: 'cheatOnly', armClass: 'cheat', armExempt: null },
  { name: '臂差集', armClass: null, armExempt: ['fam_holding_thin', 'oversell_residual', 'act_low'] },
  { name: 'cheatOnly+差集', armClass: 'cheat', armExempt: ['slow_pump_unload', 'arb_bot_holdings'] },
];

/** 基线快照（全门不中：像样买方在场、活跃度正常）——各夹具在其上叠加命中键 */
const base = (bd = {}, cd = {}) => ({
  ticks: [{ dt: 400 }],
  wallets: [{ maxBuyBnb: 0.2994 }],
  buyDerived: Object.assign({ activity: { nearTail10BuyN: 3, nearTail10SellBnb: 0.2 } }, bd),
  cheatDerived: Object.assign({}, cd),
});
const row = (r, id) => r.gates.find((g) => g.id === id);

/** 旧 else-if 链命中集重建（决策参考）：独立臂全量 + 链序首命中 + act/tail/famous */
function legacyArmsOf(r) {
  const nonFam = r.rawHits.filter((c) => !FAMOUS_CODES.has(c) && c !== PVP_CODE);
  const chainHits = CHAIN_ORDER.filter((c) => nonFam.includes(c));
  const indepHits = INDEP_ORDER.filter((c) => nonFam.includes(c));
  const actCodes = r.activity.level === 'low' ? ['act_low'] : (r.activity.level === 'ultra' ? ['act_ultra'] : []);
  const tailCodes = r.tail.reason ? [r.tail.reason] : [];
  const famousCodes = r.famous.hit === 1 && r.famous.reason ? [r.famous.reason] : [];
  return [...indepHits, ...(chainHits.length ? [chainHits[0]] : []), ...actCodes, ...tailCodes, ...famousCodes];
}

/**
 * 对单份快照断言全部不变量（四种 policy）；返回 {fails, hits}。
 * 不打印——夹具段逐条输出，模糊段聚合输出。
 */
function invariantFailures(snap, tag) {
  const fails = [];
  const r0 = FP.evaluateFactorPreBuy(snap);
  const legacyArms = legacyArmsOf(r0);
  if (JSON.stringify(r0.arms) !== JSON.stringify(legacyArms)) {
    fails.push(`${tag} 缺省 policy：arms !== 旧链命中集重建 ${JSON.stringify({ arms: r0.arms, legacyArms })}`);
  }
  const hitCodes = r0.gates.filter((g) => g.hit === true && g.code).map((g) => g.code);
  if (!hitCodes.every((c) => r0.rawHits.includes(c))) fails.push(`${tag} rawHits 漏门行命中码 ${JSON.stringify({ rawHits: r0.rawHits, hitCodes })}`);
  const chainInRaw = CHAIN_ORDER.filter((c) => r0.rawHits.includes(c));
  if (chainInRaw.length > 0 && !r0.arms.includes(chainInRaw[0])) fails.push(`${tag} 链序首命中未进 arms ${JSON.stringify({ chainInRaw, arms: r0.arms })}`);
  // 早窗快闪是链末兜底：链内已有更早命中时，早窗码即便原始命中也不进 arms
  const earlyInArms = r0.arms.find((c) => c === 'fam_early_flip_partial' || c === 'fam_early_flip_exit');
  if (earlyInArms && chainInRaw.some((c) => c !== earlyInArms)) fails.push(`${tag} 早窗兜底被更早链臂遮蔽却进了 arms ${JSON.stringify({ chainInRaw, arms: r0.arms })}`);

  for (const pol of POLICIES) {
    const opts = {};
    if (pol.armClass) opts.armClass = pol.armClass;
    if (pol.armExempt) opts.armExempt = pol.armExempt;
    const r = FP.evaluateFactorPreBuy(snap, opts);
    const ref = FP.filterArmsByClass({
      arms: legacyArms, pvpReason: r0.pvp.reason, actLevel: r0.activity.level,
      tailReason: r0.tail.reason, famousReason: r0.famous.reason,
    }, pol.armClass, pol.armExempt);
    if (JSON.stringify(r.arms) !== JSON.stringify(ref.arms) || r.reason !== ref.reason) {
      fails.push(`${tag} [${pol.name}] arms/reason !== filterArmsByClass 参考 ${JSON.stringify({ arms: r.arms, reason: r.reason, refArms: ref.arms, refReason: ref.reason })}`);
    }
    if (r.pass !== !r.gates.some((g) => g.blocked)) fails.push(`${tag} [${pol.name}] 不变式破：pass=${r.pass} reason=${r.reason}`);
    if (!r.gates.every((g) => !g.blocked || (g.hit === true && g.activated === true))) fails.push(`${tag} [${pol.name}] blocked 但非 (hit ∧ activated)`);
    if (JSON.stringify(r.rawHits) !== JSON.stringify(r0.rawHits)) fails.push(`${tag} [${pol.name}] policy 改变了原始判定`);
    if (!r.gates.every((g) => g.source && g.group && typeof g.activated === 'boolean' && typeof g.blocked === 'boolean'
      && (g.hit === true || g.hit === false || g.hit === null))) fails.push(`${tag} [${pol.name}] 门行形状不全`);
  }
  return { fails, hits: new Set(r0.rawHits) };
}

// ── 模糊快照生成（固定种子；极值偏置提高命中率）──
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261128);
// 键 → [下界, 上界]（数值域按各臂判据线圈定；约 12% 概率省略键=证据缺席）
const BD_KEYS = {
  chg5Pct: [-40, 20], chg10Pct: [-40, 30], chg30Pct: [-40, 40], chg60Pct: [-60, 60], chg300Pct: [-80, 120],
  athVsLaunchPct: [0, 300], currentVsLaunchPct: [-30, 80], currentVsAthPct: [-60, 5], totalVolumeBnb: [0, 60],
  tokenAgeSec: [0, 1500], launchMinVsFloorPct: [-25, 5], secSinceAth: [0, 1200], secSinceSwingHigh: [0, 200],
  currentVsSwingHighPct: [-30, 3], nearMaxDn5Pct: [-25, 2], curVsMinGapPct: [0, 8], recentDip5Pct: [-30, 3],
  minVsLaunchPct: [0, 12], oversellBnb: [0, 1.5], oversellerN: [0, 5], anchorWalletN: [0, 20], oversellSecToAnchor: [0, 120],
  arbBotHoldCircPct: [0, 60], arbBotHolderN: [0, 6], bigHolderSellBnb60: [0, 0.5], bigHolderSellerMinBuyRatio60: [0, 2],
  mcapFromPeakPct: [0, 100], famousEarlyBuySharePct: [0, 80],
};
const ACT_KEYS = {
  nearTail10BuyN: [0, 6], nearTail10SellBnb: [0, 0.6], nearTail10SellWallets: [0, 14], nearTail10BuyBnb: [0, 0.4],
  nearTail5BuyN: [0, 4], nearTail7BuyN: [0, 5], nearSegBuyMedianBnb: [0, 0.09], nearSegBnbPerMin: [0, 2.4],
  ticksPerMin: [0, 260], idlePct: [0, 100], throughputBnbPerMin: [0, 3], buyMedianBnb: [0, 0.09], tickCount: [7, 400],
  maxDrawdownPct: [0, 90],
};
const WIN_KEYS = { buyBnb: [0, 1.2], sellBnb: [0, 3], buyN: [0, 12], sellN: [0, 18], netBnb: [-3, 1], sellers: [0, 20], ticksPerMin: [0, 120], buyers: [0, 12], newBuyers: [0, 10], buySharePct: [0, 100] };
const CD_KEYS = {
  nearDumpQualBlocks: [0, 3], nearDumpMinAbsorbBnb: [0, 0.09], nearDumpWorstSellers: [0, 24],
  burstPreSegBuyBnb: [0, 0.4], burstPreSegSellBnb: [0, 0.4], burstWaveSegSellPct: [0, 100], burstWaveSegBnb: [0, 0.8],
  burstWaveSegBuyBnb: [0, 0.8], burstSecSinceWaveEnd: [0, 90], burstSecSinceSegEnd: [0, 120], burstLastGapSec: [0, 120],
  burstWaveBundleMaxWallets: [0, 12], burstWaveBundleAdjPairSum: [0, 14], nearDumpWorstSellBnb: [0, 1.6],
  pumpStablePoints: [0, 60], pumpStableR2: [0.85, 1], famousDominancePct: [70, 100], totalBuyBnb: [0, 6],
  burstExitWaveBuyBnb: [0, 0.7], burstExitWaveWallets: [0, 6], burstWaveNetBnb: [-0.3, 0.4], burstWaveWalletAvgBnb: [0, 0.06],
  athVsLaunchPct: [0, 200],
  // T210 停滞再启动九键原料
  stallRestartExitBnb: [0, 0.5], stallRestartExitToAnchorSec: [0, 4], stallRestartWaveRows: [0, 12],
  stallRestartEarlyWallets: [0, 20], stallRestartVolPreBnb: [0, 8], stallRestartHolders: [0, 10],
  stallRestartBuyers: [0, 14], stallRestartRetention: [0, 1],
};
const FT_KEYS = {
  groupBuyBnb: [0, 3], groupSellBnb: [0, 3], groupBuyPct: [0, 60], groupSellPct: [0, 60], presenceNetBnb: [-0.5, 1],
  famousFollowBnb: [0, 0.4], lastSellVsLaunchPct: [0, 50], lastSellToAnchorSec: [0, 200], postEntryMinBnb: [0, 1],
  postSellTroughPct: [0, 20], groupFirstBuyDt: [0, 40], groupFirstBuyRank: [0, 20],
};

function randVal(lo, hi) {
  const u = rnd();
  if (u < 0.12) return null;                    // 证据缺席（省略键）
  if (u < 0.30) return lo;                      // 下界极值
  if (u < 0.48) return hi;                      // 上界极值
  if (u < 0.60) return +(lo + (hi - lo) * 0.5).toFixed(4);
  return +(lo + (hi - lo) * rnd()).toFixed(4);
}
function randObj(keys) {
  const o = {};
  for (const [k, rng] of Object.entries(keys)) {
    const v = randVal(rng[0], rng[1]);
    if (v !== null) o[k] = v;
  }
  return o;
}
function randSnapshot() {
  const bd = randObj(BD_KEYS);
  bd.activity = randObj(ACT_KEYS);
  bd.win = {};
  for (const w of [30, 60, 120]) if (rnd() < 0.85) bd.win[w] = randObj(WIN_KEYS);
  if (rnd() < 0.5) bd.chip = randObj({ posHolderCount: [0, 40], top1HoldCircPct: [0, 80], top1Top2HoldCircPct: [0, 90], holderHHI: [0, 0.2], holderHHIEntities: [0, 0.2], circSupplyPct: [0, 30] });
  if (rnd() < 0.5) {
    bd.launchSquad = randObj({ waveWallets: [0, 14], domPct: [0, 50] });
    bd.launchDefer = randObj({ bigBuyBnb: [0, 1.4], sinceFirstTradeSec: [0, 90] });
  }
  if (rnd() < 0.5) {
    bd.dumpBlock = randObj({ sellBnb: [0, 1.2], dropPct: [0, 20], sellers: [0, 10], secToAnchor: [0, 30], followBuyRatio: [0, 0.9] });
    bd.dump2Block = randObj({ sellers: [0, 14], sellBnb: [0, 1.0], dropPct: [0, 12], secToAnchor: [0, 90], followBuyRatio: [0, 0.5], followBuyBnb: [0, 0.2] });
  }
  if (rnd() < 0.5) bd.burstWaveQuality = randObj({ whaleWallets: [0, 4], whaleMergedGroups: [0, 4], preWaveBuyBnb: [0, 2] });
  if (rnd() < 0.6) bd.famousTraces = Object.assign({ wallets: ['0xf1', '0xf2'].slice(0, 1 + (rnd() < 0.5 ? 1 : 0)) }, randObj(FT_KEYS));
  if (rnd() < 0.5) bd.famBurstWave = randObj({ stallSec: [0, 90], waveBuyBnb: [0, 0.6], famSysSharePct: [0, 100], famousFirstInWave: [0, 1] });
  const cd = randObj(CD_KEYS);
  if (rnd() < 0.7) cd.stallRestartExitSide = rnd() < 0.5 ? 'BUY' : 'SELL';
  // 像样买方在场与否随机（PVP 判定树读 wallets[].maxBuyBnb）
  const u = rnd();
  const wallets = u < 0.35 ? [] : (u < 0.6 ? [{ maxBuyBnb: randVal(0, 0.29) || 0.01 }] : [{ maxBuyBnb: 0.2994 }]);
  return Object.assign(base(bd, cd), { wallets });
}

console.log('A. FP 纯函数层：全臂恒算 + 门行三元组');
{
  // ── A1 夹具：各族代表形状，不变量逐条输出 ──
  const famThin = base({ famousTraces: { wallets: ['0xf1'], groupBuyBnb: 1, groupSellBnb: 0.5 } }, { totalBuyBnb: 1 });
  const famDump = base({ famousTraces: { wallets: ['0xf1'], groupBuyBnb: 1, groupSellBnb: 0.5 }, chg30Pct: -20 }, { totalBuyBnb: 10 });
  const cd400 = base({}, { nearDumpQualBlocks: 1, nearDumpMinAbsorbBnb: 0.01 });
  const slowPump = base({ secSinceAth: 700, win: { 120: { buyBnb: 0.2, sellBnb: 0.2 } } }, { pumpStablePoints: 40, pumpStableR2: 0.99 });
  for (const [nm, s] of [['famThin', famThin], ['famDump', famDump], ['cd400', cd400], ['slowPump', slowPump]]) {
    const r = FP.evaluateFactorPreBuy(s);
    ok(`A1 夹具 ${nm} 前置：确有原始命中（${JSON.stringify(r.rawHits)}）`, r.rawHits.length > 0, r.rawHits);
    const { fails } = invariantFailures(s, `夹具 ${nm}`);
    ok(`A1 夹具 ${nm}：四种 policy 下 arms/reason 与旧链参考逐位相等 + 全部不变量成立（${fails.length} 违反）`, fails.length === 0, fails);
  }

  // ── A2 三元组真值表 ──
  const t = row(FP.evaluateFactorPreBuy(famThin), 'fam_holding');
  check('A2a 缺省 policy：fam_holding 命中 thin → hit/activated/blocked 全 true，code=命中支', [t.hit, t.activated, t.blocked, t.code], [true, true, true, 'fam_holding_thin']);
  const rb = FP.evaluateFactorPreBuy(famThin, { armExempt: ['fam_holding_thin'] });
  const tb = row(rb, 'fam_holding');
  check('A2b 独舞差集（豁免 thin）：thin 命中=hit 真但不拦（blocked 假）、dumping 仍可拦（activated 真）、放行',
    [rb.pass, rb.reason, tb.hit, tb.activated, tb.blocked], [true, null, true, true, false]);
  const rc = FP.evaluateFactorPreBuy(famThin, { armExempt: ['fam_holding_thin', 'fam_holding_dumping'] });
  check('A2c 双豁免：门整体未激活（activated 假），原始命中仍在', [rc.pass, row(rc, 'fam_holding').hit, row(rc, 'fam_holding').activated, row(rc, 'fam_holding').blocked], [true, true, false, false]);
  const rd = FP.evaluateFactorPreBuy(famDump, { armExempt: ['fam_holding_thin'] });
  check('A2d 只豁免 thin、dumping 命中 → 照拦', [rd.pass, rd.reason, row(rd, 'fam_holding').code, row(rd, 'fam_holding').blocked], [false, 'fam_holding_dumping', 'fam_holding_dumping', true]);
  const re = FP.evaluateFactorPreBuy(famThin, { armClass: 'cheat' });
  check('A2e cheatOnly（黄金坑）：非作弊类臂 thin=命中·未激活（算了不拦）→ 放行；rawHits 仍含 thin',
    [re.pass, re.reason, row(re, 'fam_holding').hit, row(re, 'fam_holding').activated, row(re, 'fam_holding').blocked, re.rawHits.includes('fam_holding_thin')],
    [true, null, true, false, false, true]);
  const rf = FP.evaluateFactorPreBuy(cd400, { armClass: 'cheat' });
  check('A2f cheatOnly：作弊类臂 cd400 照拦', [rf.pass, rf.reason, row(rf, 'cd400').blocked], [false, 'cd400_dump_no_absorption', true]);
  const rg = FP.evaluateFactorPreBuy(slowPump, { armClass: 'cheat', armExempt: ['slow_pump_unload', 'arb_bot_holdings'] });
  check('A2g cheatOnly+差集（黄金坑全 policy）：slow_pump 命中但被臂豁免 → 不拦；cd400 类臂差集外照拦',
    [rg.pass, rg.reason, row(rg, 'slow_pump').hit, row(rg, 'slow_pump').activated, row(rg, 'slow_pump').blocked], [true, null, true, false, false]);

  // ── A3 短路等价守卫 ──
  const bombBd = { bigHolderSellBnb60: 0.2, athVsLaunchPct: 50 };
  Object.defineProperty(bombBd, 'bigHolderSellerMinBuyRatio60', { get() { throw new Error('boom'); }, enumerable: true });
  const withBomb = (cd) => ({ ticks: [{ dt: 400 }], wallets: [{ maxBuyBnb: 0.2994 }], buyDerived: bombBd, cheatDerived: cd });
  // 原链可达（无前臂命中）：判定抛错上抛=旧链同向（service catch → error → fail-open）
  let threw = null;
  try { FP.evaluateFactorPreBuy(withBomb({})); } catch (e) { threw = e.message; }
  check('A3a 原链可达的判定抛错 → 上抛（与旧链同向）', threw, 'boom');
  // 原链不可达（cd400 已认领）：后续判定抛错吞掉按未命中，决策=cd400 不变
  const rq = FP.evaluateFactorPreBuy(withBomb({ nearDumpQualBlocks: 1, nearDumpMinAbsorbBnb: 0.01 }));
  check('A3b 前臂已认领时后续判定抛错 → 吞（按未命中），决策不变', [rq.pass, rq.reason, row(rq, 'holder_quiet_unload').hit], [false, 'cd400_dump_no_absorption', false]);

  // ── A4 上涨趋势值门 ──
  const rt = FP.evaluateFactorPreBuy(base(), { trendFactors: { riseLegSec: 4.2, surgeStartSec: null } });
  const trendRows = rt.gates.filter((g) => g.category === 'trend');
  check('A4a 趋势值门 11 行恒在链首、hit=null（未设判据）、activated/blocked 恒 false、source=trigger',
    [trendRows.length, rt.gates.slice(0, 11).every((g) => g.category === 'trend'), trendRows.every((g) => g.hit === null && g.activated === false && g.blocked === false && g.source === 'trigger' && g.group === 'trend' && g.code === null)], [11, true, true]);
  check('A4b 趋势值门取值（继承触发层因子；缺证据 \'-\'）', [trendRows[0].id, trendRows[0].value, trendRows[1].value], ['riseLegSec', '4.2s', '-']);
  check('A4c 趋势值门不进决策：rawHits 不含趋势键、放行', [rt.pass, rt.rawHits.length], [true, 0]);
  check('A4d 不传 trendFactors=零行（形状 bit 不变）', FP.evaluateFactorPreBuy(base()).gates.filter((g) => g.category === 'trend').length, 0);

  // ── A5 门 id ↔ 臂码表一致 ──
  const ids = FP.evaluateFactorPreBuy(base()).gates.map((g) => g.id);
  check('A5a GATE_ARM_CODES 键集 === 因子门门行 id 集（40 门）', [ids.length, JSON.stringify([...ids].sort()) === JSON.stringify(Object.keys(FP.GATE_ARM_CODES).sort())], [40, true]);
  check('A5b 零臂码门（通路/FP6 值门）恒不激活', [FP.gateActivated('stall_restart', null, null), FP.gateActivated('fam_dom_fall', null, null), FP.gateActivated('fam_dom_fall', 'cheat', null)], [false, false, false]);

  // ── A6 模糊：800 份随机快照 × 四种 policy ──
  const allFails = [];
  const hitCodes = new Set();
  const N = 800;
  for (let i = 0; i < N; i++) {
    const s = randSnapshot();
    let res;
    try { res = invariantFailures(s, `fuzz#${i}`); }
    catch (e) { allFails.push(`fuzz#${i} 抛错 ${e.message}`); continue; }
    for (const f of res.fails) allFails.push(f);
    for (const c of res.hits) hitCodes.add(c);
  }
  ok(`A6 模糊 ${N} 份 × 4 policy：arms/reason 与旧链参考逐位相等 + 全部不变量成立（${allFails.length} 违反）`, allFails.length === 0, allFails.slice(0, 5));
  const familyHit = {
    pvp: hitCodes.has(PVP_CODE), act: hitCodes.has('act_low') || hitCodes.has('act_ultra'), tail: hitCodes.has('act_tail_flat'),
    famous: [...FAMOUS_CODES].some((c) => hitCodes.has(c)), indep: INDEP_ORDER.some((c) => hitCodes.has(c)), chain: CHAIN_ORDER.some((c) => hitCodes.has(c)),
  };
  ok(`A6b 模糊覆盖：六族臂均有命中样本（${JSON.stringify(familyHit)}），去重命中码 ${hitCodes.size} 种 ≥ 30`, Object.values(familyHit).every(Boolean) && hitCodes.size >= 30, [...hitCodes].sort());
}

console.log(`\n${'='.repeat(60)}\n因子过滤门层单测：${pass} 通过，${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
