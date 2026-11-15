'use strict';

/**
 * T143 因子购买前检查门（FACTOR_PREBUY_VERSION='FP1'）——纯代码零 Jev 的最前门
 * （2026-11-15 duanju 0x65aebe91…7777 案立法；用户裁定三件同车：
 * ①BP84 retail_pvp 判定从 Jev market_pattern 题迁入本模块纯代码（「逻辑完全
 *   定死……准确，且不需要燃烧 Jev 的 token」）+ 0.2994 视同 0.3（「本身应该
 *   就是一笔 0.3B 的交易只是支付了 gas」→ 线定 ≥0.29，与 ≥0.19 视同 0.2 的
 *   ±0.01 幅度对齐，落大户参与臂+量维度豁免臂两处；同块捆绑合计 >0.3 不动
 *   ——合计无 gas 贴线）；
 * ②CD408 四条纯数值臂升格独立阻挡门（CD400/CD403/CD405 全票检命中即拒；
 *   CD401 走用户两分法路线 1=burst 认定机械化代理线，预扫描校准不过则该臂
 *   留 cheat 门内）；CD380 wash 臂依赖 Jev washPair 档留 cheat 不迁；
 * ③门链最前（用户裁定「因子门的代价最小，在最前面」）：因子门→cheat 门→
 *   BP 门——被拒票零 Jev 消耗。
 *
 * 输入=buildBuyPointSnapshot 产物（一次拉数同时携带 wallets/buyDerived/
 * cheatDerived——nearDump/burstWaveSeg/burstWaveBundle 锚全在 cheatDerived），
 * 纯函数零 DB 零网络零 Jev；as-of 纪律=只读已截窗 rows，idle 用锚末 tick dt
 * 不用 Date.now（回测回放无前视）。
 *
 * null 语义总则（宁拦不冒充的双向版）：豁免方向的证据缺席→不豁免（更拦）；
 * 拒方向的证据缺席→不拒（证据坐实才拦）——与 mapper「拒=有证据的拒绝」同哲学。
 *
 * 判定树与常量均为单源：cheat 侧 _exemptDeniedReason 四臂线值 import 本文件
 * （cheat 侧行为零改动，豁免收紧语义与全票拦截分层并存——同票双码双留痕）。
 */

// ═══════════════ 常量（单源导出） ═══════════════

const FACTOR_PREBUY_VERSION = 'FP1';

// ── PVP（BP84 迁入；BP19/BP26/BP55/BP71/BP73/BP79 判据谱系） ──
/** 0.3 视同线（≥0.29；duanju 0.2994 案——±0.01 与 0.19↔0.2 对齐） */
const PVP_TREAT03_BNB = 0.29;
/** 0.2 级线（≥0.19 视同，BP19 既有线不动） */
const PVP_LEVEL02_BNB = 0.19;
/** 在场净值线（净 ≤ 此=清仓离场，BP79） */
const PVP_NET_EPS = 0.005;
/** 活跃在场末动线（末动距今 > 此=挂账在场不算，BP79） */
const PVP_ACTIVE_IDLE_SEC = 120;
/** 同块捆绑合计线（严格 >；BP73——合计无 gas 贴线） */
const PVP_BUNDLE_BNB = 0.3;

// ── 承接轴三新线（BP84 数值化保守缺省，预扫描校准点） ──
/** 承接在场=win30 买 ≥N 笔（镜像 BP74 尾段买力线） */
const PVP_ABSORB_ALIVE_N = 3;
/** 承接在场=win30 买额 ≥ 此 */
const PVP_ABSORB_ALIVE_BNB = 0.1;
/** 承接归零=win30 买额 ≤ 此（尘级） */
const PVP_ABSORB_ZERO_BNB = 0.03;
/** 承接归零=尾 10s 买笔 ≤ 此 */
const PVP_ABSORB_ZERO_TAIL_N = 1;
/** 大户卖压归零线（bigHolderSellBnb60 ≤ 此=归零） */
const PVP_SELL_ZERO_EPS = 0.01;
/** 大户「未卖」=已卖占买入 < 此 */
const PVP_UNSOLD_RATIO = 0.05;

