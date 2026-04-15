/**
 * Video Section - 视频平台信息（YouTube/抖音/TikTok/Bilibili）
 */

import { safeSubstring } from '../../utils/data-cleaner.mjs';

const MAX_VIDEO_DESC_LENGTH = 500;

/**
 * 截断过长的文本
 */
function truncateText(text, maxLength) {
  return safeSubstring(text, maxLength, '...(已截断)');
}

/**
 * 构建视频平台section
 * @param {Object} youtubeInfo - YouTube信息
 * @param {Object} douyinInfo - 抖音信息
 * @param {Object} tiktokInfo - TikTok信息
 * @param {Object} bilibiliInfo - Bilibili信息
 * @returns {string} Video section或空字符串
 */
export function buildVideoSection(youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo) {
  const parts = [];

  // YouTube
  if (youtubeInfo) {
    if (youtubeInfo.type === 'channel') {
      // YouTube频道
      parts.push(`【YouTube频道】${youtubeInfo.channel_title || '未知'}`);
      if (youtubeInfo.description) {
        parts.push(`描述: ${truncateText(youtubeInfo.description, 300)}`);
      }
      if (youtubeInfo.recent_videos && youtubeInfo.recent_videos.length > 0) {
        parts.push(`最近视频:`);
        youtubeInfo.recent_videos.slice(0, 3).forEach(v => {
          parts.push(`  - ${v.title || '无标题'} (${v.view_count || 0}播放)`);
        });
      }
    } else {
      // YouTube视频
      parts.push(`【YouTube】${youtubeInfo.title || '未知'}`);
      const stats = [`观看数: ${youtubeInfo.view_count || 0}`];
      if (youtubeInfo.like_count) stats.push(`点赞数: ${youtubeInfo.like_count}`);
      parts.push(stats.join(', '));
      if (youtubeInfo.influence_level) {
        parts.push(`影响力: ${youtubeInfo.influence_description}`);
      }
    }
  }

  // 抖音
  if (douyinInfo) {
    if (parts.length > 0) parts.push('');
    if (douyinInfo.type === 'user_profile') {
      // 抖音用户主页
      const verified = douyinInfo.verified ? ' [已认证]' : '';
      parts.push(`【抖音用户主页】${douyinInfo.nickname || '未知'}${verified}`);
      parts.push(`粉丝: ${douyinInfo.follower_count || 0} | 获赞: ${douyinInfo.total_favorited || 0} | 作品: ${douyinInfo.aweme_count || 0}`);
      if (douyinInfo.signature) {
        parts.push(`简介: ${truncateText(douyinInfo.signature, 300)}`);
      }
      if (douyinInfo.ip_location) {
        parts.push(`IP属地: ${douyinInfo.ip_location}`);
      }
    } else {
      // 抖音视频
      parts.push(`【抖音】${douyinInfo.title || '未知'}`);
      const stats = [];
      const likeCount = douyinInfo.like_count || 0;
      stats.push(`点赞数: ${likeCount}`);
      const viewCount = douyinInfo.view_count || 0;
      if (viewCount > 0) {
        stats.push(`观看数: ${viewCount}`);
      } else {
        stats.push(`观看数: 隐藏`);
      }
      const shareCount = douyinInfo.share_count || 0;
      if (shareCount > 0) {
        stats.push(`分享数: ${shareCount}`);
      }
      parts.push(stats.join(', '));
      if (douyinInfo.influence_level) {
        parts.push(`影响力: ${douyinInfo.influence_description}`);
      }
    }
  }

  // TikTok
  if (tiktokInfo) {
    if (parts.length > 0) parts.push('');
    if (tiktokInfo.type === 'user_profile') {
      // TikTok用户主页
      const verified = tiktokInfo.verified ? ' [已认证]' : '';
      parts.push(`【TikTok用户】@${tiktokInfo.unique_id || '未知'}${verified}`);
      parts.push(`昵称: ${tiktokInfo.nickname || '未知'}`);
      parts.push(`粉丝: ${tiktokInfo.follower_count || 0} | 获赞: ${tiktokInfo.heart_count || 0} | 作品: ${tiktokInfo.video_count || 0}`);
      if (tiktokInfo.signature) {
        parts.push(`简介: ${truncateText(tiktokInfo.signature, 300)}`);
      }
    } else {
      // TikTok视频
      const author = tiktokInfo.author_username || tiktokInfo.author_name || '未知';
      const desc = truncateText(tiktokInfo.description || '无描述', MAX_VIDEO_DESC_LENGTH);
      parts.push(`【TikTok】@${author} - ${desc}`);
      parts.push(`播放数: ${tiktokInfo.view_count || 0}, 点赞数: ${tiktokInfo.like_count || 0}`);
      if (tiktokInfo.influence_level) {
        parts.push(`影响力: ${tiktokInfo.influence_description}`);
      }
    }
  }

  // Bilibili
  if (bilibiliInfo) {
    if (parts.length > 0) parts.push('');
    const author = bilibiliInfo.author_name || '未知';
    parts.push(`【Bilibili】${bilibiliInfo.title || '未知'}`);
    parts.push(`UP主: ${author}`);
    parts.push(`播放数: ${bilibiliInfo.view_count || 0}, 点赞数: ${bilibiliInfo.like_count || 0}`);
    if (bilibiliInfo.influence_level) {
      parts.push(`影响力: ${bilibiliInfo.influence_description}`);
    }
  }

  return parts.length > 0 ? parts.join('\n') : '';
}
