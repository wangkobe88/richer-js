/**
 * Jev answers → 阶段结果映射器
 *
 * 全部确定性聚合在本文件完成（原 3 阶段管线的公式原样保留）：
 * - 量级档 S/A/B/C → 40/32/24/12（复用 super-ip-registry 的 TIER_SCORES），D/E 档阻断
 * - 标准类 stage2Total = tierScore + dimension2(0-30) + 时效(0-20)，pass ≥ 60
 * - W 类独立数学：产品(0-35) + 币安交互(0-40) + 时效(0-25) = 100，pass ≥ 60
 * - 最终 = round(stage2Total×0.6, 2) + 关联分 + 质量分，≥70 high / ≥50 mid / else low
 * - Stage3 截断顺序：品牌劫持 → 无背景拼写错误 → 关联≤10 → 质量≤4
 * - reason 为代码端模板拼接（Jev 不生成文本，已裁定接受损失）
 *
 * 输出形状与 NarrativeAnalyzer 旧流程的 stageXDataToSave 完全一致（旧格式），
 * 经 buildStageSaveData 零改动转换为五列存储契约（{stage}_result/_prompt/_raw_output）。
 */

import { TIER_SCORES } from '../prompts/super-ip/super-ip-registry.mjs';
import { JEV_QUESTIONS_VERSION } from './jev-questions.mjs';

/** 量级 6 档（与 jev-questions event_magnitude criteria 顺序一致） */
const MAGNITUDE_TIERS = ['E', 'D', 'C', 'B', 'A', 'S'];

/** 时效 6 档 → 分数（标准类 / W 类各自一张表，与原 prompt 逐档对齐） */
const TIMING_SCORES_STANDARD = {
  within_7d: 15, within_30d: 10, older: 0,
  expected_within_30d: 10, expected_beyond_30d: 5, unknown: 0,
};
const TIMING_SCORES_W = {
  within_7d: 25, within_30d: 15, older: 0,
  expected_within_30d: 15, expected_beyond_30d: 0, unknown: 0,
};

/** dimension2 六带边界（与 jev-questions dimension2 criteria 一致） */
const DIM2_BANDS = [[0, 4], [5, 9], [10, 14], [15, 19], [20, 24], [25, 30]];
const W_PRODUCT_BANDS = [[0, 8], [9, 17], [18, 26], [27, 35]];
const W_INTERACTION_BANDS = [[0, 9], [10, 19], [20, 29], [30, 40]];
const SPELLING_BANDS = [[0, 1], [2, 3], [4, 5], [6, 7]];
const REASONABILITY_BANDS = [[0, 1], [2, 3], [4, 5]];

/** 关联分查表：[type][levelIdx 0-4]（levelIdx = round(relevance_level.score)） */
const RELEVANCE_TABLE = {
  exact_match:      [20, 20, 20, 20, 20],
  translation_match: [18, 18, 18, 18, 18],
  abbreviation_alias: [16, 16, 17, 18, 18],
  semantic:          [8, 10, 12, 15, 15],
  cultural:          [1, 5, 10, 14, 15],
  generic_concept:   [2, 4, 6, 7, 7],
  none:              [0, 1, 2, 2, 2],
};

/** block_reason 选项 → 中文标签（reason 模板用） */
const BLOCK_LABELS = {
  none: '无阻断',
  subject_unqualified: '主体资格不足',
  niche_subculture: '小圈子亚文化',
  empty_content: '空洞内容',
  institution_routine: '机构日常运营',
  low_quality_derivative: '低质衍生',
  marketing_gimmick: '营销噱头',
  baseless_speculation: '无据猜测',
  ip_reuse: 'IP二次利用',
  regional_event: '地区性事件',
};

/**
 * 阻断选项的类别作用域（与原各类 Stage2 prompt 的阻断条件集合对齐）：
 * - A 类（形象化IP）：主体资格不足/小圈子亚文化/低质衍生(简单替换拼贴/抄袭)/IP二次利用
 * - W/B 类：营销噱头/标题党（旧管线仅此两类设此项，校准实证设为通用会误伤 E/C 类热点推文）
 * - C/D 类：机构日常运营
 * - G 类：无据猜测
 * - E 类：地区性事件
 * - 通用（各类均设）：空洞内容
 * Jev 在不知类别的情况下作答（speculative fan-out），代码端按分类结果
 * 条件采信——scope 外的 choice 不构成阻断（如 E 类蹭热点命名代币不算低质衍生）。
 */