// ── CD 四臂升格（CD408；线值=cheat 侧单源，CheatCheckService import 本文件） ──
/** CD400 贴锚砸块零承接：块后承接 < 此 */
const DUMP_NO_ABSORB_BNB = 0.05;
/** CD403 超大量捆绑砸盘承接比臂：达标砸块卖方 ≥ 此（与 BP77 塞单门同线） */
const DUMP_RATIO_MIN_SELLERS = 8;
/** CD403 承接比 < 此（与 BP82「达三成=承接形成」同线） */
const DUMP_LOW_ABSORPTION_RATIO = 0.3;
/** CD405 burst 捆绑收割：去尘捆绑钱包 ≥ 此（单块或相邻两 slot 任一） */
const BURST_BUNDLE_MIN_WALLETS = 7;

// ── CD401 sbw 机械化代理线（用户两分法路线 1；预扫描校准点） ──
/** 波贴近锚：出口波末笔距今 ≤ 此秒（「当下事件」非历史遗迹） */
const SBW_PROXY_WAVE_NEAR_SEC = 60;
/** 波钱包中位尘埃线（sbw 主体判轴=沉积后小散涌入） */
const SBW_PROXY_MEDIAN_DUST_BNB = 0.05;

// ═══════════════ 在场三分（BP79，与 buy-point-state-builder clsOf 同源） ═══════════════

/**
 * 钱包在场三分：净 ≤0.005=离场；净 >0.005 ∧ 末动 ≤120s=活跃在场；否则挂账。
 * 末动不可算（tEnd/lastActDt 缺）→ 挂账（宁拦方向，与 state builder 同款）。
 * @param {{buyBnb:number,sellBnb:number,lastActDt:number|null}} w
 * @param {number|null} tEndMs 锚末 tick dt（ms）
 * @returns {'离场'|'活跃在场'|'挂账在场'}
 */
function classifyWallet(w, tEndSec) {
  const net = (w.buyBnb || 0) - (w.sellBnb || 0);
  if (net <= PVP_NET_EPS) return '离场';
  // 单位=秒（snapshot 的 dt/lastActDt/tEnd 均为相对锚基秒——与 state-builder clsOf
  // 同源；F2 蝴蝶案夹具抓住的 ×1000 单位坑：idle 是秒不得乘 1000 比较）
  const idle = (tEndSec !== null && tEndSec !== undefined && w.lastActDt !== null && w.lastActDt !== undefined)
    ? tEndSec - w.lastActDt : null;
  return (idle !== null && idle <= PVP_ACTIVE_IDLE_SEC) ? '活跃在场' : '挂账在场';
}

// ═══════════════ retail_pvp 判定树（题面三步翻译） ═══════════════

/**
 * retail_pvp 纯代码判定（BP84 从 Jev market_pattern ②桶迁入）。
 * @returns {{hit:number, branch:string|null, reason:string|null, trace:object}}
 */
