/**
 * 作弊盘检测 Jev 结果映射（CD1）——纯函数，零 DB 零网络
 *
 * D3.5 观测框架（2026-10-31 用户裁定三轮：「活跃度请做成一个单独的锚。此外，
 * 先不下结论，不把它们分类为 作弊/不健康 等等，只识别现象，以及现象的强度」
 * +「我的意思也是用Jev判断活跃度」+「这个基本原则一定要清楚，使用Jev进行判断！」）：
 * **判断一律 Jev、代码只组数据（原始事实/数值）不产档位结论**。判定层停产——
 * D3.1-D3.4 的综合规则臂（A1-A5/B1/兜底）整体退役（git 留档），mapper 不再导出
 * verdict/cheatProb/patternType；输出=**观测记录**：
 * - phenomena：4 现象题档位（Jev Choice 四档 argmax）
 * - extLevels：观察性现象题（stall_burst_wave D3.3 / amount_tiering D3.7 /
 *   same_block_buy_wave D3.8，容缺）
 * - activityLevel：**活跃度 Jev 题**（activity_level，独立档域 low/mid/high/ultra
 *   ——Jev 从 [TICKS] 直读自判，D3.2 代码档位锚撤除；容缺：旧存档缺席→null）
 * - bundledDominance：**捆绑交易主导度 Jev 题**（bundled_trade_dominance，独立
 *   档域 low/mid/high（D3.8 用户裁定「部分捆绑没事，持仓太大量就不好了，高中低
 *   三档」）；容缺同上）
 * - anchors：代码数值锚——持仓占比四键（sb/eq 簇占比 + D3.20 top1HoldSupplyPct/
 *   top1HoldCircPct 单一钱包持仓集中双锚；只述数值事实，非档位判定）
 * 结论（哪些现象组合成什么分类）待观测数据攒批后再定（D3.4 删兜底后 unhealthy
 * 本就无输出臂；A2 退役、证据臂设计随判定层悬置一并挂起）。
 *
 * 前史：D3.0「现象锚观测+代码综合」→ D3.1 4 题+A5 数值门 → D3.3 题面教算法
 * → D3.4 删兜底（无臂命中=healthy）→ D3.5 判定层整体停产（详见台账版本演进表）。
 *
 * JevClient 缺答案 id 直接 throw（fail-loud）——现象题缺失/未知桶名同样 throw
 * （题集/映射漂移防线，调用方落 error 行）；观察题（EXT）与活跃度题容缺：
 * 旧存档（<D3.5）answers 无该键 → null 不 throw（零配额重放兼容），在场未知
 * 桶名仍 throw。
 */

/** 现象题 id 清单（与题集对齐——漂移由未知桶名/缺题 throw 兜住） */
const PHENOMENON_IDS = [
  'equal_amount_split',
  'coordinated_sell_back',
  'creator_front_run',
  'sell_dispersion',
];

/**
 * 观察性现象题 id 清单（D3.3 起）：答案只落 extLevels 审计，不进观测主键。
 * D3.7 起=后增题容缺通道（sbw D3.3 / amount_tiering D3.7 / same_block_buy_wave D3.8
 * / insider_supply_sell D3.9 / slow_grind_pump D3.14）。容缺语义：旧存档
 * （< 各题引入版本）answers 无该键 → null 不 throw（重放兼容）；在场答案走
 * _phenomenon（未知桶名照 throw，漂移防线不因容缺放宽）。**sbw 例外**：D3.11 起
 * 现象二分桶域（none/burst），读档走 _stallBurst——D3.3-D3.8 四档值、
 * D3.9 burst_suspect、D3.10 burst_cheat/burst_normal 桶值语义不可比=断代 null。
 */
const EXT_PHENOMENON_IDS = ['stall_burst_wave', 'amount_tiering', 'same_block_buy_wave', 'insider_supply_sell', 'slow_grind_pump', 'wash_pair', 'holdings_balance', 'burst_spike_concentration', 'strong_backer_pressure']; // wash_pair D3.28（同块对敲）/ holdings_balance D3.32（持仓均衡——组合垄断，EXT 容缺通道同款）/ burst_spike_concentration D3.51（burst 尖刺集中——CD157/CD102 裁定立项，A 主判自动吸收）/ strong_backer_pressure D3.52（强庄持续买压——CD159 立项**观察期**：cheat-grade MAIN_IDS 显式排除不进 A 主判，档位只进 FA 投影攒分布，豁免规则攒 case 后再裁）

