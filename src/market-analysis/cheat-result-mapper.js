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
 * - anchors：代码数值锚——持仓占比两键（sb/eq；只述数值事实，非档位判定）
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
 * / insider_supply_sell D3.9）。容缺语义：旧存档（< 各题引入版本）answers 无该键
 * → null 不 throw（重放兼容）；在场答案走 _phenomenon（未知桶名照 throw，漂移
 * 防线不因容缺放宽）。**sbw 例外**：D3.9 起三分类桶域（D3.10 起 burst_cheat），
 * 读档走 _stallBurst——旧档四档值（weak/moderate/strong）与 D3.9 burst_suspect
 * 桶值语义不可比=断代 null。
 */
const EXT_PHENOMENON_IDS = ['stall_burst_wave', 'amount_tiering', 'same_block_buy_wave', 'insider_supply_sell'];

/** 程度档位序（与题集 PHENOMENON_LEVELS 一致；档位比较用） */
const LEVEL_ORDER = { none: 0, weak: 1, moderate: 2, strong: 3 };

/** 活跃度题独立档域（与题集 ACTIVITY_LEVELS 一致；桶域校验用） */
const ACTIVITY_LEVELS = ['low', 'mid', 'high', 'ultra'];

/** 捆绑交易题独立档域（与题集 BUNDLED_LEVELS 一致；D3.8 用户裁定高中低三档） */
const BUNDLED_LEVELS = ['low', 'mid', 'high'];

/** 停滞突发波三分类桶域（与题集 STALL_BURST_LEVELS 一致；D3.10 用户裁定「不要有
 *  什么可疑作弊流量一说，作弊就是作弊，判断不了作弊就是正常」：burst_cheat 直判） */
const STALL_BURST_LEVELS = ['none', 'burst_cheat', 'burst_normal'];

/** sbw 旧档断代清单（none 两域同义保留）：D3.3-D3.8 现象四档值（weak/moderate/
 *  strong）+ D3.9 burst_suspect 桶值（「可疑」中间态已废）——语义不可比=断代 null */
const STALL_BURST_LEGACY_LEVELS = ['weak', 'moderate', 'strong', 'burst_suspect'];

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
 * 停滞突发波题答案读取（D3.10：题 id stall_burst_wave，三分类桶域
 * none/burst_cheat/burst_normal——涌入存在性 × 波内资金形状；「可疑」中间态
 * 已废：判不上作弊形状=正常涌入 fail-normal）。容缺：旧存档（<D3.3）无该键
 * → null；旧档断代值（D3.3-D3.8 四档 weak/moderate/strong + D3.9
 * burst_suspect）与新桶语义不可比 → 断代 null（不冒充映射）；在场新桶
 * argmax + 桶域校验，未知桶名 throw（漂移防线不因容缺放宽）。
 */
function _stallBurst(answers) {
  const a = answers && answers.stall_burst_wave;
  if (!a || !a.probabilities) return null;
  let best = null;
  for (const [bucket, p] of Object.entries(a.probabilities)) {
    if (best === null || p > best.prob) best = { bucket, prob: p };
  }
  if (STALL_BURST_LEGACY_LEVELS.includes(best.bucket)) return null; // 旧档断代（D3.3-D3.8 四档 + D3.9 burst_suspect）
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
 *   {sameBlockHoldPct, equalBandHoldPct}（D3.1 持仓锚；缺省/形状异常=缺席）
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
      // D3.10 三分类桶域（burst_cheat）独立读档：旧档断代值 → null
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
    // 代码数值锚（只述数值事实；异常形状缺席不冒充）
    anchors: {
      sameBlockHoldPct: _anchorPct(anchors, 'sameBlockHoldPct'),
      equalBandHoldPct: _anchorPct(anchors, 'equalBandHoldPct'),
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
};
