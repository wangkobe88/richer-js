/**
 * Prompt构建器 - V7.2 Section-based架构
 * 根据实际获取的数据动态组装Prompt
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
    return 'V7.2';
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

    // 4. 评分框架（数据展示后，先建立评分标准）
    sections.push(this._buildScoringFramework(hasGithub));

    // 5. 分析原则和评估步骤
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
- **推文附带媒体说明存在视觉关联**：有配图/视频即建立关联，不能说"无法建立视觉关联"
- **视频平台数据说明关联**：YouTube/抖音/TikTok/Bilibili 等视频存在时，假设视频与代币有关联（无法解析视频内容）
- **新币不需要已有加密社区**：评估的是叙事本身的传播潜力和可信度，不能因为"缺乏加密社区支持"而减分
- **⚠️ 低质量叙事检测是最重要的功能**：在评分之前，必须先检查是否触发低质量模式，触发直接返回low

【重要识别】
- **世界级人物**：Trump、Musk、Elon、拜登
- **加密平台**：Binance、Coinbase、Trust Wallet
- **@Four_FORM_** = FourMeme官方（平台官方推文至少mid，40-60分）
- **@cz_binance/@heyibinance** = 币安CZ/何一（世界级加密人物，直接提及代币至少mid）`);

    // 评估步骤
    lines.push(`【评估步骤】`);

    // 第一步：语言判断（有推文时）
    if (hasTwitter) {
      lines.push(`
**第一步：语言判断（如有推文）**
- 非中英文推文需满足影响力条件（粉丝>=1万 或认证 或高互动点赞>=1000/转发>=500）
- 满足则继续，否则返回low
- 推文为"True"/空/无法获取→unrated`);
    }

    // 第二步：核心信息缺失判断
    lines.push(`
**第二步：核心信息缺失判断**
同时满足以下条件→unrated：
1. 无推文 2. 无website 3. 无Twitter账号 4. intro仅简单描述（名字/单词/短语）`);

    // 第三步：低质量叙事检测（最重要，优先检查）
    lines.push(`
**第三步：低质量叙事检测（⚠️ 最高优先级）**
⚠️ **这是叙事分析最重要的功能！必须首先检查！**
⚠️ **以下任何一条触发，直接返回low，不要再继续后面的步骤！**

【检测清单】
1. **纯谐音梗**：只有谐音关联（如"生菜=生财"、"Duck you=鸭你一拳"），无实质内容
   - 判断标准：如果去掉谐音关联，代币没有其他实质性叙事 → 纯谐音梗
   - 即使有情感包装（如"社畜情感共鸣"），如果核心只是谐音 → 直接low

2. **热搜搬运**：纯报道热点事件（如"XX上热搜"），没有具体内容/事件
   - 只是提到"XX上热搜/爆火"，没有具体的叙事内容或事件 → 蹭热搜，low

3. **泛泛情感概念**：只是借用常见词/抽象概念，没有具体故事/文化符号
   - 例如："遗憾"、"佛系"、"躺平"、"社恐"等常见词
   - 如果没有具体的故事/文化符号/社区共识支撑 → low
   - 对比：伞（有避雨情感+社区符号=有价值）vs 遗憾（只是抽象词=无价值）

4. **伪关联**：代币名称只在内容中顺便提及，不是核心主题
   - 结尾口号式提及不算伪关联（如"...total xxx，这就可以发币了"）
   - 判断标准：代币名称是否在内容核心部分，还是只在开头/结尾顺便提到

5. **大IP蹭热度**：代币名称是世界级大IP（特朗普/马斯克/CZ等），但缺乏强关联证据
   - 世界级大IP：美国总统、顶级名人（马斯克/特朗普等）、CZ、币安、世界级品牌等
   - 如果只是同名或简单提及（如"它叫特朗普"）→ 蹭热度，直接返回low
   - 需要本人提及、官方发布、权威媒体报道等强证据

6. **平台产品更新蹭热度**：内容只是某个平台上线新功能，无明确"官方代币"表述
   - 一般/中小型平台的功能更新 → 影响力极低（0-8分），通常返回low
   - 世界级知名平台（币安、特斯拉等）的功能更新 → 需谨慎评估，通常也不高

7. **功能性符号/标志**：借用功能性、严肃性符号或标志
   - 功能性符号：紧急出口标志（皮特托先生）、交通标志、警告标志等
   - 评估原则：功能性符号通常 **0-15分**（传播力极弱），即使有认知度也评为low

8. **无影响力的新说法/梗**：创造或使用一个新的概念/梗，但发表者无影响力且未形成社交热度

9. **低star数的GitHub项目**：GitHub star数<100的项目，影响力通常low

⚠️ **再次强调：如果以上任何一条触发，立即返回low，不要继续第四步及后续的评分！**`);

    // 第四步：推文类型判断（有推文时）
    if (hasTwitter) {
      lines.push(`
**第四步：推文类型判断（重要，如有推文）**

代币推文分为两类，需优先判断：
    if (hasTwitter) {
      lines.push(`
**第三步：推文类型判断（重要，如有推文）**

代币推文分为两类，需优先判断：

**类型A：找角度**
- 特征：发币人解读当前事件，说明为什么可以作为meme币
- 判断标准（满足至少1个）：
  1. 有引用推文（引用原始事件）或包含网站链接
  2. 推文内容是"解读/分析"而非"原创声明"本身
  3. intro是解读性描述（如"The Meme House"、"Money Without Masters"）
- **评估原则**：
  - **默认叙事为真**（因为无法验证，发现虚假由黑名单处理）
  - **不要求发布者影响力**，发币人影响力低是正常的
  - **重点评估：事件本身的热度 + 叙事的合理性**
- **评分说明（重要，务必遵守）**：
  - ⚠️ **类型A的评分完全不考虑推文作者影响力**
  - ⚠️ **即使作者粉丝少、互动少，也不能因此减分**
  - **可信度评分（0-50分）**：100%基于事件本身的影响力
    - 世界级事件（政府meme、顶级国际事件）→ 30-45分
    - 平台级事件（微博/抖音/Bilibili等平台上线新功能）→ 20-35分
      - **首个/首创类**（如"首个AI才能发帖的超话"）→ 30-35分
      - 主流平台常规功能 → 20-25分
      - 社区级情感叙事（强情感共鸣+文化符号）→ 25-40分
    - 社区级事件（圈内讨论热点）→ 5-15分
    - 知名品牌背书（明确提到XX官方/品牌）→ 25-40分
  - **传播力评分（0-50分）**：基于角度的创意/合理性 + 事件的社会讨论价值
    - 强创意+高社会讨论价值（如首个AI功能、病毒话题）→ 30-40分
    - 有一定创意+话题性 → 20-30分
    - 普通角度 → 5-15分
  - **示例**：硅基茶水间（微博首个AI功能）= 可信度30分（平台级首创）+ 传播力30分（AI话题+社会讨论）= 60分 → mid
  - **错误示例❌**："推文作者影响力较低，互动量也较少" → 这是错误的理由！类型A不考虑作者影响力

**类型B：由来**
- 特征：有影响力账号的内容本身就是meme币的来源/背景
- 判断标准（满足至少2个）：
  1. 发布者是知名人物（Trump、Musk、CZ等）或有影响力账号（粉丝>10000）
  2. 推文是原创内容/Article/图片/视频（**Article是Twitter长文章功能，本身即为完整内容**）
  3. 推文本身就是meme内容，而非解读其他事件（**有Article时直接满足此条件**）
  4. 代币名直接来自推文内容（如"基于这条推文发币"）
- **评估原则**：
  - **直接关联发布者影响力**：发布者影响力 = 叙事背景评分
- **评分说明（重要）**：
  - **可信度评分（0-50分）**：直接等于发布者影响力
    - 世界级人物（Trump、Musk、拜登、CZ/何一）→ 35-50分
    - 认证用户+高互动（点赞>1000或转发>500）→ 20-35分
    - 普通有影响力账号（粉丝>10000）→ 10-25分
    - 普通用户 → 0-10分
  - **传播力评分（0-50分）**：基于内容的meme程度
    - 原创meme内容（有趣图片、视频、Article）→ 25-40分
    - 有趣的引用/转发 → 15-25分
    - 普通内容 → 0-15分
  - **情感溢价**：若内容具备强情感共鸣，传播力可+5分
  - **总分=可信度+传播力，根据评级标准确定high/mid/low**`);
    }

    // 第五步：可理解性/关联度判断
    lines.push(`
**第五步：可理解性/关联度判断与评分**

**重要：如果有两个推文（主推文 + Website推文）**：
- **影响力判断：以影响力高的推文为准**（粉丝数多、互动量高的那个）
- 例如：主推文粉丝3千，Website推文粉丝18万 → 以Website推文的影响力为准

**推文有配图/视频（重要）**：
- **有图片/视频** → 假设图片与代币有关，**代币名即为图片内容的描述**
- **不需要**推文文字中明确提及代币名
- **评分调整**：有图片/视频时，**重点评估推文互动量**而非文字内容
  - 高互动（点赞>5000）→ 传播力30-40分
  - 中等互动（点赞500-5000）→ 传播力20-30分
  - 低互动（点赞<500）→ 传播力10-20分

**推文@了用户**：@知名/加密用户→建立背书关联，可评low或mid（根据影响力判断）；发布者有影响力→可评mid

**政府机构/世界级组织meme（适用于类型A-找角度）**：
- **情况**：推文内容提到政府机构或世界级组织发布meme内容（如"White House is posting video memes"）
- **可信度评分：30-45分**（世界级影响力）
- **传播力评分：30-45分**（官方机构发布meme具有病毒传播潜力）
- **即使发布者影响力低，也应至少评mid或mid-high**

**知名品牌背书（适用于类型A-找角度）**：
- **情况1**：推文内容明确提到是"XX市场营销/官方发布"的内容（如"aster市场营销发的logo"）
- **情况2**：推文提到币安旗下平台/知名项目（Aster、Trust Wallet、Binance等）
- **情况3**：代币名称与知名品牌匹配（如ASTERCLAN与Aster）
- **满足以上任一情况 + 有具体命名/Logo/配图 → 可信度25-40分，传播力20-35分**

**信息在外部平台**（Telegram/Discord/小红书等）→unrated`);

    // 第六步：类型B-由来推文的影响力评估（有推文时）
    if (hasTwitter) {
      lines.push(`
**第六步：类型B-由来推文的影响力评估（仅适用于类型B）**
- **知名人物直接发帖**：Trump、Musk、CZ等世界级人物 → mid或high
- **认证用户+高互动**：点赞>1000或转发>500 → 可评mid
- **普通用户**：影响力低 → 通常low（除非内容极具传播性）`);
    }

    // 第七步：BSC链CZ/何一回复预期溢价
    lines.push(`
**第七步：BSC链CZ/何一回复预期溢价**
同时满足才加分：
1. **有近期事件**（2周内）：新闻/币安动态/加密事件/热点
2. **与CZ/何一强关联**：直接提及/涉及币安创始人/引用@cz_binance或@heyibinance
- 强关联+近期热点→+20-35分
- 中等关联→+5-15分
- 无事件或无强关联→不加分`);

    // 第八步：综合评分
    lines.push(`
**第八步：综合评分**
⚠️ **前提：必须先通过第三步的低质量叙事检测，才能进行以下评分**
⚠️ **如果第三步检测到任何低质量模式，应已返回low，不要继续评分！**

根据前面各步骤的判断，使用对应类型（类型A找角度/类型B由来）的评分标准给出：

1. **可信度分数**（0-50分）：叙事背景的权威性和影响力
2. **传播力分数**（0-50分）：内容的meme潜力、社交属性、情感共鸣
3. **总分**（0-100分）：可信度 + 传播力
4. **评级**：根据总分和评级标准确定high/mid/low/unrated

**重要提醒**：
- **类型A（找角度）**：可信度基于事件本身影响力，**与推文作者影响力无关**
- **类型B（由来）**：可信度等于发布者影响力
- **不要以"缺乏加密社区"作为减分理由**
- **非加密内容也可以高分**：知名网红、病毒视频、热门话题等

**特殊情况的处理**：
${hasGithub ? `- GitHub项目：<100 stars通常low，100-1000 stars→10-25分，>1000 stars→20-50分
` : ''}- 功能性符号（交通标志、紧急出口标志等）：传播力0-15分
- AI相关事件：革命性突破30-45分，普通产品5-15分，成立部门0-10分`);

    return lines.join('\n');
  }

  /**
   * 构建评分框架（简化版，只说明评分维度）
   * 详细评分标准已整合到各评估步骤中
   */
  static _buildScoringFramework(hasGithub) {
    return `
【评分维度说明】
总分100分，由以下两个维度组成：

**1. 可信度（0-50分）**：叙事来源的权威性、影响力
- 评估内容：品牌/公司/人物/平台的知名度、事件的影响力量级
- 核心问题：这个叙事的来源有多可信？

**2. 传播力（0-50分）**：内容的meme潜力、社交属性、情感共鸣
- 评估内容：meme潜力+社交属性+情感共鸣+FOMO+内容丰富度
- 核心问题：这个叙事能传播多远？

**重要说明**：
- 详细的评分标准已在各评估步骤中说明
- 根据推文类型（找角度/由来）使用对应的评分标准
- 非加密内容也可以高分（如知名网红、病毒视频等）
- 不要以"缺乏加密社区"作为减分理由
`;
  }

  /**
   * 构建评级标准和输出格式
   */
  static _buildRatingStandards() {
    return `
【评级标准】
- **unrated**：信息获取不全或信息在外部平台，无法评估
  - 技术限制导致无法获取完整信息（网站无法访问、链接内容获取失败等）
  - 主体信息在外部平台（B站、快手等）无法获取
  - 完全无信息（intro只是名字、无推文、无website）

- **low**（以下任一情况直接返回low）：
  1. 触发第七步的任何低质量叙事模式（纯谐音梗、热搜搬运、泛泛情感概念、伪关联、大IP蹭热度、平台产品更新蹭热度、功能性符号等）
  2. 非中英文推文（语言限制传播）
  3. 总分<50（即使评分，总分低于50也评为low）
  4. 信息完整但与代币无明显关联
  5. 通用描述/无意义内容

- **mid**：叙事背景≥20 且 总分≥50 且 未触发low质量模式

- **high**：叙事背景≥35 且 总分≥75

【输出格式】
正常评分输出（包含scores）:
{"reasoning":"2-3句中文说明理由","scores":{"credibility":0-50,"virality":0-50},"total_score":0-100,"category":"high/mid/low"}

无法理解输出（不包含scores）:
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
