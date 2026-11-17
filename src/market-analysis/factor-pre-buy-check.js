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

// ── T144 活跃度门（BP act 题整题迁入：low+ultra 五桶全代码化，2026-11-15 用户
//    裁定「活跃度低可以全部通过因子表达」——省 cheat 16 题+BP 4 题 Jev/信号；
//    题面七要素+四臂+burst 档的机械翻译，线值=题面明线/代码常量先例） ──
/** L1 大比例无交易期（题面①参考 ≥50；T144 预扫描校准收紧=**极端档联立**：
 * idle ≥60 ∧ 吞吐 <0.5 BNB/min 同时成立才拦——单臂 50 时 Go Brrrrr 39s 蓄势窗
 * 等高 idle 票大量误伤（Newly-blocked +0.45 主源），用户裁定「只过滤极端的
 * 拿得准的情况，不要误伤」） */
const ACT_LOW_IDLE_PCT = 60;
const ACT_LOW_IDLE_THROUGHPUT = 0.5;
/** L2/L5 尘埃线（题面③：买盘中位常见交易档参照 0.05） */
const ACT_DUST_MEDIAN_BNB = 0.05;
/** L2/L4/L5 吞吐死寂线（题面⑤：<1 BNB/分钟=金额死寂） */
const ACT_DEAD_THROUGHPUT_BNB_MIN = 1;
/** L3 单向死水：笔比 ≥5:1 ∧ 额比 ≥3:1 ∧ 回撤 <5% */
const ACT_ONESIDED_BUY_SELL_N = 5;
const ACT_ONESIDED_BUY_SELL_BNB = 3;
const ACT_ONESIDED_MAX_DD_PCT = 5;
/** L3 极早窗反锚：窗 <60s ∧ <30 笔 两腿同时（价格发现期常态） */
const ACT_EARLYWIN_SEC = 60;
const ACT_EARLYWIN_TICKS = 30;
/** L5 全窗四腿联立：密度 <10 笔/分 ∧（idlePct ≥25 或最长空窗 ≥40s） */
const ACT_SPARSE_TPM = 10;
const ACT_SPARSE_IDLE_PCT = 25;
const ACT_SPARSE_MAX_GAP_SEC = 40;
/** B2 尾段激活豁免（题面⑥三段形状明线：尾 5s 买 ≥3 笔 ∧ ≥0.3 BNB） */
const ACT_TAIL5_ACTIVATE_N = 3;
const ACT_TAIL5_ACTIVATE_BNB = 0.3;
/** B1 burst 语境豁免：出口簇买 ≥0.3（CD402 波质量线；背景冷同 T143） */
const ACT_BURST_WAVE_BUY_BNB = 0.3;
/** U1 协同出货臂：末 10s 独立卖钱包 ≥10 ∧ 买入趋零（≤2 笔 ∧ <0.1 BNB——c84a 双边在场防线） */
const ACT_ULTRA_SELL_WALLETS = 10;
const ACT_ULTRA_BUY_N_MAX = 2;
const ACT_ULTRA_BUY_BNB_MAX = 0.1;
/** U2 极端密度臂：≥150 笔/分 ∧ idlePct<5（题面「每秒十笔级」下界；常量 ULTRA_TPM=140 参照） */
const ACT_ULTRA_TPM = 150;
const ACT_ULTRA_IDLE_PCT = 5;

const FACTOR_PREBUY_VERSION = 'FP6';

// ── FP6 famous 高控+砸落观察臂（2026-11-17 btv140 复审 BP-T007 小树 0x92598590…7777
//    案用户裁定：「这样吧，这个场景（持有不多还没砸）先不阻挡购买，不过可以在因子
//    过滤这个环节中，把这种情况标记一下（不阻挡过滤），留待之后再寻找方案」——
//    famousDominancePct（famous∪跟单者在场筹码控制度，cheatDerived 筹码口径——与
//    famousTraces 流量口径互补：小树 dom=100% 但本人占买仅 9.6%）≥90 ∧ chg30≤−20
//    （已砸落）→ observe 标记不拦截。btv140 19 票 D 码豁免口袋扫描：该形状 5 票
//    （memes/小树/XXX/CEPE/鯨）止血 4 Σ−0.15 与误伤 1（鯨 +0.052）同形状不可分
//    ——净 −0.099/窗，故先观察攒分布后找分化轴。同批：FP 输出整理为门/值对
//    （gates——用户裁定「跟 Jev 购买前检查模块由各个锚组成门控一样…在信号页面
//    中也要展示各个门的值」） ──
/** 观察臂线：famous∪跟单筹码控制度 ≥90% */
const FAM_DOM_FALL_DOM_PCT = 90;
/** 观察臂线：chg30 ≤−20%（盘面已砸落） */
const FAM_DOM_FALL_CHG30_PCT = -20;

