/**
 * Website Section - 网页内容
 */

const MAX_WEBSITE_CONTENT_LENGTH = 1000;

/**
 * 构建网站内容section
 * @param {Object} websiteInfo - 网站信息
 * @returns {string} Website section或空字符串
 */
export function buildWebsiteSection(websiteInfo) {
  if (!websiteInfo || !websiteInfo.content) {
    return '';
  }

  let content = websiteInfo.content;

  // 截断过长的网站内容，避免Prompt过长
  if (content.length > MAX_WEBSITE_CONTENT_LENGTH) {
    content = content.substring(0, MAX_WEBSITE_CONTENT_LENGTH) + '...(内容已截断)';
  }

  return `【网页内容】${content}`;
}
