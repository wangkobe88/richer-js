/**
 * 微信公众号文章 Section
 */

/**
 * 构建微信文章内容 section
 * @param {Object} weixinInfo - 微信文章信息
 * @returns {string} 微信文章 section 或空字符串
 */
export function buildWeixinSection(weixinInfo) {
  if (!weixinInfo || !weixinInfo.title) {
    return '';
  }

  let section = `【微信公众号文章】\n`;
  section += `标题: ${weixinInfo.title}\n`;

  if (weixinInfo.author || weixinInfo.nickname) {
    section += `公众号: ${weixinInfo.nickname || weixinInfo.author || ''}\n`;
  }

  if (weixinInfo.digest) {
    section += `摘要: ${weixinInfo.digest}\n`;
  }

  // 统计信息
  const stats = [];
  if (weixinInfo.read_num > 0) {
    stats.push(`阅读 ${weixinInfo.read_num}`);
  }
  if (weixinInfo.like_num > 0) {
    stats.push(`点赞 ${weixinInfo.like_num}`);
  }
  if (weixinInfo.comment_num > 0) {
    stats.push(`评论 ${weixinInfo.comment_num}`);
  }
  if (stats.length > 0) {
    section += `数据: ${stats.join(', ')}\n`;
  }

  // 正文内容（截取到合适长度）
  if (weixinInfo.content) {
    const maxLength = 2000;
    const content = weixinInfo.content.length > maxLength
      ? weixinInfo.content.substring(0, maxLength) + '...'
      : weixinInfo.content;
    section += `正文:\n${content}\n`;
  }

  return section;
}
