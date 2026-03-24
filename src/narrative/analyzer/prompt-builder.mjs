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
**第二步：核心信息缺失判断（最高优先级）**
同时满足以下条件→unrated：
1. 无推文 2. 无website 3. 无Twitter账号 4. intro仅简单描述（名字/单词/短语）`);

    // 第三步：推文类型判断（有推文时）
    if (hasTwitter) {
      lines.push(`
**第三步：推文类型判断（重要，如有推文）**

代币推文分为两类，需优先判断：

**类型A：找角度**
- 特征：发币人解读当前事件，说明为什么可以作为meme币
- 判断标准（满足至少2个）：
  1. 推文中有"front-run"、"people talking about"、"news coming"等前瞻性表述
  2. 有引用推文（引用原始事件）或包含网站链接
  3. 推文内容是"解读/分析"而非"原创声明"本身
  4. intro是解读性描述（如"The Meme House"、"Money Without Masters"）
  5. 发布者影响力较低（粉丝<10000，即使认证）
- **评估原则**：
  - **默认叙事为真**（因为无法验证，发现虚假由黑名单处理）
  - **不要求发布者影响力**，发币人影响力低是正常的
  - **重点评估：事件本身的热度 + 叙事的合理性**
- **评分说明（重要）**：
  - **可信度评分基于事件本身的影响力**，而非推文作者的影响力
  - **推文作者=发币人，粉丝数少是正常的**，不影响可信度评分
  - **可信度来源**：
    - 世界级事件（政府meme等）→ 30-45分
    - 平台级事件（微博/抖音等平台上线新功能）→ 20-35分
      - **首个/首创类创新**（如"首个AI才能发帖"）→ 至少30分
      - 微博/抖音等主流平台常规功能 → 20-25分
    - 社区级事件（圈内讨论热点）→ 5-15分
  - **传播力来源**：角度的创意/合理性 + 事件的社会讨论价值
  - **示例**：硅基茶水间（微博首个AI功能）= 平台级事件(30分，因为是首个) + AI角度创意(25分) = 55分 → mid

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
  - **可信度=发布者影响力**：
    - 世界级人物（Trump、Musk等）→ 35-50分
    - 认证用户+高互动（点赞>1000或转发>500）→ 20-35分
    - 普通有影响力账号（粉丝>10000）→ 10-25分
    - 普通用户 → 0-10分
  - **传播力=内容meme程度**：
    - 原创meme内容（图片、视频、Article）→ 25-40分
    - 有趣的引用/转发 → 15-25分
    - 普通内容 → 0-15分`);
    }

    // 第四步：可理解性/关联度判断
    lines.push(`
