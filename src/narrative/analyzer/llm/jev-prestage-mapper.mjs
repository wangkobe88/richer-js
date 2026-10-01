/**
 * Jev prestage answers → 前置判定结果映射器（P3）
 *
 * 全部确定性判定在本文件完成（原 V2.0/V1.0 prompt 的评级数学下沉代码端）：
 * - addressVerified=false → 固定 account_based_meme：名称关联≠none 且 P(has_traffic)≥0.5
 *   两条件同时满足 → mid，否则 low（2026-09-27 裁定：abm 双证据成立给结论 mid，
 *   不再 unrated——分析完成必须有 low/mid/high 结论，9 只保留给直调失败/超时/未触发）
 * - addressVerified=true → token_type 二分（V2.0 第一步）：
 *   - web3_native_ip_early → 按账号基本面评级（复用 rateProject 粉丝带 + P1.3 降档，
 *     2026-09-27 裁定：蝴蝶轮回 168 粉 → mid，"等社区成长"不再是不给结论的理由）
 *   - project 评级（V2.0 第三步表，就高处理——high 档无封顶，认证记 details 不参与）：
 *     账号 <20 low / 20-299 mid / ≥300 high（账号底线 60→20，2026-09-27 裁定）；
 *     社区 <20 low / 20-99 mid / ≥100 且活跃 high；
 *     P1.3 账号信用降档——推文 <5 或账号年龄 <30 天（token 创建时点锚定）→ low
 * - 输出 prestageDataToSave 与旧 prestageData 字段一一对应（存储契约不变），
 *   promptType 用于 prompt_type 列识别新旧格式
 */

import { JEV_PRESTAGE_QUESTIONS_VERSION } from './jev-prestage-questions.mjs';

const round2 = (x) => Math.round(x * 100) / 100;

/** abm 名称关联选项 → 中文标签（reason 模板用） */
const NAME_LINK_LABELS = {
  exact: '精确匹配',
  abbreviation: '缩写匹配',
  semantic: '语义关联',
  none: '无关联',
};

/** P1.5 项目实度豁免下限（prestage_project_quality ≥3 = 产品可验证+运营正常的及格线） */
const PROJECT_QUALITY_PASS_MIN = 3;

/**
 * project 评级（纯确定性，V2.0 评级表下沉；high 档就高处理：
 * 旧表 high 只写 300-2999 且"认证/蓝V优先"无量化规则 → ≥300 一律 high，
 * 认证状态记入 details 不参与计算——评级可由 followers/members 复算验证）
 * P1.3 信用降档（x-0 案 C15）：账号型 project 加新号/空内容降档——买粉新号
 * 可精确卡进粉丝带（x-0：131 粉、11 天号、1 条推文 → mid 放行 -68.8%），
 * 粉丝数是唯一量化指标的盲区。推文 <5 或账号年龄 <30 天 → low（不具项目信用）。
 * 年龄以 token 创建时间为锚（与 pre-check 时效基准同裁定：重跑/回测幂等）；
 * created_at 缺失/解析失败跳过年龄项；statuses_count 是当前快照（重放偏松方向，
 * 穿越声明同 narrativeRating 直调）。
 * P1.5 实度豁免（2026-10-01 用户裁定，WIRED 案）：账号新不再一票否决——
 * prestage_project_quality 分（产品价值+推文内容质量）≥3 豁免降档走粉丝带；
 * <3 或缺分 fail-closed 维持 low。推文 <5 保留拦（无内容=质量无从评估）。
 * P1.9 accountAgeGate（C46 MarsCoin 案，2026-10-01 用户裁定「很多 meme 币一出生
 * 就有账号，一般算是 web3 原生IP」）：web3ip 评级不再吃 P1.3 年龄降档/P1.5 实度门
 * ——项目信用框架对 meme 范畴错配（实度题要求产品陈述，meme 无产品可陈述；
 * MarsCoin 实度 2.76 的低分正是范畴错配产物）。年龄门经 opts 关闭后推文 <5 拦截
 * 保留（C15 x-0 买粉新号防线与 token 类型无关）。
 * @param {Object} data - fullAccountOrCommunityData
 * @param {string|null} activityChoice - prestage_community_activity 的 choice（社区型用）
 * @param {number|null} [tokenCreatedAtSec] - 代币创建时间（秒，raw_api_data.created_at）
 * @param {number|null} [projectQualityScore] - prestage_project_quality 分（P1.5 恒带题）
 * @param {Object} [opts] - { accountAgeGate=true（P1.3 年龄降档开关，web3ip 传 false）,
 *   ratingLabel='项目币评级'（reason 前缀，web3ip 传 '账号基本面评级'） }
 * @returns {{rating: string, baselineMet: boolean, reason: string, downgrade: Object|null, qualityExempt: Object|null}}
 */
