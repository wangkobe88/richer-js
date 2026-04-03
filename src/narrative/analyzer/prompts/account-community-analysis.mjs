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
    return `${i + 1}. [${t.created_at}] ${t.text.substring(0, 100)}${t.text.length > 100 ? '...' : ''}`;
  }).join('\n');

  // 构建介绍信息部分
  let introSection = '';
  if (introEn || introCn) {
    introSection = '\n【代币介绍】';
    if (introCn) introSection += `\n- 中文介绍：${introCn}`;
    if (introEn) introSection += `\n- 英文介绍：${introEn}`;
  }

  return `你是${typeLabel}代币分析专家。请验证代币地址的合法性并评估影响力。

【代币信息】
- 代币地址：${tokenAddress}
- 代币Symbol：${tokenSymbol}
${tokenName ? `- 代币Name：${tokenName}` : ''}${introSection}

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

📋 **第二步+: 币种类型判断（分流检查）**

🎯 **核心判断**：这是项目币还是meme币？

**判断标准**：

${data.type === 'account' ? `
**项目币特征**：
- 账号简介介绍具体产品、技术、服务、开发计划
- 推文内容涉及技术更新、产品发布、开发进展、商务合作
- 有明确的官网、白皮书、技术文档链接
- 语言风格正式，强调功能性、实用性

**meme币特征**：
- 账号简介纯meme内容：搞笑图片、网络梗、文化符号、动物形象
- 推文内容多为喊单、互动、造梗、跟风热点
- 没有实质产品介绍，或介绍的内容明显是噱头
- 语言风格轻松、玩梗、强调社区和"to the moon"
` : `
**项目币特征**：
- 社区介绍涉及具体产品、技术、服务、开发计划
- 讨论内容围绕技术更新、产品发布、开发进展
- 有明确的官网、白皮书、技术文档链接
- 语言正式，强调功能性、实用性

**meme币特征**：
- 社区纯meme内容：围绕网络梗、文化符号、动物形象
- 讨论多为喊单、互动、造梗、跟风热点
- 没有实质产品介绍，或介绍的内容明显是噱头
- 语言轻松、玩梗、强调社区和"to the moon"
`}

**⚠️ 如果判断为meme币**：
- 需要额外生成账号摘要（用于后续meme币分析流程）
- 跳过第三、四步，转入meme币两阶段分析流程
- **重要**：账号摘要必须包含具体事件信息！
  - 提取代币依托的具体"事件"是什么
  - **必须从代币介绍、账号简介、推文中提取所有相关信息**：
    - 代币介绍中的具体描述（如"年度爆火meme"、"全网热度超过百亿播放"等）
    - 账号简介中的IP定位（如"电子宠物"、"现象级IP"等）
    - 推文中的热度数据、传播描述（如"从XX到XX"、"二创人数"等）
  - **以下这些都算事件**：
    1. IP概念、角色设定（如"电子宠物IP"、"虚拟猫咪"）
    2. 热度传播（如"全网热度破百亿"、"从XX到现象级IP"）
    3. 成长过程（如"从玩梗符号到XX"）
    4. 具体数据（如播放量、二创人数、热度排名等）
  - 不要只说"营销账号"，要详细说明营销的是什么IP/事件/梗，包含所有关键数据

**⚠️ 如果判断为项目币**：
- 继续第三、四步，完成影响力评级
- 直接返回评级结果

═══════════════════════════════════════════════════════════════════════════════

📋 **第三步：底线指标检查（仅项目币执行）**

🎯 **底线要求**（低于此值将被过滤）：
${data.type === 'account' ? `
- 粉丝数 ≥ 60
` : `
- 成员数 ≥ 20
`}

**⚠️ 如果不满足底线**：直接返回 rating = "low"，reason = "底线指标不达标（被过滤）"

═══════════════════════════════════════════════════════════════════════════════

📋 **第四步：影响力评级（仅项目币执行）**

**⚠️ 只有通过前两步+且判断为项目币才执行评级**

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
  "tokenType": "project" | "meme",
  "baselineMet": true/false,  // 仅当tokenType="project"时需要填写
  "rating": "low" | "mid" | "high",  // 仅当tokenType="project"时需要填写
  "reason": "原因说明",
  "accountSummary": "账号摘要（仅当tokenType='meme'时需要）",
  "details": {
    "addressLocations": ["简介", "推文3"],
    "nameMatchType": "symbol" | "name" | "none",
    "followers": ${data.type === 'account' ? data.followers_count : 'null'},
    "members": ${data.type === 'community' ? data.members_count : 'null'},
    "tweetsWithAddress": 2,
    "projectReason": "判断为项目币的原因",
    "memeReason": "判断为meme币的原因"
  }
}

⚠️ **注意**：
- addressVerified: false → 直接返回 low，无需继续
- nameMatch: false → 直接返回 low，无需继续

**当 tokenType = "meme" 时**：
- accountSummary: 必填，生成账号摘要（200-300字）
  - **必须包含具体事件/IP概念**！
    - 提取代币依托的"事件"是什么：IP推出、角色诞生、概念提出、热度传播
    - **以下都算事件**：
      1. IP概念：电子宠物、虚拟形象、文化符号、现象级XX
      2. 热度传播：全网热度破百亿、从XX到XX、成长过程、演变路径
      3. 具体事件：某只动物的趣事、某个网络热点、某个搞笑事件
    - **必须从所有来源提取具体描述**：
      - 代币介绍：如"年度爆火meme"、"超过百亿播放"、"50w人二创"
      - 账号简介：如"电子宠物"、"现象级IP"
      - 推文内容：如"从玩梗符号到全网热度"、"热度排名"等
    - 不要只说"营销账号"，要详细说明营销的是什么事件/IP/梗
    - 包含所有关键数据：播放量、二创人数、热度排名等
  - 账号信息：账号名称、简介核心内容
  - 推文精简：提取主要话题和互动风格，不要逐条罗列
  - 如果确实没有任何事件/IP概念，明确说明"无具体事件/IP概念，只有营销宣传"
- baselineMet, rating: 留空或null

**当 tokenType = "project" 时**：
- baselineMet: 必填，底线指标是否达标
- rating: 必填，最终评级（low/mid/high）
- accountSummary: 留空或null
`;
}
