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
/** 同块捆绑合计线（严格 >；BP73——合计无 gas 贴线） */
const PVP_BUNDLE_BNB = 0.3;


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

// ═══════════════ retail_pvp 判定（BP84 二修：纯买入侧极简口径） ═══════════════

/**
 * retail_pvp 纯代码判定（BP84 从 Jev market_pattern ②桶迁入）。
 * **二修（2026-11-15 用户裁定「pvp 盘的检测，不是只看买入侧，不看持有吗。
 * 为何搞这么复杂」）**：判定=买入侧有无像样买方，**买入过就算**——不看持有/
 * 在场/卖压/承接（首版承接轴 bigHolderSellBnb60 与 absorb 族与在场三分全删——
 * Go Brrrrr 案 39 秒蓄势静默被「持有+承接归零=死盘」误伤；承接/卖压语义本
 * 就属盘面其它门不管 PVP）。像样买方三口径任一在场即不落 PVP：
 * （单笔 ≥0.19（0.2 级视同）钱包 ≥2 个）∨（单笔 ≥0.29（0.3 视同，duanju
 * 0.2994 案）≥1 笔）∨（同 block 捆绑买入合计 >0.3——BP73 组织性买入）。
 * @returns {{hit:number, branch:string|null, reason:string|null, trace:object}}
 */
function judgeRetailPvp(snapshot) {
  const wallets = snapshot.wallets || [];
  const bd = snapshot.buyDerived || {};
  const bigSingles = wallets.filter((w) => (w.maxBuyBnb || 0) >= PVP_LEVEL02_BNB);
  const act30 = bigSingles.filter((w) => (w.maxBuyBnb || 0) >= PVP_TREAT03_BNB).length;
  const volBundledBnb = bd.bundledBlock ? bd.bundledBlock.buyBnb : null;
  const trace = { act20: bigSingles.length, act30, volBundledBnb };
  const pass = bigSingles.length >= 2 || act30 >= 1
    || (volBundledBnb !== null && volBundledBnb > PVP_BUNDLE_BNB);
  if (pass) return { hit: 0, branch: 'big_buyers_present', reason: null, trace };
  return { hit: 1, branch: 'pvp_no_big_participation', reason: 'pvp_no_big_participation', trace };
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
  if (!burstContextBackgroundCold(cd)) return false; // 背景腿（T143 追裁定）：高活跃背景不构成 burst 语境
  if (typeof cd.burstWaveSegSellPct !== 'number' || cd.burstWaveSegSellPct < 30) return false;
  if (typeof cd.burstWaveSegSellBnb !== 'number' || cd.burstWaveSegSellBnb < 0.3) return false;
  if (typeof cd.burstSecSinceWaveEnd !== 'number' || cd.burstSecSinceWaveEnd > SBW_PROXY_WAVE_NEAR_SEC) return false;
  if (typeof cd.burstWaveWalletMedianBnb !== 'number' || cd.burstWaveWalletMedianBnb >= SBW_PROXY_MEDIAN_DUST_BNB) return false;
  if (typeof cd.burstWaveWalletNetBnb !== 'number' || cd.burstWaveWalletNetBnb <= 0) return false;
  return true;
}

/**
 * CD401 背景腿线（T143 追裁定 2026-11-15，Go Brrrrr 0xdae106c8…7777 案）：
 * burst 语义前提=**背景活跃度低/中**（用户裁定「这个活跃度本来就高，不属于
 * 突然涌入是连着的，那就活跃度直接就是 high 就行了」）——静默段前 60s 背景
 * 窗 ≥0.5 BNB/min 或 ≥6 笔/min=高活跃背景（流量连着的，30s+ 喘息只是节奏
 * 间隙非沉积）→ 不构成 burst 语境，臂不触发。锚缺失（无段）null=语境缺席
 * 不触发（宁不拦——拒方向证据缺席）。
 */
const BURST_CONTEXT_PRESEG_MIN_BNB = 0.5;
const BURST_CONTEXT_PRESEG_MIN_TICKS = 6;
/** 背景腿（CD401/CD405 两臂共用，用户裁定两臂同加）：true=低/中背景（burst
 * 语境成立）；false=高活跃背景或缺锚（不触发——宁不拦） */
function burstContextBackgroundCold(cd) {
  if (typeof cd.burstPreSegBnbPerMin !== 'number' || typeof cd.burstPreSegTicksPerMin !== 'number') return false;
  return cd.burstPreSegBnbPerMin < BURST_CONTEXT_PRESEG_MIN_BNB && cd.burstPreSegTicksPerMin < BURST_CONTEXT_PRESEG_MIN_TICKS;
}

/** CD405 burst 捆绑收割：单块或相邻两 slot 去尘捆绑钱包 ≥7 */
function armBurstBundledWave(cd) {
  // 背景腿（用户裁定两臂同加）：高活跃背景不构成 burst 语境——捆绑收割臂
  // 同为 ≥30s 段波窗绑定，高活跃盘喘息误触发同病（bt-v131 拒 24 行零实伤预防性收紧）
  if (!burstContextBackgroundCold(cd)) return false;
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
  const pvp = enablePvp
    ? judgeRetailPvp(snapshot)
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
    trace: { ...pvp.trace } };
}

module.exports = {
  FACTOR_PREBUY_VERSION,
  PVP_TREAT03_BNB, PVP_LEVEL02_BNB, PVP_BUNDLE_BNB,
  DUMP_NO_ABSORB_BNB, DUMP_RATIO_MIN_SELLERS, DUMP_LOW_ABSORPTION_RATIO, BURST_BUNDLE_MIN_WALLETS,
  SBW_PROXY_WAVE_NEAR_SEC, SBW_PROXY_MEDIAN_DUST_BNB,
  BURST_CONTEXT_PRESEG_MIN_BNB, BURST_CONTEXT_PRESEG_MIN_TICKS, burstContextBackgroundCold,
  judgeRetailPvp,
  armDumpNoAbsorption, armDumpLowAbsorption, armBurstExitSellPressure, armBurstBundledWave,
  evaluateFactorPreBuy,
};
