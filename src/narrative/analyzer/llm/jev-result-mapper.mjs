/**
 * Jev answers → 阶段结果映射器
 *
 * 全部确定性聚合在本文件完成（原 3 阶段管线的公式原样保留）：
 * - 量级档 S/A/B/C → 39/34/27/22（MAGNITUDE_TIER_SCORES，108 样本校准定参），D/E 档阻断
 * - 标准类 stage2Total = tierScore + dimension2(0-30) + 时效(0-20)，pass ≥ 60
 * - W 类独立数学：产品(0-35) + 币安交互(0-40) + 时效(0-25) = 100，pass ≥ 60
 * - 最终 = round(stage2Total×0.6, 2) + 关联分 + 质量分，≥70 high / ≥50 mid / else low
 * - Stage3 截断顺序：品牌劫持 → 无背景拼写错误 → 关联≤10 → 质量≤4
 * - reason 为代码端模板拼接（Jev 不生成文本，已裁定接受损失）
 *
 * 输出形状与 NarrativeAnalyzer 旧流程的 stageXDataToSave 完全一致（旧格式），
 * 经 buildStageSaveData 零改动转换为五列存储契约（{stage}_result/_prompt/_raw_output）。
 */

import { JEV_QUESTIONS_VERSION } from './jev-questions.mjs';

/** 量级 6 档（与 jev-questions event_magnitude criteria 顺序一致） */
const MAGNITUDE_TIERS = ['E', 'D', 'C', 'B', 'A', 'S'];

/**
 * 主路径量级档 → 分（108 样本校准定参，2026-09-20）：
 * 按条件期望 E[旧tier分|Jev档]（S 38.8/A 33.9/B 27.3，n=91）取整；
 * C 档从期望 26.8 下调至 22——Jev 的 C 档混有旧 B/A 样本（期望被拉高），
 * 但"C 档主体难过 pass 线"是旧管线核心语义（C22+dim2均值21.5+时效15=58.5<60）。
 * D/E 档不进表：维持主体量级不足阻断。
 * superIP 路径不用此表（注册表 tier 可信，走 TIER_SCORES 预评分）。
 */
const MAGNITUDE_TIER_SCORES = { S: 39, A: 34, B: 27, C: 22 };

/** 时效 6 档 → 分数（标准类 / W 类各自一张表，与原 prompt 逐档对齐） */
const TIMING_SCORES_STANDARD = {
  within_7d: 15, within_30d: 10, older: 0,
  expected_within_30d: 10, expected_beyond_30d: 5, unknown: 0,
};
const TIMING_SCORES_W = {
  within_7d: 25, within_30d: 15, older: 0,
  expected_within_30d: 15, expected_beyond_30d: 0, unknown: 0,
};

/**
 * dimension2 校准带（108 样本远程校准定参，2026-09-20）：
 * Jev 档位与旧 LLM 维度二分几乎不相关（旧量表 P25=18/P50=22/P75=25，近似恒 20-25
 * 的宽松输出），故按分布分位匹配而非逐点拟合——Jev 档 1-4 累计占比 29%/58%/86%/100%
 * ↔ 旧分位 15.5/22.5/26/29，映射后均值 21.5 ≈ 旧均值 21.1。
 * 带语义（与 jev-questions dimension2 criteria 的六档对应）：
 * 无[0,10] / 微弱[10,20] / 小[18,26] / 中[23,28] / 强[26,30] / 极强[28,30]
 */
const DIM2_BANDS = [[0, 10], [10, 20], [18, 26], [23, 28], [26, 30], [28, 30]];
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
  negative_hard_news: '负面硬新闻事件',
};

