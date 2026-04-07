/**
 * Token Info Service - 代币信息服务
 * 处理代币数据获取和信息提取
 */

import dbManager from '../../../services/dbManager.js';
import { cleanSymbol } from '../utils/narrative-utils.mjs';

/**
 * 从数据库获取代币数据
 * @param {string} address - 代币地址
 * @returns {Promise<Object|null>} 代币数据或null
 */
export async function fetchTokenData(address) {
  const supabase = dbManager.getSupabase();
  const { data, error } = await supabase
    .from('experiment_tokens')
    .select('token_symbol, raw_api_data, blockchain, platform')
    .eq('token_address', address)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return {
    address: address,
    symbol: cleanSymbol(data.token_symbol),  // 清洗代币名
    blockchain: data.blockchain,
    platform: data.platform,
    raw_api_data: data.raw_api_data
  };
}

/**
 * 提取结构化信息
 * @param {Object} tokenData - 代币数据
 * @returns {Object} 提取的信息
 */
export function extractInfo(tokenData) {
  const rawData = tokenData.raw_api_data || {};

  // 解析appendix字段（可能是JSON字符串）
  let appendix = {};
  if (rawData.appendix && typeof rawData.appendix === 'string') {
    try {
      appendix = JSON.parse(rawData.appendix);
    } catch (e) {
      console.warn('[NarrativeAnalyzer] 解析appendix失败:', e.message);
    }
  } else if (rawData.appendix && typeof rawData.appendix === 'object') {
    appendix = rawData.appendix;
  }

  // 提取twitter_url（按优先级）：
  // 1. appendix.twitter
  // 2. rawData.webUrl
  // 3. rawData.twitterUrl
  // 4. fourmeme_creator_info.full_info.raw.twitterUrl
  // 5. fourmeme_creator_info.full_info.twitterUrl
  let twitterUrl = appendix.twitter || rawData.webUrl || rawData.twitterUrl || '';

  // 尝试从 fourmeme_creator_info 获取
  if (!twitterUrl && rawData.fourmeme_creator_info) {
    const creatorInfo = rawData.fourmeme_creator_info;
    if (creatorInfo.full_info && creatorInfo.full_info.raw && creatorInfo.full_info.raw.twitterUrl) {
      twitterUrl = creatorInfo.full_info.raw.twitterUrl;
    } else if (creatorInfo.full_info && creatorInfo.full_info.twitterUrl) {
      twitterUrl = creatorInfo.full_info.twitterUrl;
    }
  }

  // 提取website（appendix.website > rawData.website）
  let website = appendix.website || rawData.website || rawData.websiteUrl || '';

  // 提取weibo_url（appendix.weibo > rawData.weibo）
  let weiboUrl = appendix.weibo || rawData.weibo || rawData.weiboUrl || '';

  return {
    intro_en: rawData.intro_en || rawData.introduction || '',
    intro_cn: rawData.intro_cn || '',
    website: website,
    twitter_url: twitterUrl,
    weibo_url: weiboUrl,
    description: rawData.description || ''
  };
}

/**
 * 检查是否是币安相关（代币名 + 任何语料都包含币安关键词）
 * @param {Object} tokenData - 代币数据
 * @param {Object} fetchResults - 获取的数据结果
 * @returns {Object} { isBinanceRelated: boolean, reason: string }
 */
export function checkBinanceRelated(tokenData, fetchResults) {
  const binanceKeywords = [
    'binance', '币安', 'bnb', 'bsc',
    'cz', '何一'  // 币安创始人
  ];

  const tokenSymbol = (tokenData.symbol || '').toLowerCase();

  // 1. 检查代币名是否包含币安关键词
  const tokenMatch = binanceKeywords.some(kw =>
    tokenSymbol.includes(kw.toLowerCase())
  );

  if (!tokenMatch) {
    return { isBinanceRelated: false };
  }

  // 2. 检查任何语料是否包含币安关键词（且数据获取成功）
  const { twitterInfo, websiteInfo, classifiedUrls, extractedInfo } = fetchResults;

  // 2.1 检查推文内容（必须有实际获取到的内容）
  if (twitterInfo?.text && twitterInfo.text.trim().length > 0) {
    const text = twitterInfo.text.toLowerCase();
    if (binanceKeywords.some(kw => text.includes(kw.toLowerCase()))) {
      return {
        isBinanceRelated: true,
        reason: `代币名"${tokenSymbol}" + 推文内容包含币安关键词`
      };
    }
  }

  // 2.2 检查推特账号信息（必须有实际获取到的账号数据）
  if (twitterInfo?.type === 'account' && twitterInfo.screen_name) {
    const screenName = twitterInfo.screen_name.toLowerCase();
    const name = (twitterInfo.name || '').toLowerCase();
    const description = (twitterInfo.description || '').toLowerCase();

    // 检查账号名、显示名、简介
    if (binanceKeywords.some(kw =>
      screenName.includes(kw.toLowerCase()) ||
      name.includes(kw.toLowerCase()) ||
      description.includes(kw.toLowerCase())
    )) {
      return {
        isBinanceRelated: true,
        reason: `代币名"${tokenSymbol}" + 推特账号信息包含币安关键词`
      };
    }
  }

  // 2.3 检查网站内容（必须有实际获取到的内容）
  if (websiteInfo?.content && websiteInfo.content.trim().length > 50) {
    const content = websiteInfo.content.toLowerCase();
    if (binanceKeywords.some(kw => content.includes(kw.toLowerCase()))) {
      return {
        isBinanceRelated: true,
        reason: `代币名"${tokenSymbol}" + 网站内容包含币安关键词`
      };
    }
  }

  // 注意：介绍信息（extractedInfo）不算外部数据，不检查
  // 注意：不检查 classifiedUrls 中的URL字符串，因为URL存在不代表数据获取成功
  // 必须有实际获取到的外部内容才算

  return { isBinanceRelated: false };
}
