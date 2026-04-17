/**
 * 代币分析Prompt
 * V16.4 - 恢复日期阻断规则
 *
 * 修改内容：
 * - 恢复"日期阻断检查"规则
 * - 日期类代币（如"927"、"420"、"48"等）在精确匹配时被阻断
 * - 理由：日期只是时间标记，不是事件主体本身
 * - 保留"数字作为事件核心元素"豁免
 * - 触发条件：代币只是日期/时间标记，不是事件的核心实体
 *
 * V16.3 - 删除日期阻断规则
 *
 * 修改内容：
 * - 完全删除"日期阻断检查"规则
 * - 理由：发现日期类代币也有涨幅不错的案例
 * - 删除了以下内容：
 *   - "日期的特殊处理"说明
 *   - "日期阻断检查"规则（927、420等日期不再被阻断）
 *   - "数字作为事件核心元素"豁免（不再需要）
 *   - 输出格式中的日期阻断示例
 * - 现在所有代币（包括日期类）都可以正常进入关联性评估流程
 *
 * V16.2 - 修复数字类代币的日期阻断误判
 *
 * 修改内容：
 * - 新增"数字作为事件核心元素"的豁免条件
 * - 当数字本身是事件的核心元素/关键词时，不触发日期阻断
 * - 示例：代币"48" vs 事件"币安多次提到48这个数字" → 不阻断
 * - 在实体识别中明确说明：数字也可以是核心实体
 * - 理由：数字=核心概念时是精确匹配，不是日期标记
 *
 * V16.1 - 调整长度评分阈值，更宽松
 * - 中文：1-3字8分，4-6字5-7分，7-10字2-4分，>10字0-1分
 * - 英文：1词8分，2-3词5-7分，4词2-4分，>4词0-1分
 *
 * V16.0 - 重大重构：将匹配、评分、阻断合并到各层级内
 * - 1.1 精确匹配（16-20分）：实体识别 + 匹配规则 + 评分 + 阻断
 * - 1.2 语义关联（10-15分）：语义判断 + 用户测试 + 评分 + 阻断
 * - 1.3 文化关联（0-9分）：文化判断 + 用户测试 + 评分 + 阻断
 * - 每层失败即阻断，成功即评分，不再有独立的评分和阻断步骤
 * - 日期拦截规则：在1.1精确匹配中直接排除，阻断矛盾
 *
 * V15.0 - 重大重构：合并重复步骤，增加阻断性检查
 * - 第一步：合并原"关联性检查"+"关联评分"，增加阻断性检查
 * - 第二步：合并原"基础检查"+"质量评分"，增加阻断性检查
 * - 第三步：综合评分（原第五步）
 * - 解决重复问题：关联性检查+评分合并，基础检查+质量评分合并
 * - 日期拦截规则：在关联评分中明确日期匹配算弱关联（0-9分）
 *
 * V14.5 - 修正"日期 ≠ 事件主体"规则
 *
 * 修改理由：预检查（NarrativeAnalyzer.mjs）已有阻断性的代币长度检查
 * - Symbol视觉长度≥12或Name视觉长度≥30 → 直接返回low
 * - 能走到LLM评分的代币，一定已通过预检查的长度限制
 * - 因此LLM评分中的"长度底线"是冗余的，已删除
 *
 * 分析重点：
 * 1. 代币-事件关联性检查（递进式，每层内置评分和阻断）
 * 2. 代币质量检查与评分
 * 3. 综合评分（事件60% + 关联20% + 质量20%）
 *
 * 存储位置：stage2_result / stage2_prompt / stage2_raw_output 字段
 */

import { buildTwitterSection } from './sections/twitter-section.mjs';
import { buildWebsiteSection } from './sections/website-section.mjs';
import { buildVideoSection } from './sections/video-section.mjs';
import { buildGithubSection } from './sections/github-section.mjs';
import { buildWeiboSection } from './sections/weibo-section.mjs';
import { buildWeixinSection } from './sections/weixin-section.mjs';
import { buildAmazonSection } from './sections/amazon-section.mjs';
import { buildXiaohongshuSection } from './sections/xiaohongshu-section.mjs';
import { buildInstagramSection } from './sections/instagram-section.mjs';
import { generateAccountBackgroundsPrompt } from './account/account-backgrounds.mjs';

/**
 * Prompt版本号
 */