/**
 * name_referent 阻断（J1.10，2026-09-23 用户裁定：截词/截名发币要成立，名字的主人
 * 得是超级 IP——被超级IP/大V提到≠名字本身有生命力）：
 * - minor_other：名字指向事件中被提到/@到/点评到的无名对象（周边小号/小公司/纠纷
 *   对象等）——YAYA（何一推文@的周边账号）、OneKey（Flork 纠纷文中的失败会展）
 * - common_word：名字取自非超级IP文本中的普通词——CONVICTION（133万粉 KOL 推文截词）
 * - notable_other：名字指向知名但非超级IP（十万粉级 KOL/行业知名公司）——同样不构成
 *   名字的独立生命力（CONVICTION 案即 133 万粉 KOL 推文截词，知名≠超级IP，不放行）
 * - super_ip（CZ 原话"not a genius"→天才）/subject_self（嫦娥：作者自创）放行
 * 作用域同截词语义：C/D/F/G + **B（2026-09-24 Muse 案补入）** + **W（2026-09-25
 * ChainPulse 案补入，用户裁定「被骑对象的热度还是远远不够的，如果是超大超火的
 * 产品被骑，那没问题。但现在就是一个几千粉的用户，发了个1赞的产品介绍，被骑
 * 肯定不行的」）**：
 * - B 类：币名指向的产品/对象不是超级 IP（Muse 桌面版 0xc313：minor_other 0.32+
 *   notable_other 0.31 阻断侧合计 0.66；用户定性「只是版本更新功能改进，影响力
 *   不够」——版本更新语义在 block_reason 题面不可判，实判 none 0.98，但无论事件
 *   性质如何，骑乘非超级 IP 的产品名本身无独立生命力，由本维度拦）
 * - W 类：第三方骑乘文章/事件中的**无名构想**发币（ChainPulse 0x1fc2：3886粉
 *   1赞推文链 Article 全文不可获取，标题构想的 agent 名被第三方发币，蹭 BNB
 *   Agent Studio v4 发版；W 数学交互分 18.1 被「BNB Chain」字样喂成生态热度档、
 *   产品分 18 对标题党创意无实体约束 → 61.1 压线过；阻断侧 0.68 拦）。W 数学的
 *   交互分存在语义错位——被骑对象火反而给骑乘盘加分，与 C7「骑乘盘要求被骑
 *   产品影响力极高才放」矛盾，由名字维度补此门；super_ip≥0.5（超大超火被骑）
 *   仍在放行侧豁免，真自发盘 subject_self 高不受影响
 * - 主体自己的作品名（B/C）走骑乘改道（rideDetourBelow，放行侧语义）。E 类热点
 *   命名先例不拦；A 类不适用
 */
const NAME_REFERENT_BLOCK_LABELS = {
  minor_other: '名字指向无名对象',
  common_word: '截词（非超级IP话中词）',
  notable_other: '名字指向知名但非超级IP',
};
const NAME_REFERENT_BLOCK_SCOPE = ['C', 'D', 'F', 'G', 'B', 'W'];

/**
 * 阻断选项的类别作用域（与原各类 Stage2 prompt 的阻断条件集合对齐）：
 * - A 类（形象化IP）：主体资格不足/小圈子亚文化/低质衍生(简单替换拼贴/抄袭)/IP二次利用
 * - W/B 类：营销噱头/标题党（旧管线仅此两类设此项，校准实证设为通用会误伤 E/C 类热点推文）
 * - C/D 类：机构日常运营
 * - G 类：无据猜测
 * - E 类：地区性事件
 * - A/C/D/F/G 类：主体资格不足（J1.9 扩：小主体事件原本靠"事件分<60"下限拦截，但
 *   Jev 量级打分在 C/B 边界会漂移（OneKey 语料A：257 粉小号时过时不过），此档
 *   兜底为确定性阻断。E 类不设——热点主体按归因规则是热点主角而非搬运小号）
 * - 通用（各类均设）：空洞内容
 * Jev 在不知类别的情况下作答（speculative fan-out），代码端按分类结果
 * 条件采信——scope 外的 choice 不构成阻断（如 E 类蹭热点命名代币不算低质衍生）。
 */
