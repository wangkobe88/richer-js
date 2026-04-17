/**
 * 推文类型预分类器
 * 在 Stage 1 之前，根据 twitterInfo 的数据（粉丝数、互动数、回复结构）
 * 纯代码判断推文类型，路由到对应的专用 Stage 1 prompt
 *
 * 推文类型：
 * - interpretive_reply: 解读型回复（回复/引用/转发大IP的推文）
 * - angle_seeking: 找角度推文（借外部热点事件发币，低粉丝+低互动）
 * - direct_tweet: 直接依托推文（推文本身就是事件来源）
 * - unknown: 不确定，使用原始 Stage 1 兜底
 */

import { SUPER_IP_REGISTRY } from '../prompts/super-ip/super-ip-registry.mjs';
import { isHighInfluenceAccount } from '../prompts/account/account-backgrounds.mjs';
import { isFrequentIssuer } from './frequent-issuers.mjs';

/**
 * 分类阈值常量（集中配置，便于调优）
 */
const THRESHOLDS = {
  // 找角度推文：低粉丝 + 低互动
  LOW_FOLLOWERS: 2000,
  LOW_LIKES: 100,
  LOW_RETWEETS: 20,

  // 直接依托推文：高粉丝 或 高互动
  HIGH_FOLLOWERS: 5000,
  HIGH_LIKES: 500,
  HIGH_RETWEETS: 100,
};

/**
 * 分类推文类型
 * @param {Object} twitterInfo - 推文数据
 * @returns {{ type: string, confidence: string, reason: string }}
 */
export function classifyTweetType(twitterInfo) {
  // 无 twitterInfo 或非推文类型 → unknown
  if (!twitterInfo) {
    return { type: 'unknown', confidence: 'high', reason: '无 twitterInfo' };
  }

  if (twitterInfo.type === 'account' || twitterInfo.type === 'community') {
    return { type: 'unknown', confidence: 'high', reason: `非推文类型: ${twitterInfo.type}` };
  }

  // 无推文文本
  if (!twitterInfo.text || !twitterInfo.text.trim()) {
    return { type: 'unknown', confidence: 'high', reason: '无推文文本' };
  }

  // --- 提取基础数据 ---
  const followers = twitterInfo.author_followers_count ?? 0;
  const likes = twitterInfo.metrics?.favorite_count ?? 0;
  const retweets = twitterInfo.metrics?.retweet_count ?? 0;

  // --- 优先级 1：interpretive_reply ---
  // 条件：有回复/引用/转发结构 且 被回复方是大IP/高影响力账号
  const interpretiveResult = _checkInterpretiveReply(twitterInfo);
  if (interpretiveResult) {
    return interpretiveResult;
  }

  // --- 优先级 2：angle_seeking（条件 A：频繁发币者）---
  if (isFrequentIssuer(twitterInfo.author_screen_name)) {
    return {
      type: 'angle_seeking',
      confidence: 'high',
      reason: `频繁发币者: @${twitterInfo.author_screen_name}`,
    };
  }

  // --- 优先级 2：angle_seeking（条件 B：低影响力 + 低互动）---
  const isLowInfluence = followers < THRESHOLDS.LOW_FOLLOWERS;
  const isLowEngagement = likes < THRESHOLDS.LOW_LIKES && retweets < THRESHOLDS.LOW_RETWEETS;

  if (isLowInfluence && isLowEngagement) {
    return {
      type: 'angle_seeking',
      confidence: 'medium',
      reason: `低影响力: ${followers}粉, ${likes}赞, ${retweets}转发`,
    };
  }

  // --- 优先级 3：direct_tweet（高粉丝）---
  if (followers >= THRESHOLDS.HIGH_FOLLOWERS) {
    return {
      type: 'direct_tweet',
      confidence: 'high',
      reason: `高影响力作者: ${followers}粉丝`,
    };
  }

  // --- 优先级 3：direct_tweet（高互动）---
  if (likes >= THRESHOLDS.HIGH_LIKES || retweets >= THRESHOLDS.HIGH_RETWEETS) {
    return {
      type: 'direct_tweet',
      confidence: 'high',
      reason: `高互动: ${likes}赞, ${retweets}转发`,
    };
  }

  // --- 兜底：unknown ---
  return {
    type: 'unknown',
    confidence: 'medium',
    reason: `中间地带: ${followers}粉, ${likes}赞, ${retweets}转发`,
  };
}

/**
 * 检查是否为解读型回复推文
 * @param {Object} twitterInfo
 * @returns {Object|null} 分类结果或 null
 */
function _checkInterpretiveReply(twitterInfo) {
  // 收集所有可能的回复目标（in_reply_to, quoted_status, retweeted_status）
  // 同时检查 twitterInfo 本身和 twitterInfo.website_tweet
  const targets = [];

  // 主推文的回复结构
  _collectReplyTargets(twitterInfo, targets);

  // website_tweet 的回复结构
  if (twitterInfo.website_tweet) {
    _collectReplyTargets(twitterInfo.website_tweet, targets);
  }

  // 检查每个回复目标是否是大IP
  for (const target of targets) {
    const isSuperIP = _isInSuperIPRegistry(target.screenName);
    const isHighInfluence = isHighInfluenceAccount(target.screenName);

    if (isSuperIP || isHighInfluence) {
      return {
        type: 'interpretive_reply',
        confidence: isSuperIP ? 'high' : 'high',
        reason: `回复/引用大IP: @${target.screenName} (${target.source})`,
      };
    }
  }

  return null;
}

/**
 * 收集推文中的回复目标信息
 * @param {Object} tweet - 推文对象
 * @param {Array} targets - 收集目标数组
 */
function _collectReplyTargets(tweet, targets) {
  if (tweet.in_reply_to?.author_screen_name) {
    targets.push({
      screenName: tweet.in_reply_to.author_screen_name,
      followers: tweet.in_reply_to.author_followers_count ?? 0,
      source: 'in_reply_to',
    });
  }

  if (tweet.quoted_status?.author_screen_name) {
    targets.push({
      screenName: tweet.quoted_status.author_screen_name,
      followers: tweet.quoted_status.author_followers_count ?? 0,
      source: 'quoted_status',
    });
  }

  if (tweet.retweeted_status?.author_screen_name) {
    targets.push({
      screenName: tweet.retweeted_status.author_screen_name,
      followers: tweet.retweeted_status.author_followers_count ?? 0,
      source: 'retweeted_status',
    });
  }
}

/**
 * 检查 screen_name 是否在 SUPER_IP_REGISTRY 中
 * @param {string} screenName
 * @returns {boolean}
 */
function _isInSuperIPRegistry(screenName) {
  if (!screenName) return false;
  return !!SUPER_IP_REGISTRY[screenName.toLowerCase()];
}