// ── FP3 famous 两法（btv134 复审轮立法，2026-11-16 用户两分法裁定：「第一种，
//    盘面尚未起来，famous 抢跑，如果持有过多，就很危险，它一般会选择砸盘；
//    第二种，盘面已经热了一段时间，有 famous 参与比较多，它（们）已经收割
//    一遍了，然后我们的低价策略在下跌后接到。这两种需要拦住」+追裁定
//    「第二种不仅看占买也看占卖」）。键源=buyDerived.famousTraces（roster v7）
//    + cheatDerived.totalBuyBnb（锚窗总买）+ buyDerived.chg30Pct。
//    61 张 famous 票全量验证（btv134-famous-full）：一法 17 张亏 15 赢 2
//    （Σ−0.31）、二法双门 15 张亏 11 赢 4（净改善 +0.318）；合计净改善 ~+0.46） ──
/** 一法线：自卖比 <70%=在场持有（收割未完成） */
const FAM_HOLDING_SOLD_RATIO = 0.70;
/** 一法线：薄盘=锚窗总买 <3 BNB（盘面尚未起来——famous 是唯一流动性来源） */
const FAM_THIN_TOTAL_BUY_BNB = 3;
/** 一法线：正在砸=chg30 < −15%（持有未卖+深跌=砸盘进行时——6/6 全亏零误伤带） */
const FAM_DUMPING_CHG30_PCT = -15;
/** 二法线：自卖比 ≥70%（收割完成=跌的倒计时，无论当下跌没跌——Kiki/天仔/币安
 *  联盟 chg30 正五票全亏实证） */
const FAM_HARVEST_SOLD_RATIO = 0.70;
/** 二法线：占买 ≥10%（参与度门槛——排除路过型） */
const FAM_HARVEST_BUY_PCT = 10;
/** 二法线：占卖 ≥20%（主杀伤轴：famous 卖出占全盘卖出 1/5+=这轮下跌就是它
 *  砸的；屁屁/鯨/悲伤蛙占卖 14~16% 不达线=盘面自己换手→正确放行） */
const FAM_HARVEST_SELL_PCT = 20;

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
// CD412 极端捆绑砸盘独立臂（2026-11-16 btv134 R3 POORNANCE 0x7f25…7777 案用户裁定
// 「按道理如果流量来自正常传播下跌到这个幅度也算好点位，但这个出现了非常严重的捆绑
// 砸盘（异常作弊，散户感觉不会砸这么快）」）：同块独立卖方 ≥15 ∧ 块卖 ≥1 BNB →
// denied 不看承接比（20 个独立卖方本身已构成极端组织性，承接可能是对倒——POORNANCE
// 20 sellers/4.13B/承接比 0.49 被两条既有臂放行）。**破发豁免**（用户裁定「如果下跌
// 到最底部破发，这个作弊行为也被豁免=防止归零后新庄入场」）：launchMinVsFloorPct
// ≤0（经历过破发）→ 不拦。btv134 验证：176 token 唯一命中=主案，零误伤。
const EXTREME_DUMP_MIN_SELLERS = 15;
const EXTREME_DUMP_MIN_BNB = 1;

// ── FP5 尾声延伸活跃度门（2026-11-17 btv140 复审 BP-T013 1105 `0x3fe6ec12…7777`
//    案立法，用户裁定原话：「如果买入点位，是属于『代币曾经充分上涨了』（可以
//    使用代币的上涨幅度/交易总额来标记），那么活跃度要求进行一下延伸，不仅仅
//    是最近的30秒活跃度要求高，买入点位前2分钟，都要求高活跃度。主要是因为，
//    代币到了尾声有些小波动，但是已经完全支撑不起上涨了，除非活跃度持续保持」。
//    案形状：ath +233.7%→距峰 −63.5% 尾声、总成交 47.3 BNB；尾 10s 流量
//    2.35 BNB/min（30s 活跃度判过）但 win120 买入 0.2475 全部集中在最后 30s
//    ——前 90 秒零买入、win120 吞吐 0.42 BNB/min（低于 1 BNB/min 死寂线）。
//    btv140 127 票扫描：命中 3 票（T013/T019/T096，tpm≤0.6）与充分上涨但持续
//    活跃放行面（tpm≥6.1、延伸段买入 ≥4.9 BNB）分离带极宽，线 1↔2/0.1↔0.2
//    不翻动命中面；实现位置=用户裁定「在因子过滤（层）搞」） ──
/** 充分上涨标记线①：锚窗最高较发行价 ≥+100%（曾到 2 倍） */
const TAIL_ATH_VS_LAUNCH_PCT = 100;
/** 充分上涨标记线②：锚窗总成交额 ≥20 BNB（与 BP78 dump 豁免「交易了比较久」同线） */
const TAIL_TOTAL_VOLUME_BNB = 20;
/** 延伸活跃腿1线：win120 整体吞吐 <1 BNB/min（CD 死寂线同源） */
const TAIL_WIN120_TPM_BNB = 1;
/** 延伸活跃腿2线：前 90s 延伸段买入（win120BuyBnb−win30BuyBnb）<0.1（尘埃级
 *  ——买入只发生在最后 30s=小波动，30s 前无人在买） */
const TAIL_EXT_BUY_BNB = 0.1;

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

