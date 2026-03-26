/**
 * Stage 2: 详细评分Prompt
 * 四维度100分评分框架
 *
 * V8.0 - 两阶段架构的第二阶段
 * - 只在Stage 1通过后执行
 * - 提供完整的评分框架
 */

import { buildTwitterSection } from './sections/twitter-section.mjs';
import { buildWebsiteSection } from './sections/website-section.mjs';
import { buildVideoSection } from './sections/video-section.mjs';
import { buildGithubSection } from './sections/github-section.mjs';
import { buildWeiboSection } from './sections/weibo-section.mjs';
import { buildAmazonSection } from './sections/amazon-section.mjs';
import { generateAccountBackgroundsPrompt } from './account-backgrounds.mjs';

/**
 * 构建Stage 2详细评分Prompt
 * @param {Object} tokenData - 代币数据
 * @param {Object} fetchResults - 获取的数据结果
 * @returns {string} Stage 2 Prompt
 */
export function buildDetailedScoringPrompt(tokenData, fetchResults) {
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
    amazonInfo = null
  } = fetchResults;

  // 判断有哪些数据类型
  const hasGithub = !!githubInfo;
  const hasVideo = !!(youtubeInfo || douyinInfo || tiktokInfo || bilibiliInfo);
  const hasTwitter = !!(twitterInfo && (twitterInfo.text || twitterInfo.type === 'account'));

  const sections = [];

  // 1. 开头：代币信息
  sections.push(`你是代币叙事分析专家，负责评估meme代币的叙事质量。

【代币信息】
- 代币名称：${tokenData.symbol}
- 代币地址：${tokenData.address}`);

  if (extractedInfo.intro_en) sections[0] += `\n- 介绍（英文）：${extractedInfo.intro_en}`;
  if (extractedInfo.intro_cn) sections[0] += `\n- 介绍（中文）：${extractedInfo.intro_cn}`;
  if (extractedInfo.website) sections[0] += `\n- 网站：${extractedInfo.website}`;
  if (extractedInfo.twitter_url) sections[0] += `\n- Twitter链接：${extractedInfo.twitter_url}`;

  // 2. 账号背景信息
  const backgrounds = generateAccountBackgroundsPrompt(twitterInfo);
  if (backgrounds) sections.push(backgrounds);

  // 3. 数据sections（Twitter、微博、GitHub、视频、网站）
  const twitterSection = buildTwitterSection(twitterInfo);
  if (twitterSection) sections.push(twitterSection);

  const weiboSection = buildWeiboSection(backgroundInfo);
  if (weiboSection) sections.push(weiboSection);

  const githubSection = buildGithubSection(githubInfo);
  if (githubSection) sections.push(githubSection);

  const videoSection = buildVideoSection(youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo);
  if (videoSection) sections.push(videoSection);

  const websiteSection = buildWebsiteSection(websiteInfo);
  if (websiteSection) sections.push(websiteSection);

  const amazonSection = buildAmazonSection(amazonInfo);
  if (amazonSection) sections.push(amazonSection);

  // 4. 评分框架
  sections.push(buildEvaluationFramework(hasGithub, hasVideo, hasTwitter));

  // 5. 评级标准和输出格式
  sections.push(buildRatingStandards());

  return sections.filter(s => s).join('\n\n');
}

/**
 * 构建评估框架
 */
