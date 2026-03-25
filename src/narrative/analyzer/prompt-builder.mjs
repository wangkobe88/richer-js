/**
 * Prompt构建器 - V7.21 Section-based架构
 * 根据实际获取的数据动态组装Prompt
 *
 * V7.21变更：
 * - 来源权威性新增地域限制：地方性话题即使有地方媒体报道 → 最高15分
 * - 内容传播力新增地域限制：地方性事件/话题 → 最高12分
 * - 示例：地方足球队吉祥物、省级媒体报道本地事件 → 评分受限
 *
 * V7.20变更：
 * - 强化硬蹭检查规则：明确"推文主体与代币主体不相关"是判断标准
 * - 新增示例：推文说"AI创作比赛获奖"提到"AI meme"，代币名"AImeme" → 硬蹭
 * - 判断标准：推文的核心主体是什么？代币的核心主体是什么？两者是否在同一件事上？
 *
 * V7.19变更：
 * - 新增规则4：高影响力推文+媒体 → unrated（代码预检查阶段）
 * - 高影响力账号包括：Elon、Trump、CZ等世界级人物
 * - 移除Prompt中"有图片视频则认为有关联"的表述（因为代码已处理）
 *
 * V7.18变更：
 * - 语言不匹配豁免：中文⇄英文不算语言不匹配（主体用户中英文都会）
 * - 低质量场景第7条和关联度评分均增加此豁免
 *
 * V7.17变更：
 * - 视频代币处理逻辑移至代码预检查阶段，不再走LLM分析
 * - 有视频时：播放量达标→unrated，播放量低→low（代码直接判断）
 * - 移除Prompt中的视频豁免规则（不再需要）
 *
 * V7.16变更：
 * - 强化视频豁免规则措辞：使用⛔符号，"绝对禁止执行硬蹭检查"
 * - 添加错误示例：有视频时判断"代币名与视频标题无直接关联"是错误的
 * - 确保LLM理解：有视频时必须跳过硬蹭检查
 *
 * V7.15变更：
 * - 关联度评分中新增"视频豁免规则"
 * - 有视频时必须假设视频内容与代币相关，不能因"无法判断关联性"而给低分
 * - 有视频时，关联度应给予强关联（20-25分）或中关联（15-19分）
 *
 * V7.14变更：
 * - 新增低质量场景：纯负面概念/负面事件
 * - 代币名是纯负面概念（如"失业"、"破产"、"经济衰退"等）→ 直接low
 * - 理由：负面概念缺乏正向情感共鸣，用户不愿意传播持有；例外：有讽刺/幽默元素的负面概念
 *
 * V7.13变更：
 * - 新增低质量场景：语言不匹配导致传播障碍
 * - 推文语言与代币名语言不匹配 → 直接low（底线问题）
 * - 示例：推文是英语含"surprise"，代币名是日文"驚き" → 直接low
 * - 理由：目标受众无法理解、无法记住、无法传播不同语言的代币名
 *
 * V7.12变更：
 * - 关联度评分细化：明确语言不匹配的情况应降1档
 * - 示例：代币名"驚き"（日语）vs 推文中的"surprise"（英语）→ 中关联15分，不是强关联
 * - 理由：语言不匹配意味着是翻译关系，不是直接引用
 *
 * V7.11变更：
 * - 预检查增加：过期视频检查（抖音/YouTube/TikTok/Bilibili发布超过180天→low）
 * - 理由：视频发布太久，叙事价值已耗尽
 *
 * V7.10变更：
 * - LLM参数调整：temperature 0.3 → 0（完全确定性输出，提高稳定性）
 * - LLM参数调整：max_tokens 1000 → 2000（确保有足够空间输出详细理由）
 * - 新增参数：top_p: 0.9（控制输出多样性）
 *
 * V7.9变更：
 * - 代币质量增加：语言匹配度调整（非中英文名称→降低1档/-5分）
 * - 理由：非中英文名称在中英文用户群体中的传播力大幅降低
 *
 * V7.8变更：
 * - 来源权威性细化：品牌背书按级别细分（世界顶级12-18分，区域/细分5-11分）
 * - 内容传播力增加：语言匹配度调整（非中英文内容，目标用户是中英文→降低1-2档）
 * - 内容传播力增加：品牌产品/营销发布类 → 3-10分（缺乏病毒传播属性）
 *
 * V7.7变更：
 * - 来源权威性细化：品牌背书按级别细分（世界顶级12-18分，区域/细分5-11分）
 * - 内容传播力增加：语言匹配度调整（非中英文内容，目标用户是中英文→降低1-2档）
 * - 内容传播力增加：品牌产品/营销发布类 → 3-10分（缺乏病毒传播属性）
 *
 * V7.6变更：
 * - 代币质量评分改进：首先判断名称类型，功能性/技术性名称（工具、平台等）→ 0-10分
 * - 内容传播力改进：工具/功能发布类内容 → 0-10分（即使描述有趣）
 * - 理由：功能性名称缺乏meme属性，不易形成病毒传播
 *
 * V7.5变更：
 * - 强化视频豁免规则：用🚫和✅明确标记"跳过检查"和"执行检查"的条件
 * - 有YouTube/抖音/TikTok/Bilibili视频时，必须跳过硬蹭检查
 *
 * V7.4变更：
 * - 硬蹭检查中加入视频豁免：如果有YouTube/抖音/TikTok/Bilibili视频，跳过硬蹭检查
 * - 理由：根据分析原则"视频存在时假设与代币相关"，不能仅根据代币名与推文/标题不匹配就判定硬蹭
 *
 * V7.3变更：
 * - 低质量场景检查提前到【分析原则】之后，作为必须首先执行的检查
 * - 使用更强烈的警告符号（🚨）和措辞强调低质量场景检查的强制性
 * - 明确说明"这是评估的第一步，必须严格执行，不能跳过！"
 * - 清理评级标准部分，避免重复
 *
 * V7.2变更：
 * - 评分框架前置，在数据sections之后立即展示
 * - 各评估步骤中加入评分指导
 * - 更连贯的逻辑流程
 */