const BLOCK_SCOPE = {
  empty_content: 'all',
  marketing_gimmick: ['W', 'B'],
  subject_unqualified: ['A'],
  niche_subculture: ['A'],
  low_quality_derivative: ['A'],
  ip_reuse: ['A'],
  baseless_speculation: ['G'],
  institution_routine: ['C', 'D'],
  regional_event: ['E'],
};

/**
 * 阻断选项是否在该类别下生效
 * @param {string} choice - block_reason 的 choice（≠'none'）
 * @param {string|null} category - event_category 的 choice
 * @returns {boolean}
 */
function blockInScope(choice, category) {
  const scope = BLOCK_SCOPE[choice];
  if (scope === undefined) return true; // 未知选项按通用处理（问题集与表需同步维护）
  return scope === 'all' || (Array.isArray(scope) && category != null && scope.includes(category));
}

const round2 = (x) => Math.round(x * 100) / 100;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * Score 带内线性插值：score=i+f → 第 i 带内 lo+f*(hi-lo)
 * @param {number} score - Jev Score 原始值（0 ~ bands.length）
 * @param {Array<[number,number]>} bands - 有序带边界
 * @returns {number} 插值后的分
 */
function bandInterpolate(score, bands) {
  const idx = clamp(Math.floor(score), 0, bands.length - 1);
  const frac = clamp(score - Math.floor(score), 0, 1);
  const [lo, hi] = bands[idx];
  return round2(lo + frac * (hi - lo));
}

/**
 * 量级档位：score 四舍五入到最近档
 * @returns {string} 'E'|'D'|'C'|'B'|'A'|'S'
 */
function magnitudeTier(score) {
  return MAGNITUDE_TIERS[clamp(Math.round(score), 0, MAGNITUDE_TIERS.length - 1)];
}

/**
 * 质量长度分（确定性表，原 Stage3 2.1 节）
 * 中文：1-3字8分，4-6字5-7分，7-10字2-4分，>10字0-1分
 * 英文：1词8分，2-3词5-7分，4词2-4分，>4词0-1分
 */
export function qualityLengthScore(symbol) {
  if (!symbol) return 0;
  const cjkCount = [...symbol].filter(c => {
    const code = c.codePointAt(0);
    return code >= 0x4E00 && code <= 0x9FFF;
  }).length;
  if (cjkCount > 0) {
    if (cjkCount <= 3) return 8;
    if (cjkCount <= 6) return 6;   // 5-7 带中值
    if (cjkCount <= 10) return 3;  // 2-4 带中值
    return 0;                       // 0-1
  }
  const words = symbol.split(/[^a-zA-Z]+/).filter(Boolean).length;
  if (words <= 1) return 8;
  if (words <= 3) return 6;
  if (words === 4) return 3;
  return 0;
}

/** 从 answers 提取关联分 */
function relevanceFrom(answers) {
  const type = answers.relevance_type?.choice || 'none';
  const levelIdx = clamp(Math.round(answers.relevance_level?.score ?? 0), 0, 4);
  const table = RELEVANCE_TABLE[type] || RELEVANCE_TABLE.none;
  return { type, levelIdx, score: table[levelIdx] };
}

/** 从 answers 提取质量三项（长度代码算） */
function qualityFrom(answers, symbol) {
  const length = qualityLengthScore(symbol);
  const spelling = bandInterpolate(answers.quality_spelling?.score ?? 0, SPELLING_BANDS);
  const reasonability = bandInterpolate(answers.quality_reasonability?.score ?? 0, REASONABILITY_BANDS);
  return { length, spelling, reasonability, total: round2(length + spelling + reasonability) };
}

/** 组装三个 stage 共用的调用元数据（prompt 列存储内容） */
function buildCallPromptMeta(questions, stateStats) {
  return JSON.stringify({
    engine: 'jev',
    questionsVersion: JEV_QUESTIONS_VERSION,
    questionIds: Object.keys(questions),
    stateStats,
  });
}