**第四步：可理解性/关联度判断与评分**

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

    // 第五步：类型B-由来推文的影响力评估（有推文时）
    if (hasTwitter) {
      lines.push(`
**第五步：类型B-由来推文的影响力评估（仅适用于类型B）**
- **知名人物直接发帖**：Trump、Musk、CZ等世界级人物 → mid或high
- **认证用户+高互动**：点赞>1000或转发>500 → 可评mid
- **普通用户**：影响力低 → 通常low（除非内容极具传播性）`);
    }

    // 第六步：BSC链CZ/何一回复预期溢价
    lines.push(`
**第六步：BSC链CZ/何一回复预期溢价**
同时满足才加分：
1. **有近期事件**（2周内）：新闻/币安动态/加密事件/热点
2. **与CZ/何一强关联**：直接提及/涉及币安创始人/引用@cz_binance或@heyibinance
- 强关联+近期热点→+20-35分
- 中等关联→+5-15分
- 无事件或无强关联→不加分`);

    // 第七步：低质量叙事检测
    lines.push(`
**第七步：低质量叙事检测（直接返回low）**
1. **纯谐音梗**：只有谐音关联（如"生菜=生财"、"Duck you=鸭你一拳"），无实质内容
2. **热搜搬运**：纯报道热点事件（如"XX上热搜"），没有具体内容/事件
3. **泛泛情感概念**：只是借用常见词/抽象概念（"遗憾"、"佛系"等），没有具体故事/文化符号
4. **伪关联**：代币名称只在内容中顺便提及，不是核心主题（但结尾口号式提及不算伪关联）
5. **大IP蹭热度**：代币名称是世界级大IP，但缺乏强关联证据（本人提及、官方发布）
6. **平台产品更新蹭热度**：内容只是某个平台上线新功能，无明确"官方代币"表述
   - 一般/中小型平台的功能更新 → 通常low（0-8分）
7. **功能性符号/标志**：借用功能性、严肃性符号或标志
   - **功能性符号**：紧急出口标志（皮特托先生）、交通标志、警告标志等
   - **评估原则**：功能性符号通常 **0-15分**（传播力极弱）
8. **无影响力的新说法/梗**：创造或使用一个新的概念/梗，但发表者无影响力且未形成社交热度
9. **低star数的GitHub项目**（<100 stars通常low）`);

    // 第八步：综合评分
    lines.push(`
**第八步：综合评分**
根据以上各步骤的判断，结合评分框架中的标准，给出：
1. **可信度分数**（0-50分）：叙事背景的权威性和影响力
2. **传播力分数**（0-50分）：内容的meme潜力、社交属性、情感共鸣
3. **总分**（0-100分）：可信度 + 传播力
4. **评级**：根据总分和评级标准确定high/mid/low/unrated

**特殊情况的评分参考**：
${hasGithub ? `- GitHub star数：<10→0-10分，10-100→0-15分，100-1K→10-25分，1K-1W→20-35分，>1W→30-50分
` : ''}- AI相关事件：革命性突破30-45分，普通产品5-15分，成立部门0-10分
- 功能性符号传播力：0-15分`);

    return lines.join('\n');
  }

  /**
   * 构建评分框架（前置在数据sections之后）
   */
  static _buildScoringFramework(hasGithub) {
    const lines = [];

    lines.push(`【评分框架】`);
    lines.push(`总分100分，由以下两个维度组成：`);

    lines.push(`
**1. 可信度（0-50分）**：叙事来源的权威性、影响力
- 评估内容：品牌/公司/人物/平台的知名度、事件的影响力量级
- 核心问题：这个叙事的来源有多可信？

**可信度分级标准**：

*世界级公司事件分级*：
- **第一梯队公司**（Meta/Google/Apple/Tesla/微软/亚马逊）：
  - 品牌战略级事件：35-50分
  - 革命性产品发布（iPhone/ChatGPT级别）：30-45分
  - 重大产品更新：20-35分
- **第二梯队公司**（阿里巴巴/腾讯/字节跳动/AWS等）：
  - 品牌战略级事件：20-35分
  - 重大产品发布：15-30分
  - 组织调整/部门设立：5-15分
- **其他知名公司**：组织调整 → 0-8分

*AI相关事件特殊处理*（2025-2026年AI已常态化）：
- **革命性AI突破**（ChatGPT级别）：30-45分（需"首个/首创/突破"）
- **普通AI产品发布**：5-15分
- **成立AI部门**：0-10分（已是常态）

*影响力分级*：
- 币安/CZ/何一相关：35-50分
- 世界级/加密重大事件（顶级名人、国际媒体）：30-44分
- 平台级影响力（加密相关）：25-34分
- 平台级影响力（一般）：20-29分
- **社区级情感叙事**（强情感共鸣+文化符号）：**25-40分**
  - 示例：伞（避雨情感+社区符号）、唐·毒蛇（文化梗）、尼采主义海豚（哲学+趣味）
  - 注意：常见抽象词不算（如"遗憾"只是词）
  - 优质情感叙事（有独特文化符号、强共鸣）可达到35-40分
- 社区级影响力（加密相关）：10-24分
- 社区级影响力（一般）：5-19分
- **媒体命名权威性**：
  - 顶级平台官方命名（抖音/微博官方）：**15-25分**
  - 注意：官方权威性不代表实际热度，需有社交讨论热度佐证
  - 普通媒体用语（量子位/36氪等）：0-10分
- **限定范围影响力**：0-8分（如"深圳商场里的广告牌"）
- 无明确影响力：0-4分

*加分说明*：加密相关、情感叙事可在原分数基础上+3-5分（不超过该层级上限）`);

    lines.push(`
**2. 传播力（0-50分）**：内容的meme潜力、社交属性、情感共鸣
- 评估内容：meme潜力+社交属性+情感共鸣+FOMO+内容丰富度
- 核心问题：这个叙事能传播多远？

**传播力分级标准**：
- 具备病毒传播属性+内容丰富：40-50分
- 有较强传播性+内容较丰富：30-39分
- 有一定传播性：15-29分
- 传播力弱：0-14分

**特殊调整**：
- **情感溢价**：若叙事具备强情感共鸣，在原分数基础上+5分
- **限定范围降权**：如果内容明确限定地点（如"深圳商场"），传播力减半
- **AI相关事件降权**：常规AI产品发布/部门设立，传播力减半
- **功能性符号降权**：功能性符号/标志（紧急出口标志、交通标志、警告标志等）传播力极弱
  - 功能性符号通常 **0-15分**
  - 原因：不搞笑、不荒诞、没有情感共鸣，缺乏传播动力
  - 即使有全球认知度，也不代表有传播价值`);

    return lines.join('\n');
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

- **low**：信息完整但无有效关联，或触发低质量叙事模式，或 非中英文推文，或 总分<50
  - 获取了完整信息但与代币无明显关联
  - 通用描述/无意义内容
  - 触发纯谐音梗、热搜搬运、伪关联、功能性符号等低质量模式

- **mid**：叙事背景≥20 且 总分≥50

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
