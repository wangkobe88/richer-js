/**
 * Prompt构建器 - V7.0 Section-based架构
 * 根据实际获取的数据动态组装Prompt
 *
 * 架构变更：
 * - 不再有多个独立的Prompt模板
 * - 根据fetchResults动态组装各个section
 * - 更清晰、更易维护、更易扩展
 */

import { buildCoreFramework } from './prompts/sections/core-framework.mjs';
import { buildTwitterSection } from './prompts/sections/twitter-section.mjs';
import { buildWebsiteSection } from './prompts/sections/website-section.mjs';
import { buildVideoSection } from './prompts/sections/video-section.mjs';
import { buildGithubSection } from './prompts/sections/github-section.mjs';
import { buildWeiboSection } from './prompts/sections/weibo-section.mjs';
import { buildScoringFramework } from './prompts/sections/scoring-framework.mjs';
import { generateAccountBackgroundsPrompt } from './prompts/account-backgrounds.mjs';

export class PromptBuilder {

  static getPromptVersion() {
    return 'V7.0';
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
      tiktokInfo = null
    } = fetchResults;

    // 判断有哪些数据类型
    const hasGithub = !!githubInfo;
    const hasVideo = !!(youtubeInfo || douyinInfo || tiktokInfo);
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

    const videoSection = buildVideoSection(youtubeInfo, douyinInfo, tiktokInfo);
    if (videoSection) sections.push(videoSection);

    const websiteSection = buildWebsiteSection(websiteInfo);
    if (websiteSection) sections.push(websiteSection);

    // 4. 分析原则和评估步骤
    sections.push(this._buildEvaluationFramework(hasGithub, hasVideo, hasTwitter));

    // 5. 评分框架
    sections.push(buildScoringFramework());

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

**类型B：由来**
- 特征：有影响力账号的内容本身就是meme币的来源/背景
- 判断标准（满足至少2个）：
  1. 发布者是知名人物（Trump、Musk、CZ等）或有影响力账号（粉丝>10000）
  2. 推文是原创内容/Article/图片/视频（**Article是Twitter长文章功能，本身即为完整内容**）
  3. 推文本身就是meme内容，而非解读其他事件（**有Article时直接满足此条件**）
  4. 代币名直接来自推文内容（如"基于这条推文发币"）
- **评估原则**：
  - **直接关联发布者影响力**：发布者影响力 = 叙事背景评分`);
    }

    // 第四步：可理解性/关联度判断
    lines.push(`
**第四步：可理解性/关联度判断**

**重要：如果有两个推文（主推文 + Website推文）**：
- **影响力判断：以影响力高的推文为准**（粉丝数多、互动量高的那个）
- 例如：主推文粉丝3千，Website推文粉丝18万 → 以Website推文的影响力为准

**推文有配图/视频（重要）**：
- **有图片/视频** → 假设图片与代币有关，**代币名即为图片内容的描述**
- **不需要**推文文字中明确提及代币名
- **重点评估**：推文的互动量 + 图片的传播潜力（而不是文字内容）

**推文@了用户**：@知名/加密用户→建立背书关联，可评low或mid（根据影响力判断）；发布者有影响力→可评mid

**政府机构/世界级组织meme（适用于类型A-找角度）**：
- **情况**：推文内容提到政府机构或世界级组织发布meme内容（如"White House is posting video memes"）
- **叙事背景评分：30-45分**（世界级影响力）
- **传播力评分：30-45分**（官方机构发布meme具有病毒传播潜力）
- **即使发布者影响力低，也应至少评mid或mid-high**

**知名品牌背书（适用于类型A-找角度）**：
- **情况1**：推文内容明确提到是"XX市场营销/官方发布"的内容（如"aster市场营销发的logo"）
- **情况2**：推文提到币安旗下平台/知名项目（Aster、Trust Wallet、Binance等）
- **情况3**：代币名称与知名品牌匹配（如ASTERCLAN与Aster）
- **满足以上任一情况 + 有具体命名/Logo/配图 → 至少评mid**（25-40分）

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

    // 第八步：按标准评分
    let scoringStep = `
**第八步：按标准评分**
`;
    if (hasGithub) {
      scoringStep += `- GitHub star数：<10→0-10分，10-100→0-15分，100-1K→10-25分，1K-1W→20-35分，>1W→30-50分
`;
    }
    scoringStep += `- AI相关事件：革命性突破30-45分，普通产品5-15分，成立部门0-10分
- 功能性符号传播力：0-15分`;

    lines.push(scoringStep);

    return lines.join('\n');
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