import { buildTwitterSection } from './prompts/sections/twitter-section.mjs';
import { buildWebsiteSection } from './prompts/sections/website-section.mjs';
import { buildVideoSection } from './prompts/sections/video-section.mjs';
import { buildGithubSection } from './prompts/sections/github-section.mjs';
import { buildWeiboSection } from './prompts/sections/weibo-section.mjs';
import { generateAccountBackgroundsPrompt } from './prompts/account-backgrounds.mjs';

export class PromptBuilder {

  static getPromptVersion() {
    return 'V7.21';
  }

  /**
   * 获取Prompt类型描述（用于记录和调试）
   * @param {Object} fetchResults - 获取的数据结果
   * @returns {string} Prompt类型描述
   */
  static getPromptTypeDesc(fetchResults) {
    const types = [];

    if (fetchResults.twitterInfo?.text) types.push('tweet');
    else if (fetchResults.twitterInfo?.type === 'account') types.push('account');

    if (fetchResults.websiteInfo?.content) types.push('website');
    if (fetchResults.githubInfo) types.push('github');
    if (fetchResults.youtubeInfo) types.push('youtube');
    if (fetchResults.douyinInfo) types.push('douyin');
    if (fetchResults.tiktokInfo) types.push('tiktok');
    if (fetchResults.bilibiliInfo) types.push('bilibili');
    if (fetchResults.backgroundInfo?.source === 'weibo') types.push('weibo');

    if (fetchResults.twitterInfo?.website_tweet) types.push('+website_tweet');

    return types.length > 0 ? types.join('+') : 'minimal';
  }

  /**
   * 构建代币叙事分析Prompt
   * @param {Object} tokenData - 代币数据（包含 symbol, address, raw_api_data）
   * @param {Object} fetchResults - 获取的所有数据结果
   * @returns {string} 构建好的Prompt字符串
   */
  static build(tokenData, fetchResults) {
    const {
      twitterInfo = null,
      websiteInfo = null,
      extractedInfo = null,
      backgroundInfo = null,
      githubInfo = null,
      youtubeInfo = null,
      douyinInfo = null,
      tiktokInfo = null,
      bilibiliInfo = null
    } = fetchResults;

    // 判断有哪些数据类型
    const hasGithub = !!githubInfo;
    const hasVideo = !!(youtubeInfo || douyinInfo || tiktokInfo || bilibiliInfo);
    const hasTwitter = !!(twitterInfo && (twitterInfo.text || twitterInfo.type === 'account'));

    // 构建各个section
    const sections = [];

    // 1. 开头：代币信息
    sections.push(`你是代币叙事分析专家，负责评估meme代币的叙事质量。

【代币信息】
- 代币名称：${tokenData.symbol}
- 代币地址：${tokenData.address}`);

    // 基础信息
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

    // 4. 分析原则和评估步骤
    sections.push(this._buildEvaluationFramework(hasGithub, hasVideo, hasTwitter));

    // 6. 评级标准和输出格式
    sections.push(this._buildRatingStandards());

    // 拼接所有section
    return sections.filter(s => s).join('\n\n');
  }

