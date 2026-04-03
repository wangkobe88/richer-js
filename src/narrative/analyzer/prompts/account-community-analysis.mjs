/**
 * 账号/社区代币分析 Prompt
 * V1.0 - 专门针对只有账号/社区信息的代币
 *
 * 使用场景：
 * - 代币链接只有 Twitter 账号或社区
 * - 没有可获取的推文、网站、电报、Discord 等其他信息
 *
 * 分析重点：
 * 1. 代币地址验证（bio/推文中必须包含地址）
 * 2. 底线指标检查（粉丝≥60，成员≥20）
 * 3. 影响力评级（low/mid/high）
 */

import {
  getUserByScreenName,
  getUserTweets,
  fetchCommunityTweets
} from '../../../utils/twitter-validation/index.js';

/**
 * Prompt版本号
 */
export const ACCOUNT_COMMUNITY_ANALYSIS_PROMPT_VERSION = 'V1.0';

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
 * 构建账号/社区代币分析 Prompt
 * @param {Object} tokenData - 代币数据
 * @param {Object} accountOrCommunityData - 账号或社区数据
 * @returns {Promise<string>} 分析 Prompt
 */
export async function buildAccountCommunityAnalysisPrompt(tokenData, accountOrCommunityData) {
  const tokenAddress = tokenData.address;
  const tokenSymbol = tokenData.symbol || '';
  const tokenName = tokenData.name || tokenData.raw_api_data?.name || '';

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
    return `${i + 1}. [${t.created_at}] ${t.text.substring(0, 100)}${t.text.length > 100 ? '...' : ''}`;
  }).join('\n');

  return `你是${typeLabel}代币分析专家。请验证代币地址的合法性并评估影响力。

【代币信息】
- 代币地址：${tokenAddress}
- 代币Symbol：${tokenSymbol}
${tokenName ? `- 代币Name：${tokenName}` : ''}

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
║                    ${typeLabel}代币分析框架                                            ║
╚══════════════════════════════════════════════════════════════════════════════╝

【分析目标】
判断代币是否：
1. 真实关联（地址在${typeLabel}中明确出现）
2. 名称匹配（代币名与${typeLabel}名匹配）
3. 满足底线指标
4. 具有传播潜力

═══════════════════════════════════════════════════════════════════════════════

📋 **第一步：代币地址验证（阻断性检查）**

🎯 **核心判断**：代币地址是否在${typeLabel}中明确出现？

**检查位置**：
${data.type === 'account' ? `
1. 账号简介（bio/description）
2. 近20条推文内容
` : `
1. 社区简介（description）
2. 近20条推文内容
`}

**验证标准**：
- 必须找到完整匹配的代币地址（${tokenAddress}）
- 缩写、部分匹配、相似地址都不算

**⚠️ 如果未找到完整地址**：直接返回 rating = "low"，reason = "地址验证失败"

═══════════════════════════════════════════════════════════════════════════════

📋 **第二步：名称匹配检查（阻断性检查）**

🎯 **核心判断**：代币名称与${typeLabel}名称是否匹配？

**匹配标准**：
${data.type === 'account' ? `
- 代币Symbol 或 Name 与 账号名（screen_name）或 显示名（name）匹配
- 匹配方式：精确匹配、包含匹配、去掉空格/下划线/横线后匹配
- 示例：代币"ABC"与账号@ABC_Official匹配 ✓
` : `
- 代币Symbol 或 Name 与 社区名称 匹配
- 匹配方式：精确匹配、包含匹配、去掉空格/下划线/横线后匹配
- 示例：代币"ABC"与社区"ABC Community"匹配 ✓
`}

**⚠️ 如果名称不匹配**：直接返回 rating = "low"，reason = "代币名称与${typeLabel}名称不匹配"

═══════════════════════════════════════════════════════════════════════════════

📋 **第三步：底线指标检查（阻断性检查）**

🎯 **底线要求**（低于此值将被过滤）：
${data.type === 'account' ? `
- 粉丝数 ≥ 60
` : `
- 成员数 ≥ 20
`}

**⚠️ 如果不满足底线**：直接返回 rating = "low"，reason = "底线指标不达标（被过滤）"

═══════════════════════════════════════════════════════════════════════════════

📋 **第四步：影响力评级**

**⚠️ 只有通过前三步才执行评级**

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
  "addressVerified": true/false,
  "nameMatch": true/false,
  "baselineMet": true/false,
  "rating": "low" | "mid" | "high",
  "reason": "原因说明",
  "details": {
    "addressLocations": ["简介", "推文3"],
    "nameMatchType": "symbol" 或 "name" 或 "none",
    "followers": ${data.type === 'account' ? data.followers_count : 'null'},
    "members": ${data.type === 'community' ? data.members_count : 'null'},
    "tweetsWithAddress": 2
  }
}

⚠️ **注意**：
- addressVerified: false → 直接返回 low，无需继续
- nameMatch: false → 直接返回 low，无需继续
- baselineMet: false → 直接返回 low，无需继续
- rating: 最终评级（low/mid/high）
- reason: 简洁说明评级原因
`;
}