// ═══════════════ 活跃度门（T144：BP act 题整题迁入——low+ultra 全代码化） ═══════════════

/**
 * 活跃度判定（BP act 题五桶的机械翻译：low/ultra 拦，null=正常域不拦）。
 * 键源：buyDerived.activity 嵌套 24 键（含 BP 自算 nearTail10BuyN/BuyBnb）+
 * cheatDerived 扁平（totalBuyBnb/totalSellBnb/buyN/sellN/burstWaveSegBuyBnb）。
 * 判序：先 B1/B2 豁免（burst 语境/尾段激活）再评 low；ultra 独立评（两臂）。
 * null 容缺：关键锚缺失该臂不触发（宁不拦——拒方向证据缺席，T143 同哲学）。
 * 题面判读谱系：①idlePct≥50 ③⑤尘埃+死寂 ④单向死水（极早窗反锚）⑦临近死寂臂
 * 综合锚四腿联立 ⑥反锚（尾段行明线）burst 输入桶（T143 机械化替代）。
 */
function judgeActivityLevel(snapshot) {
  const act = (snapshot.buyDerived && snapshot.buyDerived.activity) || {};
  const cd = snapshot.cheatDerived || {};
  const trace = {
    idlePct: act.idlePct ?? null, ticksPerMin: act.ticksPerMin ?? null,
    buyMedianBnb: act.buyMedianBnb ?? null, throughputBnbPerMin: act.throughputBnbPerMin ?? null,
    maxDrawdownPct: act.maxDrawdownPct ?? null, spanSec: act.spanSec ?? null, tickCount: act.tickCount ?? null,
    nearSegBuyMedianBnb: act.nearSegBuyMedianBnb ?? null, nearSegBnbPerMin: act.nearSegBnbPerMin ?? null,
    nearTail5BuyN: act.nearTail5BuyN ?? null, nearTail5BuyBnb: act.nearTail5BuyBnb ?? null,
    nearTail10SellWallets: act.nearTail10SellWallets ?? null,
    nearTail10BuyN: act.nearTail10BuyN ?? null, nearTail10BuyBnb: act.nearTail10BuyBnb ?? null,
  };

  // ── B1 burst 语境豁免（替代原 cheat sbw 输入桶：沉积前提+出口簇真实买入，T143 同源） ──
  const burstCtx = typeof cd.burstWaveSegBuyBnb === 'number' && cd.burstWaveSegBuyBnb >= ACT_BURST_WAVE_BUY_BNB
    && burstContextBackgroundCold(cd);
  // ── B2 尾段激活豁免（题面⑥三段形状：锚前尾段买 ≥3 笔 ∧ ≥0.3 BNB=正被流量激活） ──
  const tailActive = trace.nearTail5BuyN !== null && trace.nearTail5BuyBnb !== null
    && trace.nearTail5BuyN >= ACT_TAIL5_ACTIVATE_N && trace.nearTail5BuyBnb >= ACT_TAIL5_ACTIVATE_BNB;

  // ── low 五臂（豁免后任一成立） ──
  if (!burstCtx && !tailActive) {
    // L1 大比例无交易期（极端联立：静默 ≥60% ∧ 吞吐近死寂——预扫描校准）
    if (typeof trace.idlePct === 'number' && trace.idlePct >= ACT_LOW_IDLE_PCT
      && typeof trace.throughputBnbPerMin === 'number' && trace.throughputBnbPerMin < ACT_LOW_IDLE_THROUGHPUT) {
      return { level: 'low', branch: 'act_low_idle', trace: { ...trace, burstCtx, tailActive } };
    }
    // L5 全窗四腿联立（间歇死水：密度/吞吐/中位/静默可观）
    if (typeof trace.ticksPerMin === 'number' && trace.ticksPerMin < ACT_SPARSE_TPM
      && typeof trace.throughputBnbPerMin === 'number' && trace.throughputBnbPerMin < ACT_DEAD_THROUGHPUT_BNB_MIN
      && typeof trace.buyMedianBnb === 'number' && trace.buyMedianBnb < ACT_DUST_MEDIAN_BNB
      && ((typeof trace.idlePct === 'number' && trace.idlePct >= ACT_SPARSE_IDLE_PCT)
        || (typeof act.maxGapSec === 'number' && act.maxGapSec >= ACT_SPARSE_MAX_GAP_SEC))) {
      return { level: 'low', branch: 'act_low_sparse_quad', trace: { ...trace, burstCtx, tailActive } };
    }
    // L2 尘埃假活跃（中位尘埃 ∧ 吞吐死寂两腿）
    if (typeof trace.buyMedianBnb === 'number' && trace.buyMedianBnb < ACT_DUST_MEDIAN_BNB
      && typeof trace.throughputBnbPerMin === 'number' && trace.throughputBnbPerMin < ACT_DEAD_THROUGHPUT_BNB_MIN) {
      return { level: 'low', branch: 'act_low_dust_dead', trace: { ...trace, burstCtx, tailActive } };
    }
    // L3 单向死水推进（笔比+额比+浅回撤三腿；极早窗反锚两腿同时则不适用）
    const earlyWin = (trace.spanSec !== null && trace.tickCount !== null
      && trace.spanSec < ACT_EARLYWIN_SEC && trace.tickCount < ACT_EARLYWIN_TICKS);
    if (!earlyWin && typeof cd.buyN === 'number' && typeof cd.sellN === 'number' && cd.sellN > 0
      && cd.buyN / cd.sellN >= ACT_ONESIDED_BUY_SELL_N
      && typeof cd.totalBuyBnb === 'number' && typeof cd.totalSellBnb === 'number' && cd.totalSellBnb > 0
      && cd.totalBuyBnb / cd.totalSellBnb >= ACT_ONESIDED_BUY_SELL_BNB
      && typeof trace.maxDrawdownPct === 'number' && trace.maxDrawdownPct < ACT_ONESIDED_MAX_DD_PCT) {
      return { level: 'low', branch: 'act_low_onesided', trace: { ...trace, burstCtx, tailActive, earlyWin } };
    }
    // L4 临近死寂臂（⑦主锚；预扫描校准=**两腿联立**：中位尘埃 ∧ 吞吐死寂同时
    // 成立才拦——单腿时近窗偶发空档即拦，321 行主误伤源）
    const nearDead = (typeof trace.nearSegBuyMedianBnb === 'number' && trace.nearSegBuyMedianBnb < ACT_DUST_MEDIAN_BNB)
      && (typeof trace.nearSegBnbPerMin === 'number' && trace.nearSegBnbPerMin < ACT_DEAD_THROUGHPUT_BNB_MIN);
    if (nearDead) {
      return { level: 'low', branch: 'act_low_near_dead', trace: { ...trace, burstCtx, tailActive } };
    }
  }

  // ── ultra 两臂（独立于豁免——协同出货/极端密度是当下事实非沉积语境） ──
  // U1 协同出货臂（末 10s ≥10 独立卖钱包 ∧ 买入趋零；c84a 双边在场不落）
  if (typeof trace.nearTail10SellWallets === 'number' && trace.nearTail10SellWallets >= ACT_ULTRA_SELL_WALLETS
    && typeof trace.nearTail10BuyN === 'number' && trace.nearTail10BuyN <= ACT_ULTRA_BUY_N_MAX
    && typeof trace.nearTail10BuyBnb === 'number' && trace.nearTail10BuyBnb < ACT_ULTRA_BUY_BNB_MAX) {
    return { level: 'ultra', branch: 'act_ultra_coordinated_selling', trace: { ...trace, burstCtx, tailActive } };
  }
  // U2 极端密度臂（几乎无空窗每秒十笔级下界）
  if (typeof trace.ticksPerMin === 'number' && trace.ticksPerMin >= ACT_ULTRA_TPM
    && typeof trace.idlePct === 'number' && trace.idlePct < ACT_ULTRA_IDLE_PCT) {
    return { level: 'ultra', branch: 'act_ultra_density', trace: { ...trace, burstCtx, tailActive } };
  }

  return { level: null, branch: burstCtx ? 'burst_ctx' : (tailActive ? 'tail_active' : 'normal'), reason: null, trace: { ...trace, burstCtx, tailActive } };
}

