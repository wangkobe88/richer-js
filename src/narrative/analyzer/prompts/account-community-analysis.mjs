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
export const ACCOUNT_COMMUNITY_ANALYSIS_PROMPT_VERSION = 'V1.5';  // V1.5: 合约地址未命中时硬性限制只能返回account_based_meme

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
export async function buildAccountCommunityAnalysisPrompt(tokenData, accountOrCommunityData, addressVerified = true, extraOptions = {}) {
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

  // 构建合约地址验证信息
  let addressVerifiedSection;
  if (extraOptions.projectCoinFromWebsite) {
    const websiteUrl = extraOptions.websiteInfo?.url || '';
    addressVerifiedSection = `✅ 已命中（项目官方网站 ${websiteUrl} 的HTML中包含代币合约地址，确认为项目方发行的代币）`;
  } else {
    addressVerifiedSection = addressVerified
      ? '✅ 已命中（账号的简介或推文中找到了代币合约地址）'
      : '❌ 未命中（账号的简介和推文中都没有找到代币合约地址）';
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
${extraOptions.projectCoinFromWebsite && extraOptions.websiteInfo?.content ? `
【项目网站内容】（来源：${extraOptions.websiteInfo.url}）
${extraOptions.websiteInfo.content.substring(0, 2000)}
` : ''}

╔══════════════════════════════════════════════════════════════════════════════╗
║                    ${typeLabel}代币分析框架                                            ║
╚══════════════════════════════════════════════════════════════════════════════╝

【分析目标】
判断代币类型（项目币 vs 传统meme币 vs 以账号为背景的meme币 vs Web3原生IP早期），并根据类型进行评估：

═══════════════════════════════════════════════════════════════════════════════

📋 **第一步：币种类型判断（分流检查）**

🎯 **核心判断**：这是项目币、传统meme币、以账号为背景的meme币，还是Web3原生IP早期？

**判断标准**：

${!addressVerified ? `
🔴🔴🔴 **硬性规则：合约地址未命中，tokenType 必须为 "account_based_meme"** 🔴🔴🔴

**禁止返回以下类型**：
- ❌ tokenType = "project"：真项目方会在账号中公示合约地址，没有地址说明这不是项目方官方代币
- ❌ tokenType = "meme"：传统meme币依托已有成熟IP（Trump、PEPE、Doge等），依托账号的必然是改造过的新IP，不是传统meme
- ❌ tokenType = "web3_native_ip_early"：Web3原生IP早期要求合约名在账号中命中，否则任何人都可以随意命名一个"新IP概念"来作弊

**必须返回**：tokenType = "account_based_meme"

` : ''}${data.type === 'account' ? `
**项目币特征**：
- 账号简介介绍具体产品、技术、服务、开发计划
- 推文内容涉及技术更新、产品发布、开发进展、商务合作
- 有明确的官网、白皮书、技术文档链接
- 语言风格正式，强调功能性、实用性

**传统meme币特征**：
- 依托现实中**已有、成熟**的IP/热点/事件（如特朗普当选、PEPE青蛙、Doge狗、SpaceX等）
- 这些IP在代币创建前就已经存在并有一定知名度
- 代币**直接使用现成的IP名称**（如"Trump"、"PEPE"、"Doge"）
- **特别说明**：如果是基于真实人物，**必须直接使用人物原名**才算传统meme币
  - ✅ "CZ" - 直接使用CZ原名 → 传统meme币
  - ✅ "Yihe" - 直接使用Yihe原名 → 传统meme币
  - ❌ "币安女英雄" - 创造了新称号"女英雄" → Web3原生IP早期
  - ❌ "币安之王" - 创造了新称号"之王" → Web3原生IP早期
- **例子**：
  - "Trump" - 直接使用特朗普的名字
  - "PEPE" - 直接使用PEPE青蛙梗的名称
  - "Doge" - 直接使用Doge表情包的名称
- 有明确的热度爆发点（新闻事件、网络热搜、病毒传播）
- 代币介绍/账号简介中有具体的热度数据（播放量、转发量、热搜排名等）
- 内容多为转发热点、跟风造梗

**以账号为背景的meme币特征**（新增类型）：
- **触发条件**：账号中没有代币地址，但账号质量达到阈值（粉丝≥500且发推≥20，或粉丝≥1000且有认证，或粉丝≥3000）
- **核心特征**：
  - 代币名称与账号名称/简介存在关联（精确匹配、缩写、或语义关联）
  - 账号近期活跃（最近7天内有推文）
  - 有与Web3圈子的交互事件（如提及CZ、币安、Binance、BTC、ETH等加密相关关键词）
- **匹配类型**：
  - **精确匹配**：代币Symbol/Name = 账号名/显示名（如 "PP" = "Prison Professors"）
  - **缩写匹配**：代币Symbol是账号名的常见缩写（如 "MS" = "Michael Santos"）
  - **语义关联**：代币名与账号简介/内容有明确的语义关联（如 "Prison Professors" 与监狱教育相关）
- **Web3流量事件判断**：
  - 流量事件 = 账号**自身**产生了实际的Web3相关关注度/互动量
  - ✅ 有流量事件（满足任一）：
    - 账号被知名加密KOL/机构（CZ、Binance、a16z等）**主动提及或互动**（不是账号自己@对方）
    - 账号的原创加密内容获得了**显著互动数据**（大量点赞/转发/评论，而非个位数）
    - 账号与Web3大IP有**真实的双向互动**（双方都有回应，非单向@）
  - ❌ 不算流量事件（常见误判）：
    - 简介中的自我声明（如"Backed by XX"、"Partnered with XX"）→ 无证据支撑，不算
    - 转发别人的内容（无论转发的是谁）→ 不代表账号自身有流量
    - 账号主动@了大IP但没有得到回应 → 单方面行为，不算
    - 发了一条营销推文但没有互动数据 → 无流量证据
  - 必须是近期的（30天内）
- **通过条件**（必须同时满足以下2项）：
  1. **名称关联**：代币名称与账号名称/简介存在明确关联（精确匹配、缩写、或语义关联）
  2. **Web3流量事件**：账号近期有真实的Web3流量事件（按上述标准判断）
- **处理方式**：
  - 满足通过条件 → tokenType = "account_based_meme"，rating = "unrated"
  - 不满足通过条件 → tokenType = "account_based_meme"，rating = "low"，reason 说明不满足的具体条件

**Web3原生IP早期特征**：
- **创造了一个全新的IP概念/称号/角色**（这个概念在代币创建前并不存在）
- 这个新IP可能基于加密行业人物/概念作为**灵感来源**，但**不是直接使用原名**
- **关键区别**：是否创造了一个**新的名称/称号**？
- **例子对比**：
  - ❌ "CZ" - 直接使用CZ的名字，这是传统meme币
  - ✅ "币安之王" - 创造了新称号"币安之王"，这是Web3原生IP早期
  - ❌ "Vitalik" - 直接使用Vitalik的名字，这是传统meme币
  - ✅ "ETH之神" - 创造了新称号"ETH之神"，这是Web3原生IP早期
  - ❌ "Musk" - 直接使用马斯克的名字，这是传统meme币
  - ✅ "火星CEO" - 创造了新概念，可能是Web3原生IP早期
  - ❌ "Yihe" - 直接使用Yihe的名字，这是传统meme币
  - ✅ "币安女英雄" / "Heroine of Binance" - 创造了新称号"女英雄"，这是Web3原生IP早期
- **判断要点**：
  - 即使是基于真实人物，只要**创造了新的称号/角色定位**（如"女英雄"、"之王"、"之神"），就应该判断为Web3原生IP早期
  - 只有**直接使用人物原名**（如"CZ"、"Yihe"、"Trump"）才是传统meme币
- **基础设施特点**：
  - 至少有账号/网站/社区中的1个
  - 如果有网站，通常是独立站点（不是第三方平台）
- 社区规模较小（粉丝<5000，或社区成员<500）
- 内容数量较少（推文<50条）
- 处于IP塑造早期阶段
` : `
**项目币特征**：
- 社区介绍涉及具体产品、技术、服务、开发计划
- 讨论内容围绕技术更新、产品发布、开发进展
- 有明确的官网、白皮书、技术文档链接
- 语言正式，强调功能性、实用性

**传统meme币特征**：
- 依托现实中**已有、成熟**的IP/热点/事件（如特朗普当选、PEPE青蛙、Doge狗、SpaceX等）
- 这些IP在代币创建前就已经存在并有一定知名度
- 代币**直接使用现成的IP名称**（如"Trump"、"PEPE"、"Doge"）
- **例子**：
  - "Trump" - 直接使用特朗普的名字
  - "PEPE" - 直接使用PEPE青蛙梗的名称
  - "Doge" - 直接使用Doge表情包的名称
- 有明确的热度爆发点（新闻事件、网络热搜、病毒传播）
- 代币介绍/社区简介中有具体的热度数据（播放量、转发量、热搜排名等）
- 内容多为转发热点、跟风造梗

**Web3原生IP早期特征**：
- **创造了一个全新的IP概念/称号/角色**（这个概念在代币创建前并不存在）
- 这个新IP可能基于加密行业人物/概念作为**灵感来源**，但**不是直接使用原名**
- **关键区别**：是否创造了一个**新的名称/称号**？
- **例子对比**：
  - ❌ "CZ" - 直接使用CZ的名字，这是传统meme币
  - ✅ "币安之王" - 创造了新称号"币安之王"，这是Web3原生IP早期
  - ❌ "Vitalik" - 直接使用Vitalik的名字，这是传统meme币
  - ✅ "ETH之神" - 创造了新称号"ETH之神"，这是Web3原生IP早期
  - ❌ "Musk" - 直接使用马斯克的名字，这是传统meme币
  - ✅ "火星CEO" - 创造了新概念，可能是Web3原生IP早期
- **基础设施特点**：
  - 至少有账号/网站/社区中的1个
  - 如果有网站，通常是独立站点（不是第三方平台）
- 社区规模较小（社区成员<500）
- 内容数量较少（推文<50条）
- 处于IP塑造早期阶段
`}

**判断结果与处理**：

**情况1：tokenType = "project"（项目币）**
- 继续第二、三步，完成影响力评级
- 直接返回评级结果

**情况2：tokenType = "meme"（传统meme币）**
- 需要额外生成账号摘要（用于后续meme币分析流程）
- 跳过第二、三步，转入meme币两阶段分析流程
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

**情况2.5：tokenType = "account_based_meme"（以账号为背景的meme币）**
- **通过条件检查**：必须同时满足以下2项
  1. **名称关联**：代币名称与账号名称/简介存在明确关联（精确匹配、缩写、或语义关联）
  2. **Web3流量事件**：账号自身产生了实际的Web3相关关注度（被大IP主动互动、原创内容获显著互动等；简介声明/RT别人不算）
- 满足通过条件 → rating = "unrated"
- 不满足通过条件 → rating = "low"，reason 说明不满足的具体条件
- **必须填写以下字段**：
  - accountMatchDetails：代币名称与账号的匹配情况（精确匹配/缩写匹配/语义关联/无关联）
  - accountActivity：账号近期活跃情况（最近推文时间、推文频率等）
  - web3Interaction：与Web3圈子的交互事件（提及的加密相关内容/无Web3交互）
- **不生成账号摘要，不进入两阶段分析**

**情况3：tokenType = "web3_native_ip_early"（Web3原生IP早期）**
- 直接返回 rating = "unrated"
- 原因：Web3原生IP处于早期发展阶段，需等待社区成长后再评估
- **不生成账号摘要，不进入两阶段分析**

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
  "tokenType": "project" | "meme" | "account_based_meme" | "web3_native_ip_early",
  "baselineMet": true/false,  // 仅当tokenType="project"时需要填写
  "rating": "low" | "mid" | "high" | "unrated",  // tokenType="project"时为low/mid/high；account_based_meme满足条件为unrated不满足为low；其他为unrated
  "reason": "原因说明",
  "accountSummary": "账号摘要（仅当tokenType='meme'时需要）",
  "details": {
    "followers": ${data.type === 'account' ? data.followers_count : 'null'},
    "members": ${data.type === 'community' ? data.members_count : 'null'},
    "projectReason": "判断为项目币的原因",
    "memeReason": "判断为meme币的原因",
    "accountMatchDetails": "代币名称与账号的匹配情况（仅当tokenType='account_based_meme'时需要）",
    "accountActivity": "账号近期活跃情况（仅当tokenType='account_based_meme'时需要）",
    "web3Interaction": "Web3流量事件（仅当tokenType='account_based_meme'时需要。必须有证据：被大IP主动互动/原创内容获显著互动。简介声明和RT不算）",
    "ipConcept": "Web3原生IP的概念描述（仅当tokenType='web3_native_ip_early'时需要）"
  }
}

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

**当 tokenType = "account_based_meme" 时**：
- rating: 必填，满足通过条件为 "unrated"，不满足为 "low"
- reason: 必填，说明判断原因；如果rating为low，需说明不满足的具体条件
- accountMatchDetails: 必填，描述代币名称与账号的匹配情况
  - 匹配类型：精确匹配/缩写匹配/语义关联
  - 具体说明：如"代币Symbol 'PP' 与账号名 'Prison Professors' 精确匹配"
- accountActivity: 必填，描述账号近期活跃情况
  - 最近推文时间：如"最后一条推文发布于2天前"
  - 推文频率：如"平均每天发布2-3条推文"
- web3Interaction: 必填，描述与Web3圈子的流量事件
  - 有流量事件：描述具体事件，如"近期与CZ互动"、"原创加密内容获得大量传播"
  - 无流量事件：明确说明"无近期Web3流量事件，仅RT他人内容"
- accountSummary: 留空或null
- baselineMet: 留空或null

**当 tokenType = "project" 时**：
- baselineMet: 必填，底线指标是否达标
- rating: 必填，最终评级（low/mid/high）
- accountSummary: 留空或null

**当 tokenType = "web3_native_ip_early" 时**：
- rating: 必填，固定为 "unrated"
- reason: 必填，说明判断为Web3原生IP早期的原因
- ipConcept: 必填，描述IP的概念（如"币安的守护者"、"ETH之神"等）
- accountSummary: 留空或null
- baselineMet: 留空或null
`;
}