function judgeRetailPvp(snapshot, tEndMs) {
  const wallets = snapshot.wallets || [];
  const bd = snapshot.buyDerived || {};
  const cd = snapshot.cheatDerived || {};
  const trace = {
    volSingle: 0, volBundledBnb: null, act20: 0, act30: 0,
    sell60: null, holdersUnsold: 0, absorbAlive: null, absorbZero: null,
  };

  // ── 在场分类（一次算好） ──
  const cls = new Map();
  for (const w of wallets) cls.set(w, classifyWallet(w, tEndMs));
  const active = (w) => cls.get(w) === '活跃在场';

  // ── 第一步·量维度（豁 (a) 臂；BP73） ──
  // volSingle=单笔 ≥0.29（0.3 视同，BP84）且未清仓在场（题面字面：已清仓离场
  // 的不算——net>0.005 即在场持有；120s 线是第二步「活跃在场」专属，不引入）
  trace.volSingle = wallets.some((w) =>
    (w.maxBuyBnb || 0) >= PVP_TREAT03_BNB && ((w.buyBnb || 0) - (w.sellBnb || 0)) > PVP_NET_EPS) ? 1 : 0;
  // volBundled=同 block 捆绑买入合计 >0.3（BP73 严格大于；已剔路由；无买块 null）
  trace.volBundledBnb = bd.bundledBlock ? bd.bundledBlock.buyBnb : null;
  const volumePresent = trace.volSingle === 1
    || (trace.volBundledBnb !== null && trace.volBundledBnb > PVP_BUNDLE_BNB);

  // ── 第二步·大户参与前置（对②整体；BP26/BP55 按单笔不累计） ──
  // BP84 追裁定（2026-11-15 预扫描好似喵/−32° 案）：**只要买入过即可，不要求
  // 在场**——「单笔 0.4~0.5 买后立刻清仓离场+散单接棒」形状按在场口径全拦
  // （净 +0.24 误伤面），用户裁定「要求在场误伤有点大，改成只要买入过就可以」；
  // 在场三分降为 trace 观察键（act20Active/act30Active），不进门判定。
  const bigSingles = wallets.filter((w) => (w.maxBuyBnb || 0) >= PVP_LEVEL02_BNB);
  trace.act20 = bigSingles.length;
  trace.act30 = bigSingles.filter((w) => (w.maxBuyBnb || 0) >= PVP_TREAT03_BNB).length;
  trace.act20Active = bigSingles.filter(active).length;
  trace.act30Active = bigSingles.filter((w) => (w.maxBuyBnb || 0) >= PVP_TREAT03_BNB).filter(active).length;
  const participation = trace.act20 >= 2 || trace.act30 >= 1;

  // 判序：第二步不满足 → 直接落②（(a)/(b) 归并此码；volumePresent 只杀 (a) 臂
  // 候选不救 participation——题面判序：第二步对②整体，盘面活跃度不救）
  if (!participation) {
    return { hit: 1, branch: volumePresent ? 'pvp_b_no_participation' : 'pvp_a_no_participation',
      reason: 'pvp_no_big_participation', trace };
  }

  // ── 第三步·承接轴（(b) 判据数值化；仅 participation 满足后评估） ──
  trace.sell60 = (bd.bigHolderSellBnb60 !== null && bd.bigHolderSellBnb60 !== undefined)
    ? bd.bigHolderSellBnb60 : null;
  // 在场持有（BP79 语义重心=净 >0.005 仍在场——含部分兑现中；「已卖完离场」=
  // 0.2 级钱包全体清仓走空。duanju 案修正：部分兑现 57% 但净 0.13 活跃在场
  // 的钱包属③在场持有，不得落入②卖完离场分支——「未卖 <5%」线降为佐证键）
  trace.holdersHolding = bigSingles.some((w) =>
    (w.buyBnb || 0) - (w.sellBnb || 0) > PVP_NET_EPS) ? 1 : 0;
  trace.holdersUnsold = bigSingles.some((w) => {
    const net = (w.buyBnb || 0) - (w.sellBnb || 0);
    return net > PVP_NET_EPS && (w.buyBnb || 0) > 0 && (w.sellBnb || 0) / w.buyBnb < PVP_UNSOLD_RATIO;
  }) ? 1 : 0;
  // 承接在场（win30 买 ≥3 笔 ∧ ≥0.1 BNB——BP74 尾段买力线镜像）
  const w30 = bd.win && bd.win[30] ? bd.win[30] : null;
  trace.absorbAlive = (w30 && w30.buyN !== null && w30.buyN !== undefined)
    ? (w30.buyN >= PVP_ABSORB_ALIVE_N && (w30.buyBnb || 0) >= PVP_ABSORB_ALIVE_BNB ? 1 : 0) : null;
  // 承接归零（win30 买额尘级 ∧ 尾 10s 买笔 ≤1）
  const tail10BuyN = bd.activity && bd.activity.nearTail10BuyN !== undefined ? bd.activity.nearTail10BuyN : null;
  trace.absorbZero = (w30 && w30.buyBnb !== null && w30.buyBnb !== undefined && tail10BuyN !== null)
    ? ((w30.buyBnb || 0) <= PVP_ABSORB_ZERO_BNB && tail10BuyN <= PVP_ABSORB_ZERO_TAIL_N ? 1 : 0) : null;

  if (trace.sell60 === null) {
    // 卖方锚缺失（quote 盘 tok 缺失）：卖方两分支证据不坐实不点火；仅承接归零
    // 例外可拒（在场持有+买方归零=对倒停摆死盘，双证据在场）
    if (trace.holdersHolding === 1 && trace.absorbZero === 1) {
      return { hit: 1, branch: 'pvp_b_zero_absorption', reason: 'pvp_zero_absorption', trace };
    }
    return { hit: 0, branch: 'sell_anchor_null', reason: null, trace };
  }
  if (trace.sell60 > 0) {
    // 三分①：大户持续卖——承接在场=双边在场放行；承接不在场=向小散出货无人接落②(b)
    if (trace.absorbAlive === 1) return { hit: 0, branch: 'big_selling_absorbed', reason: null, trace };
    return { hit: 1, branch: 'pvp_b_big_selling_no_absorb', reason: 'pvp_absorption_dust', trace };
  }
  // 三分②/③（卖压归零）：题面②「大户已卖完离场」形状在判定序上**结构性归并**
  // 到第二步——0.2 级全体清仓走空 ⇒ 买点时刻无在场大户 ⇒ participation 不满足
  // ⇒ 已以 branch=pvp_b_no_participation 拒（B10 单测锁死此归并）；承接轴仅评③：
  // 在场持有（participation 满足时必真，holdersHolding 仅留痕）+承接归零例外。
  if (trace.absorbZero === 1) {
    // ③' 承接归零例外（在场持有∧买方归零=对倒停摆死盘）→ 落②(b)
    return { hit: 1, branch: 'pvp_b_zero_absorption', reason: 'pvp_zero_absorption', trace };
  }
  return { hit: 0, branch: 'holding_absorbed', reason: null, trace };
}