// ═══════════════ 尾声延伸活跃度门（FP5：充分上涨过的票，活跃度要求延伸到前 2 分钟） ═══════════════

/**
 * 尾声延伸活跃度判定（FP5，纯机械）。前提=「曾充分上涨」（涨幅 ≥+100% ∧
 * 总成交 ≥20 BNB 双标记同时成立——明确的大轮次）；此前提下若前 2 分钟活跃度
 * 不足（任一腿）：腿1 win120 整体吞吐 <1 BNB/min（2 分钟合计死寂）；腿2 前
 * 90s 延伸段买入 <0.1 BNB（买入只集中在最后 30s=尾声小波动）→ 拒 act_tail_flat。
 * 未充分上涨的票不适用（普通票活跃度语义归 judgeActivityLevel）；锚缺失
 * （ath/vol/win 族 null）不拦（拒方向证据缺席，T143 哲学）。
 * 正在拉升的票天然豁免：win120 持续活跃两腿均不命中（btv140 放行面 tpm≥6.1）。
 */
function judgeTailPhaseActivity(snapshot) {
  const bd = snapshot.buyDerived || {};
  const w30 = bd.win && bd.win[30] ? bd.win[30] : null;
  const w120 = bd.win && bd.win[120] ? bd.win[120] : null;
  const trace = {
    athVsLaunchPct: typeof bd.athVsLaunchPct === 'number' ? bd.athVsLaunchPct : null,
    totalVolumeBnb: typeof bd.totalVolumeBnb === 'number' ? bd.totalVolumeBnb : null,
    tpm120: w120 && typeof w120.buyBnb === 'number' && typeof w120.sellBnb === 'number'
      ? +(((w120.buyBnb + w120.sellBnb) / 120) * 60).toFixed(2) : null,
    extBuyBnb: w120 && w30 && typeof w120.buyBnb === 'number' && typeof w30.buyBnb === 'number'
      ? +(w120.buyBnb - w30.buyBnb).toFixed(4) : null,
  };
  if (trace.athVsLaunchPct === null || trace.totalVolumeBnb === null) {
    return { hit: 0, branch: 'anchors_missing', reason: null, trace };
  }
  if (trace.athVsLaunchPct < TAIL_ATH_VS_LAUNCH_PCT || trace.totalVolumeBnb < TAIL_TOTAL_VOLUME_BNB) {
    return { hit: 0, branch: 'not_fully_risen', reason: null, trace };
  }
  if (trace.tpm120 === null && trace.extBuyBnb === null) {
    return { hit: 0, branch: 'win_missing', reason: null, trace };
  }
  const tpmLow = trace.tpm120 !== null && trace.tpm120 < TAIL_WIN120_TPM_BNB;
  const extLow = trace.extBuyBnb !== null && trace.extBuyBnb < TAIL_EXT_BUY_BNB;
  if (tpmLow || extLow) {
    return { hit: 1, branch: tpmLow ? 'tail_tpm_dead' : 'tail_ext_buy_gap', reason: 'act_tail_flat', trace };
  }
  return { hit: 0, branch: 'sustained', reason: null, trace };
}