  /**
   * 构建评估框架（分析原则、重要识别、评估步骤）
   */
  static _buildEvaluationFramework(hasGithub, hasVideo, hasTwitter) {
    const lines = [];

    // 分析原则
    lines.push(`【分析原则】
- **代币名称匹配即视为有效关联**
- **meme币不需要"官方代币"等表述**，名称匹配即可
- **新币不需要已有加密社区**：评估的是叙事本身的传播潜力和可信度，不能因为"缺乏加密社区支持"而减分

【🚨 必须首先执行：低质量场景检查】

⚠️ **这是评估的第一步，必须严格执行，不能跳过！**

检查以下低质量场景，**如果触发任何一种，立即返回 {\"category\":\"low\",\"reasoning\":\"...\"}，不要继续评分！**

**1. 硬蹭/弱关联**：代币名称借用了推文中的词汇，但推文主体与代币主体不相关
   - ⚠️ **这是最常见的低质量场景，必须严格检查！**
   - 推文未提及或暗示任何与代币相关的信息是没问题的，这是Meme币，只是借助传播
   - 检查方法：推文说的是A事，代币名借用了推文中的词汇，但实质上是B事，两者主体不相关。代币应该是推文中某个核心的事物或者概念，或者是推文的主体
   - 示例：推文说"绿水青山"，代币名是"绿水青山就是金山银山" → 硬蹭（推文主体是风景，代币主体是完整标语，不相关）
   - 示例：推文是"AI创作比赛获奖"，提到"AI meme"，代币名是"AImeme" → 硬蹭（推文主体是比赛结果，代币主体是AI meme这个概念，不相关）
   - 示例：推文只是"Cute 🥰"，代币名是某个不相关的词 → 硬蹭
   - 示例：推文是"特斯拉发布新功能"，代币名是"特斯拉" → 硬蹭（推文主体是特斯拉公司，代币主体是特斯拉这个名字，不相关）
   - 判断标准：推文的核心主体是什么？代币的核心主体是什么？两者是否在同一件事上？

**2. 纯谐音梗**：只有谐音关联无实质内容
   - 示例："生菜=生财"、"Duck you=鸭你一拳" → 直接low

**3. 泛泛情感概念**：只是借用常见词无具体故事/符号
   - 示例："遗憾"、"佛系"、"躺平"等常见情感词，无具体叙事 → 直接low

**4. 大IP蹭热度**：代币名是世界级大IP但缺乏强关联证据
   - 示例：代币名是"特朗普"，但推文只是同名，无本人提及/官方发布 → 直接low

**5. 功能性符号/标志**：传播力极弱的符号
   - 示例：紧急出口标志、交通标志等 → 直接low

**6. 纯报道热搜**：只报道"XX上热搜/爆火"，无具体叙事内容
   - 示例：推文只是"这个上热搜了"，无具体内容 → 直接low

**7. 语言不匹配导致传播障碍**：推文语言与代币名称语言不匹配
   - ⚠️ **这是底线问题：语言不匹配 = 无法传播 = 直接low**
   - 示例：推文是英语（含"surprise"），代币名是日文"驚き" → 直接low
   - 示例：推文是中文，代币名是泰语/韩语等非中英语言 → 直接low
   - 理由：目标受众无法理解、无法记住、无法传播不同语言的代币名
   - ⛔ **豁免：中文⇄英文不算语言不匹配**（主体用户中英文都会，可互译）

**8. 纯负面概念/负面事件**：代币名是纯负面概念，缺乏meme属性
   - ⚠️ **负面概念缺乏正向情感共鸣，用户不愿意传播持有**
   - 示例："失业"、"破产"、"倒闭"、"经济衰退"、"裁员"等 → 直接low
   - 示例："暴跌"、"崩盘"、"亏损"等 → 直接low
   - 理由：纯粹负面的概念缺乏幽默、讽刺或正向的情感驱动，无法形成病毒传播
   - 例外：有讽刺/幽默元素的负面概念（如"躺平"、"佛系"等可自嘲的概念）

✅ **如果以上8种情况都没有触发，继续执行下面的评分步骤。**

---

【评分维度（总分100分）】
1. **可信度（0-50分）= 来源权威性（0-25分）+ 关联度（0-25分）**
   - 来源权威性：叙事来源的权威性、影响力
   - 关联度：代币与叙事背景的关联程度（核心概念 vs 硬蹭）

2. **传播力（0-50分）= 内容传播力（0-25分）+ 代币质量（0-25分）**
   - 内容传播力：社交属性、情感共鸣、FOMO效应、话题性
   - 代币质量：名字长度、meme程度（诙谐易传播 vs 古板无趣）
`);

    // 评估步骤
    lines.push(`【评估步骤】`);

    // 第一步：评分前判断
    lines.push(`
**第一步：评分前判断**
同时满足以下条件→unrated：
1. 无推文 2. 无website 3. 无Twitter账号 4. intro仅简单描述（名字/单词/短语）`);

    // 第二步：评分标准
    lines.push(`
**第二步：评分标准**

✅ 已通过低质量场景检查，继续评分。

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
  static _buildRatingStandards() {
    return `
【评级定义】

⚠️ **低质量场景已在评估第一步检查，如果通过则继续评分**

- **unrated**：第一步判断（无推文、无website、无Twitter账号、intro仅简单描述）
- **low**：触发低质量场景，或总分<50
- **mid**：可信度≥25 且 总分≥50
- **high**：可信度≥40 且 总分≥75

【输出格式】

**正常评分输出（包含scores）:**
{"reasoning":"必须说明四个维度的评分：来源权威性(X/25)+关联度(X/25)，内容传播力(X/25)+代币质量(X/25)","scores":{"credibility":0-50,"virality":0-50},"total_score":0-100,"category":"high/mid/low"}

**低质量场景输出（不包含scores）:**
{"category":"low","reasoning":"说明触发低质量场景的具体原因"}

**无法理解输出（不包含scores）:**
{"category":"unrated","reasoning":"说明无法理解代币性质的原因"}
`;
  }

  /**
   * 兼容旧版API（保持向后兼容）
   * @deprecated 请使用新的 build(tokenData, fetchResults) 方法
   */
  static buildLegacy(tokenData, twitterInfo = null, websiteInfo = null, extractedInfo = null, backgroundInfo = null, githubInfo = null, youtubeInfo = null, douyinInfo = null, tiktokInfo = null) {
    return this.build(tokenData, {
      twitterInfo,
      websiteInfo,
      extractedInfo,
      backgroundInfo,
      githubInfo,
      youtubeInfo,
      douyinInfo,
      tiktokInfo
    });
  }

  /**
   * 获取Prompt类型描述（兼容旧版）
   * @deprecated 请使用新的 getPromptTypeDesc(fetchResults) 方法
   */
  static getPromptType(twitterInfo, websiteInfo, githubInfo, youtubeInfo, douyinInfo, tiktokInfo) {
    return this.getPromptTypeDesc({
      twitterInfo,
      websiteInfo,
      githubInfo,
      youtubeInfo,
      douyinInfo,
      tiktokInfo
    });
  }

  /**
   * 检查中文合成词/简称关联
   * 识别如"万事币安"(万事达+币安)这类由多个词组成的代币名
   * @param {string} tokenName - 代币名称
   * @param {string} tweetText - 推文内容（已转小写）
   * @returns {string|null} 匹配提示或 null
   */
  static checkCompoundWordMatch(tokenName, tweetText) {
    // 中文品牌简称/双关语映射表
    const chineseAbbreviations = {
      '万事': ['mastercard', '万事达', 'master'],
      '马斯': ['musk', '马斯克'],
      '币安': ['binance', '币安'],
      '安币': ['binance', '币安'],
    };

    // 常见合成词模式（代币名 -> 分解后的组成部分）
    const compoundPatterns = {
      '万事币安': ['万事', '币安'],
      '马斯狗': ['马斯', '狗'],
    };

    // 检查是否是已知合成词
    const components = compoundPatterns[tokenName];
    if (components) {
      const matchedComponents = [];
      const matchedKeywords = [];

      for (const component of components) {
        if (tweetText.includes(component.toLowerCase())) {
          matchedComponents.push(component);
        }

        const abbreviations = chineseAbbreviations[component];
        if (abbreviations) {
          for (const abbr of abbreviations) {
            if (tweetText.includes(abbr.toLowerCase())) {
              matchedKeywords.push(abbr);
              break;
            }
          }
        }
      }

      if (matchedComponents.length > 0 || matchedKeywords.length > 0) {
        const hints = [];
        if (matchedComponents.length > 0) {
          hints.push(`直接匹配: ${matchedComponents.join(', ')}`);
        }
        if (matchedKeywords.length > 0) {
          hints.push(`关联匹配: ${matchedKeywords.join(', ')}`);
        }
        return `\n【代币名称关联】代币"${tokenName}"是合成词，推文包含其组成部分: ${hints.join('; ')}`;
      }
    }

    // 检查其他可能的简称关联
    for (const [abbr, keywords] of Object.entries(chineseAbbreviations)) {
      if (tokenName.includes(abbr)) {
        for (const keyword of keywords) {
          if (tweetText.includes(keyword.toLowerCase())) {
            return `\n【代币名称关联】代币"${tokenName}"包含"${abbr}"（${keyword}的简称），推文提及${keyword}`;
          }
        }
      }
    }

    return null;
  }
}