function buildEvaluationFramework(hasGithub, hasVideo, hasTwitter) {
  const lines = [];

  // 分析原则
  lines.push(`【分析原则】
- **代币名称匹配即视为有效关联**
- **meme币不需要"官方代币"等表述**，名称匹配即可
- **新币不需要已有加密社区**：评估的是叙事本身的传播潜力和可信度

【评分维度（总分100分）】
1. **可信度（0-50分）= 来源权威性（0-25分）+ 关联度（0-25分）**
   - 来源权威性：叙事来源的权威性、影响力
   - 关联度：代币与叙事背景的关联程度

2. **传播力（0-50分）= 内容传播力（0-25分）+ 代币质量（0-25分）**
   - 内容传播力：社交属性、情感共鸣、FOMO效应、话题性
   - 代币质量：名字长度、meme程度（诙谐易传播 vs 古板无趣）
`);

  // 评估步骤
  lines.push(`【评估步骤】`);

  // 评分标准
  lines.push(`
**评分标准**

**评分结构（总分100分）：**
- **可信度（0-50分）** = 来源权威性（0-25分）+ 关联度（0-25分）
- **传播力（0-50分）** = 内容传播力（0-25分）+ 代币质量（0-25分）

---

**1. 可信度评分（0-50分）**

**来源权威性（0-25分）**：叙事来源的权威性、影响力

⚠️ **地域限制（必须首先检查）**：
- **地方性话题**（地方球队、地方新闻、地方活动）即使有地方媒体报道 → **最高15分**
- 示例：地方足球队吉祥物、省级媒体报道本地事件 → 最高10-15分
- 理由：地方性话题影响力有限，无法与全国性/世界级话题相比

*数据来源：事件本身（如类型A-找角度）*
- 世界级事件（政府meme、顶级国际事件）→ 20-25分
- 平台级事件（微博/抖音/Bilibili等平台上线新功能）→ 15-24分
  - 首个/首创类 → 20-24分
  - 主流平台常规功能 → 15-19分
  - 社区级情感叙事（强情感共鸣+文化符号）→ 15-24分
- 社区级事件（圈内讨论热点）→ 5-14分
- 品牌背书（明确提到XX官方/品牌）→ 按品牌级别细分
  - 世界顶级品牌（Apple、Nike、Coca-Cola等全球知名）→ 12-18分
  - 区域/细分市场品牌（Tod's Japan、特定领域品牌）→ 5-11分
  - 小品牌/地方品牌 → 0-4分
- 无明确影响力 → 0-4分

*数据来源：发布者（如类型B-由来）*
- 世界级人物（Trump、Musk、拜登、CZ/何一）→ 20-25分
- 认证用户+高互动（点赞>1000或转发>500）→ 15-24分
- 普通有影响力账号（粉丝>10000）→ 10-19分
- 普通用户 → 0-9分

**关联度（0-25分）**：代币与叙事背景的关联程度

⚠️ **语言不匹配调整**：
- 如果代币名称与叙事内容的语言不同（如代币名是日语，推文是英语的"surprise"），需要**降1档**
- 理由：语言不匹配意味着不是直接引用，而是翻译关系，关联度降低
- 示例：代币名"驚き"（日语）vs 推文中的"surprise"（英语）→ 中关联（15分），不是强关联
- ⛔ **豁免：中文⇄英文不算语言不匹配**（主体用户中英文都会，可互译）

- **强关联**（20-25分）：代币名称直接出现在叙事内容中
  - 示例：推文说"Cute duck"，代币名就是"Duck"；事件核心是"伞"，代币名就是"伞"
  - 要求：名称完全匹配，或直接引用

- **中关联**（10-19分）：代币名称与叙事有合理联系，但不是直接引用
  - **语言不匹配**的情况属于此类：代币名是叙事关键词的翻译版本
  - 示例：代币名"驚き"（日语）vs 推文中的"surprise"（英语）→ 15分
  - 示例：事件是AI技术突破，代币名是"AI助手"

- **弱关联**（0-9分）：代币名称勉强相关
  - 示例：代币名与事件内容联系较弱

---

**2. 传播力评分（0-50分）**

**内容传播力（0-25分）**：社交属性、情感共鸣、FOMO效应、话题性

⚠️ **地域限制（必须首先检查）**：
- **地方性事件/话题**（地方球队、地方新闻、地方活动）→ **最高12分**
- 示例：地方足球队吉祥物发布、省级媒体报道本地事件 → 最高8-12分
- 理由：地方性事件传播范围限于当地，缺乏病毒传播潜力

⚠️ **语言匹配度调整**：
- 如果叙事语言（推文/内容）非中英文，而目标用户是中英文用户 → **降低1-2档（-5至-10分）**
- 示例：日语内容、泰语内容等，目标是中英文加密用户群体

**按内容类型评分**：
- 强创意+高社会讨论价值（如首个AI功能、病毒话题、引发全民讨论）→ 20-25分
- 有一定创意+话题性 → 15-19分
- 普通内容 → 8-14分
- **工具/功能发布类**（推广某个工具、功能、产品）→ 0-10分
  - 即使描述有趣，但本质是功能推广，不是病毒传播内容
  - 示例："防阿峰装置"、"XXX交易工具"、"XXX助手"等功能发布
- **品牌产品/营销发布类**（品牌推出新产品、联名款等）→ 3-10分
  - 品牌营销发布缺乏病毒传播属性，主要是品牌粉丝关注
  - 示例：品牌推出新包款、联名产品等
- 内容平淡/无趣 → 0-7分

**代币质量（0-25分）**：meme程度、名字长度、易记性、语言匹配度

⚠️ **语言匹配度调整（必须首先检查，适用于所有类型）**：
- 如果代币名称非中英文（如日语、泰语、韩语等），而目标用户是中英文用户 → **必须在原评分基础上降低1档（-5分）**
- 理由：非中英文名称在中英文用户群体中的传播力大幅降低
- 示例：日语的"フォーバッグ"应从15分降到10分，泰语代币名同样需要调整
- 输出格式要求：如果应用语言调整，必须在reasoning中说明"日语名称-5分"

⚠️ **首先判断名称类型，然后按meme程度评分（评分后再应用语言调整）：**

**类型A：功能性/技术性名称**（工具、平台、功能、技术术语等）→ **0-10分**
- 即使字数少，也因为不是meme而低分
- 示例："防阿峰装置"、"TokenHub"、"AI助手"、"交易工具"
- 理由：功能性名称缺乏meme属性，不易形成病毒传播

**类型B：meme名称**（有趣、诙谐、有梗、易传播）→ 按字数细分
- **高质量**（20-25分）：1-3字符、简短、直观、有趣、易记
  - 示例："伞"、"狗狗币"、"Duck"、"鸡"
- **中等质量**（10-19分）：4-6字符、有一定意义但不突出
  - 示例："硅基茶水间"、"来根麻子"、"Mini Trump"
- **低质量**（0-9分）：7+字符、过长、难记
  - 示例："绿水青山就是金山银山"（10字）

**类型C：人名/IP名** → 取决于IP本身的传播力（在来源权威性中体现），代币质量中等（10-15分）

---

【重要补充说明】

**1. 特殊情况处理**

**双推文**：如果有主推文+Website推文，以影响力高的为准（粉丝数多、互动量高）

**推文有配图/视频**：
- 注意：有媒体的推文可能在预检查阶段被拦截（高影响力账号+媒体 → unrated）
- 如果进入评分阶段，重点评估推文互动量和文本内容
  - 高互动（点赞>5000）→ 内容传播力20-25分
  - 中等互动（点赞500-5000）→ 内容传播力15-19分
  - 低互动（点赞<500）→ 内容传播力8-14分

**推文@用户**：@知名/加密用户→建立背书关联

**信息在外部平台**（Telegram/Discord/小红书等）→unrated

**2. 推文类型判断（用于确定数据来源）**`);

  // 推文类型判断说明（有推文时）
  if (hasTwitter) {
    lines.push(`

**类型A：找角度**（数据来自事件本身）
- 特征：发币人解读当前事件，说明为什么可以作为meme币
- 判断标准（满足至少1个）：
  1. 有引用推文（引用原始事件）或包含网站链接
  2. 推文内容是"解读/分析"而非"原创声明"本身
- **评估原则**：
  - ⚠️ **类型A的评分完全不考虑推文作者影响力**
  - ⚠️ **即使作者粉丝少、互动少，也不能因此减分**
  - **默认叙事为真**（因为无法验证，发现虚假由黑名单处理）
  - **重点评估：事件本身的热度 + 叙事的合理性 + 代币与事件的关联度**

**类型B：由来**（数据来自发布者影响力）
- 特征：有影响力账号的内容本身就是meme币的来源/背景
- 判断标准（满足至少2个）：
  1. 发布者是知名人物（Trump、Musk、CZ等）或有影响力账号（粉丝>10000）
  2. 推文是原创内容/Article/图片/视频
  3. 推文本身就是meme内容，而非解读其他事件
  4. 代币名直接来自推文内容（如"基于这条推文发币"）
- **评估原则**：
  - **直接关联发布者影响力**：发布者影响力是可信度的重要组成部分
  - **必须评估代币与推文内容的关联度**`);
  }

  // BSC链CZ/何一回复预期溢价
  lines.push(`

**3. BSC链CZ/何一回复预期溢价**
同时满足才加分：
1. **有近期事件**（2周内）：新闻/币安动态/加密事件/热点
2. **与CZ/何一强关联**：直接提及/涉及币安创始人/引用@cz_binance或@heyibinance
- 强关联+近期热点→+20-35分
- 中等关联→+5-15分
- 无事件或无强关联→不加分`);

  // 第三步：综合评分
  lines.push(`

**第三步：综合评分**

根据第二步的评分标准和补充说明，给出最终评分：

**输出格式要求**：
- reasoning必须明确说明四个维度的评分
- 格式示例："来源权威性20分（马斯克世界级）+关联度15分（中等关联），内容传播力18分+代币质量12分（4字中等）"
- 必须说明关联度：强关联(20-25)/中关联(10-19)/弱关联(0-9)
- 必须说明代币质量：高质量(1-3字,20-25)/中等质量(4-6字,10-19)/低质量(7+字,0-9)`);

  return lines.join('\n');
}

/**
 * 构建评级标准和输出格式
 */
function buildRatingStandards() {
  return `
【评级定义】

- **low**：总分<50
- **mid**：可信度≥25 且 总分≥50
- **high**：可信度≥40 且 总分≥75

【输出格式】

**正常评分输出（包含scores）:**
{"reasoning":"必须说明四个维度的评分：来源权威性(X/25)+关联度(X/25)，内容传播力(X/25)+代币质量(X/25)","scores":{"credibility":0-50,"virality":0-50},"total_score":0-100,"category":"high/mid/low"}

**无法理解输出（不包含scores）:**
{"category":"unrated","reasoning":"说明无法理解代币性质的原因"}
`;
}
