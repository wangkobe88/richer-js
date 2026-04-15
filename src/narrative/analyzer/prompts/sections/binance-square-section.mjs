/**
 * 币安广场（Binance Square） Section
 */

/**
 * 构建币安广场内容 section
 * @param {Object} binanceSquareInfo - 币安广场文章信息
 * @returns {string} 币安广场 section 或空字符串
 */
export function buildBinanceSquareSection(binanceSquareInfo) {
  if (!binanceSquareInfo) return '';

  // 最小元数据模式下只有 postId，没有 title 和 content
  // 只要有 postId 就能提供有用信息
  if (!binanceSquareInfo.postId && !binanceSquareInfo.title && !binanceSquareInfo.content) {
    return '';
  }

  let section = `【币安广场内容】\n`;
  section += `来源: 币安广场(Binance Square)\n`;

  if (binanceSquareInfo.title) {
    section += `标题: ${binanceSquareInfo.title}\n`;
  }

  if (binanceSquareInfo.author) {
    section += `作者: ${binanceSquareInfo.author}\n`;
  }

  // 统计信息
  const stats = [];
  if (binanceSquareInfo.likeCount > 0) {
    stats.push(`点赞 ${binanceSquareInfo.likeCount}`);
  }
  if (binanceSquareInfo.commentCount > 0) {
    stats.push(`评论 ${binanceSquareInfo.commentCount}`);
  }
  if (binanceSquareInfo.shareCount > 0) {
    stats.push(`分享 ${binanceSquareInfo.shareCount}`);
  }
  if (stats.length > 0) {
    section += `数据: ${stats.join(', ')}\n`;
  }

  if (binanceSquareInfo.influence_level) {
    section += `影响力: ${binanceSquareInfo.influence_description || binanceSquareInfo.influence_level}\n`;
  }

  // 标签
  if (binanceSquareInfo.tags && binanceSquareInfo.tags.length > 0) {
    section += `标签: ${binanceSquareInfo.tags.join(', ')}\n`;
  }

  // 正文内容
  if (binanceSquareInfo.content) {
    section += `内容:\n${binanceSquareInfo.content}\n`;
  } else if (binanceSquareInfo.fetchMethod === 'minimal') {
    section += `⚠️ 内容获取受限（WAF保护），仅有文章ID: ${binanceSquareInfo.postId}\n`;
  }

  return section;
}