export function rateProject(data, activityChoice, tokenCreatedAtSec = null, projectQualityScore = null, opts = {}) {
  const { accountAgeGate = true, ratingLabel = '项目币评级' } = opts;
  const isAccount = data.type === 'account';
  let qualityExempt = null;
  const count = isAccount
    ? (data.followers_count || 0)
    : (data.members_count || 0);
  const metric = isAccount ? '粉丝' : '成员';
  // 账号粉丝底线 60→20（2026-09-27 用户裁定，§六-23）：fPay 26 粉 / FOMOPAY 25 粉
  // 两例实证 60 对当天冷启动项目账号偏严（宣告几分钟内分析必然 <60）；新号/空内容
  // 风险仍由 P1.3 信用降档拦截（推文 <5 或账号年龄 <30 天 → low），粉丝底线只做
  // 存在性下限。账号/社区底线现一致（均为 20）
  const floor = 20;

  if (count < floor) {
    return {
      rating: 'low',
      baselineMet: false,
      reason: `底线指标不达标（${metric}${count} < ${floor}，被过滤）`,
      downgrade: null,
    };
  }

  // 账号信用降档（P1.3/P1.5）：只作用于账号型——社区型无账号年龄概念
  // P1.5（2026-10-01 用户裁定，WIRED 案）：账号新不再一票否决——项目实度分
  // （prestage_project_quality，产品价值+推文内容质量）≥3 豁免降档走粉丝带；
  // <3 或缺分 fail-closed 维持 low。推文 <5 保留拦（无内容=质量无从评估）。
  if (isAccount) {
    const statuses = data.statuses_count || 0;
    let accountAgeDays = null;
    if (tokenCreatedAtSec && data.created_at) {
      const accountCreatedMs = Date.parse(data.created_at);
      if (!Number.isNaN(accountCreatedMs)) {
        accountAgeDays = (tokenCreatedAtSec * 1000 - accountCreatedMs) / 86400000;
      }
    }
    const tooFewTweets = statuses < 5;
    // P1.9（C46）：accountAgeGate=false（web3ip）时年龄不构成反证——账号随币而生/
    // 社区后建是 web3 原生 IP 常态；推文 <5 保留（C15 x-0 防线）
    const tooYoung = accountAgeGate && accountAgeDays !== null && accountAgeDays < 30;
    const ageDaysFloor = accountAgeDays === null ? null : Math.floor(accountAgeDays);
    const qualityOk = projectQualityScore !== null && projectQualityScore >= PROJECT_QUALITY_PASS_MIN;
    if (tooFewTweets || (tooYoung && !qualityOk)) {
      const why = [];
      if (tooFewTweets) why.push(`推文仅${statuses}条<5`);
      if (tooYoung) why.push(`账号注册仅${ageDaysFloor}天<30（以token创建时点锚定）${projectQualityScore === null ? '、项目实度分缺失fail-closed' : `、项目实度${projectQualityScore}分<${PROJECT_QUALITY_PASS_MIN}`}`);
      return {
        rating: 'low',
        baselineMet: true,
        reason: `${ratingLabel}：${metric}${count} → 信用降档low（${why.join('、')}，新号/空内容不具项目信用）`,
        downgrade: { statuses, accountAgeDays: ageDaysFloor, ...(projectQualityScore !== null ? { projectQuality: projectQualityScore } : {}) },
      };
    }
    if (tooYoung && qualityOk) {
      qualityExempt = { accountAgeDays: ageDaysFloor, projectQuality: projectQualityScore };
    }
  }

  let rating;
  if (isAccount) {
    rating = count >= 300 ? 'high' : 'mid';
  } else {
    // 社区：≥100 且日活 high → high；100-999 旧表写 high、≥100 就高
    rating = (count >= 100 && activityChoice === 'high') ? 'high' : 'mid';
  }

  const activityNote = !isAccount ? `，活跃度${activityChoice || '?'}` : '';
  const exemptNote = qualityExempt ? `；账号新${qualityExempt.accountAgeDays}天但项目实度${qualityExempt.projectQuality}分≥${PROJECT_QUALITY_PASS_MIN}豁免降档` : '';
  return {
    rating,
    baselineMet: true,
    reason: `${ratingLabel}：${metric}${count}${activityNote} → ${rating}（底线≥${floor}${exemptNote}）`,
    downgrade: null,
    qualityExempt,
  };
}

