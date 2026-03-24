/**
 * 完整 Prompt - 兜底版本
 * 精简但完整的评估框架，适用于所有场景
 */

import { CORE_FRAMEWORK } from './core.mjs';
import { generateAccountBackgroundsPrompt } from './account-backgrounds.mjs';

export const COMPLETE_PROMPT = (tokenData, twitterInfo, websiteInfo, extractedInfo, githubInfo, youtubeInfo, douyinInfo, tiktokInfo) => {
  const tokenName = tokenData.symbol;
  const introEn = extractedInfo.intro_en || '';
  const introCn = extractedInfo.intro_cn || '';
  const website = extractedInfo.website || '';
  const twitterUrl = extractedInfo.twitter_url || '';

  // 构建内容部分
  const contentParts = [];

  // Twitter 信息
  if (twitterInfo) {
    if (twitterInfo.type === 'account') {
      const isVerified = twitterInfo.verified || twitterInfo.is_blue_verified;
      contentParts.push(`【推特账号】@${twitterInfo.screen_name} (${twitterInfo.name})${isVerified ? ' ✓' : ''}`);
      if (twitterInfo.description) contentParts.push(`简介: ${twitterInfo.description}`);
      contentParts.push(`粉丝数: ${twitterInfo.followers_count || 0}`);
    } else if (twitterInfo.text) {
      const verified = twitterInfo.author_verified;
      contentParts.push(`【推文作者】@${twitterInfo.author_screen_name || '未知'}${verified ? ' ✓' : ''}`);
      contentParts.push(`【作者粉丝数】${twitterInfo.author_followers_count || 0}`);
      contentParts.push(`【推文互动】点赞 ${twitterInfo.metrics?.favorite_count || 0} / 转发 ${twitterInfo.metrics?.retweet_count || 0}`);
      contentParts.push(`【推文】${twitterInfo.text}`);

      if (twitterInfo.in_reply_to) {
        contentParts.push(`【回复的推文】${twitterInfo.in_reply_to.text}`);
      }

      if (twitterInfo.media && twitterInfo.media.has_media) {
        if (twitterInfo.media.images?.length > 0) contentParts.push(`【推文附带图片】${twitterInfo.media.images.length}张`);
        if (twitterInfo.media.videos?.length > 0) contentParts.push(`【推文附带视频】${twitterInfo.media.videos.length}个`);
      }
    }

    if (twitterInfo.link_content?.content) {
      contentParts.push(`【推文链接内容】${twitterInfo.link_content.content}`);
    }
  }

  // GitHub 信息
  if (githubInfo) {
    contentParts.push(`【GitHub】${githubInfo.full_name || '未知'}`);
    contentParts.push(`Star数: ${githubInfo.stargazers_count || 0}`);
    if (githubInfo.description) contentParts.push(`描述: ${githubInfo.description}`);
    if (githubInfo.influence_level) contentParts.push(`影响力: ${githubInfo.influence_description}`);
  }

  // YouTube 信息
  if (youtubeInfo) {
    contentParts.push(`【YouTube】${youtubeInfo.title || '未知'}`);
    contentParts.push(`观看数: ${youtubeInfo.view_count || 0}`);
    if (youtubeInfo.influence_level) contentParts.push(`影响力: ${youtubeInfo.influence_description}`);
  }

  // 抖音信息
  if (douyinInfo) {
    contentParts.push(`【抖音】${douyinInfo.title || '未知'}`);
    contentParts.push(`点赞数: ${douyinInfo.like_count || 0}`);
    if (douyinInfo.influence_level) contentParts.push(`影响力: ${douyinInfo.influence_description}`);
  }

  // TikTok信息
  if (tiktokInfo) {
    contentParts.push(`【TikTok】@${tiktokInfo.author_username || tiktokInfo.author_name || '未知'} - ${tiktokInfo.description || '无描述'}`);
    contentParts.push(`播放数: ${tiktokInfo.view_count || 0}, 点赞数: ${tiktokInfo.like_count || 0}`);
    if (tiktokInfo.influence_level) contentParts.push(`影响力: ${tiktokInfo.influence_description}`);
  }

  // 网站信息
  if (websiteInfo?.content) {
    contentParts.push(`【网页内容】${websiteInfo.content}`);
  }

  // 基础信息
  if (introEn) contentParts.push(`【介绍英文】${introEn}`);
  if (introCn) contentParts.push(`【介绍中文】${introCn}`);
  if (website) contentParts.push(`【网站】${website}`);
  if (twitterUrl) contentParts.push(`【Twitter链接】${twitterUrl}`);

  return `
你是代币叙事分析专家，负责评估meme代币的叙事质量。

【代币信息】
- 代币名称：${tokenName}
- 代币地址：${tokenData.address}

${generateAccountBackgroundsPrompt(twitterInfo)}${contentParts.join('\n')}

【分析原则】
- **代币名称匹配即视为有效关联**
- **meme币不需要"官方代币"等表述**，名称匹配即可
- **推文附带媒体说明存在视觉关联**：有配图/视频即建立关联，不能说"无法建立视觉关联"

【重要识别】
- **世界级人物**：Trump、Musk、Elon、拜登
- **加密平台**：Binance、Coinbase、Trust Wallet
- **@Four_FORM_** = FourMeme官方（平台官方推文至少mid，40-60分）
- **@cz_binance/@heyibinance** = 币安CZ/何一（世界级加密人物，直接提及代币至少mid）

【评估步骤】

**第一步：语言判断（如有推文）**
- 非中英文推文需满足影响力条件（粉丝>=1万 或认证 或高互动点赞>=1000/转发>=500）
- 满足则继续，否则返回low
- 推文为"True"/空/无法获取→unrated

**第二步：核心信息缺失判断（最高优先级）**
同时满足以下条件→unrated：
1. 无推文 2. 无website 3. 无Twitter账号 4. intro仅简单描述（名字/单词/短语）

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
  2. 推文是原创内容/图片/视频（可能有引用推文，但引用的是相关补充内容）
  3. 推文本身就是meme内容，而非解读其他事件
  4. 代币名直接来自推文内容（如"基于这条推文发币"）
- **评估原则**：
  - **直接关联发布者影响力**：发布者影响力 = 叙事背景评分

**第四步：可理解性/关联度判断**

**推文有配图/视频**：默认视觉关联，intro有实际含义→至少mid（25-45分）；intro完全无意义且文本不相关→可评low

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

**信息在外部平台**（Telegram/Discord/小红书等）→unrated

**第五步：类型B-由来推文的影响力评估（仅适用于类型B）**
- **知名人物直接发帖**：Trump、Musk、CZ等世界级人物 → mid或high
- **认证用户+高互动**：点赞>1000或转发>500 → 可评mid
- **普通用户**：影响力低 → 通常low（除非内容极具传播性）

**第六步：BSC链CZ/何一回复预期溢价**
同时满足才加分：
1. **有近期事件**（2周内）：新闻/币安动态/加密事件/热点
2. **与CZ/何一强关联**：直接提及/涉及币安创始人/引用@cz_binance或@heyibinance
- 强关联+近期热点→+20-35分
- 中等关联→+5-15分
- 无事件或无强关联→不加分

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
9. **低star数的GitHub项目**（<100 stars通常low）

**第八步：按标准评分**
- GitHub star数：<10→0-10分，10-100→0-15分，100-1K→10-25分，1K-1W→20-35分，>1W→30-50分
- AI相关事件：革命性突破30-45分，普通产品5-15分，成立部门0-10分
- 功能性符号传播力：0-15分

${CORE_FRAMEWORK}
`;
};
