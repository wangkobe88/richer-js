/**
 * 代币分析Prompt
 * V12.0 - 新框架第二阶段：代币分析
 *
 * 分析重点：
 * 1. 代币-事件关联性检查（继承 Stage 1 第二阶段 + 三层匹配）
 * 2. 代币传播潜力评估（继承 Stage 2 评分体系）
 *
 * 存储位置：llm_stage2_* 字段
 */

import { buildTwitterSection } from './sections/twitter-section.mjs';
import { buildWebsiteSection } from './sections/website-section.mjs';
import { buildVideoSection } from './sections/video-section.mjs';
import { buildGithubSection } from './sections/github-section.mjs';
import { buildWeiboSection } from './sections/weibo-section.mjs';
import { buildWeixinSection } from './sections/weixin-section.mjs';
import { buildAmazonSection } from './sections/amazon-section.mjs';
import { generateAccountBackgroundsPrompt } from './account-backgrounds.mjs';

/**
 * Prompt版本号
 */
export const TOKEN_ANALYSIS_PROMPT_VERSION = 'V12.0';

/**
 * 构建代币分析Prompt
 * @param {Object} tokenData - 代币数据
 * @param {Object} fetchResults - 获取的数据结果
 * @param {Object} eventAnalysis - 事件分析结果
 * @returns {string} 代币分析Prompt
 */
export function buildTokenAnalysisPrompt(tokenData, fetchResults, eventAnalysis) {
  const {
    twitterInfo = null,
    websiteInfo = null,
    extractedInfo = null,
    backgroundInfo = null,
    githubInfo = null,
    youtubeInfo = null,
    douyinInfo = null,
    tiktokInfo = null,
    bilibiliInfo = null,
    weixinInfo = null,
    amazonInfo = null,
    classifiedUrls = null,
    accountSummary = null  // 账号摘要（来自账号/社区分析分流）
  } = fetchResults;

  const sections = [];

  // 1. 开头：代币信息和事件分析结果
  const chainName = (tokenData.blockchain || tokenData.platform || 'BSC').toUpperCase();
  const symbol = tokenData.symbol || '';
  const tokenName = tokenData.name || tokenData.raw_api_data?.name || '';
  const charCount = symbol.length;

  sections.push(`你是代币分析专家。请分析代币与事件的关联性及其传播潜力。

【代币信息】
- 代币Symbol：${tokenData.symbol}${tokenName ? ` (${tokenName})` : ''}（${charCount}字符）
- 代币地址：${tokenData.address}
- 所属链：${chainName}${chainName === 'BSC' ? '（币安智能链，CZ/何一相关叙事适用溢价规则）' : ''}`);

  if (extractedInfo.intro_en) sections[0] += `\n- 介绍（英文）：${extractedInfo.intro_en}`;
  if (extractedInfo.intro_cn) sections[0] += `\n- 介绍（中文）：${extractedInfo.intro_cn}`;

  // 显示分类URL（与Stage 2相同）
  if (classifiedUrls) {
    const tweets = classifiedUrls.twitter?.filter(u => u.type === 'tweet') || [];
    if (tweets.length > 0) {
      sections[0] += `\n- Twitter推文：${tweets.map(u => u.url).join(', ')}`;
    }
    const accounts = classifiedUrls.twitter?.filter(u => u.type === 'account') || [];
    if (accounts.length > 0) {
      sections[0] += `\n- Twitter账号：${accounts.map(u => u.url).join(', ')}`;
    }
    if (classifiedUrls.weibo?.length > 0) {
      sections[0] += `\n- 微博：${classifiedUrls.weibo.map(u => u.url).join(', ')}`;
    }
    if (classifiedUrls.youtube?.length > 0) {
      sections[0] += `\n- YouTube：${classifiedUrls.youtube.map(u => u.url).join(', ')}`;
    }
    if (classifiedUrls.tiktok?.length > 0) {
      sections[0] += `\n- TikTok：${classifiedUrls.tiktok.map(u => u.url).join(', ')}`;
    }
    if (classifiedUrls.douyin?.length > 0) {
      sections[0] += `\n- 抖音：${classifiedUrls.douyin.map(u => u.url).join(', ')}`;
    }
    if (classifiedUrls.bilibili?.length > 0) {
      sections[0] += `\n- Bilibili：${classifiedUrls.bilibili.map(u => u.url).join(', ')}`;
    }
    if (classifiedUrls.weixin?.length > 0) {
      sections[0] += `\n- 微信文章：${classifiedUrls.weixin.map(u => u.url).join(', ')}`;
    }
    if (classifiedUrls.github?.length > 0) {
      sections[0] += `\n- GitHub：${classifiedUrls.github.map(u => u.url).join(', ')}`;
    }
    if (classifiedUrls.amazon?.length > 0) {
      sections[0] += `\n- Amazon：${classifiedUrls.amazon.map(u => u.url).join(', ')}`;
    }
    if (classifiedUrls.websites?.length > 0) {
      sections[0] += `\n- 网站：${classifiedUrls.websites.map(u => u.url).join(', ')}`;
    }
  }

  // 2. 事件分析结果（前置信息）
  if (eventAnalysis) {
    sections.push(`【前置信息：事件分析结果】

事件完整描述：
- 主题：${eventAnalysis.eventDescription?.主题 || '未知'}
- 主体：${eventAnalysis.eventDescription?.主体 || '未知'}
- 类别：${eventAnalysis.eventDescription?.类别 || '未知'}
- 时效性：${eventAnalysis.eventDescription?.时效性 || '未知'}

事件传播潜力：${eventAnalysis.propagationScore || 0}/100分`);
  }

  // 3. 账号摘要（如果存在，来自账号/社区分析分流）
  if (accountSummary) {
    sections.push(`【账号摘要】
${accountSummary}`);
  }

  // 4. 账号背景信息
  const backgrounds = generateAccountBackgroundsPrompt(twitterInfo);
  if (backgrounds) sections.push(backgrounds);

  // 5. 各类语料sections
  const twitterSection = buildTwitterSection(twitterInfo);
  if (twitterSection) sections.push(twitterSection);

  const weiboSection = buildWeiboSection(backgroundInfo);
  if (weiboSection) sections.push(weiboSection);

  const githubSection = buildGithubSection(githubInfo);
  if (githubSection) sections.push(githubSection);

  const videoSection = buildVideoSection(youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo);
  if (videoSection) sections.push(videoSection);

  const weixinSection = buildWeixinSection(weixinInfo);
  if (weixinSection) sections.push(weixinSection);

  const websiteSection = buildWebsiteSection(websiteInfo);
  if (websiteSection) sections.push(websiteSection);

  const amazonSection = buildAmazonSection(amazonInfo);
  if (amazonSection) sections.push(amazonSection);

  // 6. 代币分析框架
  sections.push(buildTokenAnalysisFramework(twitterInfo));

  return sections.filter(s => s).join('\n\n');
}

