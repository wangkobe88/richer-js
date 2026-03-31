/**
 * Video Section - 视频平台信息（YouTube/抖音/TikTok/Bilibili）
 */

const MAX_VIDEO_DESC_LENGTH = 500;

/**
 * 截断过长的文本
 */
function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...(已截断)';
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
    parts.push(`【YouTube】${youtubeInfo.title || '未知'}`);
    const stats = [`观看数: ${youtubeInfo.view_count || 0}`];
    if (youtubeInfo.like_count) stats.push(`点赞数: ${youtubeInfo.like_count}`);
    parts.push(stats.join(', '));
    if (youtubeInfo.influence_level) {
      parts.push(`影响力: ${youtubeInfo.influence_description}`);
    }
  }

  // 抖音
  if (douyinInfo) {
    if (parts.length > 0) parts.push('');
    parts.push(`【抖音】${douyinInfo.title || '未知'}`);
    const stats = [`点赞数: ${douyinInfo.like_count || 0}`];
    if (douyinInfo.view_count) stats.push(`观看数: ${douyinInfo.view_count}`);
    parts.push(stats.join(', '));
    if (douyinInfo.influence_level) {
      parts.push(`影响力: ${douyinInfo.influence_description}`);
    }
  }

  // TikTok
  if (tiktokInfo) {
    if (parts.length > 0) parts.push('');
    const author = tiktokInfo.author_username || tiktokInfo.author_name || '未知';
    const desc = truncateText(tiktokInfo.description || '无描述', MAX_VIDEO_DESC_LENGTH);
    parts.push(`【TikTok】@${author} - ${desc}`);
    parts.push(`播放数: ${tiktokInfo.view_count || 0}, 点赞数: ${tiktokInfo.like_count || 0}`);
    if (tiktokInfo.influence_level) {
      parts.push(`影响力: ${tiktokInfo.influence_description}`);
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
