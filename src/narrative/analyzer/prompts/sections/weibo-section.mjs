/**
 * Weibo Section - 微博信息（背景信息）
 */

import { safeSubstring } from '../../utils/data-cleaner.mjs';

/**
 * 构建微博信息section
 * @param {Object} backgroundInfo - 背景信息（微博）
 * @returns {string} Weibo section或空字符串
 */
export function buildWeiboSection(backgroundInfo) {
  if (!backgroundInfo || (backgroundInfo.source !== 'weibo' && backgroundInfo.type !== 'weibo')) {
    return '';
  }

  const parts = [];

  // 微博用户主页
  if (backgroundInfo.type === 'user_profile') {
    const verified = backgroundInfo.verified ? ' [已认证]' : '';
    parts.push(`【微博用户主页】${backgroundInfo.screen_name || '未知'}${verified}`);
    parts.push(`粉丝: ${backgroundInfo.followers_count || 0} | 关注: ${backgroundInfo.friends_count || 0} | 微博: ${backgroundInfo.statuses_count || 0}`);
    if (backgroundInfo.verified && backgroundInfo.verified_reason) {
      parts.push(`认证: ${backgroundInfo.verified_reason}`);
    }
    if (backgroundInfo.description) {
      parts.push(`简介: ${safeSubstring(backgroundInfo.description, 300)}`);
    }
    if (backgroundInfo.location) {
      parts.push(`位置: ${backgroundInfo.location}`);
    }
    return parts.join('\n');
  }

  // 微博帖子（原有逻辑）
  parts.push(`【微博信息】`);
  parts.push(`- 微博内容：${safeSubstring(backgroundInfo.text || '', 300) || '无'}`);
  parts.push(`- 作者：${backgroundInfo.author_name || backgroundInfo.author || '无'}`);

  if (backgroundInfo.author_followers_count) {
    parts.push(`- 粉丝数：${backgroundInfo.author_followers_count}`);
  }

  if (backgroundInfo.created_at) {
    parts.push(`- 发布时间：${backgroundInfo.created_at}`);
  }

  return parts.join('\n');
}