export const TOKEN_ANALYSIS_PROMPT_VERSION = 'V16.4';

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
    xiaohongshuInfo = null,
    instagramInfo = null,
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

  const xiaohongshuSection = buildXiaohongshuSection(xiaohongshuInfo);
  if (xiaohongshuSection) sections.push(xiaohongshuSection);

  const instagramSection = buildInstagramSection(instagramInfo);
  if (instagramSection) sections.push(instagramSection);

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
1. 判断代币与事件是否存在有效关联（递进式检查：精确→语义→文化）
2. 检查代币质量，并评分
3. 综合评分，给出最终分类

═══════════════════════════════════════════════════════════════════════════════

📋 **第一步：代币-事件关联性检查（递进式）**

🎯 **流程**：按顺序执行1.1→1.2→1.3，每层失败即阻断，成功即评分

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**1.1 精确匹配（16-20分）**

⚠️ **什么是语料？**
- 语料 = 后面列出的所有内容载体：推文、Website、Amazon、微博、微信文章、视频等
- 语料中的核心实体 = 人名、组织名、产品名、事件名、昵称、称号、概念、书籍名等
- ⚠️ 代币的名字、介绍等原始信息不属于语料（只是用来做匹配的"目标"）

**第一步：列出核心实体**

⚠️ **识别事件主体**（用于理解事件的核心对象）：
- 从【前置信息：事件分析结果】中提取事件的**主体**（eventDescription.主体）
- 事件主体 = 事件的核心对象：人物、组织、概念、产品等
- 示例：
  - "CZ出狱" → 主体是"CZ"（人物）
  - "币安成立" → 主体是"币安"（组织）
  - "大麻日庆祝" → 主体是"大麻文化"（概念）
  - "币安提到48这个数字" → 主体是"48"（数字作为核心元素）

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
- **数字也可以是核心实体**：当数字在事件中有特殊意义、被反复强调时（如"48"作为币安的神秘数字、"420"作为大麻日）

⚠️ **⚠️⚠️ 以下内容不是独立实体，禁止列出 ⚠️⚠️⚠️**
- 用户ID片段：如"55807****"中的"55807"不是独立实体
- 打码/隐藏部分：带****的内容已被部分隐藏，不可视为完整实体

${hasTwitter ? `
⚠️ **Twitter账号的实体识别规则**（检测到Twitter账号，必须严格执行）：
- 账号名/账号品牌名：账号的screen_name或品牌名必须作为实体列出
- 账号所属机构/公司名：如果账号简介或背景中提及所属机构，必须作为实体列出
- 账号关联人物/品牌：如果账号与知名人物或品牌关联，必须作为实体列出
` : ''}

**第二步：判断是否精确匹配**

⚠️ **核心规则：Symbol或Name满足一个即可算匹配！**

**✅ 算精确匹配的情况**：
- **精确相等**：实体和Symbol/Name完全相同（忽略大小写和空格）
- **子串包含（仅限中文）**：Symbol/Name作为完整词语出现在实体中
  - ✅ Symbol="安全月"，实体包含"币安安全月" → 匹配
  - ❌ Symbol="Trump"，实体包含"Trump2024" → 不匹配（不是独立词语）
- **中英文对应**：只要能互译就算对应
  - 示例："小老弟"（中文）vs "lil bro"（英文）→ 匹配
  - 示例："币安VIP"（中文）vs "Binance VIP"（英文）→ 匹配

**❌ 不算精确匹配的情况**：
- 拼音首字母缩写：代币名"HY"vs 实体"CZ" → 不匹配
- 英文单词缩写：代币名"CM"vs 实体"Community Manager" → 不匹配
- 谐音梗：代币名"生财"vs 实体"生菜" → 不匹配
- 推理关联：代币名"Binance CEO"vs 实体"CZ" → 不匹配
- 行业关联：代币名"Crypto"vs 实体"Bitcoin" → 不匹配

**第三步：评分与阻断**

⚠️ **日期的特殊处理**（阻断性）

🎯 **核心判断**：代币只是日期/时间标记，不是事件主体？

**【日期阻断检查】（立即返回low）**

⚠️ **以下情况触发阻断**：
- 代币只是日期/时间标记（如"927"、"420"、"48"、"4.8"等）
- 日期在事件中只是时间背景，不是事件主体
- 事件的核心是其他内容（如"CZ出狱"、"新书发布"、"大麻日庆祝"）

**触发示例**：
- 代币"927" vs 事件"CZ在9月27日出狱" → 触发（927只是日期）
- 代币"420" vs 事件"大麻日庆祝活动" → 触发（420只是日期）
- 代币"48" vs 事件"CZ新书发布会" → 触发（48只是日期标记）

**⚠️ 重要豁免：数字作为事件核心元素**