const BLOCK_SCOPE = {
  empty_content: 'all',
  marketing_gimmick: ['W', 'B'],
  subject_unqualified: ['A', 'C', 'D', 'F', 'G'],
  niche_subculture: ['A'],
  low_quality_derivative: ['A'],
  ip_reuse: ['A'],
  baseless_speculation: ['G'],
  institution_routine: ['C', 'D'],
  regional_event: ['E'],
  // J1.11（2026-09-26 用户裁定，C9 bitget被盗案）：负面事故（被盗/暴雷）+纯硬新闻
  // 的事件无 meme 价值，全域拦截——事件热度高≠该放（A 档量级喂饱事件分 74.65、
  // 80.32 high 放行后 -55%）。质量门 negativeHardNewsBlock 同步双挂（argmax 五五开
  // 抖动时概率门兜底），二者任一命中即拦
  negative_hard_news: 'all',
};

/**
 * name_referent 是否在该类别下构成阻断（独立作用域表，语义同 blockInScope）。
 * 返回 {label, mass} 或 null。label 取阻断侧三项中概率最大者的标签，mass 为三项合计。
 * 门槛用阻断侧合计概率（minor_other+common_word+notable_other ≥ 0.5）而非 argmax 单项：
 * Jev 在 YAYA 案上 subject_self/minor_other 五五开（0.43/0.41，argmax 跨 run 抖动），
 * 合并阻断侧质量后 0.55 稳定过半。放行侧（super_ip/subject_self/none_related）不累计
 * （B/C 类例外：subject_self 质量触发骑乘改道，见 rideDetourBelow）。
 */
function nameReferentBlock(answers, category) {
  if (category == null || !NAME_REFERENT_BLOCK_SCOPE.includes(category)) return null;
  const probs = answers?.name_referent?.probabilities;
  if (!probs) return null;
  let mass = 0;
  let bestKey = 'minor_other';
  let bestP = -1;
  for (const k of Object.keys(NAME_REFERENT_BLOCK_LABELS)) {
    const p = probs[k] ?? 0;
    mass += p;
    if (p > bestP) { bestP = p; bestKey = k; }
  }
  if (mass < 0.5) return null;
  return { label: NAME_REFERENT_BLOCK_LABELS[bestKey], mass: Math.round(mass * 100) / 100 };
}

/**
 * 负面硬新闻质量门（J1.11，2026-09-26 用户裁定，C9 bitget被盗案 0x0e323198：
 * 蹭 Bitget 热钱包被盗 3.516 亿官方公告命名，D 类 + A 档量级直接喂饱事件分 74.65
 * → 80.32 high 放行后 -55%。裁定原文「第一，这是一个负面事件；第二，它没有啥
 * meme的」——安全事故/被盗/被黑/暴雷/巨额损失类负面事件无 meme 化玩味空间
 * （主体是机构不自嘲、无梗无二创），蹭其命名只是消费热度，热度再高也不该放）。
 *
 * 与 argmax 机制（BLOCK_SCOPE 'all'）双挂：argmax 命中 negative_hard_news 且
 * noneProb<0.5 拦；本门按概率 ≥0.5 独立拦（覆盖 negative 是 argmax 但 none 恰
 * ≥0.5、或边界抖动 none/negative 五五开时 mass 仍过半的情况）。二者任一命中
 * 即拦，全域（不限类别）、标准 + superIP 双路径。
 */
function negativeHardNewsBlock(answers) {
  const p = answers?.block_reason?.probabilities?.negative_hard_news ?? 0;
  if (p < 0.5) return null;
  return { label: BLOCK_LABELS.negative_hard_news, mass: Math.round(p * 100) / 100 };
}