/**
 * prestage answers → 判定结果
 * @param {Object} answers - JevClient 返回的 answers
 * @param {Object} context
 * @param {Object} context.fullAccountOrCommunityData - 账号/社区完整数据
 * @param {boolean} context.addressVerified - 规则验证地址命中结果
 * @param {Object|null} [context.rulesResult] - performRulesValidation 结果
 * @param {number|null} [context.tokenCreatedAtSec] - 代币创建时间（秒；P1.3 账号
 *   年龄锚点，与 pre-check 时效基准同裁定）
 * @param {Object} context.callInfo - {model, questions, state, stateStats, usage, startedAt, finishedAt}
 * @returns {Object} { tokenType, rating, reasoning, baselineMet, prestageDataToSave, promptType, jevDetails }
 */
export function mapPrestageAnswers(answers, context) {
  const { fullAccountOrCommunityData, addressVerified, rulesResult, callInfo, tokenCreatedAtSec = null } = context;
  const data = fullAccountOrCommunityData;
  const isAccount = data.type === 'account';
  const followers = isAccount ? (data.followers_count || 0) : null;
  const members = !isAccount ? (data.members_count || 0) : null;

  // 完整 prompt 落库：state（语料全文）+ questions（问题集全文），页面回放展示用
  const promptMeta = JSON.stringify({
    engine: 'jev',
    questionsVersion: JEV_PRESTAGE_QUESTIONS_VERSION,
    questionIds: Object.keys(callInfo.questions),
    stateStats: callInfo.stateStats,
    state: callInfo.state,
    questions: callInfo.questions,
  });
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

  // answers 里的概率（details 概率承载，供校准分析）
  const jevProbabilities = {
    prestage_token_type: answers.prestage_token_type?.probabilities,
    prestage_abm_name_link: answers.prestage_abm_name_link?.probabilities,
    prestage_abm_web3_traffic: answers.prestage_abm_web3_traffic?.probabilities,
    prestage_community_activity: answers.prestage_community_activity?.probabilities,
  };

  let tokenType;
  let rating;
  let reasoning;
  let baselineMet = null;
  let pass;
  let details;
  let jevDetails;

  if (!addressVerified) {
    // ── 地址未命中：固定 account_based_meme 判定（V1.0 两条件）──────────
    tokenType = 'account_based_meme';
    const nameLink = answers.prestage_abm_name_link?.choice || 'none';
    const trafficChoice = answers.prestage_abm_web3_traffic?.choice || 'no_traffic';
    const trafficP = answers.prestage_abm_web3_traffic?.probabilities?.has_traffic ?? 0;

    const nameOk = nameLink !== 'none';
    const trafficOk = trafficP >= 0.5;
    rating = (nameOk && trafficOk) ? 'mid' : 'low';

    const failed = [];
    if (!nameOk) failed.push('名称关联不成立');
    if (!trafficOk) failed.push('无30天内Web3流量事件');

    reasoning = `名称关联:${NAME_LINK_LABELS[nameLink] || nameLink}｜Web3流量:${trafficOk ? `有(P=${round2(trafficP)})` : `无(P=${round2(trafficP)}，choice=${trafficChoice})`}｜${rating === 'mid' ? '两条件同时满足→mid（账号背景 meme 双证据成立）' : `不满足:${failed.join('、')}→low`}`;
    pass = true; // 对齐旧 abm 分支的 prestageData.pass=true（判定本身完成）

    details = {
      followers,
      members,
      accountMatchDetails: `${NAME_LINK_LABELS[nameLink] || nameLink}（Jev choice=${nameLink}）`,
      web3Interaction: trafficOk ? '有近期Web3流量事件' : `无近期Web3流量事件（P=${round2(trafficP)}）`,
    };
    jevDetails = { nameLink, trafficChoice, trafficP };
  } else {
    // ── 地址命中：token_type 二分（V2.0）────────────────────────────────
    tokenType = answers.prestage_token_type?.choice || 'project';

    if (tokenType === 'web3_native_ip_early') {
      // 按账号基本面评级（2026-09-27 裁定：不再 unrated"等社区成长"——过与不过要有
      // 结论）。复用 rateProject 粉丝/成员带（<20 low / 20-299 mid / ≥300 high）。
      // P1.9（C46 MarsCoin 案 @bnbMarsCoin，2026-10-01 用户裁定：「代币大了后社区
      // 自己搞的 Meme 币主账号不属于项目」「很多 meme 币一出生就有账号，一般算是
      // web3 原生IP」）：web3ip 评级不吃 P1.3 年龄降档/P1.5 实度门——账号随币而生/
      // 社区后建是常态（MarsCoin 主账号晚于 token 创建 23 天，负年龄被当「新号」
      // 降档），实度题要求产品陈述而 meme 无产品可陈述（范畴错配，实度 2.76 低分
      // 正是产物）。accountAgeGate=false 只关年龄臂，推文 <5 拦截保留（C15 x-0
      // 买粉新号防线与 token 类型无关）
      const rated = rateProject(data, null, tokenCreatedAtSec, null, { accountAgeGate: false, ratingLabel: '账号基本面评级' });
      rating = rated.rating;
      baselineMet = rated.baselineMet;
      reasoning = `Web3原生IP早期（币本身即IP：新称号/概念或社区meme，账号随币而生/社区后建）→ ${rated.reason}`;
      pass = true;
      details = { followers, members, projectReason: null, ipConcept: null };
      jevDetails = { tokenType, baselineMet: rated.baselineMet,
        ...(rated.downgrade ? { downgrade: rated.downgrade } : {}),
        ...(rated.qualityExempt ? { qualityExempt: rated.qualityExempt } : {}) };
    } else {
      // project：评级数学全部代码端（V2.0 评级表 + P1.3 信用降档 + P1.5 实度豁免）
      const activityChoice = answers.prestage_community_activity?.choice || null;
      const rated = rateProject(data, activityChoice, tokenCreatedAtSec, answers.prestage_project_quality?.score ?? null);
      tokenType = 'project';
      rating = rated.rating;
      baselineMet = rated.baselineMet;
      reasoning = rated.reason;
      pass = true; // 对齐旧 project 分支

      details = {
        followers,
        members,
        projectReason: null, // Jev 无文本生成，判定依据由 jev probabilities 承载
        ipConcept: null,
        ...(isAccount ? { verified: data.verified || data.is_blue_verified || false } : { communityActivity: activityChoice }),
      };
      jevDetails = { tokenType, activityChoice, baselineMet: rated.baselineMet,
        ...(rated.downgrade ? { downgrade: rated.downgrade } : {}),
        ...(rated.qualityExempt ? { qualityExempt: rated.qualityExempt } : {}) };
    }
  }

  const prestageDataToSave = {
    rating,
    pass,
    category: tokenType,
    ...baseFields,
    parsed_output: {
      tokenType,
      rating,
      reason: reasoning,
      baselineMet,
      details,
      rulesValidationPassed: true,
      addressVerified,
      nameMatch: addressVerified ? (rulesResult?.nameMatch ?? true) : null,
      jev: { probabilities: jevProbabilities },
    },
  };

  const promptType = `prestage-jev(${JEV_PRESTAGE_QUESTIONS_VERSION}/${tokenType})`;

  return {
    tokenType,
    rating,
    reasoning,
    baselineMet,
    prestageDataToSave,
    promptType,
    jevDetails,
  };
}