- **不触发阻断的情况**：数字本身是事件的核心元素/关键词
  - 示例：代币"48" vs 事件"币安多次提到48这个数字" → 不阻断（48是核心关键词）
  - 示例：代币"100" vs 事件"项目达成100万用户里程碑" → 不阻断（100是核心数据）
  - 示例：代币"4" vs 事件"CZ在第4季度发布新书" → 不阻断（4是核心数字）
- **判断标准**：数字在事件描述中被反复强调、作为关键词、或代表核心概念/数据
- **理由**：当数字本身就是事件的核心元素时，数字=核心概念，是精确匹配而非日期标记

**判断流程**：
1. 识别代币是否是日期/数字形式
2. 检查事件主体：日期/数字是事件核心吗？
   - 是 → 不阻断（按精确匹配处理）
   - 否 → 阻断，返回low

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**评分与阻断**：

- **如果触发日期阻断** → **立即返回** rating="low"，理由：代币只是日期标记，不是事件主体
- **如果精确匹配（且未触发日期阻断）** → 关联强度 = 16-20分，继续执行第二步
- **如果不精确匹配** → 进入1.2语义关联

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**1.2 语义关联（10-15分）**

⚠️ **只有在1.1未精确匹配时才进入此层**

🎯 **核心判断**：是否存在明显的语义关联？

**✅ 可接受的语义关联**：
1. **非常明显的语义关联**
   - 示例：代币名"狗狗"vs 语料"dog"（明显的中英对应）
   - 示例：代币名"猫咪"vs 语料"cat"（明显的中英对应）

2. **一眼就能看出的同义词**
   - 示例：代币名"香蕉"vs 语料"香蕉"（相同）
   - 示例：代币名"老师"vs 语料"教师"（明显同义词）

**⚠️ 用户视角测试（阻断性）**

🎯 **核心判断**：普通用户能否快速get到关联？

❌ **用户无法快速get到的关联（直接拒绝）**：

1. **需要2步以上推理的关联**
   - 示例：代币名"时间就是金钱"，语料"我花了好多时间"
   - 推理路径："时间就是金钱" → "花了时间" → "成本高" → "金钱"
   - 需要3步推理 → 拒绝

2. **需要概念联想的关联**
   - 示例：代币名"时间就是金钱"，语料提到"时间"
   - 推理路径："时间" → 联想到习语"时间就是金钱" → 匹配
   - 需要概念联想 → 拒绝

3. **需要背景知识的关联**
   - 示例：需要知道某个文化梗、行业黑话才能理解
   - 普通用户不知道 → 拒绝

4. **谐音梗、隐喻、代指**
   - 示例：代币名"生财"vs 语料"生菜"
   - 示例：代币名"寿与齐"vs 语料"吃桃"
   - 需要谐音/隐喻推理 → 拒绝

**关联验证要求**：

- **必须输出**：
  1. 关联路径解释（详细说明为什么有关联）
  2. 支撑判断的关键词（必须在源语料中存在）
  3. 置信度（0-1之间的数值）
  4. **用户能否快速get到**：是/否

- **评分与阻断**：
  - **用户无法快速get到** → **立即返回** rating="low"，理由：语义关联无法快速理解
  - **用户能快速get到且置信度 ≥ 0.8** → 关联强度 = 10-15分，继续执行第二步
  - **用户能快速get到但置信度 < 0.8** → **立即返回** rating="low"，理由：语义关联置信度不足

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**1.3 文化关联（0-9分）**

⚠️ **只有在1.2未通过时才尝试此层**
⚠️ **此层置信度要求极高，用户视角要求更严**

🎯 **核心判断**：是否是**极其明显、广为人知**的文化梗？

**⚠️ 用户视角测试（阻断性）**

❌ **用户无法快速get到的关联（直接拒绝）**：

1. **小众文化梗、圈层黑话**
   - 只有特定圈子的人才知道
   - 普通用户完全不了解 → 拒绝

2. **需要文化背景知识才能理解的**
   - 需要了解某个历史事件、文化现象
   - 需要了解某个特定领域的知识 → 拒绝

3. **双关语、谐音梗**
   - 即使是文化相关的，也需要谐音/双关推理 → 拒绝

✅ **用户能快速get到的关联（极其罕见）**：

1. **广为人知的网络梗/流行语**
   - 全网都知道的现象级梗
   - 示例：代币名"躺平"vs 语料"躺平文化"（广为人知）
   - 但必须：语料中明确提到这个梗，不能只暗示

