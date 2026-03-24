/**
 * Website Section - 网页内容
 */

/**
 * 构建网站内容section
 * @param {Object} websiteInfo - 网站信息
 * @returns {string} Website section或空字符串
 */
export function buildWebsiteSection(websiteInfo) {
  if (!websiteInfo || !websiteInfo.content) {
    return '';
  }

  return `【网页内容】${websiteInfo.content}`;
}
