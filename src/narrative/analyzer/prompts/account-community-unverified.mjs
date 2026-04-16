/**
 * 账号/社区代币分析 Prompt - 地址不命中专用
 * V1.0 - 合约地址在账号简介/推文中未找到时的专用 prompt
 *
 * 使用场景：
 * - 代币合约地址不在账号的简介或推文中
 * - 唯一分类：account_based_meme（以账号为背景的meme币）
 *
 * 核心逻辑：
 * - 合约地址未命中 → 说明这不是项目方官方代币
 * - 判断代币名称与账号的关联程度 + 账号的 Web3 流量事件
 * - 决定 rating = unrated（通过）或 low（不通过）
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
export const ACCOUNT_COMMUNITY_UNVERIFIED_PROMPT_VERSION = 'V1.0';

/**
 * 获取账号信息（含推文）- 从 account-community-analysis.mjs 导入有循环依赖风险，此处直接实现
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
 * 构建地址不命中的分析 Prompt
 * @param {Object} tokenData - 代币数据
 * @param {Object} accountOrCommunityData - 账号或社区数据
 * @returns {Promise<string|null>} 分析 Prompt
 */
export async function buildUnverifiedPrompt(tokenData, accountOrCommunityData) {
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

  return `你是${typeLabel}代币分析专家。

【代币信息】
- 代币地址：${tokenAddress}
- 代币Symbol：${tokenSymbol}
${tokenName ? `- 代币Name：${tokenName}` : ''}${introSection}

⚠️ **合约地址验证结果：❌ 未命中（账号的简介和推文中都没有找到代币合约地址）**

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

╔══════════════════════════════════════════════════════════════════════════════╗
║              以账号为背景的meme币分析（合约地址未命中）                      ║
╚══════════════════════════════════════════════════════════════════════════════╝

🔴 **硬性规则：合约地址未命中，tokenType 固定为 "account_based_meme"**

**说明**：真项目方会在账号中公示合约地址。地址未命中说明这不是项目方的官方代币，而是以账号为背景的meme币。

═══════════════════════════════════════════════════════════════════════════════

📋 **第一步：名称关联判断**

判断代币名称与账号名称/简介是否存在关联：

**匹配类型**：
- **精确匹配**：代币Symbol/Name = 账号名/显示名（如 "PP" = "Prison Professors"）
- **缩写匹配**：代币Symbol是账号名的常见缩写（如 "MS" = "Michael Santos"）
- **语义关联**：代币名与账号简介/内容有明确的语义关联（如 "Prison Professors" 与监狱教育相关）
- **无关联**：代币名称与账号毫无关系

═══════════════════════════════════════════════════════════════════════════════

📋 **第二步：Web3 流量事件判断**

流量事件 = 账号**自身**产生了实际的Web3相关关注度/互动量

✅ **有流量事件**（满足任一）：
- 账号被知名加密KOL/机构（CZ、Binance、a16z等）**主动提及或互动**（不是账号自己@对方）
- 账号的原创加密内容获得了**显著互动数据**（大量点赞/转发/评论，而非个位数）
- 账号与Web3大IP有**真实的双向互动**（双方都有回应，非单向@）

❌ **不算流量事件**（常见误判）：
- 简介中的自我声明（如"Backed by XX"、"Partnered with XX"）→ 无证据支撑，不算
- 转发别人的内容（无论转发的是谁）→ 不代表账号自身有流量
- 账号主动@了大IP但没有得到回应 → 单方面行为，不算
- 发了一条营销推文但没有互动数据 → 无流量证据

必须是近期的（30天内）。

═══════════════════════════════════════════════════════════════════════════════

📋 **第三步：综合评定**

**通过条件**（必须同时满足以下2项）：
1. **名称关联**：代币名称与账号名称/简介存在明确关联（精确匹配、缩写、或语义关联）
2. **Web3流量事件**：账号近期有真实的Web3流量事件（按上述标准判断）

- 满足通过条件 → rating = "unrated"
- 不满足通过条件 → rating = "low"，reason 说明不满足的具体条件

═══════════════════════════════════════════════════════════════════════════════

【输出格式】

**只返回JSON，不要其他内容**：

{
  "tokenType": "account_based_meme",
  "rating": "low" | "unrated",
  "reason": "判断原因",
  "details": {
    "followers": ${data.type === 'account' ? data.followers_count : 'null'},
    "members": ${data.type === 'community' ? data.members_count : 'null'},
    "accountMatchDetails": "代币名称与账号的匹配情况（必填）：匹配类型 + 具体说明",
    "accountActivity": "账号近期活跃情况（必填）：最近推文时间、推文频率等",
    "web3Interaction": "Web3流量事件（必填）：有则描述具体事件，无则明确说明"
  }
}

**字段要求**：
- tokenType：固定为 "account_based_meme"
- rating：满足通过条件为 "unrated"，不满足为 "low"
- reason：说明判断原因；如果rating为low，需说明不满足的具体条件
- accountMatchDetails：匹配类型（精确匹配/缩写匹配/语义关联/无关联）+ 具体说明
- accountActivity：最近推文时间、推文频率等
- web3Interaction：有流量事件则描述具体事件；无则明确说明"无近期Web3流量事件"
`;
}
