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

第一步：判断推文语言（如有推文）
- 非中英文推文需满足影响力条件：粉丝数>=10000 或 认证 或 高互动（点赞>=1000）
- 不满足 → 返回 low

第二步：判断核心信息是否缺失
**同时满足以下条件 → unrated：**
1. 无推文、无website、无Twitter账号
2. intro只是简单名字描述（如"Tom the lizard"、"A meme coin"）
**重要例外**：有Twitter账号（不管是不是大IP）→ 不是unrated

第三步：判断可理解性/关联度
**推文有配图/视频时：**
- 默认假设：配图内容与代币有关联
- intro有实际含义 + 有配图 → 评mid或以上
- 禁止理由：不能说"无法建立有效的视觉关联"

**信息在外部平台 → unrated：**
- website是B站、快手、Telegram、Discord、小红书、Instagram等
- 网站无法访问或超时

**信息完整但无关联 → low：**
- 获取了完整信息但与代币无明显关联
- intro只是通用描述（如"Infinite Runner"）

第四步：检测低质量叙事（以下情况返回low）
1. 纯谐音梗（如"生菜=生财"）
2. 热搜搬运（纯报道热点事件）
3. 泛泛情感概念（如"遗憾"、"佛系"）
4. 伪关联（代币名只是顺便提及）
5. 大IP蹭热度（缺乏强关联证据）
6. 平台产品更新蹭热度
7. 功能性符号（紧急出口标志、交通标志等）→ 0-15分
8. 无影响力的新说法/梗
9. 低star数的GitHub项目（<100 stars通常low）

第五步：按标准评分
- GitHub star数：<10→0-10分，10-100→0-15分，100-1K→10-25分，1K-1W→20-35分，>1W→30-50分
- AI相关事件：革命性突破30-45分，普通产品5-15分，成立部门0-10分
- 功能性符号传播力：0-15分

${CORE_FRAMEWORK}
`;
};
