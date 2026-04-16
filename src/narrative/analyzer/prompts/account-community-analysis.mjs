/**
 * 账号/社区代币分析 Prompt - 地址命中专用
 * V2.0 - 合约地址在账号简介/推文/网站中已确认时的专用 prompt
 *
 * 使用场景：
 * - 代币合约地址在账号简介/推文或项目网站中找到
 * - 分类选项：project（项目币）/ web3_native_ip_early（Web3原生IP早期）
 *
 * 分析重点：
 * 1. 币种类型判断（项目币 vs Web3原生IP早期）
 * 2. 底线指标检查（仅项目币，粉丝≥60，成员≥20）
 * 3. 影响力评级（仅项目币，low/mid/high）
 *
 * 注意：地址不命中的场景请使用 account-community-unverified.mjs
 */

import {
  getUserByScreenName,
  getUserTweets,
  fetchCommunityTweets
} from '../../../utils/twitter-validation/index.js';
import { safeSubstring } from '../utils/data-cleaner.mjs';

/**
 * Prompt版本号
 */
export const ACCOUNT_COMMUNITY_ANALYSIS_PROMPT_VERSION = 'V2.0';  // V2.0: 拆分为地址命中专用prompt，只保留project/web3_native_ip_early

/**
 * 获取账号信息（含推文）
 * @param {string} screenName - Twitter用户名
 * @param {number} tweetCount - 获取推文数量
 * @returns {Promise<Object>} 账号信息
 */
async function getAccountWithTweets(screenName, tweetCount = 20) {
  try {
    const userInfo = await getUserByScreenName(screenName);
    const tweets = await getUserTweets(userInfo.id, { count: tweetCount });

    return {
      type: 'account',
      screen_name: userInfo.screen_name,
      name: userInfo.name,
      description: userInfo.description,
      followers_count: userInfo.followers_count,
      verified: userInfo.verified,
      is_blue_verified: userInfo.is_blue_verified,
      statuses_count: userInfo.statuses_count,
      tweets: tweets.map(t => ({
        tweet_id: t.tweet_id,
        text: t.text,
        created_at: t.created_at
      }))
    };
  } catch (error) {
    console.error(`获取账号信息失败: ${error.message}`);
    return null;
  }
}

/**
 * 获取社区信息（含推文）
 * @param {string} communityId - 社区ID
 * @param {number} tweetCount - 获取推文数量
 * @returns {Promise<Object>} 社区信息
 */
async function getCommunityWithTweets(communityId, tweetCount = 20) {
  try {
    const { fetchCommunityById } = await import('../../../utils/twitter-validation/communities-api.js');
    const communityInfo = await fetchCommunityById(communityId);
    if (!communityInfo) {
      return null;
    }

    const tweets = await fetchCommunityTweets(communityId, { count: tweetCount });

    return {
      type: 'community',
      id: communityInfo.id,
      name: communityInfo.name,
      description: communityInfo.description,
      members_count: communityInfo.members_count,
      moderators_count: communityInfo.moderators_count,
      timeline_tweet_count: communityInfo.timeline?.tweet_count || 0,
      tweets: tweets.map(t => ({
        tweet_id: t.tweet_id,
        text: t.text,
        created_at: t.created_at,
        user: {
          screen_name: t.user?.screen_name,
          name: t.user?.name
        }
      }))
    };
  } catch (error) {
    console.error(`获取社区信息失败: ${error.message}`);
    return null;
  }
}

/**
 * 构建地址命中的分析 Prompt
 * @param {Object} tokenData - 代币数据
 * @param {Object} accountOrCommunityData - 账号或社区数据
 * @param {Object} extraOptions - 额外选项
 * @param {Object} extraOptions.websiteInfo - 网站信息（如果地址从网站验证）
 * @returns {Promise<string|null>} 分析 Prompt
 */
