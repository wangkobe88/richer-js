/**
 * Xiaohongshu Section - 小红书笔记信息
 */

import { safeSubstring } from '../../utils/data-cleaner.mjs';

const MAX_DESC_LENGTH = 500;

/**
 * 截断过长的文本
 */
function truncateText(text, maxLength) {
  return safeSubstring(text, maxLength, '...(已截断)');
}

/**
 * 构建小红书笔记section
 * @param {Object} xiaohongshuInfo - 小红书笔记信息
 * @returns {string} 小红书section或空字符串
 */
export function buildXiaohongshuSection(xiaohongshuInfo) {
  if (!xiaohongshuInfo) {
    return '';
  }

  const parts = [];

  // 笔记标题和类型
  const typeLabel = xiaohongshuInfo.type === 'video' ? '视频' : '图文';
  parts.push(`【小红书${typeLabel}】${xiaohongshuInfo.title || '未知标题'}`);

  // 作者信息
  if (xiaohongshuInfo.user) {
    const user = xiaohongshuInfo.user;
    const verified = user.red_official_verified ? '[官方认证]' : '';
    parts.push(`发布者: @${user.nickname}${verified}`);
  }

  // 笔记类型和发布信息
  const timeStr = xiaohongshuInfo.time ? new Date(xiaohongshuInfo.time).toLocaleString('zh-CN') : '未知时间';
  const location = xiaohongshuInfo.ip_location || '未知地点';
  parts.push(`类型: ${typeLabel} | 发布时间: ${timeStr} | 发布地点: ${location}`);

  // 互动数据
  const stats = [
    `浏览: ${xiaohongshuInfo.view_count || 0}`,
    `点赞: ${xiaohongshuInfo.liked_count || 0}`,
    `收藏: ${xiaohongshuInfo.collected_count || 0}`,
    `评论: ${xiaohongshuInfo.comments_count || 0}`
  ];
  parts.push(stats.join(', '));

  // 影响力
  if (xiaohongshuInfo.influence_level) {
    parts.push(`影响力: ${xiaohongshuInfo.influence_description}`);
  }

  // 笔记内容
  if (xiaohongshuInfo.desc) {
    const desc = truncateText(xiaohongshuInfo.desc, MAX_DESC_LENGTH);
    parts.push(`\n【笔记内容】`);
    parts.push(desc);
  }

  // 标签信息
  const tags = [];
  if (xiaohongshuInfo.topics && xiaohongshuInfo.topics.length > 0) {
    tags.push(`话题: ${xiaohongshuInfo.topics.map(t => t.name || t).join(', ')}`);
  }
  if (xiaohongshuInfo.hashtags) {
    tags.push(`标签: ${xiaohongshuInfo.hashtags}`);
  }
  if (xiaohongshuInfo.mentions && xiaohongshuInfo.mentions.length > 0) {
    tags.push(`提及: ${xiaohongshuInfo.mentions.map(m => m.nickname).join(', ')}`);
  }
  if (tags.length > 0) {
    parts.push(`\n【标签信息】`);
    parts.push(tags.join('\n'));
  }

  return parts.join('\n');
}
