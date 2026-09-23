/**
 * Jev prestage answers → 前置判定结果映射器（P3）
 *
 * 全部确定性判定在本文件完成（原 V2.0/V1.0 prompt 的评级数学下沉代码端）：
 * - addressVerified=false → 固定 account_based_meme：名称关联≠none 且 P(has_traffic)≥0.5
 *   两条件同时满足 → unrated，否则 low（V1.0 第三步逐字转译）
 * - addressVerified=true → token_type 二分（V2.0 第一步）：
 *   - web3_native_ip_early → unrated
 *   - project 评级（V2.0 第三步表，就高处理——high 档无封顶，认证记 details 不参与）：
 *     账号 <60 low / 60-299 mid / ≥300 high；社区 <20 low / 20-99 mid / ≥100 且活跃 high
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

/**
 * project 评级（纯确定性，V2.0 评级表下沉；high 档就高处理：
 * 旧表 high 只写 300-2999 且"认证/蓝V优先"无量化规则 → ≥300 一律 high，
 * 认证状态记入 details 不参与计算——评级可由 followers/members 复算验证）
 * @param {Object} data - fullAccountOrCommunityData
 * @param {string|null} activityChoice - prestage_community_activity 的 choice（社区型用）
 * @returns {{rating: string, baselineMet: boolean, reason: string}}
 */
export function rateProject(data, activityChoice) {
  const isAccount = data.type === 'account';
  const count = isAccount
    ? (data.followers_count || 0)
    : (data.members_count || 0);
  const metric = isAccount ? '粉丝' : '成员';
  const floor = isAccount ? 60 : 20;

  if (count < floor) {
    return {
      rating: 'low',
      baselineMet: false,
      reason: `底线指标不达标（${metric}${count} < ${floor}，被过滤）`,
    };
  }

  let rating;
  if (isAccount) {
    rating = count >= 300 ? 'high' : 'mid';
  } else {
    // 社区：≥100 且日活 high → high；100-999 旧表写 high、≥100 就高
    rating = (count >= 100 && activityChoice === 'high') ? 'high' : 'mid';
  }

  const activityNote = !isAccount ? `，活跃度${activityChoice || '?'}` : '';
  return {
    rating,
    baselineMet: true,
    reason: `项目币评级：${metric}${count}${activityNote} → ${rating}（底线≥${floor}）`,
  };
}

/**
 * prestage answers → 判定结果
 * @param {Object} answers - JevClient 返回的 answers
 * @param {Object} context
 * @param {Object} context.fullAccountOrCommunityData - 账号/社区完整数据
 * @param {boolean} context.addressVerified - 规则验证地址命中结果
 * @param {Object|null} [context.rulesResult] - performRulesValidation 结果
 * @param {Object} context.callInfo - {model, questions, state, stateStats, usage, startedAt, finishedAt}
 * @returns {Object} { tokenType, rating, reasoning, baselineMet, prestageDataToSave, promptType, jevDetails }
 */
export function mapPrestageAnswers(answers, context) {
  const { fullAccountOrCommunityData, addressVerified, rulesResult, callInfo } = context;
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
    rating = (nameOk && trafficOk) ? 'unrated' : 'low';

    const failed = [];
    if (!nameOk) failed.push('名称关联不成立');
    if (!trafficOk) failed.push('无30天内Web3流量事件');

    reasoning = `名称关联:${NAME_LINK_LABELS[nameLink] || nameLink}｜Web3流量:${trafficOk ? `有(P=${round2(trafficP)})` : `无(P=${round2(trafficP)}，choice=${trafficChoice})`}｜${rating === 'unrated' ? '两条件同时满足→unrated' : `不满足:${failed.join('、')}→low`}`;
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
      rating = 'unrated';
      reasoning = '判断为Web3原生IP早期（创造了新称号/概念，社区早期阶段），需等待社区成长后再评估';
      pass = null; // 对齐旧 web3ip 分支
      details = { followers, members, projectReason: null, ipConcept: null };
      jevDetails = { tokenType };
    } else {
      // project：评级数学全部代码端（V2.0 评级表）
      const activityChoice = answers.prestage_community_activity?.choice || null;
      const rated = rateProject(data, activityChoice);
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
      jevDetails = { tokenType, activityChoice, baselineMet: rated.baselineMet };
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