// ═══════════════ CD 四臂升格（CD408；判据=cheat 侧 _exemptDeniedReason 数值照抄） ═══════════════

/** CD400 贴锚砸块零承接：qualBlocks ≥1 ∧ 最恶性块承接 <0.05 */
function armDumpNoAbsorption(cd) {
  if (typeof cd.nearDumpQualBlocks !== 'number' || cd.nearDumpQualBlocks < 1) return false;
  return typeof cd.nearDumpMinAbsorbBnb === 'number' && cd.nearDumpMinAbsorbBnb < DUMP_NO_ABSORB_BNB;
}

/** CD403 超大量捆绑砸盘承接比：卖方 ≥8 ∧ 承接比 <0.3 */
function armDumpLowAbsorption(cd) {
  if (typeof cd.nearDumpQualBlocks !== 'number' || cd.nearDumpQualBlocks < 1) return false;
  if (typeof cd.nearDumpWorstSellers !== 'number' || cd.nearDumpWorstSellers < DUMP_RATIO_MIN_SELLERS) return false;
  if (typeof cd.nearDumpMinAbsorbBnb !== 'number' || typeof cd.nearDumpWorstSellBnb !== 'number') return false;
  return cd.nearDumpWorstSellBnb > 0 && cd.nearDumpMinAbsorbBnb / cd.nearDumpWorstSellBnb < DUMP_LOW_ABSORPTION_RATIO;
}

/**
 * CD401 burst 出口段卖压（sbw 机械化代理线——用户两分法路线 1）：
 * 代理=burstWaveSeg 簇存在（≥30s 静默段+出口簇=burst 结构前提）∧ 波贴近锚
 * ≤60s（当下事件）∧ 波钱包中位尘埃级（小散涌入主体）∧ 波净流入 >0（流量
 * 涌入非卖出引发）；代理 ∧ 簇卖占比 ≥30% ∧ 卖额 ≥0.3 → 拒。
 * 无段/锚缺失全族 null → 代理不成立（宁不拦——拒方向证据缺席不拒）。
 */