2. **全球性的文化符号**
   - 全世界都知道的文化符号
   - 示例：代币名"超人"vs 语料"Superman"（全球知名）
   - 但必须：语料中明确提到这个符号，不能只暗示

**关联验证要求**：

- **必须输出**：
  1. 关联路径解释（详细说明为什么有关联）
  2. 支撑判断的关键词（必须在源语料中存在）
  3. 置信度（0-1之间的数值）
  4. **用户能否快速get到**：是/否
  5. **是否广为人知**：是/否

- **评分与阻断**：
  - **用户无法快速get到或不够广为人知** → **立即返回** rating="low"，理由：文化关联不够广为人知
  - **用户能快速get到且广为人知且置信度 ≥ 0.9** → 关联强度 = 0-9分，继续执行第二步
  - **策略**：宁可误杀，不要误判

═══════════════════════════════════════════════════════════════════════════════

📋 **第二步：代币质量检查与评分**

🎯 **目的**：检查代币是否存在硬伤，并评估代币名称质量

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**2.1 语言不当性检查（阻断性）**

⚠️ **以下情况直接返回rating="low"**

- ✅ 唯一豁免：中文⇄英文互译不算语言不匹配
- ⚠️ 触发语言不匹配：
  - 日文⇄英文/中文：推文含日文片假名，代币名是英文/中文
  - 韩语⇄英文/中文
  - 泰语⇄英文/中文
  - 其他非中英语言与英文/中文混用
- 触发 → rating="low"，理由：语言不匹配 = 无法传播

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**2.2 内容不当性检查（阻断性）**

⚠️ **以下情况直接返回rating="low"**

- 检查代币名是否适合作为meme币的标识
- 判断标准（满足任一即触发low）：

  **A. 纯负面概念**
  - 代币名是纯负面概念：失业、破产、倒闭、经济衰退、裁员、暴跌、崩盘、亏损等
  - 理由：纯粹负面的概念缺乏正向情感共鸣，用户不愿意传播持有
  - 例外：有讽刺/幽默元素的负面概念（如"躺平"、"佛系"等可自嘲的概念）

  **B. 低俗/不当用语**
  - 包含低俗字眼：妓、屄、婊、逼、操等
  - 恶搞知名品牌：利用知名品牌+不当字眼（如"霸王茶妓"、"茶姬x"、"币安狗"等）
  - 冒犯性用语：涉及种族、宗教、性别歧视、政治人物不当称呼等
  - 违法暗示：毒品、暴力等非法活动暗示

- 示例：
  - "破产" → 触发A（纯负面概念）
  - "霸王茶妓" → 触发B（恶搞品牌"霸王茶姬"+低俗字"妓"）
  - "特朗普遇刺" → 触发B（政治人物不当称呼）
- 豁免：纯谐音无恶意、幽默自嘲、官方IP授权、网络流行梗无恶意

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**2.3 质量评分（0-20分）**

⚠️ **不按"类型"分类，直接评估meme属性**

**2.3.1 长度评分（0-8分）**

⚠️ **核心原则：真正的meme应该是简短的**

**中文代币名**：
- 1-3字：8分（简短有力，如"币安之王"）
- 4-6字：5-7分（中等长度）
- 7-10字：2-4分（较长）
- >10字：0-1分（过长）

**英文代币名**：
- 1词：8分（单词meme，如"Doge"、"Pepe"）
- 2-3词：5-7分（两三个单词，如"MoonShot"、"Just Do It"）
- 4词：2-4分（四个单词）
- >4词：0-1分（过长）

**2.3.2 meme适配度（0-8分）**

⚠️ **评分从严，只有真正优秀的meme才给高分**

- 是否有趣/有梗（0-3分）：
  - 3分：有非常强的幽默感/网络梗/自嘲元素，让人看了就想笑或想转发
  - 2分：有一定趣味性
  - 1分：勉强有趣
  - 0分：无趣/平淡

- 是否好记/有记忆点（0-3分）：
  - 3分：极其好记，听过一次就忘不掉
  - 2分：比较好记
  - 1分：一般
  - 0分：难记

- 是否有情绪共鸣（0-2分）：
  - 2分：强烈共鸣（兴奋、认同、讽刺、同情等）
  - 1分：轻微共鸣
  - 0分：无共鸣

**加分项**（在上述基础上叠加）：
- 谐音梗/双关语：+1分
- 网络流行梗：+1分（注意：普通网络梗+1，只有超级流行梗如"yyds"才+2）

**减分项**（在上述基础上扣除）：
- 纯数字/无意义字母：-2分
- 拼音缩写（如"HY"、"XGL"）：-1分

