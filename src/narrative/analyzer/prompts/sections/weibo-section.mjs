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
