/**
 * Account Analysis Service - 账号/社区分析服务
 * 处理账号和社区相关的分析逻辑
 *
 * P3（2026-09-21）：前置判定 LLM 段迁移 Jev（原 account-community-analysis.mjs V2.0
 * + account-community-unverified.mjs V1.0 两条生成式 prompt 合并为一次 Jev 调用，
 * 评级数学下沉 jev-prestage-mapper.mjs）。meme 分流已删除——实证死代码：
 * V2.0/V1.0 prompt 从不允许输出 tokenType='meme'，12873 行历史数据 0 行触发。
 */

import logger from '../../core/logger.mjs';
import { hasIndependentWebsite, shouldUseAccountCommunityAnalysis } from '../utils/narrative-utils.mjs';
import { JevClient } from '../llm/JevClient.mjs';
import { buildPrestageQuestions } from '../llm/jev-prestage-questions.mjs';
import { buildPrestageState } from '../llm/jev-state-builder.mjs';
import { mapPrestageAnswers } from '../llm/jev-prestage-mapper.mjs';

/**
 * 收集所有相关账号的完整信息
 * 当检测到独立网站时，收集所有相关账号（主账号、原始作者等）的完整信息
 * @param {Object} twitterInfo - Twitter信息
 * @returns {Promise<Array>} 账号信息列表
 */
export async function collectAllAccountsWithFullInfo(twitterInfo) {
  const accounts = [];
  const screenNames = new Set(); // 用于去重

  // 1. 添加主账号（根据类型获取）
  let primaryScreenName = null;
  if (twitterInfo.type === 'account' && twitterInfo.screen_name) {
    primaryScreenName = twitterInfo.screen_name;
  } else if (twitterInfo.type === 'tweet' || twitterInfo.type === 'community') {
    // 对于推文类型，从 author_screen_name 获取主账号
    if (twitterInfo.author_screen_name) {
      primaryScreenName = twitterInfo.author_screen_name;
    }
  }

  if (primaryScreenName && !screenNames.has(primaryScreenName)) {
    const fullAccount = await getFullAccountInfo(primaryScreenName);
    if (fullAccount) {
      accounts.push({ ...fullAccount, role: 'primary' });
      screenNames.add(primaryScreenName);
    }
  }

  // 2. 添加原始作者账号（in_reply_to）
  if (twitterInfo.in_reply_to && twitterInfo.in_reply_to.author_screen_name) {
    const originalAuthor = twitterInfo.in_reply_to.author_screen_name;
    if (!screenNames.has(originalAuthor)) {
      const fullAccount = await getFullAccountInfo(originalAuthor);
      if (fullAccount) {
        accounts.push({ ...fullAccount, role: 'original_author' });
        screenNames.add(originalAuthor);
      }
    }
  }

  // 3. 未来可以添加更多账号类型（如 retweeted_status 等）

  logger.info('NarrativeAnalyzer', `账号信息收集完成，共${accounts.length}个账号`, {
    accounts: accounts.map(a => ({ screen_name: a.screen_name, role: a.role }))
  });

  return accounts;
}

/**
 * 获取单个账号的完整信息（含推文历史）
 * @param {string} screenName - Twitter用户名
 * @returns {Promise<Object|null>} 账号完整信息
 */
export async function getFullAccountInfo(screenName) {
  try {
    const { getAccountWithFullTweets } = await import('../prompts/account/account-community-rules.mjs');
    const accountInfo = await getAccountWithFullTweets(screenName, 20); // 获取20条推文
    if (accountInfo) {
      return accountInfo;
    } else {
      logger.warn('NarrativeAnalyzer', `获取账号信息失败: @${screenName}（返回null）`);
      return null;
    }
  } catch (error) {
    logger.error('NarrativeAnalyzer', `获取账号信息异常: @${screenName}`, { error: error.message });
    return null;
  }
}