/** 程度档位序（与题集 PHENOMENON_LEVELS 一致；档位比较用） */
const LEVEL_ORDER = { none: 0, weak: 1, moderate: 2, strong: 3 };

/** 活跃度题独立档域（与题集 ACTIVITY_LEVELS 一致；桶域校验用） */
const ACTIVITY_LEVELS = ['low', 'mid', 'high', 'ultra'];

/** 捆绑交易题独立档域（与题集 BUNDLED_LEVELS 一致；D3.8 用户裁定高中低三档） */
const BUNDLED_LEVELS = ['low', 'mid', 'high'];

/** 异常行为占比题独立档域（与题集 ABNORMAL_BEHAVIOR_LEVELS 一致；D3.35 立项
 *  real_participation→D3.39 改名+理念重构——用户裁定「异常行为识别与比例计算」
 *  无罪推定：无可见异常即正常，不要求自证真实用户；四桶异常占比轴
 *  negligible/noticeable/dominant/unclear（镜像原参与度轴 minimal_genuine≈
 *  dominant；D3.35-D3.38 旧档 real_participation 答案键缺席容缺 null 断代） */
const ABNORMAL_BEHAVIOR_LEVELS = ['negligible', 'noticeable', 'dominant', 'unclear'];

/** 停滞突发波二分类桶域（与题集 STALL_BURST_LEVELS 一致；D3.11 用户裁定退回
 *  纯现象二分「burst_cheat 就不再次检测了……只做一个是否有 停滞后涌入 的现象
 *  判断即可」——波内资金定性与其它门重复且无明确标准，只判有无） */
const STALL_BURST_LEVELS = ['none', 'burst'];

/** sbw 旧档断代清单（none 两域同义保留）：D3.3-D3.8 现象四档值（weak/moderate/
 *  strong）+ D3.9 burst_suspect + D3.10 burst_cheat/burst_normal 桶值——语义
 *  不可比=断代 null */
const STALL_BURST_LEGACY_LEVELS = ['weak', 'moderate', 'strong', 'burst_suspect', 'burst_cheat', 'burst_normal'];

/** 单现象题 → {bucket, prob, level}（argmax 桶；缺题/未知桶 throw） */
function _phenomenon(answers, id) {
  const a = answers && answers[id];
  if (!a || !a.probabilities) {
    throw new Error(`现象题 ${id} 答案缺失或无概率分布: ${JSON.stringify(a).slice(0, 120)}`);
  }
  let best = null;
  for (const [bucket, p] of Object.entries(a.probabilities)) {
    if (best === null || p > best.prob) best = { bucket, prob: p };
  }
  const level = LEVEL_ORDER[best.bucket];
  if (level === undefined) {
    throw new Error(`现象题 ${id} 未知桶名 '${best.bucket}'（题集/映射漂移——PHENOMENON_LEVELS 须同步）`);
  }
  return { bucket: best.bucket, prob: best.prob, level };
}