export async function buildAccountCommunityAnalysisPrompt(tokenData, accountOrCommunityData, extraOptions = {}) {
  const tokenAddress = tokenData.address;
  const tokenSymbol = tokenData.symbol || '';
  const tokenName = tokenData.name || tokenData.raw_api_data?.name || '';

  // 获取代币介绍信息
  const introEn = tokenData.raw_api_data?.intro_en || '';
  const introCn = tokenData.raw_api_data?.intro_cn || '';

  // 根据类型获取数据
  const data = accountOrCommunityData.type === 'account'
    ? await getAccountWithTweets(accountOrCommunityData.screen_name)
    : await getCommunityWithTweets(accountOrCommunityData.community_id);

  if (!data) {
    return null;
  }

  const typeLabel = data.type === 'account' ? 'Twitter账号' : '社区';

  // 构建推文摘要
  const tweetsSummary = data.tweets.map((t, i) => {
    return `${i + 1}. [${t.created_at}] ${safeSubstring(t.text, 100)}`;
  }).join('\n');

  // 构建介绍信息部分
  let introSection = '';
  if (introEn || introCn) {
    introSection = '\n【代币介绍】';
    if (introCn) introSection += `\n- 中文介绍：${introCn}`;
    if (introEn) introSection += `\n- 英文介绍：${introEn}`;
  }

  // 构建合约地址验证信息
  let addressVerifiedSection;
  if (extraOptions.websiteInfo) {
    const websiteUrl = extraOptions.websiteInfo.url || '';
    addressVerifiedSection = `✅ 已命中（项目官方网站 ${websiteUrl} 的HTML中包含代币合约地址，确认为项目方发行的代币）`;
  } else {
    addressVerifiedSection = '✅ 已命中（账号的简介或推文中找到了代币合约地址）';
  }

  return `你是${typeLabel}代币分析专家。请判断代币类型并评估影响力。

【代币信息】
- 代币地址：${tokenAddress}
- 代币Symbol：${tokenSymbol}
${tokenName ? `- 代币Name：${tokenName}` : ''}${introSection}

⚠️ **合约地址验证结果：${addressVerifiedSection}**

【${typeLabel}信息】
${data.type === 'account' ? `
- 账号名：@${data.screen_name}
- 显示名：${data.name}
- 简介：${data.description || '无'}
- 粉丝数：${data.followers_count.toLocaleString()}
- 认证状态：${data.verified ? '认证' : data.is_blue_verified ? '蓝V' : '无'}
- 推文总数：${data.statuses_count.toLocaleString()}
` : `
- 社区名：${data.name}
- 简介：${data.description || '无'}
- 成员数：${data.members_count.toLocaleString()}
- 管理员数：${data.moderators_count}
- 推文总数：${data.timeline_tweet_count.toLocaleString()}
`}

【近期推文（${data.tweets.length}条）】
${tweetsSummary}
${extraOptions.websiteInfo?.content ? `
【项目网站内容】（来源：${extraOptions.websiteInfo.url}）
${safeSubstring(extraOptions.websiteInfo.content, 2000)}
` : ''}

╔══════════════════════════════════════════════════════════════════════════════╗
║            ${typeLabel}代币分析框架（合约地址已验证）                           ║
╚══════════════════════════════════════════════════════════════════════════════╝

【分析目标】
判断代币类型（项目币 vs Web3原生IP早期），并根据类型进行评估：

═══════════════════════════════════════════════════════════════════════════════

📋 **第一步：币种类型判断（分流检查）**

🎯 **核心判断**：这是项目币，还是Web3原生IP早期？

**判断标准**：

**项目币特征**：
${data.type === 'account' ? `
- 账号简介介绍具体产品、技术、服务、开发计划
- 推文内容涉及技术更新、产品发布、开发进展、商务合作
- 有明确的官网、白皮书、技术文档链接
- 语言风格正式，强调功能性、实用性
` : `
- 社区介绍涉及具体产品、技术、服务、开发计划
- 讨论内容围绕技术更新、产品发布、开发进展
- 有明确的官网、白皮书、技术文档链接
- 语言正式，强调功能性、实用性
`}

**Web3原生IP早期特征**：
- **创造了一个全新的IP概念/称号/角色**（这个概念在代币创建前并不存在）
- 这个新IP可能基于加密行业人物/概念作为**灵感来源**，但**不是直接使用原名**
- **关键区别**：是否创造了一个**新的名称/称号**？
- **例子对比**：
  - ✅ "币安之王" - 创造了新称号"币安之王" → Web3原生IP早期
  - ✅ "ETH之神" - 创造了新称号"ETH之神" → Web3原生IP早期
  - ✅ "火星CEO" - 创造了新概念 → Web3原生IP早期
  - ✅ "币安女英雄" / "Heroine of Binance" - 创造了新称号"女英雄" → Web3原生IP早期
  - ✅ "币安改变人生" - 创造了新概念"改变人生" → Web3原生IP早期
- **判断要点**：
  - 只要**创造了新的称号/角色定位/概念**（如"女英雄"、"之王"、"之神"、"改变人生"），就应该判断为Web3原生IP早期
- **基础设施特点**：
  - 至少有账号/网站/社区中的1个
  - 如果有网站，通常是独立站点（不是第三方平台）
- 社区规模较小（${data.type === 'account' ? '粉丝<5000' : '社区成员<500'}）
- 内容数量较少（推文<50条）
- 处于IP塑造早期阶段

**判断结果与处理**：

**情况1：tokenType = "project"（项目币）**
- 继续第二、三步，完成影响力评级
- 直接返回评级结果

**情况2：tokenType = "web3_native_ip_early"（Web3原生IP早期）**
- 直接返回 rating = "unrated"
- 原因：Web3原生IP处于早期发展阶段，需等待社区成长后再评估
- **不执行第二、三步**

═══════════════════════════════════════════════════════════════════════════════

📋 **第二步：底线指标检查（仅项目币执行）**

🎯 **底线要求**（低于此值将被过滤）：
${data.type === 'account' ? `
- 粉丝数 ≥ 60
` : `
- 成员数 ≥ 20
`}

**⚠️ 如果不满足底线**：直接返回 rating = "low"，reason = "底线指标不达标（被过滤）"

═══════════════════════════════════════════════════════════════════════════════

📋 **第三步：影响力评级（仅项目币执行）**

**⚠️ 只有通过第一步且判断为项目币才执行评级**

${data.type === 'account' ? `
**账号评级标准**（仅对满足底线≥60的账号）：

| 等级 | 粉丝数 | 认证状态 | 评级 |
|------|--------|----------|------|
| high | 300 - 2999 | 认证/蓝V优先 | high |
| mid | 60 - 299 | 任意 | mid |
| low | < 60 | - | low（被过滤） |

**参考因素**：
- 认证/蓝V账号可适当降低粉丝要求
- 推文活跃度、互动情况作为参考
` : `
**社区评级标准**（仅对满足底线≥20的社区）：

| 等级 | 成员数 | 推文活跃度 | 评级 |
|------|--------|------------|------|
| high | 100 - 999 | 日活高 | high |
| mid | 20 - 99 | 中等活跃 | mid |
| low | < 20 | - | low（被过滤） |

**参考因素**：
- 推文总数反映社区活跃度
- 成员增长趋势（如果有）
`}

═══════════════════════════════════════════════════════════════════════════════

【输出格式】

**只返回JSON，不要其他内容**：

{
  "tokenType": "project" | "web3_native_ip_early",
  "baselineMet": true/false,  // 仅当tokenType="project"时需要填写
  "rating": "low" | "mid" | "high" | "unrated",  // project时为low/mid/high；web3_native_ip_early固定unrated
  "reason": "原因说明",
  "details": {
    "followers": ${data.type === 'account' ? data.followers_count : 'null'},
    "members": ${data.type === 'community' ? data.members_count : 'null'},
    "projectReason": "判断为项目币的原因（仅当tokenType='project'时需要）",
    "ipConcept": "Web3原生IP的概念描述（仅当tokenType='web3_native_ip_early'时需要，如'币安的守护者'、'ETH之神'等）"
  }
}

**当 tokenType = "project" 时**：
- baselineMet: 必填，底线指标是否达标
- rating: 必填，最终评级（low/mid/high）
- projectReason: 必填，判断为项目币的原因

**当 tokenType = "web3_native_ip_early" 时**：
- rating: 必填，固定为 "unrated"
- reason: 必填，说明判断为Web3原生IP早期的原因
- ipConcept: 必填，描述IP的概念（如"币安的守护者"、"ETH之神"、"币安改变人生"等）
- baselineMet: 留空或null
`;
}