⚠️ **meme适配度从严要求**：
- 3个词及以上的短语，meme适配度最高不超过5分
- 除非是超级流行的网络梗（如"yyds"、"绝绝子"）

**2.3.3 传播性（0-4分）**

- 发音是否顺口（0-2分）：
  - 2分：非常顺口，朗朗上口
  - 1分：一般顺口
  - 0分：拗口/难读

- 是否容易口头传播（0-2分）：
  - 2分：极容易口头传播，一句话就能说清楚
  - 1分：比较容易
  - 0分：难传播

⚠️ **传播性从严要求**：
- 3个词及以上的短语，传播性最高不超过2分
- 除非是非常著名的广告语/流行语

**质量总分** = 2.3.1 + 2.3.2 + 2.3.3（满分20分）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**2.4 阻断性检查**

⚠️ **检查质量是否达标**

- 如果质量总分 < 4分 → **立即返回** rating="low"，不再继续
- 理由：代币名称质量X/20分 < 4分底线

═══════════════════════════════════════════════════════════════════════════════

📋 **第三步：综合评分**

读取Stage 1结果：
- 事件传播潜力：E（0-100分）
- 事件类别：C1（A类热点事件 / B类IP概念推出 / C类普通 / D类无热点）
- 时效性：T1（recent / past）

综合得分计算：
综合得分 = (E × 0.6) + (R × 1.0) + (T × 1.0)

其中：
- E = Stage 1事件传播潜力（0-100）
- R = 第一步关联强度（0-20）
- T = 第二步代币质量（0-20）

验证：当E=100, R=20, T=20时，综合得分=60+20+20=100 ✓

最终分类：
- 综合得分 ≥ 75：rating = "high"
- 综合得分 50-74：rating = "mid"
- 综合得分 < 50：rating = "low"

⚠️ **特殊调整**：
- 如果Stage 1事件类别是"D类无热点" → 直接返回 rating="low"

═══════════════════════════════════════════════════════════════════════════════

【输出格式】

**底线场景（日期阻断）**：
{
  "rating": "low",
  "reasoning": "日期阻断：代币只是日期/时间标记，不是事件主体",
  "scores": {
    "total_score": null,
    "event_propagation_score": E,
    "relevance_score": null,
    "token_name_quality_score": null
  }
}

**底线场景（语义关联阻断）**：
{
  "rating": "low",
  "reasoning": "语义关联：用户无法快速get到 / 置信度不足",
  "scores": {
    "total_score": null,
    "event_propagation_score": E,
    "relevance_score": null,
    "token_name_quality_score": null
  }
}

**底线场景（文化关联阻断）**：
{
  "rating": "low",
  "reasoning": "文化关联：不够广为人知 / 用户无法快速get到",
  "scores": {
    "total_score": null,
    "event_propagation_score": E,
    "relevance_score": null,
    "token_name_quality_score": null
  }
}

**底线场景（代币质量不达标）**：
{
  "rating": "low",
  "reasoning": "代币名称质量X/20分 < 4分底线",
  "scores": {
    "total_score": null,
    "event_propagation_score": E,
    "relevance_score": R,
    "token_name_quality_score": T
  },
  "token_name_analysis": {
    "length_score": X,
    "meme_fit_score": X,
    "virality_score": X,
    "total": T,
    "triggered_floor_limit": true
  }
}

**正常评分输出**：
{
  "rating": "high/mid/low",
  "reasoning": "综合评分：事件E分×0.6 + 关联R分×1.0 + 质量T分×1.0 = XX分",
  "scores": {
    "total_score": XX,
    "event_propagation_score": E,
    "relevance_score": R,
    "token_name_quality_score": T
  },
  "token_name_analysis": {
    "length_score": X,
    "meme_fit_score": X,
    "virality_score": X,
    "total": T,
    "triggered_floor_limit": false,
    "notes": "具体说明"
  },
  "event_info": {
    "event_category": "A/B/C/D类",
    "event_description": {...},
    "timeliness": "recent/past"
  }
}

⚠️ **reasoning格式要求**：
1. 必须说明综合得分的计算过程
2. 必须明确三个维度的得分
3. 关联阻断必须说明具体在哪一层阻断（精确匹配/语义关联/文化关联）

⚠️ **关键实体**（影响关联性判断）：
- CZ = 币安创始人 | 何一 = 币安联合创始人 | SBF = FTX创始人
- ELON/MUSK = Elon Musk | TRUMP = Trump
`;
}
