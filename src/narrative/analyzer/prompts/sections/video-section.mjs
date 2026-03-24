/**
 * Video Section - 视频平台信息（YouTube/抖音/TikTok）
 */

/**
 * 构建视频平台section
 * @param {Object} youtubeInfo - YouTube信息
 * @param {Object} douyinInfo - 抖音信息
 * @param {Object} tiktokInfo - TikTok信息
 * @returns {string} Video section或空字符串
 */
export function buildVideoSection(youtubeInfo, douyinInfo, tiktokInfo) {
  const parts = [];

  // YouTube
  if (youtubeInfo) {
    parts.push(`【YouTube】${youtubeInfo.title || '未知'}`);
    parts.push(`观看数: ${youtubeInfo.view_count || 0}`);
    if (youtubeInfo.influence_level) {
      parts.push(`影响力: ${youtubeInfo.influence_description}`);
    }
  }

  // 抖音
  if (douyinInfo) {
    if (parts.length > 0) parts.push('');
    parts.push(`【抖音】${douyinInfo.title || '未知'}`);
    parts.push(`点赞数: ${douyinInfo.like_count || 0}`);
    if (douyinInfo.influence_level) {
      parts.push(`影响力: ${douyinInfo.influence_description}`);
    }
  }

  // TikTok
  if (tiktokInfo) {
    if (parts.length > 0) parts.push('');
    const author = tiktokInfo.author_username || tiktokInfo.author_name || '未知';
    const desc = tiktokInfo.description || '无描述';
    parts.push(`【TikTok】@${author} - ${desc}`);
    parts.push(`播放数: ${tiktokInfo.view_count || 0}, 点赞数: ${tiktokInfo.like_count || 0}`);
    if (tiktokInfo.influence_level) {
      parts.push(`影响力: ${tiktokInfo.influence_description}`);
    }
  }

  return parts.length > 0 ? parts.join('\n') : '';
}