/**
 * 骑乘改道（C8，2026-09-24 用户裁定）：项目制作者自己发币通过没问题（路由层
 * detectIssuerSelfLaunch 命中 → prestage，C7 方案 A）；**第三方骑乘**推文主体的
 * 作品/产品名发币，产品的分量就远远不足——不得按「主体=作者影响力」的标准分放行，
 * 改道 W 数学：要求被骑产品本身影响力极高（宝玉 demo 级被拦）。
 *
 * 判定（纯代码市场事实，无 LLM 新题）：
 * - 作用域 B+C：作品发布（B）与账号动态（C）在「作者展示自己的东西」语料上同构，
 *   event_category 在 B/C 边界跨 run 抖动（桃花源记两次 run：B 0.52/C 0.45 →
 *   B 0.41/C 0.56），只挂 B 会被抖到 C 绕过。C7 路由优先于本门不受影响。
 * - 触发：subject_self+super_ip 合计 ≥ 0.5（币名=推文主体自己的东西；合并质量
 *   对抗跨 run 抖动，语义同 nameReferentBlock 阻断侧合计）且 **super_ip 单项 < 0.5**
 *   ——super_ip 过半 = 名字的主人本身就是超级 IP（天才 0.97/嫦娥 0.65-0.7），
 *   J1.10 放行侧语义直接豁免；B 类下同构覆盖「超级牛产品骑乘可放」（用户裁定
 *   「如果是超级牛有巨大影响的产品发布那可能可以」）。
 * - D/F/E/G 不入域：无实证 case，D/F 全量行已是 low 零增益，E 热点命名先例不拦
 *   （语义同 NAME_REFERENT_BLOCK_SCOPE 的取舍）。
 *
 * 已知模糊区（C7 同源，接受）：到达标准路径的 B/C+subject_self 必是 detector
 * 不命中——真骑乘盘，或 handle 与币名无包含的漏检自发盘（语料层无法证明钱包归属）。
 * 误伤方向=漏检自发盘按产品分评（偏低）；detector 正向命中优先转 prestage 不受影响。
 */
function rideDetourBelow(answers, category) {
  if (category !== 'B' && category !== 'C') return null;
  const probs = answers?.name_referent?.probabilities;
  if (!probs) return null;
  const ss = probs.subject_self ?? 0;
  const sip = probs.super_ip ?? 0;
  if (sip >= 0.5) return null; // 名字主人=超级 IP：豁免（天才/嫦娥/超级牛产品）
  const mass = ss + sip;
  return mass >= 0.5 ? Math.round(mass * 100) / 100 : null;
}

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

/**
 * 组装三个 stage 共用的调用元数据（prompt 列存储内容）
 * full=true 携带 state（语料全文）+ questions（问题集全文）——Jev 单次调用的完整 prompt，
 * 落库供页面回放展示；full=false 为摘要版（主路径 stage2/3 与 stage1 同一次调用，
 * 全文只存 stage1_prompt，避免一行三份 60k 语料，指针 fullPromptIn 指明全文所在列）
 */
function buildCallPromptMeta(questions, stateStats, state, { full = false } = {}) {
  return JSON.stringify({
    engine: 'jev',
    questionsVersion: JEV_QUESTIONS_VERSION,
    questionIds: Object.keys(questions),
    stateStats,
    ...(full ? { state, questions } : { fullPromptIn: 'stage1_prompt' }),
  });
}

/**
 * 主路径（原 3 阶段管线）映射
 * @param {Object} answers - JevClient 返回的 answers
 * @param {Object} context
 * @param {Object} context.tokenData - 代币数据
 * @param {boolean} context.includeBrandHijack - 品牌劫持预检是否命中（问题是否存在）
 * @param {Object} context.callInfo - {model, questions, state, stateStats, usage, startedAt, finishedAt}
 * @param {Object|null} [context.tweetClassification] - 推文预分类
 * @returns {Object} { stage1DataToSave, stage2DataToSave, stage3DataToSave,
 *                     stageFinalData, llmResult, promptType, jevDetails }
 */