/**
 * 主路径（原 3 阶段管线）映射
 * @param {Object} answers - JevClient 返回的 answers
 * @param {Object} context
 * @param {Object} context.tokenData - 代币数据
 * @param {boolean} context.includeBrandHijack - 品牌劫持预检是否命中（问题是否存在）
 * @param {Object} context.callInfo - {model, questions, stateStats, usage, startedAt, finishedAt}
 * @param {Object|null} [context.tweetClassification] - 推文预分类
 * @returns {Object} { stage1DataToSave, stage2DataToSave, stage3DataToSave,
 *                     stageFinalData, llmResult, promptType, jevDetails }
 */
export function mapStandardAnswers(answers, context) {
  const { tokenData, includeBrandHijack = false, callInfo, tweetClassification = null } = context;
  const symbol = tokenData.symbol || '';
  const promptMeta = buildCallPromptMeta(callInfo.questions, callInfo.stateStats);
  const rawOutput = JSON.stringify({ answers, usage: callInfo.usage });
  const baseFields = {
    model: callInfo.model,
    prompt: promptMeta,
    raw_output: rawOutput,
    started_at: callInfo.startedAt,
    finished_at: callInfo.finishedAt,
    success: true,
    error: null,
  };

  // ── Stage1：分类（无阻断语义）──────────────────────────────────────
  const category = answers.event_category?.choice || null;
  const magnitude = answers.event_magnitude?.score ?? 0;
  const tier = magnitudeTier(magnitude);
  const timing = answers.event_timing?.choice || 'unknown';
  const dim2 = bandInterpolate(answers.dimension2?.score ?? 0, DIM2_BANDS);
  const blockChoice = answers.block_reason?.choice || 'none';
  const blockProb = answers.block_reason?.probabilities?.[blockChoice];
  // 原 prompt 语义是"命中任一阻断条件即阻断"（二值）。Choice 摊成 10 路分布后
  // 9 个阻断项共享概率质量，argmax≠none 过易触发（dry-run 实证：P=0.43 即阻断）。
  // 忠实转译：P(none)≥0.5 才视为无阻断。
  const noneProb = answers.block_reason?.probabilities?.none ?? 0;

  const stage1DataToSave = {
    category,
    ...baseFields,
    parsed_output: {
      pass: true,
      eventClassification: category ? { primaryCategory: category } : null,
      eventDescription: null, // Jev 不生成文本，叙事细节由 details 概率承载
      jev: {
        tweetType: tweetClassification?.type || null,
        magnitudeTier: tier,
        timing,
        blockChoice,
        probabilities: {
          event_category: answers.event_category?.probabilities,
          event_magnitude: answers.event_magnitude?.probabilities,
          block_reason: answers.block_reason?.probabilities,
        },
      },
    },
  };

  // ── Stage2：阻断 + 事件分 ──────────────────────────────────────────
  const isW = category === 'W';
  let stage2Blocked = false;
  let stage2BlockReason = null;
  let tierScore = 0;
  let timeliness = 0;
  let stage2Total = null;
  let wProduct = null;
  let wInteraction = null;
  let stage2Reason = null;

  if (blockChoice !== 'none' && noneProb < 0.5 && blockInScope(blockChoice, category)) {
    stage2Blocked = true;
    stage2BlockReason = BLOCK_LABELS[blockChoice] || blockChoice;
  } else if (!isW && (tier === 'E' || tier === 'D')) {
    // 量级 D/E 档：主体量级不足，直接阻断（原各类 prompt 的 D/E 处理）
    stage2Blocked = true;
    stage2BlockReason = `事件主体量级不足（${tier}档）`;
  } else if (isW) {
    wProduct = bandInterpolate(answers.w_product_score?.score ?? 0, W_PRODUCT_BANDS);
    wInteraction = bandInterpolate(answers.w_binance_interaction?.score ?? 0, W_INTERACTION_BANDS);
    timeliness = TIMING_SCORES_W[timing] ?? 0;
    stage2Total = round2(wProduct + wInteraction + timeliness);
    stage2Blocked = stage2Total < 60;
    stage2Reason = `W类 产品${wProduct}+交互${wInteraction}+时效${timeliness}=${stage2Total}（pass线60）`;
    if (stage2Blocked) stage2BlockReason = `W类总分不足（${stage2Total}<60）`;
  } else {
    tierScore = TIER_SCORES[tier] || 0;
    timeliness = TIMING_SCORES_STANDARD[timing] ?? 0;
    stage2Total = round2(tierScore + dim2 + timeliness);
    stage2Blocked = stage2Total < 60;
    stage2Reason = `事件分${tierScore}(${tier}档)+传播${dim2}+时效${timeliness}=${stage2Total}（pass线60）`;
    if (stage2Blocked) stage2BlockReason = `事件分不足（${stage2Total}<60）`;
  }

  const stage2DataToSave = {
    category: stage2Blocked ? 'low' : (isW ? 'W' : category),
    ...baseFields,
    parsed_output: {
      pass: !stage2Blocked,
      blockReason: stage2Blocked ? stage2BlockReason : null,
      scoringResult: {
        category: isW ? 'W' : category,
        totalScore: stage2Total,
        tierScore: isW ? null : tierScore,
        dimension2: isW ? null : dim2,
        timeliness,
        wProductScore: isW ? wProduct : null,
        wInteractionScore: isW ? wInteraction : null,
      },
      reason: stage2Reason,
      jev: {
        magnitudeTier: tier,
        blockChoice,
        blockProbability: blockProb ?? null,
        timing,
        probabilities: {
          event_timing: answers.event_timing?.probabilities,
          dimension2: answers.dimension2?.probabilities,
          w_product_score: answers.w_product_score?.probabilities,
          w_binance_interaction: answers.w_binance_interaction?.probabilities,
        },
      },
    },
  };

  // ── Stage3：截断检查 + 关联/质量 ───────────────────────────────────
  const relevance = relevanceFrom(answers);
  const quality = qualityFrom(answers, symbol);
  const brandHijackP = includeBrandHijack ? (answers.brand_hijack?.noul ?? 0) : 0;
  const misspellingP = answers.block_misspelling?.noul ?? 0;

  let stage3Blocked = false;
  let stage3BlockReason = null;
  if (brandHijackP >= 0.5) {
    stage3Blocked = true;
    stage3BlockReason = '品牌劫持';
  } else if (misspellingP >= 0.5) {
    stage3Blocked = true;
    stage3BlockReason = '无背景拼写错误';
  } else if (relevance.score <= 10) {
    stage3Blocked = true;
    stage3BlockReason = `关联性不足（${relevance.score}分/${relevance.type}）`;
  } else if (quality.total <= 4) {
    stage3Blocked = true;
    stage3BlockReason = `代币质量过低（${quality.total}分）`;
  }

  let aggregatedCategory;
  let aggregatedTotalScore = null;
  let eventScore = null;

  if (stage2Blocked || stage3Blocked) {
    aggregatedCategory = 'low';
  } else {
    eventScore = round2(stage2Total * 0.6);
    aggregatedTotalScore = round2(eventScore + relevance.score + quality.total);
    aggregatedCategory = aggregatedTotalScore >= 70 ? 'high'
      : aggregatedTotalScore >= 50 ? 'mid' : 'low';
  }

  const finalReason = stage2Blocked
    ? `阻断:${stage2BlockReason}｜P=${blockProb ?? '-'}`
    : stage3Blocked
      ? `截断:${stage3BlockReason}｜品牌劫持P=${round2(brandHijackP)} 拼写P=${round2(misspellingP)}`
      : `事件分${eventScore}(${stage2Total}×0.6)｜关联${relevance.score}(${relevance.type}/lv${relevance.levelIdx})｜质量${quality.total}(长${quality.length}+拼${quality.spelling}+合${quality.reasonability})｜总分${aggregatedTotalScore}→${aggregatedCategory}`;

  const stage3DataToSave = stage2Blocked
    ? { __clear: true }  // 对齐原流程：Stage2 未通过 → Stage3 被跳过，清旧数据
    : {
        category: aggregatedCategory,
        ...baseFields,
        parsed_output: {
          pass: !stage3Blocked,
          blockReason: stage3Blocked ? stage3BlockReason : null,
          relevanceScore: relevance.score,
          qualityScore: quality.total,
          total_score: aggregatedTotalScore,
          category_agg: aggregatedCategory,
          breakdown: {
            length: quality.length,
            spelling: quality.spelling,
            reasonability: quality.reasonability,
          },
          jev: {
            relevanceType: relevance.type,
            relevanceLevelIdx: relevance.levelIdx,
            brandHijackP: includeBrandHijack ? brandHijackP : null,
            misspellingP,
            probabilities: {
              relevance_type: answers.relevance_type?.probabilities,
              relevance_level: answers.relevance_level?.probabilities,
              block_misspelling: answers.block_misspelling?.probabilities,
              ...(includeBrandHijack ? { brand_hijack: answers.brand_hijack } : {}),
            },
          },
        },
      };

  const stageFinalData = {
    category: aggregatedCategory,
    totalScore: aggregatedTotalScore,
    eventScore,
    relevanceScore: stage2Blocked ? null : relevance.score,
    qualityScore: stage2Blocked ? null : quality.total,
    eventWeight: 0.6,
    stage2TotalScore: stage2Total,
    blockReason: stage2Blocked ? stage2BlockReason : (stage3Blocked ? stage3BlockReason : null),
  };

  const llmResult = stage2Blocked
    ? {
        rating: 'low',
        reason: finalReason,
        score: stage2Total,
        pass: false,
        analysis_stage: 2,
      }
    : {
        rating: aggregatedCategory,
        reason: finalReason,
        score: aggregatedTotalScore,
        pass: true,
        analysis_stage: 3,
      };

  const promptType = `jev(${JEV_QUESTIONS_VERSION}/${category || '?'}类${isW ? '-W数学' : ''})`;

  return {
    stage1DataToSave,
    stage2DataToSave,
    stage3DataToSave,
    stageFinalData,
    llmResult,
    promptType,
    jevDetails: { tier, timing, dim2, relevance, quality, brandHijackP, misspellingP },
  };
}