/** 数值锚读取（形状异常按缺席=null 处理——绝不冒充） */
function _anchorPct(anchors, key) {
  const v = anchors && anchors[key];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * 活跃度题答案读取（D3.5：Jev 判断活跃度——题 id activity_level，独立档域，
 * 非现象四档轴）。容缺：旧存档（<D3.5）无该键 → null（重放兼容）；
 * 在场答案走 argmax + 桶域校验，未知桶名 throw（漂移防线不因容缺放宽）。
 */
function _activityLevel(answers) {
  const a = answers && answers.activity_level;
  if (!a || !a.probabilities) return null;
  let best = null;
  for (const [bucket, p] of Object.entries(a.probabilities)) {
    if (best === null || p > best.prob) best = { bucket, prob: p };
  }
  if (!ACTIVITY_LEVELS.includes(best.bucket)) {
    throw new Error(`活跃度题 activity_level 未知桶名 '${best.bucket}'（题集/映射漂移——ACTIVITY_LEVELS 须同步）`);
  }
  return { bucket: best.bucket, prob: best.prob };
}

/**
 * 捆绑交易主导度题答案读取（D3.8：题 id bundled_trade_dominance，独立档域
 * low/mid/high，非现象四档轴）。容缺：旧存档（<D3.8）无该键 → null（重放兼容）；
 * 在场答案走 argmax + 桶域校验，未知桶名 throw（漂移防线不因容缺放宽）。
 */
function _bundledDominance(answers) {
  const a = answers && answers.bundled_trade_dominance;
  if (!a || !a.probabilities) return null;
  let best = null;
  for (const [bucket, p] of Object.entries(a.probabilities)) {
    if (best === null || p > best.prob) best = { bucket, prob: p };
  }
  if (!BUNDLED_LEVELS.includes(best.bucket)) {
    throw new Error(`捆绑题 bundled_trade_dominance 未知桶名 '${best.bucket}'（题集/映射漂移——BUNDLED_LEVELS 须同步）`);
  }
  return { bucket: best.bucket, prob: best.prob };
}

/**
 * 异常行为占比题答案读取（D3.39：题 id abnormal_behavior_ratio，独立档域四桶
 * ——异常行为识别与比例计算综合题「明显异常形状合计解释盘面流量多大比例」，
 * 无罪推定。D3.35-D3.38 旧档 real_participation 答案键不映射（改名=换键，
 * 参与度轴与异常占比轴语义镜像不可比）。容缺：旧存档（<D3.39）无该键 → null
 * （重放兼容）；在场答案走 argmax + 桶域校验，未知桶名 throw（漂移防线不因
 * 容缺放宽）。
 */
function _abnormalBehavior(answers) {
  const a = answers && answers.abnormal_behavior_ratio;
  if (!a || !a.probabilities) return null;
  let best = null;
  for (const [bucket, p] of Object.entries(a.probabilities)) {
    if (best === null || p > best.prob) best = { bucket, prob: p };
  }
  if (!ABNORMAL_BEHAVIOR_LEVELS.includes(best.bucket)) {
    throw new Error(`异常行为占比题 abnormal_behavior_ratio 未知桶名 '${best.bucket}'（题集/映射漂移——ABNORMAL_BEHAVIOR_LEVELS 须同步）`);
  }
  return { bucket: best.bucket, prob: best.prob };
}

/**
 * 停滞突发波题答案读取（D3.11：题 id stall_burst_wave，现象二分桶域
 * none/burst——只判「有无停滞后涌入」，不判波内资金性质（定性与等额分仓/
 * 同块买入波/捆绑主导度等题重复，D3.11 用户裁定删除）。容缺：旧存档
 * （<D3.3）无该键 → null；旧档断代值（D3.3-D3.8 四档 weak/moderate/strong
 * + D3.9 burst_suspect + D3.10 burst_cheat/burst_normal）与新桶语义不可比
 * → 断代 null（不冒充映射）；在场新桶 argmax + 桶域校验，未知桶名 throw
 * （漂移防线不因容缺放宽）。
 */
function _stallBurst(answers) {
  const a = answers && answers.stall_burst_wave;
  if (!a || !a.probabilities) return null;
  let best = null;
  for (const [bucket, p] of Object.entries(a.probabilities)) {
    if (best === null || p > best.prob) best = { bucket, prob: p };
  }
  if (STALL_BURST_LEGACY_LEVELS.includes(best.bucket)) return null; // 旧档断代（D3.3-D3.8 四档 + D3.9 burst_suspect + D3.10 burst_cheat/burst_normal）
  if (!STALL_BURST_LEVELS.includes(best.bucket)) {
    throw new Error(`停滞突发波题 stall_burst_wave 未知桶名 '${best.bucket}'（题集/映射漂移——STALL_BURST_LEVELS 须同步）`);
  }
  return { bucket: best.bucket, prob: best.prob };
}

/**
 * Jev answers → 观测记录（现象+强度+档位+数值锚；无 verdict——判定层 D3.5 停产）
 * @param {Object} answers - JevClient.ask 返回的 answers（4 现象 Choice + 观察题
 *   + activity_level 活跃度题 + bundled_trade_dominance 捆绑题；档域/观察题
 *   缺席=旧存档重放兼容 null）
 * @param {Object|null} [anchors] - 代码数值锚
 *   {sameBlockHoldPct, equalBandHoldPct, bundleBuyPct}（D3.1 持仓锚 + G6 簇买入
 *   占比豁免前提锚；缺省/形状异常=缺席）
 * @returns {{phenomena:Object, extLevels:Object, activityLevel:Object|null,
 *   bundledDominance:Object|null, anchors:Object}}
 * @throws {Error} 任一现象题缺失/形状异常/未知桶名；档域题在场但未知桶名
 *   （调用方落 error 行）
 */
function buildObservation(answers, anchors = null) {
  const ph = {};
  for (const id of PHENOMENON_IDS) ph[id] = _phenomenon(answers, id);
  const extPh = {};
  for (const id of EXT_PHENOMENON_IDS) {
    const a = answers && answers[id];
    if (!a || !a.probabilities) { extPh[id] = null; continue; }
    if (id === 'stall_burst_wave') {
      // D3.11 现象二分桶域（none/burst）独立读档：旧档断代值 → null
      const v = _stallBurst(answers);
      extPh[id] = v ? v.bucket : null;
    } else {
      extPh[id] = _phenomenon(answers, id).bucket;
    }
  }
  return {
    // 现象+强度（主观测：Jev 现象题 argmax 档位）
    phenomena: Object.fromEntries(PHENOMENON_IDS.map((id) => [id, ph[id].bucket])),
    extLevels: extPh,
    // 活跃度档位（Jev 直读自判；<D3.5 旧存档缺席=null）
    activityLevel: _activityLevel(answers),
    // 捆绑交易主导度档位（Jev 直读自判；<D3.8 旧存档缺席=null）
    bundledDominance: _bundledDominance(answers),
    // 异常行为占比档位（D3.39 异常行为识别与比例计算；<D3.39 旧档（含
    // D3.35-D3.38 real_participation 期）缺席=null 断代不映射）
    abnormalBehavior: _abnormalBehavior(answers),
    // 代码数值锚（只述数值事实；异常形状缺席不冒充）
    anchors: {
      sameBlockHoldPct: _anchorPct(anchors, 'sameBlockHoldPct'),
      equalBandHoldPct: _anchorPct(anchors, 'equalBandHoldPct'),
      bundleBuyPct: _anchorPct(anchors, 'bundleBuyPct'),
      // D3.28 同块卖→买等额对敲三键（配对数+卖/买占比；无配对→null=轴不适用）
      washPairCount: _anchorPct(anchors, 'washPairCount'),
      washPairSellPct: _anchorPct(anchors, 'washPairSellPct'),
      washPairBuyPct: _anchorPct(anchors, 'washPairBuyPct'),
      // D3.20 单一钱包持仓集中双锚（占总供应量/占在场流通；supply 缺失→null 不冒充）
      top1HoldSupplyPct: _anchorPct(anchors, 'top1HoldSupplyPct'),
      top1HoldCircPct: _anchorPct(anchors, 'top1HoldCircPct'),
      // D3.32 持仓分布锚族（组合垄断：前二/簇合计/并集占总供应量% + 前二首买
      // 相差秒——J 通道 holdings_balance 的数值源；<2 正净持有人/无合格簇/
      // supply 缺失→null=有证据的缺席）
      top2HoldSupplyPct: _anchorPct(anchors, 'top2HoldSupplyPct'),
      top1Top2HoldSupplyPct: _anchorPct(anchors, 'top1Top2HoldSupplyPct'),
      top1Top2FirstBuyGapSec: _anchorPct(anchors, 'top1Top2FirstBuyGapSec'),
      clusterHoldSupplyPct: _anchorPct(anchors, 'clusterHoldSupplyPct'),
      t1PlusClusterSupplyPct: _anchorPct(anchors, 't1PlusClusterSupplyPct'),
      // G8（2026-11-02 批次六）burst 波强度三键（E 通道弱 burst 代码臂同源数值：
      // 最密 5s 滑窗 Σ买/独立钱包数+最长空窗秒；<2 有效 dt 行→null 不冒充）+
      // 零买入纯卖方占比（K/L 通道同源数值：零买入纯卖出钱包合计占全窗总卖 %；
      // 总卖=0→null）——头注见 cheat-snapshot
      burstMaxGapSec: _anchorPct(anchors, 'burstMaxGapSec'),
      burstWaveBuyBnb: _anchorPct(anchors, 'burstWaveBuyBnb'),
      burstWaveWallets: _anchorPct(anchors, 'burstWaveWallets'),
      noBuySellPct: _anchorPct(anchors, 'noBuySellPct'),
      // D3.50 总交易量占比（÷买+卖合计）——insider 题⑤单钱包隐藏筹码豁免的
      // 伤害量级标尺（观察/审计键：L 通道仍消费 noBuySellPct，本键无门侧消费）
      noBuySellVolumePct: _anchorPct(anchors, 'noBuySellVolumePct'),
      // D3.35 协同买入参考四键（abnormal_behavior_ratio 题（D3.39 前 real_participation）
      // 参考数值非门槛：最大单块
      // 买入笔数/占比/与前买块间隔秒 + 最大同档金额钱包去重占比；首买块前摇
      // null=开盘形状证据缺席；无买入 count=0 其余 null）+ 创建者曾持峰值占总
      // 供应量%（holdings_balance 补腿——创建者无 BUY 行 null=链外转入域 swap
      // 不可见，绝不以 0 冒充「从未持有」）
      maxBlockBuyCount: _anchorPct(anchors, 'maxBlockBuyCount'),
      maxBlockBuyPct: _anchorPct(anchors, 'maxBlockBuyPct'),
      maxBlockPreGapSec: _anchorPct(anchors, 'maxBlockPreGapSec'),
      sameAmountWalletPct: _anchorPct(anchors, 'sameAmountWalletPct'),
      creatorPeakHoldSupplyPct: _anchorPct(anchors, 'creatorPeakHoldSupplyPct'),
      // D3.41 簇占在场流通两锚（token 域——holdings_balance 早期盘簇垄断判读：
      // 供应口径开盘窗全员个位数失明，流通口径才有判别力；无合格簇/Σ正净=0→
      // null）+ 簇闭环三键（coordinated_sell_back 跨块闭环判读：同簇 ≥2 成员
      // 同块卖出行占簇买入/全窗总卖 %+去重闭环卖块数；无合格簇→null、有簇零
      // 闭环→0；叙事数组 clusterRoundTrips 不进 observation 仅 state 渲染）
      sameBlockHoldCircPct: _anchorPct(anchors, 'sameBlockHoldCircPct'),
      equalBandHoldCircPct: _anchorPct(anchors, 'equalBandHoldCircPct'),
      clusterRoundTripPct: _anchorPct(anchors, 'clusterRoundTripPct'),
      clusterRoundTripSellPct: _anchorPct(anchors, 'clusterRoundTripSellPct'),
      clusterRoundTripBlocks: _anchorPct(anchors, 'clusterRoundTripBlocks'),
      // D3.51 burst 尖刺两锚（burst_spike_concentration 题同源数值：尖刺买入
      // 占簇买入%/尖刺钱包正净占全窗正净%；dt 缺失/簇内无买/Σ正净=0 → null）
      spikeBuyPctInBurst: _anchorPct(anchors, 'spikeBuyPctInBurst'),
      spikeHoldPctAll: _anchorPct(anchors, 'spikeHoldPctAll'),
      // D3.52 锚窗买卖比（strong_backer_pressure 题判读原料——CD159 强庄币锚
      // 立项**观察期**：grade 零消费，只进 FA 投影/存档攒分布；窗口卖=0 → null
      // 比值不适用）
      anchorBuySellRatio: _anchorPct(anchors, 'anchorBuySellRatio'),
    },
  };
}

module.exports = {
  buildObservation,
  PHENOMENON_IDS,
  EXT_PHENOMENON_IDS,
  LEVEL_ORDER,
  ACTIVITY_LEVELS,
  BUNDLED_LEVELS,
  STALL_BURST_LEVELS,
  ABNORMAL_BEHAVIOR_LEVELS,
};