export function mapStandardAnswers(answers, context) {
  const { tokenData, includeBrandHijack = false, callInfo, tweetClassification = null } = context;
  const symbol = tokenData.symbol || '';
  // stage1 存完整 prompt（state+questions 全文），stage2/3 存摘要+指针
  const promptMetaFull = buildCallPromptMeta(callInfo.questions, callInfo.stateStats, callInfo.state, { full: true });
  const promptMeta = buildCallPromptMeta(callInfo.questions, callInfo.stateStats, callInfo.state);
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
  // name_referent 阻断（J1.10）：名字指向无名对象/截词/仅知名，无论事件分多高都不通过
  const nameReferent = answers.name_referent?.choice || null;
  const nameReferentProb = answers.name_referent?.probabilities?.[nameReferent] ?? null;

  const stage1DataToSave = {
    category,
    ...baseFields,
    prompt: promptMetaFull, // 覆盖 baseFields 的摘要版：stage1 是完整 prompt 的落库位
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
          name_referent: answers.name_referent?.probabilities,
        },
      },
    },
  };

  // ── Stage2：阻断 + 事件分 ──────────────────────────────────────────
  const isW = category === 'W';
  // C8 骑乘改道：B 类第三方骑乘盘改走 W 数学（见 rideDetourBelow 注释）
  const rideMass = rideDetourBelow(answers, category);
  let stage2Blocked = false;
  let stage2BlockReason = null;
  let nrBlock = null; // name_referent 阻断信息 {label, mass}（reason 展示用）
  let nhnBlock = null; // negative_hard_news 质量门信息 {label, mass}（J1.11）
  let tierScore = 0;
  let timeliness = 0;
  let stage2Total = null;
  let wProduct = null;
  let wInteraction = null;
  let stage2Reason = null;

  // J1.11 负面硬新闻质量门挂最前（事件性质层面的否决，优先于其他阻断展示）；
  // argmax 命中时下方 BLOCK_SCOPE 'all' 也能拦，此处覆盖概率过半但 argmax/noneProb
  // 边界抖动的情况（nameReferentBlock 同思路：合并质量对抗五五开抖动）
  if ((nhnBlock = negativeHardNewsBlock(answers))) {
    stage2Blocked = true;
    stage2BlockReason = nhnBlock.label;
  } else if (blockChoice !== 'none' && noneProb < 0.5 && blockInScope(blockChoice, category)) {
    stage2Blocked = true;
    stage2BlockReason = BLOCK_LABELS[blockChoice] || blockChoice;
  } else if ((nrBlock = nameReferentBlock(answers, isW ? 'W' : category))) {
    stage2Blocked = true;
    stage2BlockReason = nrBlock.label;
  } else if (!isW && (tier === 'E' || tier === 'D')) {
    // 量级 D/E 档：主体量级不足，直接阻断（原各类 prompt 的 D/E 处理）
    stage2Blocked = true;
    stage2BlockReason = `事件主体量级不足（${tier}档）`;
  } else if (isW || rideMass != null) {
    // W 数学（W 类原生 / B 类骑乘改道共用：产品分量 + 币安交互 + 时效，pass 线 60）
    wProduct = bandInterpolate(answers.w_product_score?.score ?? 0, W_PRODUCT_BANDS);
    wInteraction = bandInterpolate(answers.w_binance_interaction?.score ?? 0, W_INTERACTION_BANDS);
    timeliness = TIMING_SCORES_W[timing] ?? 0;
    stage2Total = round2(wProduct + wInteraction + timeliness);
    stage2Blocked = stage2Total < 60;
    if (rideMass != null) {
      stage2Reason = `骑乘改道W类 产品${wProduct}+交互${wInteraction}+时效${timeliness}=${stage2Total}（pass线60）`;
      if (stage2Blocked) stage2BlockReason = `骑乘盘W数学总分不足（${stage2Total}<60）`;
    } else {
      stage2Reason = `W类 产品${wProduct}+交互${wInteraction}+时效${timeliness}=${stage2Total}（pass线60）`;
      if (stage2Blocked) stage2BlockReason = `W类总分不足（${stage2Total}<60）`;
    }
  } else {
    tierScore = MAGNITUDE_TIER_SCORES[tier] || 0;
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
        category: (isW || rideMass != null) ? 'W' : category,
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
        nameReferent,
        nameReferentProbability: nameReferentProb,
        nameReferentBlockMass: nrBlock?.mass ?? null,
        negativeHardNewsMass: nhnBlock?.mass ?? null,
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
    ? `阻断:${stage2BlockReason}｜P=${nrBlock ? nrBlock.mass : (rideMass ?? blockProb ?? '-')}`
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

  const promptType = `jev(${JEV_QUESTIONS_VERSION}/${category || '?'}类`
    + `${isW ? '-W数学' : (rideMass != null ? '-骑乘改道W数学' : '')})`;

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
  // prestage 单列承载，无 stage2/3 冗余，直接存完整 prompt（state+questions 全文）
  const promptMeta = buildCallPromptMeta(callInfo.questions, callInfo.stateStats, callInfo.state, { full: true });
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
  // name_referent 阻断（J1.10）同样适用于快车道：注册表账号的量级分不能被
  // "其推文中@到/提到的无名对象"蹭走（YAYA 案例：何一推文@的周边账号名）
  const nameReferent = answers.name_referent?.choice || null;
  const nameReferentProb = answers.name_referent?.probabilities?.[nameReferent] ?? null;
  const blockedByBlockReason = blockChoice !== 'none' && blockChoice !== 'institution_routine'
    && noneProb < 0.5 && blockInScope(blockChoice, superIPCategory);
  const nrBlock = nameReferentBlock(answers, superIPCategory);
  const blockedByNameReferent = !!nrBlock;
  // J1.11 负面硬新闻质量门（全域，与标准路径同门；superIP 通道无豁免——
  // 超级 IP 的被盗/事故公告同样无 meme 空间，蹭名盘照样拦）
  const nhnBlock = negativeHardNewsBlock(answers);
  const blockedByNegativeNews = !!nhnBlock;
  const blocked = blockedByBlockReason || blockedByNameReferent || blockedByNegativeNews;

  const prestageDataToSave = {
    category: 'super_ip_fast',
    model: callInfo.model,
    prompt: promptMeta,
    raw_output: rawOutput,
    parsed_output: {
      pass: !blocked,
      blockReason: blocked
        ? (blockedByNegativeNews ? nhnBlock.label
          : (blockedByBlockReason ? (BLOCK_LABELS[blockChoice] || blockChoice) : nrBlock.label))
        : null,
      dimension2Score: dim2,
      ipInfo: superIPInfo,
      tierScore: preScores.tierScore,
      timeliness: preScores.timeliness,
      baseEventScore: preScores.baseEventScore,
      jev: {
        blockChoice,
        blockProbability: blockProb ?? null,
        nameReferent,
        nameReferentProbability: nameReferentProb,
        nameReferentBlockMass: nrBlock?.mass ?? null,
        negativeHardNewsMass: nhnBlock?.mass ?? null,
        probabilities: {
          dimension2: answers.dimension2?.probabilities,
          block_reason: answers.block_reason?.probabilities,
          name_referent: answers.name_referent?.probabilities,
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
    llmResult = blockedByNegativeNews
      ? {
          rating: 'low',
          reason: `阻断:${nhnBlock.label}｜P=${nhnBlock.mass}`,
          score: null,
          pass: false,
        }
      : blockedByBlockReason
      ? {
          rating: 'low',
          reason: `阻断:${BLOCK_LABELS[blockChoice] || blockChoice}｜P=${blockProb ?? '-'}`,
          score: null,
          pass: false,
        }
      : {
          rating: 'low',
          reason: `阻断:${nrBlock.label}｜P=${nrBlock.mass}`,
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
