/**
 * 视频平台专用 Prompt
 * 适用于只有TikTok/YouTube/抖音等视频平台信息的场景
 * 特点：默认视频内容与代币有关联性（因为无法获取视频内容本身）
 */

import { CORE_FRAMEWORK } from './core.mjs';
import { generateAccountBackgroundsPrompt } from './account-backgrounds.mjs';

export const VIDEO_ONLY_PROMPT = (tokenData, tiktokInfo, youtubeInfo, douyinInfo, extractedInfo) => {
  const tokenName = tokenData.symbol;
  const introEn = extractedInfo.intro_en || '';
  const introCn = extractedInfo.intro_cn || '';
  const website = extractedInfo.website || '';
  const twitterUrl = extractedInfo.twitter_url || '';

  // 构建视频信息
  const videoParts = [];

  if (tiktokInfo) {
    videoParts.push(`【TikTok】@${tiktokInfo.author_username || tiktokInfo.author_name || '未知'}`);
    videoParts.push(`描述: ${tiktokInfo.description || '无描述'}`);
    videoParts.push(`播放: ${tiktokInfo.view_count || 0}, 点赞: ${tiktokInfo.like_count || 0}, 评论: ${tiktokInfo.comment_count || 0}`);
    if (tiktokInfo.influence_level) videoParts.push(`影响力: ${tiktokInfo.influence_description}`);
  }

  if (youtubeInfo) {
    videoParts.push(`【YouTube】${youtubeInfo.title || '未知'}`);
    videoParts.push(`描述: ${youtubeInfo.description || '无描述'}`);
    videoParts.push(`观看: ${youtubeInfo.view_count || 0}, 点赞: ${youtubeInfo.like_count || 0}`);
    if (youtubeInfo.influence_level) videoParts.push(`影响力: ${youtubeInfo.influence_description}`);
  }

  if (douyinInfo) {
    videoParts.push(`【抖音】${douyinInfo.title || '未知'}`);
    videoParts.push(`描述: ${douyinInfo.description || '无描述'}`);
    videoParts.push(`点赞: ${douyinInfo.like_count || 0}, 评论: ${douyinInfo.comment_count || 0}`);
    if (douyinInfo.influence_level) videoParts.push(`影响力: ${douyinInfo.influence_description}`);
  }

  return `
你是代币叙事分析专家，负责评估meme代币的叙事质量。

【代币信息】
- 代币名称：${tokenName}
- 代币地址：${tokenData.address}

${generateAccountBackgroundsPrompt(null)}${videoParts.join('\n')}

【基础信息】
${introEn ? `【介绍英文】${introEn}\n` : ''}${introCn ? `【介绍中文】${introCn}\n` : ''}${website ? `【网站】${website}\n` : ''}${twitterUrl ? `【Twitter链接】${twitterUrl}\n` : ''}

【核心原则：视频内容默认关联】
**重要：无法获取视频的实际内容，因此默认假设视频内容与代币有关联性**
- 有视频 + intro有实际含义 → 至少评mid
- 视频高播放量 + 名称匹配 → 评mid-high或high
- 禁止理由："无法确认视频内容与代币的关联性"

【评估步骤】

第一步：判断核心信息是否缺失
**同时满足以下条件 → unrated：**
1. 只有视频描述（无intro、无其他信息）
2. 视频描述只是简单的标签（如#faker #meme）
3. intro只是简单名字描述（如"Tom the lizard"）

第二步：判断视频热度与代币关联
**高播放视频（>10万播放）：**
- 名称匹配或描述有关键词 → mid或mid-high
- 标签匹配 + 高互动 → mid或mid-high

**中低播放视频（<10万播放）：**
- 名称完全匹配 → low到mid
- 有关联但不明显 → low

第三步：判断可理解性/关联度
**默认视频与代币有关联：**
- intro有实际含义 + 有视频 → 评mid或以上
- 禁止说"无法建立有效的视觉关联"

**信息在外部平台 → unrated：**
- website是B站、快手、Telegram、Discord、小红书、Instagram等
- 网站无法访问或超时

**信息完整但无关联 → low：**
- intro只是通用描述（如"Infinite Runner"）
- 视频描述与代币名完全无关

第四步：检测低质量叙事
1. 纯谐音梗（如"生菜=生财"）
2. 热搜搬运（纯报道热点事件）
3. 泛泛情感概念（如"遗憾"、"佛系"）
4. 伪关联（代币名只是顺便提及）
5. 大IP蹭热度（缺乏强关联证据）
6. 低质量视频内容（低播放、低互动）

${CORE_FRAMEWORK}
`;
};