function armBurstExitSellPressure(cd) {
  if (typeof cd.burstWaveSegSellPct !== 'number' || cd.burstWaveSegSellPct < 30) return false;
  if (typeof cd.burstWaveSegSellBnb !== 'number' || cd.burstWaveSegSellBnb < 0.3) return false;
  if (typeof cd.burstSecSinceWaveEnd !== 'number' || cd.burstSecSinceWaveEnd > SBW_PROXY_WAVE_NEAR_SEC) return false;
  if (typeof cd.burstWaveWalletMedianBnb !== 'number' || cd.burstWaveWalletMedianBnb >= SBW_PROXY_MEDIAN_DUST_BNB) return false;
  if (typeof cd.burstWaveWalletNetBnb !== 'number' || cd.burstWaveWalletNetBnb <= 0) return false;
  return true;
}

/** CD405 burst 捆绑收割：单块或相邻两 slot 去尘捆绑钱包 ≥7 */
function armBurstBundledWave(cd) {
  if (typeof cd.burstWaveBundleMaxWallets === 'number' && cd.burstWaveBundleMaxWallets >= BURST_BUNDLE_MIN_WALLETS) return true;
  if (typeof cd.burstWaveBundleAdjPairSum === 'number' && cd.burstWaveBundleAdjPairSum >= BURST_BUNDLE_MIN_WALLETS) return true;
  return false;
}

// ═══════════════ 主入口 ═══════════════

/**
 * 因子购买前检查（纯函数）。臂序：PVP 判定树 → CD400 → CD403 → CD401 → CD405。
 * @param {object} snapshot buildBuyPointSnapshot 产物
 * @param {object} [opts] { enableCheatArms=true, enablePvp=true }（预扫描/灰度分臂开关）
 * @returns {{pass:boolean, reason:string|null, version:string, pvp:object, arms:string[], trace:object}}
 */
function evaluateFactorPreBuy(snapshot, opts = {}) {
  const enableCheatArms = opts.enableCheatArms !== false;
  const enablePvp = opts.enablePvp !== false;
  const { bpTEndOf } = require('./buy-point-snapshot');
  const tEndMs = bpTEndOf(snapshot.ticks);
  const pvp = enablePvp
    ? judgeRetailPvp(snapshot, tEndMs)
    : { hit: 0, branch: 'disabled', reason: null, trace: {} };
  const arms = [];
  const cd = snapshot.cheatDerived || {};
  if (enableCheatArms) {
    if (armDumpNoAbsorption(cd)) arms.push('cd400_dump_no_absorption');
    else if (armDumpLowAbsorption(cd)) arms.push('cd403_dump_low_absorption');
    else if (armBurstExitSellPressure(cd)) arms.push('cd401_burst_exit_sell_pressure');
    else if (armBurstBundledWave(cd)) arms.push('cd405_burst_bundled_wave');
  }
  const reason = pvp.reason || (arms.length ? arms[0] : null);
  return { pass: reason === null, reason, version: FACTOR_PREBUY_VERSION, pvp, arms,
    trace: { tEndMs, ...pvp.trace } };
}

module.exports = {
  FACTOR_PREBUY_VERSION,
  PVP_TREAT03_BNB, PVP_LEVEL02_BNB, PVP_NET_EPS, PVP_ACTIVE_IDLE_SEC, PVP_BUNDLE_BNB,
  PVP_ABSORB_ALIVE_N, PVP_ABSORB_ALIVE_BNB, PVP_ABSORB_ZERO_BNB, PVP_ABSORB_ZERO_TAIL_N,
  PVP_SELL_ZERO_EPS, PVP_UNSOLD_RATIO,
  DUMP_NO_ABSORB_BNB, DUMP_RATIO_MIN_SELLERS, DUMP_LOW_ABSORPTION_RATIO, BURST_BUNDLE_MIN_WALLETS,
  SBW_PROXY_WAVE_NEAR_SEC, SBW_PROXY_MEDIAN_DUST_BNB,
  classifyWallet, judgeRetailPvp,
  armDumpNoAbsorption, armDumpLowAbsorption, armBurstExitSellPressure, armBurstBundledWave,
  evaluateFactorPreBuy,
};
