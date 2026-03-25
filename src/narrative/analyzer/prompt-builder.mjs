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
- **推文附带媒体说明存在视觉关联**：有配图/视频即建立关联，不能说"无法建立视觉关联"
- **视频平台数据说明关联**：YouTube/抖音/TikTok/Bilibili 等视频存在时，假设视频与代币有关联（无法解析视频内容）
- **新币不需要已有加密社区**：评估的是叙事本身的传播潜力和可信度，不能因为"缺乏加密社区支持"而减分

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

    // 第一步：核心信息缺失判断
    lines.push(`
**第一步：核心信息缺失判断**
同时满足以下条件→unrated：
1. 无推文 2. 无website 3. 无Twitter账号 4. intro仅简单描述（名字/单词/短语）`);

    // 第二步：评分标准（通用框架）
    lines.push(`
**第二步：评分标准**

**评分结构（总分100分）：**
- **可信度（0-50分）** = 来源权威性（0-25分）+ 关联度（0-25分）
- **传播力（0-50分）** = 内容传播力（0-25分）+ 代币质量（0-25分）

---

**1. 可信度评分（0-50分）**

**来源权威性（0-25分）**：叙事来源的权威性、影响力

*数据来源：事件本身（如类型A-找角度）*
- 世界级事件（政府meme、顶级国际事件）→ 20-25分
- 平台级事件（微博/抖音/Bilibili等平台上线新功能）→ 15-24分
  - 首个/首创类 → 20-24分
  - 主流平台常规功能 → 15-19分
  - 社区级情感叙事（强情感共鸣+文化符号）→ 15-24分
- 社区级事件（圈内讨论热点）→ 5-14分
- 知名品牌背书（明确提到XX官方/品牌）→ 15-25分
- 无明确影响力 → 0-4分

*数据来源：发布者（如类型B-由来）*
- 世界级人物（Trump、Musk、拜登、CZ/何一）→ 20-25分
- 认证用户+高互动（点赞>1000或转发>500）→ 15-24分
- 普通有影响力账号（粉丝>10000）→ 10-19分
- 普通用户 → 0-9分

*低质量场景（来源权威性0-8分）*：
- 一般/中小型平台的功能更新 → 0-8分
- 纯报道"XX上热搜"无具体内容 → 0-4分
- 低star数GitHub项目（<100）→ 0-4分

**关联度（0-25分）**：代币与叙事背景的关联程度

- **强关联**（20-25分）：代币名称是叙事的核心概念
  - 示例：事件核心是"伞"，代币名就是"伞"；推文核心是"Cute duck"，代币名就是"Duck"
- **中关联**（10-19分）：代币名称与叙事有合理联系，但不是核心
  - 示例：事件是AI技术突破，代币名是"AI助手"
- **弱关联/硬蹭**（0-9分）：代币名称勉强相关，主要是蹭热度
  - 示例：代币名与事件内容没有实质性联系

*低质量场景（关联度0-5分）*：
- **纯谐音梗**：只有谐音关联无实质内容（如"生菜=生财"）
- **泛泛情感概念**：只是借用常见词（如"遗憾"、"佛系"）无具体故事/符号
- **伪关联**：代币名只在内容开头/结尾顺便提及
- **大IP蹭热度**：代币名是世界级大IP但缺乏强关联证据

---

**2. 传播力评分（0-50分）**

**内容传播力（0-25分）**：社交属性、情感共鸣、FOMO效应、话题性

- 强创意+高社会讨论价值（如首个AI功能、病毒话题）→ 20-25分
- 有一定创意+话题性 → 15-19分
- 普通内容 → 8-14分
- 内容平淡/无趣 → 0-7分

*低质量场景（内容传播力0-7分）*：
- **功能性符号/标志**：紧急出口标志、交通标志等（传播力极弱）
- **无影响力的新说法/梗**：发表者无影响力且未形成社交热度

**代币质量（0-25分）**：名字长度、meme程度

- **高质量**（20-25分）：1-3字符、简短、直观、有趣、易记
  - 示例："伞"、"狗狗币"、"Duck"
- **中等质量**（10-19分）：4-6字符、有一定意义但不突出
  - 示例："硅基茶水间"、"来根麻子"、"Mini Trump"
- **低质量**（0-9分）：7+字符、过长、专业、抽象、古板、难记
  - 示例："绿水青山就是金山银山"（10字）、"TokenHub"

---

**3. 特殊情况处理**

**双推文**：如果有主推文+Website推文，以影响力高的为准（粉丝数多、互动量高）

**推文有配图/视频**：
- 假设图片与代币有关，代币名即为图片内容的描述
- 重点评估推文互动量：
  - 高互动（点赞>5000）→ 内容传播力20-25分
  - 中等互动（点赞500-5000）→ 内容传播力15-19分
  - 低互动（点赞<500）→ 内容传播力8-14分

**推文@用户**：@知名/加密用户→建立背书关联

**政府机构/世界级组织meme**：来源权威性20-25分，内容传播力20-25分

**知名品牌背书**：提到"XX官方发布"、币安旗下平台，或代币名与知名品牌匹配

**信息在外部平台**（Telegram/Discord/小红书等）→unrated`);

    // 第三步：推文类型判断（仅用于确定数据来源，有推文时）
    if (hasTwitter) {
      lines.push(`
**第三步：推文类型判断（用于确定数据来源）**

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

    // 第四步：BSC链CZ/何一回复预期溢价
    lines.push(`
**第四步：BSC链CZ/何一回复预期溢价**
同时满足才加分：
1. **有近期事件**（2周内）：新闻/币安动态/加密事件/热点
2. **与CZ/何一强关联**：直接提及/涉及币安创始人/引用@cz_binance或@heyibinance
- 强关联+近期热点→+20-35分
- 中等关联→+5-15分
- 无事件或无强关联→不加分`);

    // 第五步：综合评分
    lines.push(`
**第五步：综合评分**

根据前面各步骤的判断，按照第二步的评分标准给出最终评分：

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
【评级标准】
- **unrated**：信息获取不全或信息在外部平台，无法评估
- **low**：总分<50，或触发第一步的核心信息缺失判断
- **mid**：可信度≥25 且 总分≥50
- **high**：可信度≥40 且 总分≥75

【输出格式】
正常评分输出（包含scores）:
{"reasoning":"必须说明四个维度的评分：来源权威性(X/25)+关联度(X/25)，内容传播力(X/25)+代币质量(X/25)","scores":{"credibility":0-50,"virality":0-50},"total_score":0-100,"category":"high/mid/low"}

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
