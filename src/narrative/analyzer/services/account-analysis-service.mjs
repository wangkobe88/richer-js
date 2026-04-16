/**
 * Account Analysis Service - 账号/社区分析服务
 * 处理账号和社区相关的分析逻辑
 */

import logger from '../../core/logger.mjs';
import { hasIndependentWebsite, shouldUseAccountCommunityAnalysis } from '../utils/narrative-utils.mjs';
import { safeSubstring } from '../utils/data-cleaner.mjs';

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
    const { getAccountWithFullTweets } = await import('../prompts/account-community-rules.mjs');
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
 * 执行账号/社区代币分析
 * 这是一个复杂的方法，需要依赖其他服务（如 meme-analysis-service）
 * 因此这里只是一个简化版本，完整的实现需要在调用时组合使用
 * @param {Object} tokenData - 代币数据
 * @param {Object} fetchResults - 获取的数据结果
 * @param {Object} dependencies - 依赖的方法（用于循环依赖问题）
 * @returns {Promise<Object>} 分析结果
 */
export async function analyzeAccountCommunityToken(tokenData, fetchResults, dependencies = {}, options = {}) {
  const { buildAccountCommunityAnalysisPrompt } = await import('../prompts/account-community-analysis.mjs');
  const {
    getAccountWithFullTweets,
    getCommunityWithFullTweets,
    performRulesValidation
  } = await import('../prompts/account-community-rules.mjs');

  const twitterInfo = fetchResults.twitterInfo;
  const relatedAccounts = fetchResults.relatedAccounts || [];

  // 新增：如果有多个账号，选择主要账号进行分析
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
      category: 'low',
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
      category: 'low',
      reasoning: rulesResult.reason,
      scores: null,
      total_score: null,
      addressVerified: rulesResult.addressVerified,
      nameMatch: rulesResult.nameMatch,
      details: rulesResult.details,
      rulesValidation: true, // 标记这是规则验证的结果
      // 规则验证失败返回preCheckData，在"预检查"卡片展示
      preCheckData: {
        category: 'low',
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
  // 第二步：LLM分析（币种类型判断 + 评级）
  // 根据地址验证结果选择不同的 prompt
  // ═══════════════════════════════════════════════════════════════════════════
  let prompt;
  if (!rulesResult.addressVerified) {
    // 地址未命中：使用专用 prompt，只判断 account_based_meme
    const { buildUnverifiedPrompt } = await import('../prompts/account-community-unverified.mjs');
    prompt = await buildUnverifiedPrompt(tokenData, accountOrCommunityRef);
  } else {
    // 地址命中：使用标准 prompt，判断 project / web3_native_ip_early
    prompt = await buildAccountCommunityAnalysisPrompt(tokenData, accountOrCommunityRef, {
      websiteInfo: options.skipAddressValidation ? fetchResults.websiteInfo : null
    });
  }

  if (!prompt) {
    return {
      category: 'low',
      reasoning: '无法构建账号/社区分析Prompt（数据获取失败）',
      scores: null,
      total_score: null,
      // prompt构建失败也返回preCheckData
      preCheckData: {
        category: 'low',
        reason: '无法构建账号/社区分析Prompt（数据获取失败）',
        result: {
          addressVerified: rulesResult.addressVerified,
          nameMatch: rulesResult.nameMatch,
          details: rulesResult.details,
          error: '无法构建Prompt'
        }
      }
    };
  }

  // 使用依赖注入的 _callLLMAPI 方法
  const callResult = await dependencies.callLLMAPI ? await dependencies.callLLMAPI(prompt) : await (await import('../llm/llm-api-client.mjs')).callLLMAPI(prompt);

  if (!callResult.success) {
    throw new Error(`账号/社区分析LLM调用失败: ${callResult.error}`);
  }

  // 解析响应
  let parsed;
  try {
    // 清理markdown代码块标记
    let content = callResult.content.trim();
    // 移除 ```json 和 ``` 标记
    content = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');

    // 尝试提取tokenType（作为fallback）
    const tokenTypeMatch = content.match(/"tokenType"\s*:\s*"([^"]+)"/);
    const ratingMatch = content.match(/"rating"\s*:\s*"([^"]+)"/);
    const reasonMatch = content.match(/"reason"\s*:\s*"([^"]+(?:"[^"]*)*?)"/);

    // 尝试解析JSON，处理中文引号问题
    const tryParse = (str) => {
      try {
        return JSON.parse(str);
      } catch (_) {
        return null;
      }
    };

    parsed = tryParse(content);
    if (!parsed) {
      // 尝试修复中文引号 - 替换为英文单引号
      let fixedContent = content.replace(/"/g, "'").replace(/"/g, "'");
      parsed = tryParse(fixedContent);
    }

    if (!parsed) {
      // 尝试使用eval方式解析（更宽松，但需要注意安全性）
      // 由于内容来自LLM，相对安全，但仍需谨慎
      try {
        // 移除所有换行符，但保留JSON结构中的换行
        const compactContent = content.replace(/\n/g, ' ').replace(/\r/g, '');
        parsed = eval(`(${compactContent})`);
      } catch (_) {
        // eval也失败，尝试最后一次清理
        // 移除所有可能导致问题的字符
        let cleanContent = content
          .replace(/[\u2018\u2019]/g, "'")  // 左右单引号
          .replace(/[\u201C\u201D]/g, '"')  // 左右双引号
          .replace(/\n/g, '\\n')           // 转义换行
          .replace(/\r/g, '\\r')           // 转义回车
          .replace(/\t/g, '\\t');          // 转义制表符

        parsed = tryParse(cleanContent);
      }
    }

    // 如果所有解析方式都失败，尝试从内容中提取关键字段作为fallback
    if (!parsed && tokenTypeMatch && ratingMatch) {
      logger.warn('AccountCommunityAnalysis', 'JSON解析失败，使用正则提取作为fallback', {
        tokenType: tokenTypeMatch[1],
        rating: ratingMatch[1]
      });

      // 构造最小可用的parsed对象
      parsed = {
        tokenType: tokenTypeMatch[1],
        rating: ratingMatch[1],
        reason: reasonMatch ? safeSubstring(reasonMatch[1], 200) : '解析失败但提取到关键字段',
        details: {}
      };
    }

    if (!parsed) {
      throw new Error('JSON解析失败，已尝试多种修复方式');
    }
  } catch (e) {
    logger.error('AccountCommunityAnalysis', '解析LLM响应失败', { error: e.message, content: callResult.content.substring(0, 500) });
    return {
      category: 'low',
      reasoning: '分析响应解析失败',
      scores: null,
      total_score: null
    };
  }

  // 注意：地址验证和名称匹配已在规则验证阶段完成，无需再检查LLM返回的这些字段

  // 判断币种类型并分流处理
  const tokenType = parsed.tokenType || 'project'; // 默认为项目币

  // ═══════════════════════════════════════════════════════════════════════════════
  // 新增：以账号为背景的meme币判断
  // ═══════════════════════════════════════════════════════════════════════════════
  if (tokenType === 'account_based_meme') {
    const abmRating = parsed.rating || 'unrated';
    const abmReason = parsed.reason || '这是以账号为背景的meme币';

    logger.info('AccountCommunityAnalysis', `判断为以账号为背景的meme币，返回${abmRating}`, {
      accountMatchDetails: safeSubstring(parsed.details?.accountMatchDetails, 100),
      web3Interaction: safeSubstring(parsed.details?.web3Interaction, 100)
    });

    return {
      category: abmRating,
      reasoning: abmReason,
      scores: null,
      total_score: null,
      prestageData: {
        category: abmRating,
        prompt: prompt,
        raw_output: callResult.content,
        parsed_output: {
          ...parsed,
          rulesValidationPassed: true,
          addressVerified: rulesResult.addressVerified,
          nameMatch: rulesResult.nameMatch
        },
        model: callResult.model,
        started_at: callResult.startedAt,
        finished_at: callResult.finishedAt,
        success: callResult.success,
        error: callResult.error
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 新增：Web3 原生 IP 早期判断
  // ═══════════════════════════════════════════════════════════════════════════════
  if (tokenType === 'web3_native_ip_early') {
    // Web3 原生 IP 处于早期发展阶段，直接返回 unrated
    logger.info('AccountCommunityAnalysis', '判断为Web3原生IP早期，返回unrated', {
      ipConcept: safeSubstring(parsed.ipConcept, 100)
    });

    return {
      category: 'unrated',
      reasoning: parsed.reason || 'Web3原生IP处于早期发展阶段，需等待社区成长后再评估',
      scores: null,
      total_score: null,
      // 前置LLM阶段数据（账号/社区分析判断币种类型）
      prestageData: {
        category: 'unrated', // Web3原生IP早期
        prompt: prompt,
        raw_output: callResult.content,
        parsed_output: {
          ...parsed,
          rulesValidationPassed: true,
          addressVerified: rulesResult.addressVerified,
          nameMatch: rulesResult.nameMatch
        },
        model: callResult.model,
        started_at: callResult.startedAt,
        finished_at: callResult.finishedAt,
        success: callResult.success,
        error: callResult.error
      }
    };
  }

  if (tokenType === 'meme') {
    // meme币：转入两阶段分析流程
    logger.info('AccountCommunityAnalysis', '判断为meme币，转入两阶段分析流程', {
      accountSummary: safeSubstring(parsed.accountSummary, 100)
    });

    // 构建带账号摘要的fetchResults
    const memeFetchResults = {
      ...fetchResults,
      accountSummary: parsed.accountSummary || '' // 将账号摘要传入
    };

    // 使用依赖注入的 _analyzeMemeTokenTwoStage 方法
    const analyzeMemeTokenTwoStage = dependencies.analyzeMemeTokenTwoStage ||
      (await import('./meme-analysis-service.mjs')).analyzeMemeTokenTwoStage;

    // 调用meme币两阶段分析流程，传递规则验证结果和前置LLM数据
    const memeResult = await analyzeMemeTokenTwoStage(tokenData, memeFetchResults, {
      stage1Prompt: prompt,
      stage1CallResult: callResult,
      stage1Parsed: parsed,
      rulesResult: rulesResult // 传递规则验证结果
    });

    // 添加前置LLM阶段数据（账号/社区分析判断币种类型）
    memeResult.prestageData = {
      category: 'meme', // 前置LLM判断为meme币
      prompt: prompt,
      raw_output: callResult.content,
      parsed_output: {
        ...parsed,
        rulesValidationPassed: true,
        addressVerified: rulesResult.addressVerified,
        nameMatch: rulesResult.nameMatch
      },
      model: callResult.model,
      started_at: callResult.startedAt,
      finished_at: callResult.finishedAt,
      success: callResult.success,
      error: callResult.error
    };

    return memeResult;
  } else {
    // 项目币：直接返回评级结果
    const rating = parsed.rating || 'low';
    const reason = parsed.reason || '';

    // 映射到现有category
    const categoryMap = {
      'high': 'high',
      'mid': 'mid',
      'low': 'low'
    };

    return {
      category: categoryMap[rating] || 'low',
      reasoning: reason,
      scores: null, // 简化流程不返回详细评分
      total_score: null,
      baselineMet: parsed.baselineMet,
      // 前置LLM阶段数据（账号/社区分析判断币种类型）
      prestageData: {
        category: categoryMap[rating] || 'low',
        prompt: prompt,
        raw_output: callResult.content,
        parsed_output: {
          ...parsed,
          rulesValidationPassed: true,
          addressVerified: rulesResult.addressVerified,
          nameMatch: rulesResult.nameMatch,
          details: parsed.details
        },
        model: callResult.model,
        started_at: callResult.startedAt,
        finished_at: callResult.finishedAt,
        success: callResult.success,
        error: callResult.error
      }
    };
  }
}

// 重新导出 utils 中的函数，保持向后兼容
export { hasIndependentWebsite, shouldUseAccountCommunityAnalysis };
