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
 *   B. service 层：门层统一取数 prepareGateLayer（纯内存一次取数、零 DB 读、三种短路形状、
 *      共享快照 cheatDerived ≡ cheat 快照 derived 逐位对锁）+ 因子门/BP/活跃度门判定段
 *      （prebuilt ≡ 旧入口；落行开关；arm/trace 透出；旧入口形状不变）
 *   C. 决策核 core/gate-layer.js：四个旧挂点的有效结论逐条转录为基线 legacyDecide，对各门
 *      状态 × 取数状态 × 19 种 policy（11 类型注册表真实 policy + 自定义）的笛卡尔积穷举
 *      对拍——pass / 拒因 / FA 投影 / 落行旗标 / burst 资格 / 四段有效 status 逐位相等
 *      （未到达=旧链段缺席 ↔ 新链 not_reached）；门行全集形状与汇总
 *   D. 引擎编排器 AbstractTradingEngine._gateLayerEvaluate + fpRetry 重评（原型借调 + 真 service
 *      + 内存拉数桩，零 DB）：五段恒在场、各拒因、让位形状、残缺环拒、全豁类型全行未激活、
 *      FA 投影、F6 重评带 policy 反证、续跑零二次取数、落行规则、零 DB 读、两引擎分派源码锁
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


console.log('\nB. service 层：门层统一取数（纯内存零 DB）+ 判定段拆分');
(async () => {
  const { BuyPointCheckService } = require(path.join(ROOT, 'src/market-analysis/BuyPointCheckService.js'));
  const { CheatCheckService } = require(path.join(ROOT, 'src/market-analysis/CheatCheckService.js'));
  const FR = require(path.join(ROOT, 'src/market-analysis/factor-responders.js'));
  const { buildSnapshotFromRows } = require(path.join(ROOT, 'src/market-analysis/cheat-snapshot.js'));
  const T0 = Date.parse('2026-11-25T10:00:00.000Z');
  const at = (dt) => new Date(T0 + dt * 1000).toISOString();
  const w = (n) => '0x' + String(n).padStart(4, '0') + 'aa'.repeat(18);
  const prow = (i, side, bnb, price, o = {}) => ({
    block_time: at(i), block_number: o.block ?? 1000 + Math.floor(i / 3), log_index: o.li ?? i % 3,
    trade_type: side, trader_address: w(o.wallet ?? (i % 10)), sender_address: w(o.wallet ?? (i % 10)),
    bnb_amount: bnb, token_amount: 1e9 * bnb / price, price_bnb: price, price_outlier: false,
    tx_hash: '0xtx' + (o.tx ?? i), quote_token: null,
  });
  // 健康形状（_test_crash_form_gate normalTicks 同款）：六钱包各一笔买 + 三笔稀疏小卖
  const normalTicks = [
    ...[0.22, 0.08, 0.24, 0.09, 0.12, 0.1].map((bnb, k) => prow(k * 2, 'buy', bnb, (1.0 + k * 0.012) * 1e-8, { wallet: 200 + k })),
    ...[[20, 1.05], [30, 1.04], [40, 1.03]].map(([tt, p], k) => prow(tt, 'sell', 0.03, p * 1e-8, { wallet: 260 + k })),
  ];
  // 塞单形状：同块 8 钱包等额买入
  const stuffingTicks = normalTicks.concat([0, 1, 2, 3, 4, 5, 6, 7].map((i) => prow(50 + i, 'buy', 0.05, 1.03e-8, { wallet: 500 + i, block: 1001, li: i })));
  const META = { symbol: 'TST', name: 'Test', platform: 'flap', createdAtMs: T0, creatorAddress: '0xcreator', totalSupply: 1e9 };
  const SILENT = { info() {}, warn() {}, error() {}, debug() {} };
  const neverLlm = async () => { throw new Error('no llm in factor mode'); };
  /** DB 桩：记录 from() 调用的表名与 insert 行（select/eq/order/limit 链最小实现） */
  const mkDb = () => {
    const tables = [], inserts = [];
    const client = {
      from: (t) => {
        tables.push(t);
        const q = { select: () => q, eq: () => q, lte: () => q, order: () => q, limit: async () => ({ data: [], error: null }) };
        q.insert = async (rows) => { inserts.push({ table: t, rows }); return { error: null }; };
        return q;
      },
    };
    return { client, tables, inserts };
  };
  const memPull = (rows, extra = {}) => async () => ({ rows, anchorTickCount: rows.length, capped: false, ...extra });
  const pullOf = (rows, extra) => async () => ({ rows, anchorTickCount: rows.length, capped: false, ...extra });

  // ── B1 prepareGateLayer：纯内存一次取数，零 DB 读 ──
  const db1 = mkDb();
  const bp1 = new BuyPointCheckService({ enabled: true, settleDelayMs: 0, factorCheck: { enabled: true } }, SILENT,
    { dbClient: db1.client, factorMode: true, loadLlm: neverLlm, now: () => T0, arbBotWallets: new Set(), pullTicks: pullOf(normalTicks) });
  const prep = await bp1.prepareGateLayer('0xtok', META, {}, { pullTicks: pullOf(normalTicks) });
  check('B1a prepareGateLayer：ok + 快照/拉数/meta 在场', [prep.ok, prep.token, !!prep.snapshot, prep.pull.anchorTickCount, prep.pull.fromMem, prep.pull.partial], [true, '0xtok', true, normalTicks.length, true, false]);
  check('B1b 门层取数零 DB 读（from() 零调用）', db1.tables, []);
  check('B1c 共享快照的 cheatDerived ≡ buildSnapshotFromRows 同 rows 同 meta 的 derived（逐位）——活跃度门可直接复用',
    JSON.stringify(prep.snapshot.cheatDerived) === JSON.stringify(buildSnapshotFromRows(normalTicks, prep.meta, { capped: false, anchorTickCount: normalTicks.length }).derived), true);
  // 反证：旧入口（非 prebuilt）经 _loadCreateMeta 读 wss_events——门层读 DB 的现状事实
  const legacyFp = await bp1.evaluateFactorPreBuy('0xtok', META, {}, {});
  ok('B1d 反证：旧入口 evaluateFactorPreBuy 会读 wss_events（creator 兜底）——统一门层入口不读', legacyFp.status === 'assessed' && db1.tables.includes('wss_events') && !db1.tables.includes('wss_price_ticks'), db1.tables);

  // ── B2 三种短路形状 ──
  const db2 = mkDb();
  const bp2 = new BuyPointCheckService({ enabled: true, settleDelayMs: 0 }, SILENT,
    { dbClient: db2.client, factorMode: true, loadLlm: neverLlm, now: () => T0, arbBotWallets: new Set() });
  const rAbsent = await bp2.prepareGateLayer('0xtok', META, {}, {});
  const rMiss = await bp2.prepareGateLayer('0xtok', META, {}, { pullTicks: async () => null });
  const rPartial = await bp2.prepareGateLayer('0xtok', META, {}, { pullTicks: pullOf(normalTicks, { partial: true }) });
  const rFew = await bp2.prepareGateLayer('0xtok', META, {}, { pullTicks: pullOf(normalTicks.slice(0, 3)) });
  check('B2a pullTicks 未注入 → insufficient_history/pullTicks_absent（绝不回落 DB）', [rAbsent.ok, rAbsent.status, rAbsent.reason], [false, 'insufficient_history', 'pullTicks_absent']);
  check('B2b 行环无该票 → insufficient_history/ring_miss', [rMiss.ok, rMiss.status, rMiss.reason], [false, 'insufficient_history', 'ring_miss']);
  check('B2c 行环残缺（被清过环又复活，D4）→ insufficient_history/ring_partial', [rPartial.ok, rPartial.status, rPartial.reason, rPartial.anchorTickCount], [false, 'insufficient_history', 'ring_partial', normalTicks.length]);
  check('B2d tick 数不足 minTicks → insufficient_ticks（沿用本服务阈值）', [rFew.ok, rFew.status, rFew.anchorTickCount], [false, 'insufficient_ticks', 3]);
  check('B2e 计数：insufficientHistory ×3 / gateLayerPrepared ×4，全程零 DB', [bp2.stats.insufficientHistory, bp2.stats.gateLayerPrepared, db2.tables], [3, 4, []]);

  // ── B3 因子门判定段：prebuilt 与旧入口同 rows 结论一致 ──
  const preFp = await bp1.evaluateFactorPreBuy('0xtok', META, {}, { prebuilt: prep });
  check('B3 因子门 prebuilt 判定 ≡ 旧入口（pass/reason/arms）且不新增 DB 读',
    [preFp.status, preFp.pass, preFp.reason, preFp.arms, JSON.stringify([preFp.pass, preFp.reason, preFp.arms]) === JSON.stringify([legacyFp.pass, legacyFp.reason, legacyFp.arms]), db1.tables.filter((t) => t === 'wss_events').length],
    ['assessed', true, null, [], true, 1]);

  // ── B4 BP 判定段：塞单门/全门/落行开关 ──
  const db4 = mkDb();
  const bp4 = new BuyPointCheckService({ enabled: true, settleDelayMs: 0 }, SILENT,
    { dbClient: db4.client, factorMode: true, loadLlm: neverLlm, now: () => T0, arbBotWallets: new Set() });
  const prepOK = await bp4.prepareGateLayer('0xtok', META, { signalId: 's1', experimentId: 'e1' }, { pullTicks: pullOf(normalTicks) });
  const prepStuff = await bp4.prepareGateLayer('0xtok', META, { signalId: 's2', experimentId: 'e1' }, { pullTicks: pullOf(stuffingTicks) });
  ok('B4 前置：塞单形状 eqWallets ≥8', prepStuff.snapshot.buyDerived.exactEqualBlockMaxWallets >= 8, prepStuff.snapshot.buyDerived.exactEqualBlockMaxWallets);
  const soClear = await bp4.evaluateFactorBp(prepOK, {}, { stuffingOnly: true });
  const soHit = await bp4.evaluateFactorBp(prepStuff, {}, { stuffingOnly: true });
  check('B4a stuffingOnly：未命中=neutral/policy_stuffing_only、不落行', [soClear.status, soClear.assessment, soClear.policy, db4.inserts.length], ['assessed', { bucket: 'neutral', prob: null, rule: 'policy_stuffing_only' }, 'stuffingOnly', 0]);
  check('B4b stuffingOnly：命中=poor/stuffing_gate（与 _chain 同形）+ 携带塞单锚值', [soHit.assessment.rule, soHit.assessment.bucket, soHit.stuffingEqWallets >= 8], ['stuffing_gate', 'poor', true]);
  const fullClear = await bp4.evaluateFactorBp(prepOK, {}, { writeRow: false });
  const fullHit = await bp4.evaluateFactorBp(prepStuff, {}, { writeRow: false });
  check('B4c 全门（BPF3）：塞单未命中=neutral/gates_passed；命中=poor/stuffing_gate——BPF3 唯一拒因', [fullClear.assessment, fullHit.assessment, fullClear.model], [{ bucket: 'neutral', prob: null, rule: 'gates_passed' }, { bucket: 'poor', prob: null, rule: 'stuffing_gate' }, 'factor@BPF3']);
  check('B4d writeRow=false 不落行；writeRow=true 落一行 buy_point_analyses（model=factor@BPF3、无 participantProfile、signal_id 透传）', [db4.inserts.length, (await bp4.evaluateFactorBp(prepOK, { signalId: 's1', experimentId: 'e1' }, { writeRow: true })).status, db4.inserts.length, db4.inserts[0].table, db4.inserts[0].rows[0].signal_id, db4.inserts[0].rows[0].answers_raw.model, db4.inserts[0].rows[0].snapshot_digest.participantProfile], [0, 'assessed', 1, 'buy_point_analyses', 's1', 'factor@BPF3', null]);
  const bpNoPersist = new BuyPointCheckService({ enabled: true, settleDelayMs: 0, persist: false }, SILENT,
    { dbClient: mkDb().client, factorMode: true, loadLlm: neverLlm, now: () => T0, arbBotWallets: new Set() });
  await bpNoPersist.evaluateFactorBp(prepOK, {}, { writeRow: true });
  check('B4e persist=false（回测隔离）：writeRow=true 也不落行', bpNoPersist.stats.rowsWritten, 0);

  // ── B5 活跃度门判定段：prebuilt ≡ 旧入口 + arm/trace 透出 ──
  const db5 = mkDb();
  const cs = new CheatCheckService({ enabled: true, settleDelayMs: 0 }, SILENT,
    { dbClient: db5.client, factorMode: true, loadLlm: neverLlm, now: () => T0, pullTicks: memPull(normalTicks) });
  const afLegacy = await cs.evaluateActFront('0xtok', META, {}, { anchorMs: 1 });
  const afPre = await cs.evaluateActFront('0xtok', META, {}, { prebuilt: prep });
  const pick = (o) => JSON.stringify({ status: o.status, act: o.act, sbw: o.sbw, wash: o.wash, path: o.path, version: o.version, model: o.model });
  check('B5a 活跃度门 prebuilt ≡ 旧入口（status/act/sbw/wash/path/version/model）——本夹具 AF3 判 low（锚前稀疏小卖）', [pick(afPre) === pick(afLegacy), afLegacy.status, afLegacy.act, afLegacy.path], [true, 'assessed', 'low', 'reject_low']);
  ok('B5b prebuilt 入口多带 arm（命中臂名）与 trace（判序数值锚）', typeof afPre.arm === 'string' && afPre.arm.length > 0 && afPre.trace && typeof afPre.trace === 'object', { arm: afPre.arm, trace: afPre.trace });
  check('B5c 旧入口形状不变（无 arm/trace 键——G1 深比较锁）', ['arm' in afLegacy, 'trace' in afLegacy], [false, false]);
  const afFew = await cs.evaluateActFront('0xtok', META, {}, { prebuilt: await bp2.prepareGateLayer('0xtok', META, {}, { pullTicks: pullOf(normalTicks.slice(0, 9)) }) });
  const db5b = mkDb();
  const csFew = new CheatCheckService({ enabled: true, settleDelayMs: 0, minTicks: 20 }, SILENT, { dbClient: db5b.client, factorMode: true, loadLlm: neverLlm, now: () => T0, arbBotWallets: new Set() });
  const afFew20 = await csFew.evaluateActFront('0xtok', META, {}, { prebuilt: prep });
  check('B5d minTicks 预门用 cheat 服务自身阈值（与 BP 服务各自阈值作用于同一锚计数）：不足=fail_open', [afFew.status, afFew.path ?? null, afFew20.status, afFew20.path], ['assessed', 'reject_low', 'insufficient_ticks', undefined]);

  // ── B6 应答器形状 ──
  check('B6a judgeActFrontFactor(null) 四键（旧形状）', FR.judgeActFrontFactor(null), { act: null, sbw: null, wash: null, model: 'factor@AF3' });
  check('B6b judgeActFrontFactorFull(null) 六键', FR.judgeActFrontFactorFull(null), { act: null, sbw: null, wash: null, arm: null, trace: null, model: 'factor@AF3' });
  const full = FR.judgeActFrontFactorFull({ derived: prep.snapshot.cheatDerived });
  const four = FR.judgeActFrontFactor({ derived: prep.snapshot.cheatDerived });
  check('B6c 同一判定：四键版 ≡ 全文版取四键', [four.act === full.act && four.sbw === full.sbw && four.model === full.model, typeof full.arm, typeof full.trace], [true, 'string', 'object']);

console.log('\nC. 决策核 gate-layer.js：与旧门链有效结论穷举对拍');
{
  const GL = require(path.join(ROOT, 'src/trading-engine/core/gate-layer.js'));
  const { POINT_TYPES } = require(path.join(ROOT, 'src/market-analysis/point-type-router.js'));

  // ── 旧门链决策转录（基线）：逐字对照 AbstractTradingEngine 四挂点的有效结论 ──
  // 口径：各门自取数在单快照前提下用同一份取数结果代表；取数失败的新形状
  // （insufficient_history / error）旧链无对应——FP/AF 按 fail-open、BP 按 fail-closed 映射
  const AF_REJECT = new Set(['reject_low', 'reject_ultra', 'reject_wash']);
  const AF_SKIP = new Set(['burst_exempt', 'restart_exempt', 'high_skip']);
  function legacyDecide(st) {
    const pol = st.policy || {};
    const prep = st.prep || { status: 'insufficient_history', reason: 'pullTicks_absent', anchorTickCount: 0 };
    const prepOk = prep.ok === true;
    const fp = prepOk ? st.fp : null;
    const af = prepOk ? st.af : null;
    const cheat = st.cheat;
    const bp = prepOk ? st.bp : null;
    const out = { pass: true, code: null, proj: null, writeBp: false, t189: false, st: {} };
    let fpPass = true;
    // _factorGateEvaluate
    if (pol.factorCheckArms === 'skip') out.st.fp = 'policy_pass';
    else {
      const res = prepOk ? fp : { status: prep.status };
      out.st.fp = res.status;
      if (res.status === 'assessed') {
        fpPass = res.pass === true;
        out.proj = { blocked: fpPass ? 0 : 1, reason: res.reason };
        if (!fpPass) out.code = `factor_gate_${res.reason}`;
      }
    }
    // _actFrontGateEvaluate（模块在场；段缺席=未到达）
    let afPass = true;
    let skipCheat = false;
    if (!fpPass) out.st.af = 'ABSENT';
    else if (pol.actFront === 'pass') out.st.af = 'policy_pass';
    else {
      const res = prepOk ? af : { status: prep.status };
      out.st.af = res.status;
      if (res.status === 'assessed') {
        if (AF_REJECT.has(res.path)) { afPass = false; out.code = `act_front_${res.path.replace('reject_', '')}`; }
        skipCheat = AF_SKIP.has(res.path);
      }
    }
    // _cheatGateEvaluateBinary → _cheatGateFactorEvaluate（因子代 per-signal）
    let cheatPass = true;
    if (!(fpPass && afPass)) out.st.cheat = 'ABSENT';
    else if (pol.cheatCheck === 'skip') out.st.cheat = 'policy_pass';
    else if (skipCheat) out.st.cheat = 'skipped_by_act_front';
    else {
      out.st.cheat = cheat ? cheat.status : 'unknown';
      if (cheat && (cheat.grade === 'cheat' || cheat.grade === 'unhealthy')) { cheatPass = false; out.code = `cheat_gate_${cheat.grade}`; }
    }
    // T189b：sbw 取作弊门 info.levels——旧链前门拒即 return，作弊门未到达时 t189SbwBurst 保持初值 false
    const cheatLevels = out.st.cheat === 'ABSENT' ? null
      : (out.st.cheat === 'policy_pass' ? { stallBurstWave: null } // 旧挂点 policy_pass 合成 levels
        : (out.st.cheat === 'skipped_by_act_front' ? { stallBurstWave: af.sbw === 'burst' ? 1 : null }
          : (cheat ? cheat.levels : null)));
    out.t189 = !!(cheatLevels && cheatLevels.stallBurstWave === 1);
    // _bpGateEvaluate（fail-closed）
    let bpPass = true;
    if (!(fpPass && afPass && cheatPass)) out.st.bp = 'ABSENT';
    else if (pol.buyPoint === 'skip') out.st.bp = 'policy_pass';
    else {
      out.writeBp = prepOk && pol.buyPoint !== 'stuffingOnly'; // 全门路径才有落行资格
      const res = prepOk ? bp : (prep.status === 'insufficient_ticks' ? { status: 'insufficient_ticks' } : { status: 'fail' });
      out.st.bp = res.status;
      if (res.status === 'assessed') {
        const bucket = res.assessment && res.assessment.bucket;
        bpPass = bucket != null && ['good', 'neutral'].includes(bucket);
        if (!bpPass) out.code = 'bp_gate_assessment';
      } else if (res.status === 'insufficient_ticks') { bpPass = false; out.code = 'bp_gate_insufficient_ticks'; }
      else { bpPass = false; out.code = `bp_gate_${res.status}`; }
    }
    out.pass = fpPass && afPass && cheatPass && bpPass;
    return out;
  }

  // ── 状态集 ──
  const TREND = { riseLegSec: 4.2 };
  const cd400Fix = base({}, { nearDumpQualBlocks: 1, nearDumpMinAbsorbBnb: 0.01 });
  const famThinFix = base({ famousTraces: { wallets: ['0xf1'], groupBuyBnb: 1, groupSellBnb: 0.5 } }, { totalBuyBnb: 1 });
  /** policy → 因子门判定入参（旧挂点 _factorGateEvaluate 同款：cheatOnly→armClass，臂差集→armExempt） */
  const fpOptsOf = (policy, extra = {}) => {
    const o = { ...extra };
    if (policy && policy.factorCheckArms === 'cheatOnly') o.armClass = 'cheat';
    if (policy && Array.isArray(policy.factorCheckArmExempt) && policy.factorCheckArmExempt.length) o.armExempt = policy.factorCheckArmExempt;
    return o;
  };
  // service 返回形状（status:'assessed' + 纯函数产物）——编排器拿到的就是它
  const svc = (r) => ({ status: 'assessed', ...r });
  /** 某 policy 下的因子门四态：过 / 作弊类臂拒 / 非作弊类臂拒（cheatOnly 下转放行）/ 异常 */
  const fpStatesOf = (policy) => ([
    ['pass', svc(FP.evaluateFactorPreBuy(base(), fpOptsOf(policy, { trendFactors: TREND })))],
    ['rejectCd', svc(FP.evaluateFactorPreBuy(cd400Fix, fpOptsOf(policy, { trendFactors: TREND })))],
    ['rejectThin', svc(FP.evaluateFactorPreBuy(famThinFix, fpOptsOf(policy, { trendFactors: TREND })))],
    ['error', { status: 'error', reason: 'x' }],
  ]);
  const FP_RAW = Object.fromEntries(fpStatesOf(null));
  const afRaw = (path, o = {}) => ({ status: 'assessed', act: 'mid', sbw: 'none', wash: null, path, version: 'AF3', model: 'factor@AF3', arm: 'near_alive', trace: { idlePct: 12 }, ...o });
  const AF_RAW = {
    reject_low: afRaw('reject_low', { act: 'low', arm: 'near_dead' }),
    reject_ultra: afRaw('reject_ultra', { act: 'ultra', arm: 'whole_window_ultra' }),
    reject_wash: afRaw('reject_wash', { act: 'high', wash: 'strong' }),
    burst_exempt: afRaw('burst_exempt', { act: 'low', sbw: 'burst' }),
    restart_exempt: afRaw('restart_exempt', { act: 'low' }),
    high_skip: afRaw('high_skip', { act: 'high' }),
    high_skip_burst: afRaw('high_skip', { act: 'high', sbw: 'burst' }),
    mid_full: afRaw('mid_full'),
    fail_open: afRaw('fail_open', { act: null, sbw: null }),
    insufficient: { status: 'insufficient_ticks', anchorTickCount: 3 },
    fail: { status: 'fail', reason: 'cooldown' },
    error: { status: 'error', reason: 'x' },
  };
  const CHEAT_RAW = {
    healthy: { status: 'analyzed', grade: 'healthy', reasons: [], levels: { stallBurstWave: null }, model: 'factor@CF1' },
    healthyBurst: { status: 'analyzed', grade: 'healthy', reasons: [], levels: { stallBurstWave: 1 }, model: 'factor@CF1' },
    unhealthy: { status: 'analyzed', grade: 'unhealthy', reasons: [{ code: 'E_act_low' }], levels: { stallBurstWave: null }, model: 'factor@CF1' },
    cheat: { status: 'analyzed', grade: 'cheat', reasons: [{ code: 'A_coordinated' }], levels: { stallBurstWave: null }, model: 'factor@CF1' },
    fail: { status: 'fail', reason: 'factor_error' },
  };
  const BP_RAW = {
    good: { status: 'assessed', assessment: { bucket: 'good', prob: null, rule: 'gates_passed' }, anchors: { exactEqualBlockMaxWallets: 2 } },
    neutral: { status: 'assessed', assessment: { bucket: 'neutral', prob: null, rule: 'gates_passed' }, anchors: { exactEqualBlockMaxWallets: 2 } },
    poorStuffing: { status: 'assessed', assessment: { bucket: 'poor', prob: null, rule: 'stuffing_gate' }, anchors: { exactEqualBlockMaxWallets: 9 } },
    poorOther: { status: 'assessed', assessment: { bucket: 'poor', prob: null, rule: 'entry_gate' }, anchors: {} },
    insufficient: { status: 'insufficient_ticks', anchorTickCount: 3 },
    fail: { status: 'fail', reason: 'chain_error' },
    error: { status: 'error', reason: 'x' },
  };
  const BP_STUFFING_ONLY = {
    soClear: { status: 'assessed', assessment: { bucket: 'neutral', prob: null, rule: 'policy_stuffing_only' }, policy: 'stuffingOnly', stuffingEqWallets: 2 },
    soHit: { status: 'assessed', assessment: { bucket: 'poor', prob: null, rule: 'stuffing_gate' }, policy: 'stuffingOnly', stuffingEqWallets: 9 },
  };
  const PREPS = {
    ok: { ok: true, token: '0xtok', snapshot: {}, pull: { anchorTickCount: 12, capped: false }, meta: {} },
    few: { ok: false, status: 'insufficient_ticks', anchorTickCount: 3 },
    partial: { ok: false, status: 'insufficient_history', reason: 'ring_partial', anchorTickCount: 12 },
    err: { ok: false, status: 'error', reason: 'boom' },
    absent: null,
  };
  const POLICIES = [
    ...POINT_TYPES.map((t) => ({ name: `注册表:${t.id}`, policy: t.policy })),
    { name: '空', policy: {} },
    { name: 'FP直通', policy: { factorCheckArms: 'skip' } },
    { name: 'FP作弊类', policy: { factorCheckArms: 'cheatOnly' } },
    { name: 'AF直通', policy: { actFront: 'pass' } },
    { name: '作弊门跳过', policy: { cheatCheck: 'skip' } },
    { name: 'BP直通', policy: { buyPoint: 'skip' } },
    { name: '全直通', policy: { factorCheckArms: 'skip', actFront: 'pass', cheatCheck: 'skip', buyPoint: 'skip' } },
    { name: 'FP直通+BP全门', policy: { factorCheckArms: 'skip', actFront: 'pass', buyPoint: 'stuffingOnly' } },
  ];

  // 状态归一：新链对取数失败新形状的映射（旧链无对应，按方向等价比较）
  const normNew = (status, legacyStatus) => {
    if (legacyStatus === 'ABSENT') return status === 'not_reached' ? 'ABSENT' : status;
    if (legacyStatus === 'fail' && ['insufficient_history', 'error'].includes(status)) return 'fail';
    return status;
  };
  const normCode = (code, legacyCode, prepName) => {
    // 取数失败新形状的拒因码：旧链按 fail 映射
    if (prepName !== 'ok' && legacyCode === 'bp_gate_fail' && ['bp_gate_insufficient_history', 'bp_gate_error'].includes(code)) return 'bp_gate_fail';
    return code;
  };

  let combos = 0;
  const fails = [];
  let skipCheatSeen = 0, notReachedSeen = 0;
  for (const [prepName, prep] of Object.entries(PREPS)) {
    const prepOk = prepName === 'ok';
    for (const pol of POLICIES) {
      const activation = GL.resolveGateActivation(pol.policy);
      const fpStates = prepOk ? fpStatesOf(pol.policy) : [['none', null]];
      const afStates = prepOk ? Object.entries(AF_RAW) : [['none', null]];
      const bpStates = prepOk
        ? [...Object.entries(BP_RAW), ...Object.entries(BP_STUFFING_ONLY)]
        : [['none', null]];
      for (const [fpName, fpRaw] of fpStates) {
        for (const [afName, afRawRes] of afStates) {
          for (const [cheatName, cheatRaw] of Object.entries(CHEAT_RAW)) {
            for (const [bpName, bpRaw] of bpStates) {
              // 入参形状防线：fp/af/bp 的非 assessed 形状（error/fail/insufficient）没有 gates/path 等键——decide 须容缺不抛
              const st = { policy: pol.policy, prep, fp: fpRaw, af: afRawRes, cheat: cheatRaw, bp: bpRaw };
              const legacy = legacyDecide(st);
              const dec = GL.decideGateLayer({ activation, prep, fp: fpRaw, af: afRawRes, cheat: cheatRaw, bp: bpRaw, trendFactors: { riseLegSec: 4.2 } });
              combos++;
              const tag = `${prepName}|${pol.name}|fp=${fpName}|af=${afName}|cheat=${cheatName}|bp=${bpName}`;
              const bad = [];
              if (dec.pass !== legacy.pass) bad.push(`pass ${dec.pass} ≠ ${legacy.pass}`);
              const code = dec.primary ? dec.primary.code : null;
              if (normCode(code, legacy.code, prepName) !== legacy.code) bad.push(`code ${code} ≠ ${legacy.code}`);
              if (JSON.stringify(dec.faProjection) !== JSON.stringify(legacy.proj)) bad.push(`proj ${JSON.stringify(dec.faProjection)} ≠ ${JSON.stringify(legacy.proj)}`);
              if (dec.writeBpRow !== legacy.writeBp) bad.push(`writeBp ${dec.writeBpRow} ≠ ${legacy.writeBp}`);
              if (dec.t189SbwBurst !== legacy.t189) bad.push(`t189 ${dec.t189SbwBurst} ≠ ${legacy.t189}`);
              const S = dec.sections;
              const stNew = {
                fp: normNew(S.factorCheck.status, legacy.st.fp),
                af: normNew(S.actFrontGate.status, legacy.st.af),
                cheat: normNew(S.cheatCheck.status, legacy.st.cheat),
                bp: normNew(S.buyPoint.status, legacy.st.bp),
              };
              if (JSON.stringify(stNew) !== JSON.stringify(legacy.st)) bad.push(`段 status ${JSON.stringify(stNew)} ≠ ${JSON.stringify(legacy.st)}`);
              // 不变式：拒 ⇒ 存在有效拦截门行，或主拒门是 BP 的数据类拒（无门可命中）
              const rows = S.factorCheck.gates;
              if (!dec.pass && !rows.some((r) => r.blocked) && !(dec.primary && dec.primary.gate === 'bp')) bad.push('拒但无 blocked 门行且主拒门非 BP');
              if (dec.pass && rows.some((r) => r.blocked) && dec.primary === null) {
                // 放行却有 blocked 行：只许是「前序门直通/让位后该门未被激活」之外的情形——
                // blocked 行在放行信号上只可能来自首个有效拒之前被 policy 去活的臂，而那些臂 blocked 恒 false
                bad.push('放行却存在 blocked 门行');
              }
              if (!rows.every((r) => !r.blocked || (r.hit === true && r.activated === true))) bad.push('blocked 但非 (hit ∧ activated)');
              if (dec.skipCheat) skipCheatSeen++;
              if (S.buyPoint.status === 'not_reached') notReachedSeen++;
              if (bad.length) fails.push(`${tag} → ${bad.join('; ')}`);
            }
          }
        }
      }
    }
  }
  ok(`C1 穷举对拍 ${combos} 组（取数 5 态 × policy ${POLICIES.length} 种 × FP/AF/作弊/BP 各态）：pass/拒因/FA 投影/落行旗标/burst 资格/四段有效 status 与旧门链转录逐位相等（${fails.length} 不符）`, fails.length === 0, fails.slice(0, 6));
  ok(`C1b 样本量 > 30000 组`, combos > 30000, combos);
  ok(`C2 覆盖：作弊门让位（skipCheat）与未到达（not_reached）形状均有样本`, skipCheatSeen > 0 && notReachedSeen > 0, { skipCheatSeen, notReachedSeen });

  // ── 门行全集与汇总 ──
  const activation0 = GL.resolveGateActivation(null);
  const dec0 = GL.decideGateLayer({ activation: activation0, prep: PREPS.ok, fp: FP_RAW.pass, af: AF_RAW.mid_full, cheat: CHEAT_RAW.healthy, bp: BP_RAW.neutral, trendFactors: { riseLegSec: 4.2 } });
  const rows0 = dec0.sections.factorCheck.gates;
  const byGroup = (rows) => rows.reduce((m, r) => { m[r.group] = (m[r.group] || 0) + 1; return m; }, {});
  check('C3a 全过信号的门行全集：趋势值门 11 + 因子臂 40 + 活跃度门 1 + 作弊门 1 + 塞单门 1 = 54 行', [rows0.length, byGroup(rows0)], [54, { trend: 11, fp: 40, af: 1, cheat: 1, bp: 1 }]);
  const afRow = rows0.find((r) => r.id === 'af_act_level');
  check('C3b 活跃度门行：mid_full → 未命中、已激活、值带 act/arm/sbw/path、类别 liquidity', [afRow.hit, afRow.activated, afRow.blocked, afRow.value, afRow.category, afRow.source, afRow.trace], [false, true, false, 'act=mid arm=near_alive sbw=none path=mid_full', 'liquidity', 'gate', { idlePct: 12 }]);
  const cheatRow = rows0.find((r) => r.id === 'cheat_factor');
  check('C3c 作弊门行：CF1 恒放行（hit 假）、已激活、如实标「无专属判据」', [cheatRow.hit, cheatRow.activated, cheatRow.blocked, cheatRow.value, cheatRow.category], [false, true, false, '恒放行（无专属判据）', 'organized']);
  const stuffRow = rows0.find((r) => r.id === 'stuffing_gate');
  check('C3d 塞单门行：全门路径锚值取 anchors.exactEqualBlockMaxWallets', [stuffRow.value, stuffRow.hit, stuffRow.activated], ['同块等额买入最大簇 2 钱包', false, true]);
  const gl0 = GL.buildGateLayerSection({ activation: activation0, prep: PREPS.ok, rows: rows0, primary: dec0.primary, pass: dec0.pass });
  check('C3e gateLayer 段：v=GL1 · source=memory · 取数快照 · 汇总（54 门 / 激活 41=因子臂 38+活跃度门+作弊门+塞单门，趋势值门 11 与零臂码门 2 不激活 / 命中 0 / 拦 0）',
    [gl0.v, gl0.source, gl0.snapshot, gl0.summary, gl0.primary], ['GL1', 'memory', { anchorTickCount: 12, capped: false, complete: true }, { total: 54, activated: 41, hit: 0, blocked: 0, valueGates: 11 }, null]);
  check('C3f 零臂码门恒不激活：通路行 stall_restart 与 FP6 值门 fam_dom_fall', rows0.filter((r) => r.group === 'fp' && !r.activated).map((r) => r.id).sort(), ['fam_dom_fall', 'stall_restart']);

  // ── 全豁类型（steady：FP 直通 / AF 直通 / 作弊门跳过 / BP 塞单门）+ 各门原始命中 ──
  const steady = POINT_TYPES.find((t) => t.id === 'steady_trend_climb').policy;
  const actSteady = GL.resolveGateActivation(steady);
  const decS = GL.decideGateLayer({ activation: actSteady, prep: PREPS.ok, fp: FP_RAW.rejectCd, af: AF_RAW.reject_low, cheat: CHEAT_RAW.healthy, bp: BP_RAW.neutral, trendFactors: {} });
  const rowsS = decS.sections.factorCheck.gates;
  const cdRow = rowsS.find((r) => r.id === 'cd400');
  const afRowS = rowsS.find((r) => r.id === 'af_act_level');
  const cheatRowS = rowsS.find((r) => r.id === 'cheat_factor');
  check('C4a 全豁类型：FP 原始命中 cd400 但整门未激活 → hit 真 / activated 假 / blocked 假（算了不拦），放行',
    [decS.pass, decS.primary, cdRow.hit, cdRow.activated, cdRow.blocked, rowsS.filter((r) => r.group === 'fp' && r.activated).length], [true, null, true, false, false, 0]);
  check('C4b 全豁类型：AF 直通——reject_low 原始命中、未激活；作弊门跳过——未激活；塞单门已激活', [afRowS.hit, afRowS.activated, afRowS.blocked, cheatRowS.activated, cheatRowS.value, rowsS.find((r) => r.id === 'stuffing_gate').activated], [true, false, false, false, '恒放行（无专属判据）', true]);
  check('C4c 全豁类型的决策留痕：四段有效 status = policy_pass ×3 + assessed；computed 留原始判定',
    [decS.sections.factorCheck.status, decS.sections.factorCheck.computed.reason, decS.sections.actFrontGate.status, decS.sections.actFrontGate.computed.path, decS.sections.cheatCheck.status, decS.sections.buyPoint.status, decS.sections.buyPoint.computed === undefined],
    ['policy_pass', 'cd400_dump_no_absorption', 'policy_pass', 'reject_low', 'policy_pass', 'assessed', true]);
  const glS = GL.buildGateLayerSection({ activation: actSteady, prep: PREPS.ok, rows: rowsS, primary: decS.primary, pass: decS.pass });
  check('C4d 汇总：命中 2（cd400+活跃度门原始命中）/ 拦 0 / 激活 1（仅塞单门）', glS.summary, { total: 54, activated: 1, hit: 2, blocked: 0, valueGates: 11 });

  // ── 让位与未到达 ──
  const decB = GL.decideGateLayer({ activation: activation0, prep: PREPS.ok, fp: FP_RAW.pass, af: AF_RAW.burst_exempt, cheat: CHEAT_RAW.healthy, bp: BP_RAW.neutral, trendFactors: {} });
  check('C5a 活跃度门 burst 路由 → 作弊门让位：skipped_by_act_front（与旧挂点合成 info 同构）+ sbw=burst → burst 资格',
    [decB.pass, decB.skipCheat, decB.sections.cheatCheck, decB.t189SbwBurst], [true, true, { status: 'skipped_by_act_front', path: 'burst_exempt', act: 'low', sbw: 'burst', wash: null, version: 'AF3', levels: { stallBurstWave: 1 }, computed: GL.cheatGateInfo(CHEAT_RAW.healthy) }, true]);
  const decR = GL.decideGateLayer({ activation: activation0, prep: PREPS.ok, fp: FP_RAW.rejectCd, af: AF_RAW.reject_low, cheat: CHEAT_RAW.cheat, bp: BP_RAW.poorStuffing, trendFactors: {} });
  check('C5b 因子门先拒：后续三门恒算留痕 not_reached（computed 带原始判定），不参与决策',
    [decR.pass, decR.primary, decR.sections.actFrontGate.status, decR.sections.actFrontGate.computed.path, decR.sections.cheatCheck.status, decR.sections.cheatCheck.computed.grade, decR.sections.buyPoint.status, decR.sections.buyPoint.computed.assessment.bucket, decR.writeBpRow, decR.faProjection],
    [false, { gate: 'fp', code: 'factor_gate_cd400_dump_no_absorption' }, 'not_reached', 'reject_low', 'not_reached', 'cheat', 'not_reached', 'poor', false, { blocked: 1, reason: 'cd400_dump_no_absorption' }]);
  check('C5c 因子门先拒的终态与拒因文案（与旧挂点同款）', [decR.statusUpdate, decR.reason], [{ message: '因子门拒买: cd400_dump_no_absorption', reason: 'factor_gate_cd400_dump_no_absorption' }, '因子门拒买（cd400_dump_no_absorption）']);

  // ── 取数失败：FP/AF fail-open、BP fail-closed（含 D4 历史不完整）──
  const decP = GL.decideGateLayer({ activation: activation0, prep: PREPS.partial, fp: null, af: null, cheat: CHEAT_RAW.healthy, bp: null, trendFactors: { riseLegSec: 4.2 } });
  check('C6a 行环残缺（D4）：FP/AF 放行留痕、BP 拒 bp_gate_insufficient_history、门行=趋势值门 11 + 三行（值标数据不足）',
    [decP.pass, decP.primary, decP.sections.factorCheck.status, decP.sections.actFrontGate.status, decP.sections.buyPoint.status, decP.sections.factorCheck.gates.length,
      decP.sections.factorCheck.gates.find((r) => r.id === 'af_act_level').value, decP.sections.factorCheck.gates.find((r) => r.id === 'stuffing_gate').value, decP.statusUpdate.message],
    [false, { gate: 'bp', code: 'bp_gate_insufficient_history' }, 'insufficient_history', 'insufficient_history', 'insufficient_history', 14, '历史不完整（ring_partial）', '历史不完整（ring_partial）', 'BP 门拒买: 内存行环历史不完整（ring_partial），数据不足=挡住']);
  const decF = GL.decideGateLayer({ activation: activation0, prep: PREPS.few, fp: null, af: null, cheat: CHEAT_RAW.healthy, bp: null, trendFactors: {} });
  check('C6b tick 不足：BP 拒 bp_gate_insufficient_ticks（BP10 数据不够就挡住）', [decF.pass, decF.primary.code, decF.sections.buyPoint.passed, decF.sections.buyPoint.passLevels], [false, 'bp_gate_insufficient_ticks', false, ['good', 'neutral']]);

  // ── 落行旗标：仅到达 BP ∧ 全门 ──
  const planCases = [
    ['全门+到达', { activation: activation0, prep: PREPS.ok, fp: FP_RAW.pass, af: AF_RAW.mid_full, cheat: CHEAT_RAW.healthy }, { reached: true, writeBpRow: true, stuffingOnly: false }],
    ['全门+前门拒', { activation: activation0, prep: PREPS.ok, fp: FP_RAW.rejectCd, af: AF_RAW.mid_full, cheat: CHEAT_RAW.healthy }, { reached: false, writeBpRow: false, stuffingOnly: false }],
    ['stuffingOnly 类型', { activation: GL.resolveGateActivation({ buyPoint: 'stuffingOnly' }), prep: PREPS.ok, fp: FP_RAW.pass, af: AF_RAW.mid_full, cheat: CHEAT_RAW.healthy }, { reached: true, writeBpRow: false, stuffingOnly: true }],
    ['BP 直通类型', { activation: GL.resolveGateActivation({ buyPoint: 'skip' }), prep: PREPS.ok, fp: FP_RAW.pass, af: AF_RAW.mid_full, cheat: CHEAT_RAW.healthy }, { reached: true, writeBpRow: false, stuffingOnly: false }],
  ];
  for (const [nm, inp, exp] of planCases) {
    const plan = GL.gateLayerBpPlan(inp);
    check(`C7 BP 计划 ${nm}`, [plan.reached, plan.writeBpRow, plan.stuffingOnly], [exp.reached, exp.writeBpRow, exp.stuffingOnly]);
  }
  // cheatGateInfo 与引擎 _cheatGateInfo 同形（引擎方法委托到此——D 段另锁源码）
  const { AbstractTradingEngine } = require(path.join(ROOT, 'src/trading-engine/core/AbstractTradingEngine.js'));
  const engProto = AbstractTradingEngine.prototype;
  const sample = { status: 'analyzed', grade: 'healthy', cached: true, reasons: [{ code: 'x' }], unhealthyGrades: 2, levels: { a: 1 }, buckets: { b: 2 }, anchors: { c: 3 }, strongbackerLike: 1, exempt: { code: 'activity_high' }, unblocked: true, model: 'factor@CF1' };
  check('C8 cheatGateInfo ≡ 引擎 _cheatGateInfo 输出（同输入同形）', GL.cheatGateInfo(sample), engProto._cheatGateInfo.call({}, sample));
  ok('C9 决策核源码零 Date.now / 零 DB / 零网络', !/Date\.now\(/.test(require('fs').readFileSync(path.join(ROOT, 'src/trading-engine/core/gate-layer.js'), 'utf8').replace(/\/\/.*$/gm, '')));
}

console.log('\nD. 引擎编排器：_gateLayerEvaluate + fpRetry 重评');
{
  const { AbstractTradingEngine } = require(path.join(ROOT, 'src/trading-engine/core/AbstractTradingEngine.js'));
  const { FourMemeWssTradingEngine } = require(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine.js'));
  const { BacktestEngine } = require(path.join(ROOT, 'src/trading-engine/implementations/BacktestEngine.js'));
  const { FpRetryTracker } = require(path.join(ROOT, 'src/trading-engine/core/FpRetryTracker.js'));
  const FAMod = require(path.join(ROOT, 'src/services/FourMemeFactorAggregator.js'));
  const { POINT_TYPES } = require(path.join(ROOT, 'src/market-analysis/point-type-router.js'));
  const GOLDEN = POINT_TYPES.find((t) => t.id === 'famous_holder_cold_pit').policy;
  const STEADY = POINT_TYPES.find((t) => t.id === 'steady_trend_climb').policy;
  const TOK = { token: '0xtok', symbol: 'TST', name: 'Test', platform: 'flap', createdAt: T0 / 1000, creatorAddress: '0xcreator', totalSupply: 1e9 };
  const midJudge = () => ({ act: 'mid', sbw: 'none', wash: null, arm: 'near_alive', trace: { idlePct: 12 }, model: 'factor@AF3' });
  const burstLowJudge = () => ({ act: 'low', sbw: 'burst', wash: null, arm: 'near_dead', trace: {}, model: 'factor@AF3' });

  /** 编排器测试台：真 service（因子代）+ dbClient 桩 + 内存拉数桩 + 留痕桩 */
  function mkEng({ ticks, partial = false, afJudge = midJudge, inject = {} } = {}) {
    const db = mkDb();
    let pulls = 0;
    const bp = new BuyPointCheckService({ enabled: true, settleDelayMs: 0, persist: true, factorCheck: { enabled: true } }, SILENT,
      Object.assign({ dbClient: db.client, factorMode: true, loadLlm: neverLlm, now: () => T0, arbBotWallets: new Set() }, inject.bp || {}));
    const cs = new CheatCheckService({ enabled: true, settleDelayMs: 0 }, SILENT,
      Object.assign({ dbClient: db.client, factorMode: true, loadLlm: neverLlm, now: () => T0, actFrontFactorJudgeFull: afJudge }, inject.cs || {}));
    const metas = [], statuses = [];
    const eng = Object.create(AbstractTradingEngine.prototype);
    Object.assign(eng, {
      _experimentId: 't253', logger: SILENT, _actFrontGateEnabled: true,
      _cheatCheckService: cs, _buyPointCheckService: bp,
      _gateLayerPullTicks: async () => { pulls++; return { rows: ticks, anchorTickCount: ticks.length, capped: false, ...(partial ? { partial: true } : {}) }; },
      _updateSignalMetadata: async (id, data) => { metas.push(data); },
      _updateSignalStatus: async (id, status, meta) => { statuses.push({ status, reason: meta.reason, message: meta.message }); },
    });
    return { eng, db, metas, statuses, pulls: () => pulls };
  }
  const run = (h, policy, fire = { riseLegSec: 4.2 }) => h.eng._gateLayerEvaluate('0xtok', TOK, {}, 'sig-1', { signalGate: { maxTriggers: 1 } }, fire,
    { firePriceBnb: 1e-8, strategyName: 'leg0', signalCreatedAt: T0, pointTypePolicy: policy, fireFactors: fire });
  const secOf = (h) => h.metas[0];
  const rowOf = (h, id) => secOf(h).factorCheck.gates.find((r) => r.id === id);

  // ── D1 全过（活跃度 mid）：五段恒在场、一次 metadata、无终态、无落行、零 DB 读 ──
  const h1 = mkEng({ ticks: normalTicks });
  const g1 = await run(h1, null);
  check('D1a 全过：pass / primary null / burst 资格 false', [g1.pass, g1.primary, g1.t189SbwBurst], [true, null, false]);
  check('D1b 五段一次写全：factorCheck assessed / actFrontGate assessed / cheatCheck analyzed(CF1) / buyPoint assessed neutral / gateLayer GL1',
    [h1.metas.length, Object.keys(secOf(h1)).sort(), secOf(h1).factorCheck.status, secOf(h1).actFrontGate.status, secOf(h1).actFrontGate.arm,
      secOf(h1).cheatCheck.status, secOf(h1).cheatCheck.model, secOf(h1).buyPoint.status, secOf(h1).buyPoint.assessment.bucket, secOf(h1).gateLayer.v, secOf(h1).gateLayer.snapshot],
    [1, ['actFrontGate', 'buyPoint', 'cheatCheck', 'factorCheck', 'gateLayer'], 'assessed', 'assessed', 'near_alive', 'analyzed', 'factor@CF1', 'assessed', 'neutral', 'GL1', { anchorTickCount: normalTicks.length, capped: false, complete: true }]);
  check('D1c 全过：无终态更新；到达 BP ∧ 全门 → 落一行 buy_point_analyses；门层零 DB 读（无 wss_events / wss_price_ticks）',
    [h1.statuses.length, h1.db.tables.filter((t) => t !== 'buy_point_analyses'), h1.db.inserts.length], [0, [], 1]);
  check('D1d 门行：54 行（趋势 11+因子臂 40+三行），全三元组在场；取数恰一次', [secOf(h1).factorCheck.gates.length, h1.pulls()], [54, 1]);

  // ── D2 因子门拒：后三门恒算留痕（not_reached + computed），终态 factor_gate_* ──
  const h2 = mkEng({ ticks: normalTicks.concat([0, 1, 2, 3].map((i) => prow(60 + i, 'sell', 0.3, 1.0e-8, { wallet: 700 + i, block: 1002, li: i }))) });
  const dumpTicks = normalTicks.concat([
    prow(50, 'buy', 0.05, 1.02e-8, { wallet: 650 }), prow(51, 'sell', 0.6, 1.0e-8, { wallet: 651 }), prow(52, 'sell', 0.6, 0.98e-8, { wallet: 652 }),
    prow(53, 'sell', 0.6, 0.96e-8, { wallet: 653 }), prow(54, 'sell', 0.6, 0.94e-8, { wallet: 654 }), prow(55, 'sell', 0.6, 0.92e-8, { wallet: 655 }),
    prow(56, 'sell', 0.6, 0.90e-8, { wallet: 656 }), prow(57, 'sell', 0.6, 0.88e-8, { wallet: 657 }), prow(58, 'sell', 0.6, 0.86e-8, { wallet: 658 }),
    prow(59, 'sell', 0.2, 0.85e-8, { wallet: 659 }),
  ]);
  const h2b = mkEng({ ticks: dumpTicks });
  const g2 = await run(h2b, null);
  ok('D2 前置：砸盘形状被因子门有效拒（primary=fp）', g2.pass === false && g2.primary && g2.primary.gate === 'fp', { primary: g2.primary, reason: g2.reason });
  check('D2a 因子门拒：终态 reason=factor_gate_<code>（与旧挂点同款文案）',
    [h2b.statuses.length, h2b.statuses[0].status, h2b.statuses[0].reason, h2b.statuses[0].message.startsWith('因子门拒买: ')],
    [1, 'failed', g2.primary.code, true]);
  check('D2b 因子门拒后三门恒算留痕：not_reached + computed 带原始判定（活跃度门/作弊门/BP 都有值）',
    [secOf(h2b).actFrontGate.status, secOf(h2b).actFrontGate.computed.status, secOf(h2b).cheatCheck.status, secOf(h2b).cheatCheck.computed.grade, secOf(h2b).buyPoint.status, secOf(h2b).buyPoint.computed.status],
    ['not_reached', 'assessed', 'not_reached', 'healthy', 'not_reached', 'assessed']);
  check('D2c 因子门拒：不落 BP 行（落行集合不变）；FA 投影 blocked=1', [h2b.db.inserts.length, g2.activation.fp], [0, 'all']);
  const projSpy = [];
  const origProj = FAMod.setFactorPreBuyFactors;
  FAMod.setFactorPreBuyFactors = (addr, v) => { projSpy.push([addr, v]); };
  try { await run(mkEng({ ticks: dumpTicks }), null); } finally { FAMod.setFactorPreBuyFactors = origProj; }
  check('D2d FA 投影（因子门有效评估）：blocked=1 + reason', projSpy, [['0xtok', { blocked: 1, reason: g2.primary.code.replace('factor_gate_', '') }]]);

  // ── D3 活跃度门拒 / D3b burst 让位 ──
  const h3 = mkEng({ ticks: normalTicks, afJudge: () => ({ act: 'low', sbw: 'none', wash: null, arm: 'near_dead', trace: {}, model: 'factor@AF3' }) });
  const g3 = await run(h3, null);
  check('D3a 活跃度门拒：act_front_low；作弊门/BP 留痕 not_reached；活跃度门行 hit/activated/blocked', [g3.primary, h3.statuses[0].reason, secOf(h3).cheatCheck.status, secOf(h3).buyPoint.status, [rowOf(h3, 'af_act_level').hit, rowOf(h3, 'af_act_level').activated, rowOf(h3, 'af_act_level').blocked]],
    [{ gate: 'af', code: 'act_front_low' }, 'act_front_low', 'not_reached', 'not_reached', [true, true, true]]);
  const h3b = mkEng({ ticks: normalTicks, afJudge: burstLowJudge });
  const g3b = await run(h3b, null);
  check('D3b 活跃度门 burst 路由 → 作弊门让位 skipped_by_act_front（sbw=burst → burst 资格 true）；放行', [g3b.pass, g3b.t189SbwBurst, secOf(h3b).cheatCheck.status, secOf(h3b).cheatCheck.levels, secOf(h3b).cheatCheck.computed.grade, rowOf(h3b, 'cheat_factor').activated, rowOf(h3b, 'af_act_level').blocked],
    [true, true, 'skipped_by_act_front', { stallBurstWave: 1 }, 'healthy', false, false]);

  // ── D4 塞单门拒：bp_gate_assessment；落行（到达且全门）──
  // 同块等额 8 钱包簇同时是 CD405 捆绑收割形状（因子门作弊类臂先认领）——本例用「因子门直通
  // + BP 全门」的 policy 单独验证 BP 塞单门拒（全豁类型实为 stuffingOnly，见 D6）
  const h4 = mkEng({ ticks: stuffingTicks });
  const g4 = await run(h4, { factorCheckArms: 'skip' });
  check('D4a 塞单门拒：primary=bp_gate_assessment；塞单门行命中且拦', [g4.pass, g4.primary, h4.statuses[0].reason, rowOf(h4, 'stuffing_gate').hit, rowOf(h4, 'stuffing_gate').blocked, rowOf(h4, 'stuffing_gate').value],
    [false, { gate: 'bp', code: 'bp_gate_assessment' }, 'bp_gate_assessment', true, true, '同块等额买入最大簇 8 钱包']);
  check('D4b 塞单门拒仍落行（旧门链同：BP 评估即落）；前三门段=正常形状', [h4.db.inserts.length, secOf(h4).factorCheck.status, secOf(h4).factorCheck.computed.pass, secOf(h4).actFrontGate.status, secOf(h4).cheatCheck.status],
    [1, 'policy_pass', false, 'assessed', 'analyzed']);
  check('D4c 塞单门拒后信号页可读：buyPoint 带 stuffingEqWallets（全门路径锚值）与 passLevels', [secOf(h4).buyPoint.anchors.exactEqualBlockMaxWallets, secOf(h4).buyPoint.passLevels, secOf(h4).buyPoint.passed], [8, ['good', 'neutral'], false]);

  // ── D5 残缺环（D4 行环裁定）：BP 拒 insufficient_history；FP/AF 放行留痕 ──
  const h5 = mkEng({ ticks: normalTicks, partial: true });
  const g5 = await run(h5, null);
  check('D5 残缺环：BP 拒 bp_gate_insufficient_history（不拿残缺历史冒充完整）；FP/AF 段 insufficient_history 放行；趋势值门照常 11 行；不落行',
    [g5.pass, g5.primary.code, secOf(h5).factorCheck.status, secOf(h5).actFrontGate.status, secOf(h5).buyPoint.status, secOf(h5).factorCheck.gates.filter((r) => r.group === 'trend').length, h5.db.inserts.length],
    [false, 'bp_gate_insufficient_history', 'insufficient_history', 'insufficient_history', 'insufficient_history', 11, 0]);

  // ── D6 全豁类型（steady）：各门原始命中但全不激活 → 放行，policy_pass ×3 留痕 ──
  const h6 = mkEng({ ticks: dumpTicks, afJudge: () => ({ act: 'low', sbw: 'none', wash: null, arm: 'near_dead', trace: {}, model: 'factor@AF3' }) });
  const g6 = await run(h6, STEADY);
  check('D6a 全豁类型：原始命中（因子门/活跃度门）但类型未激活 → 放行；四段有效 status = policy_pass ×3 + assessed',
    [g6.pass, secOf(h6).factorCheck.status, secOf(h6).factorCheck.computed.pass, secOf(h6).actFrontGate.status, secOf(h6).actFrontGate.computed.path, secOf(h6).cheatCheck.status, secOf(h6).buyPoint.status, secOf(h6).buyPoint.policy],
    [true, 'policy_pass', false, 'policy_pass', 'reject_low', 'policy_pass', 'assessed', 'stuffingOnly']);
  check('D6b 全豁类型门行：因子臂 40 行全未激活（原始命中行 hit 真-blocked 假）；活跃度门行未激活；塞单门行已激活；汇总拦 0',
    [secOf(h6).factorCheck.gates.filter((r) => r.group === 'fp' && r.activated).length, secOf(h6).factorCheck.gates.filter((r) => r.blocked).length,
      secOf(h6).factorCheck.gates.filter((r) => r.group === 'fp' && r.hit === true).length > 0, rowOf(h6, 'af_act_level').activated, rowOf(h6, 'stuffing_gate').activated, secOf(h6).gateLayer.summary.blocked],
    [0, 0, true, false, true, 0]);

  // ── D7 F6 事故现场反证：fpRetry 重评带类型 policy ──
  // service 桩模拟「臂差集生效」：opts.armExempt 含 slow_pump_unload → 放行；否则按全臂拒
  const policyAwareFp = async (token, meta, ctx, opts) => ({
    status: 'assessed', pass: Array.isArray(opts.armExempt) && opts.armExempt.includes('slow_pump_unload'),
    reason: Array.isArray(opts.armExempt) && opts.armExempt.includes('slow_pump_unload') ? null : 'slow_pump_unload',
    arms: [], rawHits: ['slow_pump_unload'], gates: FP.evaluateFactorPreBuy(base(), { trendFactors: opts.trendFactors }).gates.map((r) => (r.id === 'slow_pump' ? { ...r, hit: true } : r)),
    trace: {}, pvp: {}, version: 'FP48',
  });
  async function retryRun(unified) {
    const h = mkEng({ ticks: normalTicks });
    h.eng._buyPointCheckService.evaluateFactorPreBuy = policyAwareFp;
    const tr = new FpRetryTracker();
    tr.register('0xtok', { legId: 'p16', signalId: 'sig-f6', budget: 2, nowMs: T0, strategyName: 'p16' });
    const leg = { id: 'p16', action: 'buy', signalGate: { maxTriggers: 1, fpRetry: 2 } };
    const dispatched = [];
    Object.assign(h.eng, {
      _gateLayerUnified: unified,
      _fpRetryEnsure: () => tr,
      _strategyEngine: { getAllStrategies: () => [leg] },
      _factorAggregator: { getTokenState: () => ({}) },
      _classifyPointType: () => ({ type: 'famous_holder_cold_pit', label: 'x', policy: GOLDEN, version: 'PT81', snapshot: {} }),
    });
    const resumed = await h.eng.__fpRetryTickInner('0xtok', TOK, { currentPriceBnb: 1e-8 }, T0 + 500,
      (r) => dispatched.push(r), {}, tr, tr.tickCheck('0xtok', T0 + 500), tr.pendingOf('0xtok'));
    return { h, tr, dispatched, resumed };
  }
  const legacyRun = await retryRun(false);
  const legacyAtt = (legacyRun.h.metas.find((m) => m.fpRetry) || {}).fpRetry;
  check('D7a 反证（旧链重评不带 policy）：豁免类型的重评按全臂评 → 仍拒、烧掉一次预算、不续跑',
    [legacyRun.resumed, legacyRun.dispatched.length, legacyAtt && legacyAtt.attempts.length, legacyAtt && legacyAtt.attempts[0].verdict, legacyRun.tr.pendingOf('0xtok') !== null],
    [false, 0, 1, 'reject', true]);
  const unifiedRun = await retryRun(true);
  check('D7b 统一门层重评带类型 policy（修 F6）：豁免臂不拦 → 重评通过 → 续跑并携带本次评估（零二次取数）',
    [unifiedRun.resumed, unifiedRun.dispatched.length, !!unifiedRun.dispatched[0].gateLayer, unifiedRun.dispatched[0].gateLayer.pass, unifiedRun.tr.pendingOf('0xtok') === null, unifiedRun.h.metas.some((m) => m.pointType && m.pointType.type === 'famous_holder_cold_pit')],
    [true, 1, true, true, true, true]);
  check('D7c 重评只取数一次（续跑复用重评结果=零二次取数）', unifiedRun.h.pulls(), 1);

  // ── D8 源码锁：两引擎分派 + 原门链保留 + 续跑复用 ──
  const fs = require('fs');
  const liveSrc = fs.readFileSync(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
  const btSrc = fs.readFileSync(path.join(ROOT, 'src/trading-engine/implementations/BacktestEngine.js'), 'utf8');
  const absSrc = fs.readFileSync(path.join(ROOT, 'src/trading-engine/core/AbstractTradingEngine.js'), 'utf8');
  for (const [nm, src] of [['实时', liveSrc], ['回测', btSrc]]) {
    ok(`D8a ${nm}引擎：统一门层旗标（三模块皆因子代 ∧ 启用）`, /this\._gateLayerUnified = !!\([\s\S]{0,420}_packFactor\('cheatCheck'\)[\s\S]{0,80}_packFactor\('actFrontGate'\)[\s\S]{0,80}_packFactor\('buyPointCheck'\)/.test(src));
    ok(`D8b ${nm}引擎：买路径按旗标分派，续跑优先复用 opts.resume.gateLayer（零二次取数）`, /if \(this\._gateLayerUnified === true\) \{[\s\S]{0,260}opts\.resume && opts\.resume\.gateLayer\) \? opts\.resume\.gateLayer\s*\n\s*: await this\._gateLayerEvaluate\(/.test(src));
    ok(`D8c ${nm}引擎：原门链（Jev 代/混代包回滚基线）仍在旗标 else 分支（_sgRecordTrigger→_factorGateEvaluate→_bpGateEvaluate 全在）`,
      /\} else \{\s*\n\s*\/\/ ↓↓↓ Jev 代 \/ 混代包：原门链（逐字保留[^\n]*\n\s*if \(!opts\.resume\) \{[\s\S]{0,400}?this\._sgRecordTrigger\([\s\S]{0,6000}?this\._factorGateEvaluate\([\s\S]{0,9000}?this\._bpGateEvaluate\([\s\S]{0,1400}?\/\/ ↑↑↑ 原门链结束 ↑↑↑/.test(src));
    ok(`D8d ${nm}引擎：统一门层不传 legacy 四挂点专用入参（awaitMs/cheatBurst），原挂点方法原样在场`, ['_factorGateEvaluate(', '_actFrontGateEvaluate(', '_cheatGateEvaluateBinary(', '_bpGateEvaluate('].every((m) => src.includes(m)));
  }
  ok('D8e 编排器零 Date.now（决策时钟全由入参/回测虚拟时刻承载；日志计时除外）', !/Date\.now\(/.test(absSrc.slice(absSrc.indexOf('async _gateLayerEvaluate('), absSrc.indexOf('T117 信号源门链·作弊门——**因子代挂点**'))));
  ok('D8f fpRetry 重评：统一分支带 pointTypePolicy、旧分支原样', /_gateLayerUnified === true\) \{[\s\S]{0,700}pointTypePolicy: _ptInfo \? _ptInfo\.policy : null,[\s\S]{0,400}\} else \{[\s\S]{0,300}await this\._factorGateEvaluate\(tokenAddress/.test(absSrc));
  ok('D8g 两引擎 service 构造未改（factorMode 注入各两处=cheatCheck/buyPointCheck 各一，未新增——G5 锁同源）', [(liveSrc.match(/factorMode:\s*_packFactor\(/g) || []).length, (btSrc.match(/factorMode:\s*_packFactor\(/g) || []).length], [2, 2]);
  void FourMemeWssTradingEngine; void BacktestEngine;
}
})().catch((e) => { fail++; console.error(e && e.stack || e); }).finally(() => {
  console.log(`\n${'='.repeat(60)}\n因子过滤门层单测：${pass} 通过，${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
});
