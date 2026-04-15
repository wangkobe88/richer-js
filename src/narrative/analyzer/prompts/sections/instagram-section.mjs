/**
 * Instagram Section - Instagram 帖子/用户信息
 */

import { safeSubstring } from '../../utils/data-cleaner.mjs';

const MAX_CAPTION_LENGTH = 500;

/**
 * 截断过长的文本
 */
function truncateText(text, maxLength) {
  return safeSubstring(text, maxLength, '...(已截断)');
}

/**
 * 构建 Instagram section
 * @param {Object} instagramInfo - Instagram 信息（帖子或用户）
 * @returns {string} Instagram section 或空字符串
 */
export function buildInstagramSection(instagramInfo) {
  if (!instagramInfo) {
    return '';
  }

  const parts = [];

  if (instagramInfo.type === 'user_profile') {
    // 用户主页
    parts.push(`【Instagram用户主页】@${instagramInfo.username || '未知'}`);

    if (instagramInfo.full_name) {
      parts.push(`全名: ${instagramInfo.full_name}`);
    }

    const verified = instagramInfo.is_verified ? ' [已认证]' : '';
    parts.push(`粉丝: ${instagramInfo.follower_count || 0} | 关注: ${instagramInfo.following_count || 0} | 帖子: ${instagramInfo.media_count || 0}${verified}`);

    if (instagramInfo.biography) {
      const bio = truncateText(instagramInfo.biography, MAX_CAPTION_LENGTH);
      parts.push(`\n【简介】`);
      parts.push(bio);
    }

    if (instagramInfo.external_url) {
      parts.push(`外部链接: ${instagramInfo.external_url}`);
    }

  } else {
    // 帖子或 Reel
    const typeLabel = instagramInfo.type === 'reel' ? 'Reel' : '帖子';
    const mediaLabel = instagramInfo.media_type === 2 ? '视频' : '图片';
    const user = instagramInfo.user || {};
    const verified = user.is_verified ? ' [已认证]' : '';

    parts.push(`【Instagram${typeLabel}】@${user.username || '未知用户'}${verified}`);
    parts.push(`类型: ${mediaLabel} | 发布时间: ${instagramInfo.taken_at ? new Date(instagramInfo.taken_at).toLocaleString('zh-CN') : '未知'}`);

    // 互动数据
    const metrics = instagramInfo.metrics || {};
    const stats = [
      `点赞: ${metrics.like_count || 0}`,
      `评论: ${metrics.comment_count || 0}`
    ];
    if (metrics.play_count) {
      stats.push(`播放: ${metrics.play_count}`);
    }
    if (metrics.share_count) {
      stats.push(`分享: ${metrics.share_count}`);
    }
    parts.push(stats.join(', '));

    // 影响力
    if (instagramInfo.influence_level) {
      parts.push(`影响力: ${instagramInfo.influence_description}`);
    }

    // 内容
    if (instagramInfo.caption) {
      const caption = truncateText(instagramInfo.caption, MAX_CAPTION_LENGTH);
      parts.push(`\n【内容】`);
      parts.push(caption);
    }

    // 标签
    const tags = [];
    if (instagramInfo.hashtags && instagramInfo.hashtags.length > 0) {
      tags.push(`标签: ${instagramInfo.hashtags.join(', ')}`);
    }
    if (instagramInfo.mentions && instagramInfo.mentions.length > 0) {
      tags.push(`提及: ${instagramInfo.mentions.join(', ')}`);
    }
    if (tags.length > 0) {
      parts.push(`\n【标签信息】`);
      parts.push(tags.join('\n'));
    }
  }

  return parts.join('\n');
}