/**
 * 执行账号/社区代币前置判定（Jev 单次调用）
 *
 * 流程：纯规则验证先行（账号质量/地址验证/名称匹配，account-community-rules.mjs）
 * → 通过后一次 JevClient.ask（4 题问题集，代码端按 addressVerified 分支采信）
 * → 三路分流返回：account_based_meme / web3_native_ip_early / project
 *
 * @param {Object} tokenData - 代币数据
 * @param {Object} fetchResults - 获取的数据结果
 * @param {Object} [options]
 * @param {boolean} [options.skipAddressValidation] - 项目币跳过地址验证（网站已验证）
 * @returns {Promise<Object>} 分析结果
 *   成功：{ rating, category, reasoning, scores:null, total_score:null, promptType,
 *           prestageData, [baselineMet], [preCheckData 规则失败时], [addressVerified/nameMatch] }
 *   Jev 调用失败直接抛错（analysisFailed → 引擎 maxRetries，不做兼容吞错）
 */
export async function analyzeAccountCommunityToken(tokenData, fetchResults, options = {}) {
  const {
    getAccountWithFullTweets,
    getCommunityWithFullTweets,
    performRulesValidation
  } = await import('../prompts/account/account-community-rules.mjs');

  const twitterInfo = fetchResults.twitterInfo;
  const relatedAccounts = fetchResults.relatedAccounts || [];

  // 如果有多个账号，选择主要账号进行分析
  let accountOrCommunityRef;
  if (relatedAccounts.length > 0) {
    // 优先选择 original_author（通常是项目官方账号）
    const originalAuthorAccount = relatedAccounts.find(a => a.role === 'original_author');
    if (originalAuthorAccount) {
      accountOrCommunityRef = { type: 'account', screen_name: originalAuthorAccount.screen_name };
      logger.info('AccountCommunityAnalysis', `使用原始作者账号进行分析: @${originalAuthorAccount.screen_name}`);
    } else {
      // 其次选择 primary（主推文作者）
      const primaryAccount = relatedAccounts.find(a => a.role === 'primary');
      if (primaryAccount) {
        accountOrCommunityRef = { type: 'account', screen_name: primaryAccount.screen_name };
        logger.info('AccountCommunityAnalysis', `使用主账号进行分析: @${primaryAccount.screen_name}`);
      } else {
        // 使用第一个账号
        accountOrCommunityRef = { type: 'account', screen_name: relatedAccounts[0].screen_name };
        logger.info('AccountCommunityAnalysis', `使用第一个账号进行分析: @${relatedAccounts[0].screen_name}`);
      }
    }
  } else {
    // 原有逻辑：使用 twitterInfo 中的账号
    accountOrCommunityRef = twitterInfo.type === 'account'
      ? { type: 'account', screen_name: twitterInfo.screen_name }
      : { type: 'community', community_id: twitterInfo.id };
  }

  logger.info('AccountCommunityAnalysis', `开始${accountOrCommunityRef.type === 'account' ? '账号' : '社区'}代币分析`, {
    type: accountOrCommunityRef.type,
    identifier: accountOrCommunityRef.type === 'account' ? accountOrCommunityRef.screen_name : accountOrCommunityRef.id,
    relatedAccountsCount: relatedAccounts.length
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 第一步：规则验证（地址验证 + 名称匹配）- 不使用LLM
  // ═══════════════════════════════════════════════════════════════════════════
  logger.info('AccountCommunityAnalysis', '执行规则验证（地址 + 名称）');

  // 获取完整的账号/社区数据（含完整推文，用于规则验证）
  const fullAccountOrCommunityData = accountOrCommunityRef.type === 'account'
    ? await getAccountWithFullTweets(accountOrCommunityRef.screen_name, 20)
    : await getCommunityWithFullTweets(accountOrCommunityRef.community_id, 20);

  if (!fullAccountOrCommunityData) {
    return {
      rating: 'low',
      category: 'data_fetch_failed',
      reasoning: '无法获取账号/社区完整数据（用于规则验证）',
      scores: null,
      total_score: null
    };
  }

  // 执行规则验证
  const tokenAddress = tokenData.address;
  const tokenSymbol = tokenData.symbol || '';
  const tokenName = tokenData.name || tokenData.raw_api_data?.name || '';

  // 项目币已通过网站验证地址，跳过地址验证
  const skipAddressValidation = options.skipAddressValidation || false;

  const rulesResult = performRulesValidation(
    tokenAddress,
    tokenSymbol,
    tokenName,
    fullAccountOrCommunityData,
    { skipAddressValidation }
  );

  logger.info('AccountCommunityAnalysis', '规则验证结果', {
    passed: rulesResult.passed,
    stage: rulesResult.stage,
    addressVerified: rulesResult.addressVerified,
    nameMatch: rulesResult.nameMatch
  });

  // 规则验证未通过，直接返回low
  if (!rulesResult.passed) {
    return {
      rating: 'low',
      category: 'rules_validation',
      reasoning: rulesResult.reason,
      scores: null,
      total_score: null,
      addressVerified: rulesResult.addressVerified,
      nameMatch: rulesResult.nameMatch,
      details: rulesResult.details,
      rulesValidation: true, // 标记这是规则验证的结果
      // 规则验证失败返回preCheckData，在"预检查"卡片展示
      preCheckData: {
        rating: 'low',
        reason: rulesResult.reason,
        result: {
          addressVerified: rulesResult.addressVerified,
          nameMatch: rulesResult.nameMatch,
          details: rulesResult.details,
          validationStage: rulesResult.stage
        }
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 第二步：Jev 前置判定（一次调用；代码端按 addressVerified 分支采信答案）
  // 未命中 → abm 两条件判定；命中 → token_type 二分 + project 评级（代码端数学）
  // ═══════════════════════════════════════════════════════════════════════════
  const startedAt = new Date().toISOString();
  // 时效基准 = 代币创建时间（与 pre-check 规则2 同裁定：发币时语料是否新鲜，与何时分析无关）
  const tokenCreatedAtSec = tokenData.raw_api_data?.created_at;
  const { state, stats } = buildPrestageState(tokenData, fullAccountOrCommunityData, {
    addressVerified: rulesResult.addressVerified,
    rulesResult,
    websiteInfo: skipAddressValidation ? fetchResults.websiteInfo : null,
    ...(tokenCreatedAtSec ? { now: tokenCreatedAtSec * 1000 } : {}),
  });
  const questions = buildPrestageQuestions();
  const result = await JevClient.ask(state, questions, {
    label: `jev-prestage:${tokenSymbol || (tokenAddress || '').slice(0, 8)}`,
  });
  const finishedAt = new Date().toISOString();

  const mapped = mapPrestageAnswers(result.answers, {
    fullAccountOrCommunityData,
    addressVerified: rulesResult.addressVerified,
    rulesResult,
    callInfo: {
      model: result.model, questions, stateStats: stats,
      usage: result.usage, startedAt, finishedAt,
    },
  });

  logger.info('AccountCommunityAnalysis', 'Jev 前置判定完成', {
    tokenType: mapped.tokenType,
    rating: mapped.rating,
    addressVerified: rulesResult.addressVerified,
    stateChars: stats.totalChars,
    reason: mapped.reasoning,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 第三步：分流返回（旧四路分流中的 meme 分流已删除——死代码，见文件头注释）
  // ═══════════════════════════════════════════════════════════════════════════

  if (mapped.tokenType === 'account_based_meme') {
    return {
      rating: mapped.rating,
      category: 'account_based_meme',
      reasoning: mapped.reasoning,
      scores: null,
      total_score: null,
      promptType: mapped.promptType,
      prestageData: mapped.prestageDataToSave,
    };
  }

  if (mapped.tokenType === 'web3_native_ip_early') {
    return {
      rating: 'unrated',
      category: 'web3_native_ip_early',
      reasoning: mapped.reasoning,
      scores: null,
      total_score: null,
      promptType: mapped.promptType,
      prestageData: mapped.prestageDataToSave,
    };
  }

  // 项目币：直接返回评级结果（评级数学已在 mapper 代码端完成）
  return {
    rating: mapped.rating,
    category: 'project',
    reasoning: mapped.reasoning,
    scores: null,
    total_score: null,
    baselineMet: mapped.baselineMet,
    promptType: mapped.promptType,
    prestageData: mapped.prestageDataToSave,
  };
}

// 重新导出 utils 中的函数，保持向后兼容
export { hasIndependentWebsite, shouldUseAccountCommunityAnalysis };