// ═══════════════ famous 高控+砸落观察臂（FP6：标记不拦截，留待找方案） ═══════════════

/**
 * famous 高控+砸落观察判定（FP6，纯观察零拦截）：famousDominancePct（cheatDerived
 * 筹码口径=famous∪60s 跟单者合计控制在场筹码 %）≥90 ∧ chg30Pct ≤−20 → observe
 * 标记（fam_dominance_fall）。原料值（自卖比/占卖/在场净）随 trace 落盘供后续
 * 找分化轴；锚缺失不标记（同 T143 容缺哲学——观察方向证据缺席不标）。
 */
function judgeFamousDominanceFall(snapshot) {
  const bd = snapshot.buyDerived || {};
  const cd = snapshot.cheatDerived || {};
  const dom = typeof cd.famousDominancePct === 'number' ? cd.famousDominancePct : null;
  const chg30 = typeof bd.chg30Pct === 'number' ? bd.chg30Pct : null;
  const trace = { domPct: dom, chg30Pct: chg30 };
  if (dom === null || chg30 === null) {
    return { observe: false, branch: 'anchors_missing', trace };
  }
  if (dom >= FAM_DOM_FALL_DOM_PCT && chg30 <= FAM_DOM_FALL_CHG30_PCT) {
    return { observe: true, branch: 'fam_dominance_fall', trace };
  }
  return { observe: false, branch: 'clear', trace };
}

// ═══════════════ 门/值对组装（FP6：FP 输出整理为门控形态，信号页展示各门值） ═══════════════

/**
 * 组装 FP 门/值对（用户裁定 2026-11-17：「因子过滤这个环节其实也是形成了好多个
 * 门控，跟 Jev 购买前检查模块由各个锚组成门控一样，所以因子过滤的输出也整理
 * 一下形成门/值对这样的格式，在信号页面中也要展示各个门的值」）。
 * 每门 {id,label,value,line,hit,observe}——value/line 为预拼展示串（null 一律 '-'）；
 * hit=该门拦截命中（进 arms/reason）；observe=观察标记门（不拦截）。
 * @param {object} parts evaluateFactorPreBuy 组装中的各判定结果
 */