/**
 * 构建代币分析框架
 */
function buildTokenAnalysisFramework(twitterInfo) {
  const hasTwitter = !!(twitterInfo && (twitterInfo.text || twitterInfo.type === 'account'));

  return `
╔══════════════════════════════════════════════════════════════════════════════╗
║                           代 币 分 析 框 架                                   ║
╚══════════════════════════════════════════════════════════════════════════════╝

【分析目标】
1. 判断代币与事件是否存在有效关联
2. 评估代币本身的传播潜力

═══════════════════════════════════════════════════════════════════════════════

📋 **第一步：代币-事件关联性检查**

🎯 **目的**：判断代币名与语料是否有关联
⚠️ **如果代币名不在核心实体中，说明无相关性，直接返回category="low"**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**1.1 实体识别**

⚠️ **什么是语料？**
- 语料 = 后面列出的所有内容载体：推文、Website、Amazon、微博、微信文章、视频等
- 语料中的核心实体 = 人名、组织名、产品名、事件名、昵称、称号、概念、书籍名等
- ⚠️ 代币的名字、介绍等原始信息不属于语料（只是用来做匹配的"目标"）

⚠️ **加密圈常见缩写（必须识别为核心实体）**：
- CZ = Changpeng Zhao（币安创始人）
- SBF = Sam Bankman-Fried（FTX创始人）
- ELON/MUSK = Elon Musk
- TRUMP = Donald Trump
- BIDEN = Joe Biden
- 何一 = 币安联合创始人
- V神/Vitalik = Vitalik Buterin（以太坊创始人）

⚠️ **列出每条语料的核心实体**：
- 推文、Website、Amazon、Twitter账号要分别列出
- 必须列出所有依赖语料（in_reply_to、quoted_tweet、retweeted_tweet）
- 实体列表必须去重
- 语料中反复出现的关键短语/概念也是实体

⚠️ **⚠️⚠️ 以下内容不是独立实体，禁止列出 ⚠️⚠️⚠️**
- 用户ID片段：如"55807****"中的"55807"不是独立实体
- 打码/隐藏部分：带****的内容已被部分隐藏，不可视为完整实体

${hasTwitter ? `
⚠️ **Twitter账号的实体识别规则**（检测到Twitter账号，必须严格执行）：
- 账号名/账号品牌名：账号的screen_name或品牌名必须作为实体列出
- 账号所属机构/公司名：如果账号简介或背景中提及所属机构，必须作为实体列出
- 账号关联人物/品牌：如果账号与知名人物或品牌关联，必须作为实体列出
` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**1.2 关联匹配（三层递进）**

⚠️ **核心规则：Symbol或Name满足一个即可算匹配！**

**第一层：精确/标准化匹配**
- **精确相等**：实体和Symbol/Name完全相同（忽略大小写和空格）
- **子串包含（仅限中文）**：Symbol/Name作为完整词语出现在实体中
  - ✅ Symbol="安全月"，实体包含"币安安全月" → 匹配
  - ❌ Symbol="Trump"，实体包含"Trump2024" → 不匹配（不是独立词语）
- **中英文对应**：只要能互译就算对应
  - 示例："小老弟"（中文）vs "lil bro"（英文）→ 匹配
  - 示例："币安VIP"（中文）vs "Binance VIP"（英文）→ 匹配
- **名称匹配不分大小写**

⚠️ **不算匹配的情况**：
- 拼音首字母缩写：代币名"HY"vs 实体"CZ" → 不匹配
- 英文单词缩写：代币名"CM"vs 实体"Community Manager" → 不匹配
- 谐音梗：代币名"生财"vs 实体"生菜" → 不匹配
- 推理关联：代币名"Binance CEO"vs 实体"CZ" → 不匹配
- 行业关联：代币名"Crypto"vs 实体"Bitcoin" → 不匹配

**第二层：语义关联（需解释）**
⚠️ **只有在第一层未匹配时才进入此层**
⚠️ **此层需要LLM输出关联路径解释和置信度**

- **关联类型**：谐音、隐喻、代指
- **必须输出**：
  1. 关联路径解释（详细说明为什么有关联）
  2. 支撑判断的关键词（必须在源语料中存在）
  3. 置信度（0-1之间的数值）
- **示例**：
  代币名"寿与齐"，事件是"某人吃桃"
  关联路径："寿与齐" → 谐音"寿桃齐" → "寿桃" → "桃" → "吃桃事件"
  关键词：["桃", "寿桃"]
  置信度：0.75

⚠️ **第二层置信度要求**：
- 置信度 ≥ 0.6：接受为有效关联
- 置信度 < 0.6：拒绝（判定为无关联）

**第三层：文化语境关联（高风险，保守）**
⚠️ **只有在第二层置信度 < 0.7 时才尝试此层**
⚠️ **此层置信度要求很高**

- **关联类型**：需要背景知识才能理解的梗、双关语
- **置信度要求**：必须 > 0.8，否则直接判定为无关联
- **示例**：中文网络梗、特定圈层的黑话、需要文化背景的双关
- **策略**：宁可误杀，不要误判

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**1.3 验证机制**

⚠️ **对于第二层和第三层的语义关联，必须进行验证**：

1. **检查关键词存在性**：声称的关键词是否真的在源语料中
2. **检查置信度自洽**：置信度与关联强度是否匹配
3. **检查解释合理性**：关联路径解释是否逻辑清晰

⚠️ **如果验证失败，直接判定为无关联**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**1.4 根据匹配结果执行**

- ⚠️ **如果Symbol和Name都不在核心实体中（第一层未匹配）且语义关联置信度 < 0.6** → 直接返回category="low"
- ⚠️ **如果Symbol或Name在核心实体中（任一匹配）** → 继续执行后续分析

═══════════════════════════════════════════════════════════════════════════════

📋 **第二步：基础检查**

**2.1 语言不匹配**
- ✅ 唯一豁免：中文⇄英文互译不算语言不匹配
- ⚠️ 以下情况触发语言不匹配：
  - 日文⇄英文/中文：推文含日文片假名，代币名是英文/中文
  - 韩语⇄英文/中文
  - 泰语⇄英文/中文
  - 其他非中英语言与英文/中文混用
- 触发 → category="low"，理由：语言不匹配 = 无法传播

**2.2 长度检查**
- Symbol视觉长度 ≥ 12 或 Name视觉长度 ≥ 30 → 触发警告（考虑降分）
- 英文单词数 > 4 → 触发警告

**2.3 可读性检查**
- 过多特殊符号/乱码 → 考虑降分

═══════════════════════════════════════════════════════════════════════════════

📋 **第三步：传播潜力评估**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**3.1 关联强度评分（0-25分）**

- **强关联（20-25分）**：代币名称直接出现在叙事内容中
  - 完全匹配：代币名与核心关键词完全相同
  - 副标题/部分匹配：代币名匹配书籍/内容的副标题、别名或核心组成部分
  - 直接引用：代币名被直接提及或作为核心元素

- **中关联（10-19分）**：代币名称与叙事有合理联系，但不是直接引用
  - 示例：事件是AI技术突破，代币名是"AI助手"
  - 示例：代币名与叙事关键词有主题上的相关性

- **弱关联（0-9分）**：代币名称勉强相关

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**3.2 内容传播力评分（0-25分）**

⚠️ **找角度推文的评估说明**：
${hasTwitter ? `
- 什么是"找角度"推文？发币人借用当前热点事件/产品/新闻来发币
- 识别特征：推文提到"首个XXX"、引用大品牌/大事件、作者粉丝少但讨论大品牌
- 找角度推文评分：评估被引用事件/品牌的影响力，而不是主推文作者
- 完全忽略主推文的粉丝数、点赞数、转发数
` : ''}

**按内容类型评分**：
- **强创意+高社会讨论价值**（如首个AI功能、病毒话题）：20-25分
- **有一定创意+话题性**：15-19分
- **普通内容**：8-14分
- **工具/功能发布类**（推广某个工具、功能）：0-10分
  - 示例："防阿峰装置"、"XXX交易工具"
- **品牌产品/营销发布类**（品牌推出新产品）：3-10分
- **内容平淡/无趣**：0-7分

⚠️ **地域限制**：
- 地方性事件/话题（地方球队、地方新闻）→ 最高12分

⚠️ **叙事语言调整**：
- 如果叙事语言非中英文（如日语、泰语等）→ 降低1-2档（-5至-10分）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**3.3 代币质量评分（0-25分）**

⚠️ **首先判断名称类型，然后按meme程度评分**：

**类型A：功能性/技术性名称** → **0-10分**
- 即使字数少，也因为不是meme而低分
- 示例："防阿峰装置"、"TokenHub"、"AI助手"

**类型B：meme名称** → 按中英文字数细分

**中文meme名称**（按字数）：
- **高质量（20-25分）**：1-2字、简短、直观
- **中等质量（10-19分）**：3-5字、有一定意义
- **低质量（0-9分）**：6+字、过长、难记

**英文meme名称**（按单词数）：
- **高质量（20-25分）**：1个单词、简短直观
- **中等质量（10-19分）**：2个单词、有一定意义
- **低质量（0-9分）**：3个单词以上、过长难记

**类型C：人名/IP名** → **10-15分**

**类型D：品牌组合词** → **10-20分**
- 示例："ASTERCLAN"、"BINANCEVIP"、"TESLACOIN"
- 判断依据：前半部分是知名品牌，后半部分是有意义的概念

⚠️ **代币名称语言调整**：
- 非中英文名称（如日语、泰语）→ -5分

═══════════════════════════════════════════════════════════════════════════════

📋 **第四步：综合评分**

**总分计算**：
total_score = relation + content_virality + token_quality

**评级定义**：
- **low**：总分 < 55
- **mid**：总分 ≥ 55
- **high**：总分 ≥ 75

═══════════════════════════════════════════════════════════════════════════════

【输出格式】

**无关联或基础检查失败**：
{"category": "low", "reasoning": "说明原因", "scores": null, "total_score": null, "tokenAnalysis": {"relationExists": false, "blockReason": "原因"}}

**正常评分输出**：
{
  "category": "high/mid/low",
  "reasoning": "必须说明三个维度的评分：关联强度(X/25) + 内容传播力(X/25) + 代币质量(X/25)",
  "scores": {
    "relation": 20,
    "content_virality": 18,
    "token_quality": 15
  },
  "total_score": 53,
  "tokenAnalysis": {
    "relationExists": true,
    "relationLevel": "strong|medium|weak",
    "matchType": "exact|normalized|semantic|cultural",
    "relationPath": "详细解释关联路径",
    "confidence": 0.85,
    "evidence": ["关键词1", "关键词2"],
    "blockReason": null
  }
}

⚠️ **reasoning格式要求**：
1. 必须说明三个维度的评分
2. 必须说明关联强度：强关联(20-25)/中关联(10-19)/弱关联(0-9)
3. 必须说明代币质量：高质量/中等质量/低质量

⚠️ **关键实体**（影响评分）：
- CZ = 币安创始人 | 何一 = 币安联合创始人 | SBF = FTX创始人
- ELON/MUSK = Elon Musk | TRUMP = Trump
`;
}