/**
 * superIP 快速通道映射（原 fast track 单次 LLM 的等价物）
 *
 * 与主路径的差异：
 * - 量级分不用 event_magnitude（注册表 tier 已确定：S40/A32）
 * - 时效分不用 event_timing（代码端 calculateTimeliness 已算）
 * - W 类两题不采信（superIP 是 C/D 类事件）
 * - 结果写 prestage（category='super_ip_fast'），stage1/2/3 全 __clear
 *
 * @param {Object} answers - JevClient answers（与主路径同一问题集）
 * @param {Object} context
 * @param {Object} context.superIPInfo - 注册表命中信息 {name, type, tier, desc}
 * @param {Object} context.preScores - {tierScore, timeliness, baseEventScore}
 * @param {string} context.symbol - 代币 Symbol（质量长度分用）
 * @param {boolean} [context.includeBrandHijack] - 品牌劫持预检是否命中
 * @param {Object} context.callInfo - 同 mapStandardAnswers
 * @returns {Object} { prestageDataToSave, stageFinalData, llmResult, promptType }
 */
export function mapSuperIPAnswers(answers, context) {
  const { superIPInfo, preScores, callInfo } = context;
  const promptMeta = buildCallPromptMeta(callInfo.questions, callInfo.stateStats);
  const rawOutput = JSON.stringify({ answers, usage: callInfo.usage });

  const blockChoice = answers.block_reason?.choice || 'none';
  const blockProb = answers.block_reason?.probabilities?.[blockChoice];
  const noneProb = answers.block_reason?.probabilities?.none ?? 0;
  const dim2 = bandInterpolate(answers.dimension2?.score ?? 0, DIM2_BANDS);

  // superIP 阻断：注册表账号的日常闲聊（如 S 级人物发纯问候）没有叙事价值
  // （阻断门槛与主路径一致：P(none)≥0.5 才放行；作用域按注册表 type → C/D 类）
  // 例外：institution_routine 对注册表账号豁免——旧 fast track 语义是
  // "S/A 级账号的实质内容推文不算日常运营"（校准实证：币安中文/BNB Chain 的
  // 实质内容推被 P=0.02-0.09 的日常运营误阻断）
  const superIPCategory = superIPInfo.type === 'person' ? 'C' : 'D';
  const blocked = blockChoice !== 'none' && blockChoice !== 'institution_routine'
    && noneProb < 0.5 && blockInScope(blockChoice, superIPCategory);

  const prestageDataToSave = {
    category: 'super_ip_fast',
    model: callInfo.model,
    prompt: promptMeta,
    raw_output: rawOutput,
    parsed_output: {
      pass: !blocked,
      blockReason: blocked ? (BLOCK_LABELS[blockChoice] || blockChoice) : null,
      dimension2Score: dim2,
      ipInfo: superIPInfo,
      tierScore: preScores.tierScore,
      timeliness: preScores.timeliness,
      baseEventScore: preScores.baseEventScore,
      jev: {
        blockChoice,
        blockProbability: blockProb ?? null,
        probabilities: {
          dimension2: answers.dimension2?.probabilities,
          block_reason: answers.block_reason?.probabilities,
        },
      },
    },
    started_at: callInfo.startedAt,
    finished_at: callInfo.finishedAt,
    success: true,
    error: null,
  };

  let stageFinalData = null;
  let llmResult;

  if (blocked) {
    llmResult = {
      rating: 'low',
      reason: `阻断:${BLOCK_LABELS[blockChoice] || blockChoice}｜P=${blockProb ?? '-'}`,
      score: null,
      pass: false,
    };
  } else {
    // 原 fast track 聚合公式：eventTotal = baseEventScore + dimension2
    const eventTotal = round2(preScores.baseEventScore + dim2);
    const eventWeighted = round2(eventTotal * 0.6);
    const relevance = relevanceFrom(answers);
    const quality = qualityFrom(answers, context.symbol || '');

    // superIP 同样做 Stage3 截断检查（品牌劫持/拼写/关联/质量）
    const brandHijackP = context.includeBrandHijack ? (answers.brand_hijack?.noul ?? 0) : 0;
    const misspellingP = answers.block_misspelling?.noul ?? 0;
    let truncated = false;
    let truncateReason = null;
    if (brandHijackP >= 0.5) { truncated = true; truncateReason = '品牌劫持'; }
    else if (misspellingP >= 0.5) { truncated = true; truncateReason = '无背景拼写错误'; }
    else if (relevance.score <= 10) { truncated = true; truncateReason = `关联性不足（${relevance.score}分）`; }
    else if (quality.total <= 4) { truncated = true; truncateReason = `代币质量过低（${quality.total}分）`; }

    if (truncated) {
      llmResult = {
        rating: 'low',
        reason: `截断:${truncateReason}｜事件分${eventWeighted}(${eventTotal}×0.6)`,
        score: null,
        pass: false,
      };
      stageFinalData = {
        category: 'low',
        totalScore: null,
        eventScore: eventWeighted,
        relevanceScore: relevance.score,
        qualityScore: quality.total,
        eventWeight: 0.6,
        stage2TotalScore: eventTotal,
        blockReason: truncateReason,
      };
    } else {
      const totalScore = round2(eventWeighted + relevance.score + quality.total);
      const rating = totalScore >= 70 ? 'high' : totalScore >= 50 ? 'mid' : 'low';
      llmResult = {
        rating,
        reason: `事件分${eventWeighted}(${eventTotal}×0.6:${preScores.tierScore}+时效${preScores.timeliness}+传播${dim2})｜关联${relevance.score}(${relevance.type})｜质量${quality.total}｜总分${totalScore}→${rating}`,
        score: totalScore,
        pass: true,
      };
      stageFinalData = {
        category: rating,
        totalScore,
        eventScore: eventWeighted,
        relevanceScore: relevance.score,
        qualityScore: quality.total,
        eventWeight: 0.6,
        stage2TotalScore: eventTotal,
        blockReason: null,
      };
    }
  }

  const promptType = `super_ip_fast(${superIPInfo.name}/${superIPInfo.tier}级/jev-${JEV_QUESTIONS_VERSION})`;

  return {
    prestageDataToSave,
    stage1DataToSave: { __clear: true },
    stage2DataToSave: { __clear: true },
    stage3DataToSave: { __clear: true },
    stageFinalData,
    llmResult,
    promptType,
  };
}