function buildFactorGates(parts) {
  const d = (v, unit = '') => (v === null || v === undefined ? '-' : `${v}${unit}`);
  const g = [];
  // PVP
  {
    const t = parts.pvp.trace || {};
    g.push({
      id: 'pvp', label: 'PVP·像样买方在场',
      value: `0.2级×${d(t.act20)} 0.3级×${d(t.act30)} 同块捆绑${d(t.volBundledBnb, 'B')}`,
      line: '钱包≥2 ∨ 0.3级≥1 ∨ 捆绑>0.3B', hit: !!parts.pvp.reason,
    });
  }
  // act 族（trace 同源 judgeActivityLevel）
  {
    const t = parts.activity.trace || {};
    const branch = parts.activity.branch;
    g.push({
      id: 'act_idle', label: '活跃·静默死寂',
      value: `静默${d(t.idlePct, '%')} 吞吐${d(t.throughputBnbPerMin, 'B/min')}`,
      line: '≥60% ∧ <0.5B/min', hit: branch === 'act_low_idle',
    });
    g.push({
      id: 'act_sparse', label: '活跃·稀疏死水',
      value: `${d(t.ticksPerMin, '笔/min')} 吞吐${d(t.throughputBnbPerMin, 'B/min')} 中位${d(t.buyMedianBnb, 'B')}`,
      line: '<10笔/min ∧ <1B/min ∧ <0.05B', hit: branch === 'act_low_sparse_quad',
    });
    g.push({
      id: 'act_dust', label: '活跃·尘埃假活跃',
      value: `买中位${d(t.buyMedianBnb, 'B')} 吞吐${d(t.throughputBnbPerMin, 'B/min')}`,
      line: '<0.05B ∧ <1B/min', hit: branch === 'act_low_dust_dead',
    });
    g.push({
      id: 'act_near_dead', label: '活跃·临近死寂',
      value: `临近中位${d(t.nearSegBuyMedianBnb, 'B')} 临近吞吐${d(t.nearSegBnbPerMin, 'B/min')}`,
      line: '<0.05B ∧ <1B/min', hit: branch === 'act_low_near_dead',
    });
    g.push({
      id: 'act_ultra_sell', label: '活跃·协同出货',
      value: `末10s卖钱包${d(t.nearTail10SellWallets)} 买${d(t.nearTail10BuyN, '笔')}/${d(t.nearTail10BuyBnb, 'B')}`,
      line: '≥10钱包 ∧ ≤2笔 ∧ <0.1B', hit: branch === 'act_ultra_coordinated_selling',
    });
    g.push({
      id: 'act_ultra_density', label: '活跃·极端密度',
      value: `${d(t.ticksPerMin, '笔/min')} 静默${d(t.idlePct, '%')}`,
      line: '≥150笔/min ∧ <5%', hit: branch === 'act_ultra_density',
    });
  }
  // CD 四臂+CD412（cd 输入重取）
  {
    const cd = parts.cd || {};
    g.push({
      id: 'cd400', label: 'CD400·贴锚砸出零承接',
      value: `达标块${d(cd.nearDumpQualBlocks)} 最恶承接${d(cd.nearDumpMinAbsorbBnb, 'B')}`,
      line: '≥1块 ∧ 承接<0.05B', hit: parts.armHits.includes('cd400_dump_no_absorption'),
    });
    g.push({
      id: 'cd403', label: 'CD403·捆绑砸盘低承接',
      value: `卖方${d(cd.nearDumpWorstSellers)} 承接比${(typeof cd.nearDumpMinAbsorbBnb === 'number' && typeof cd.nearDumpWorstSellBnb === 'number' && cd.nearDumpWorstSellBnb > 0) ? (cd.nearDumpMinAbsorbBnb / cd.nearDumpWorstSellBnb).toFixed(2) : '-'}`,
      line: '卖方≥8 ∧ 比<0.3', hit: parts.armHits.includes('cd403_dump_low_absorption'),
    });
    g.push({
      id: 'cd401', label: 'CD401·burst出口卖压',
      value: `簇卖占${d(cd.burstWaveSegSellPct, '%')} 卖额${d(cd.burstWaveSegSellBnb, 'B')}`,
      line: '≥30% ∧ ≥0.3B（sbw=1 资格）', hit: parts.armHits.includes('cd401_burst_exit_sell_pressure'),
    });
    g.push({
      id: 'cd405', label: 'CD405·burst捆绑收割',
      value: `单块${d(cd.burstWaveBundleMaxWallets, '户')} 相邻slot${d(cd.burstWaveBundleAdjPairSum, '户')}`,
      line: '去尘捆绑≥7户', hit: parts.armHits.includes('cd405_burst_bundled_wave'),
    });
    g.push({
      id: 'cd412', label: 'CD412·极端捆绑砸盘',
      value: `卖方${d(cd.nearDumpWorstSellers)} 块卖${d(cd.nearDumpWorstSellBnb, 'B')}`,
      line: '≥15户 ∧ ≥1B（破发豁免）', hit: parts.armHits.includes('cd412_extreme_dump_sellers'),
    });
  }
  // FP3 famous 两法
  {
    const t = parts.famous.trace || {};
    g.push({
      id: 'fam_holding', label: 'FP3·famous持重危险',
      value: `自卖比${d(t.soldRatio)} 总买${d(t.totalBuyBnb, 'B')} chg30${d(t.chg30Pct, '%')}`,
      line: '自卖比<0.7 ∧（总买<3B ∨ chg30<-15%）', hit: parts.famous.reason === 'fam_holding_thin' || parts.famous.reason === 'fam_holding_dumping',
    });
    g.push({
      id: 'fam_harvest', label: 'FP3·famous收割砸盘',
      value: `自卖比${d(t.soldRatio)} 占买${d(t.groupBuyPct, '%')} 占卖${d(t.groupSellPct, '%')}`,
      line: '≥0.7 ∧ 占买≥10% ∧ 占卖≥20%', hit: parts.famous.reason === 'fam_harvested_dump',
    });
  }
  // FP5 尾声延伸
  {
    const t = parts.tail.trace || {};
    g.push({
      id: 'tail_activity', label: 'FP5·尾声延伸活跃',
      value: `ath${d(t.athVsLaunchPct, '%')} 总额${d(t.totalVolumeBnb, 'B')} win120吞吐${d(t.tpm120, 'B/min')} 前90s买${d(t.extBuyBnb, 'B')}`,
      line: 'ath≥100% ∧ 总额≥20B ∧（吞吐<1B/min ∨ 延伸买<0.1B）', hit: !!parts.tail.reason,
    });
  }
  // FP6 famous 高控+砸落（观察门——不拦截）
  {
    const t = parts.domFall.trace || {};
    g.push({
      id: 'fam_dom_fall', label: 'FP6·famous高控+砸落（观察）',
      value: `dom${d(t.domPct, '%')} chg30${d(t.chg30Pct, '%')}`,
      line: 'dom≥90% ∧ chg30≤−20%（标记不拦截，留待找方案）', hit: false,
      observe: parts.domFall.observe === true,
    });
  }
  return g;
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

/** CD412 极端捆绑砸盘：同块独立卖方 ≥15 ∧ 块卖 ≥1 BNB → 拦（不看承接比）；破发豁免 */
function armExtremeDumpSellers(cd, bd) {
  if (typeof cd.nearDumpWorstSellers !== 'number' || cd.nearDumpWorstSellers < EXTREME_DUMP_MIN_SELLERS) return false;
  if (typeof cd.nearDumpWorstSellBnb !== 'number' || cd.nearDumpWorstSellBnb < EXTREME_DUMP_MIN_BNB) return false;
  // 破发豁免：经历过破发（launchMinVsFloorPct ≤0=滚动最低 vs min(常量,首买)）→ 归零后新庄入场豁免
  if (bd && typeof bd.launchMinVsFloorPct === 'number' && bd.launchMinVsFloorPct <= 0) return false;
  return true;
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

// ═══════════════ famous 两法门（FP3：btv134 复审轮用户两分法立法） ═══════════════

/**
 * famous 危险判定（纯机械，键源 famousTraces/cheatDerived.totalBuyBnb/chg30Pct）。
 * 一法（持重危险）：famous 在场持有（自卖比 <70%——收割未完成）∧（薄盘未起
 *   锚窗总买 <3 BNB ∨ 正在砸 chg30 <−15%）→ 拦。薄盘=它是唯一流动性来源，
 *   砸盘无对手盘；砸盘中=持有未卖+深跌（btv134 验证 6/6 全亏零误伤带）。
 * 二法（收割砸盘）：自卖比 ≥70%（收割完成=跌的倒计时，无论当下跌没跌）∧
 *   占买 ≥10%（参与多，排除路过型）∧ 占卖 ≥20%（这轮下跌就是它砸的——
 *   占卖主杀伤轴：屁屁/鯨/悲伤蛙占卖 14~16%=盘面自己换手→正确放行）。
 * null 容缺：roster 缺失 famousTraces=null→不拦（轴不可评宁不拦）；窗内无
 * 名单命中 wallets=[]→放行（有证据的缺席）；关键数值缺失该臂不触发。
 */
function judgeFamousDanger(snapshot) {
  const bd = snapshot.buyDerived || {};
  const cd = snapshot.cheatDerived || {};
  const ft = bd.famousTraces;
  if (!ft || !Array.isArray(ft.wallets) || ft.wallets.length === 0) {
    return { hit: 0, branch: ft ? 'no_famous' : 'roster_missing', reason: null,
      trace: { groupBuyPct: ft && ft.groupBuyPct !== undefined ? ft.groupBuyPct : null } };
  }
  const groupBuy = typeof ft.groupBuyBnb === 'number' ? ft.groupBuyBnb : 0;
  const groupSell = typeof ft.groupSellBnb === 'number' ? ft.groupSellBnb : 0;
  const soldRatio = groupBuy > 0 ? groupSell / groupBuy : null;
  const trace = {
    groupBuyPct: typeof ft.groupBuyPct === 'number' ? ft.groupBuyPct : null,
    groupSellPct: typeof ft.groupSellPct === 'number' ? ft.groupSellPct : null,
    soldRatio: soldRatio !== null ? +(soldRatio.toFixed(3)) : null,
    totalBuyBnb: typeof cd.totalBuyBnb === 'number' ? cd.totalBuyBnb : null,
    chg30Pct: typeof bd.chg30Pct === 'number' ? bd.chg30Pct : null,
    presenceNetBnb: typeof ft.presenceNetBnb === 'number' ? ft.presenceNetBnb : null,
    wallets: ft.wallets.length,
  };
  // 一法：在场持有 ∧（薄盘 ∨ 正在砸）
  if (soldRatio !== null && soldRatio < FAM_HOLDING_SOLD_RATIO) {
    if (trace.totalBuyBnb !== null && trace.totalBuyBnb < FAM_THIN_TOTAL_BUY_BNB) {
      return { hit: 1, branch: 'fam_holding_thin', reason: 'fam_holding_thin', trace };
    }
    if (trace.chg30Pct !== null && trace.chg30Pct < FAM_DUMPING_CHG30_PCT) {
      return { hit: 1, branch: 'fam_holding_dumping', reason: 'fam_holding_dumping', trace };
    }
  }
  // 二法：收割完成 ∧ 参与多 ∧ 占卖主导
  if (soldRatio !== null && soldRatio >= FAM_HARVEST_SOLD_RATIO
    && trace.groupBuyPct !== null && trace.groupBuyPct >= FAM_HARVEST_BUY_PCT
    && trace.groupSellPct !== null && trace.groupSellPct >= FAM_HARVEST_SELL_PCT) {
    return { hit: 1, branch: 'fam_harvested_dump', reason: 'fam_harvested_dump', trace };
  }
  return { hit: 0, branch: 'fam_clear', reason: null, trace };
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
  const enableActivity = opts.enableActivity !== false;
  const enableFamous = opts.enableFamous !== false;
  const enableTail = opts.enableTail !== false;
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
    else if (armExtremeDumpSellers(cd, snapshot.buyDerived)) arms.push('cd412_extreme_dump_sellers');
  }
  // T144 活跃度门（BP act 题整题迁入）：PVP 后、CD 臂前
  const activity = enableActivity
    ? judgeActivityLevel(snapshot)
    : { level: null, branch: 'disabled', trace: {} };
  if (activity.level === 'low') arms.push('act_low');
  else if (activity.level === 'ultra') arms.push('act_ultra');
  // FP5 尾声延伸活跃度门：act 族（充分上涨过的票活跃度延伸到前 2 分钟）
  const tail = enableTail
    ? judgeTailPhaseActivity(snapshot)
    : { hit: 0, branch: 'disabled', reason: null, trace: {} };
  if (tail.hit === 1) arms.push(tail.reason);
  // FP3 famous 两法门（一法持重危险/二法收割砸盘）：act 后评（act 拒因优先）
  const famous = enableFamous
    ? judgeFamousDanger(snapshot)
    : { hit: 0, branch: 'disabled', reason: null, trace: {} };
  if (famous.hit === 1) arms.push(famous.reason);
  // FP6 famous 高控+砸落观察臂（标记不拦截——留待找方案）
  const domFall = judgeFamousDominanceFall(snapshot);
  const reason = activity.level === 'low' ? 'act_low'
    : (activity.level === 'ultra' ? 'act_ultra' : (pvp.reason || tail.reason || famous.reason || (arms.length ? arms[0] : null)));
  const gates = buildFactorGates({ pvp, activity, famous, tail, domFall, cd, armHits: arms });
  return { pass: reason === null, reason, version: FACTOR_PREBUY_VERSION, pvp, activity, tail, famous, arms,
    gates,
    observe: domFall.observe ? { code: 'fam_dominance_fall', ...domFall.trace } : null,
    trace: { ...pvp.trace, act: activity.branch, tail: tail.branch, fam: famous.branch, domFall: domFall.branch } };
}

module.exports = {
  FACTOR_PREBUY_VERSION,
  PVP_TREAT03_BNB, PVP_LEVEL02_BNB, PVP_BUNDLE_BNB,
  ACT_LOW_IDLE_PCT, ACT_DUST_MEDIAN_BNB, ACT_DEAD_THROUGHPUT_BNB_MIN,
  ACT_ONESIDED_BUY_SELL_N, ACT_ONESIDED_BUY_SELL_BNB, ACT_ONESIDED_MAX_DD_PCT,
  ACT_EARLYWIN_SEC, ACT_EARLYWIN_TICKS, ACT_SPARSE_TPM, ACT_SPARSE_IDLE_PCT, ACT_SPARSE_MAX_GAP_SEC,
  ACT_TAIL5_ACTIVATE_N, ACT_TAIL5_ACTIVATE_BNB, ACT_BURST_WAVE_BUY_BNB,
  ACT_ULTRA_SELL_WALLETS, ACT_ULTRA_BUY_N_MAX, ACT_ULTRA_BUY_BNB_MAX, ACT_ULTRA_TPM, ACT_ULTRA_IDLE_PCT,
  TAIL_ATH_VS_LAUNCH_PCT, TAIL_TOTAL_VOLUME_BNB, TAIL_WIN120_TPM_BNB, TAIL_EXT_BUY_BNB,
  FAM_DOM_FALL_DOM_PCT, FAM_DOM_FALL_CHG30_PCT,
  DUMP_NO_ABSORB_BNB, DUMP_RATIO_MIN_SELLERS, DUMP_LOW_ABSORPTION_RATIO, BURST_BUNDLE_MIN_WALLETS,
  EXTREME_DUMP_MIN_SELLERS, EXTREME_DUMP_MIN_BNB,
  SBW_PROXY_WAVE_NEAR_SEC, SBW_PROXY_MEDIAN_DUST_BNB,
  BURST_CONTEXT_PRESEG_MIN_BNB, BURST_CONTEXT_PRESEG_MIN_TICKS, burstContextBackgroundCold,
  FAM_HOLDING_SOLD_RATIO, FAM_THIN_TOTAL_BUY_BNB, FAM_DUMPING_CHG30_PCT,
  FAM_HARVEST_SOLD_RATIO, FAM_HARVEST_BUY_PCT, FAM_HARVEST_SELL_PCT,
  judgeRetailPvp, judgeActivityLevel, judgeFamousDanger, judgeTailPhaseActivity,
  judgeFamousDominanceFall, buildFactorGates,
  armDumpNoAbsorption, armDumpLowAbsorption, armBurstExitSellPressure, armBurstBundledWave,
  armExtremeDumpSellers,
  evaluateFactorPreBuy,
};
