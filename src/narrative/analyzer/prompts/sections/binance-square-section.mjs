/**
 * 币安广场（Binance Square） Section
 */

/**
 * 构建币安广场内容 section
 * @param {Object} binanceSquareInfo - 币安广场文章信息
 * @param {Object} [options] - 选项
 * @param {number} [options.now] - 时间基准（毫秒；生产传代币创建时间，与
 *   twitter-section 同款裁定——时效=发币时语料新鲜度，补跑/回测幂等）
 * @returns {string} 币安广场 section 或空字符串
 */
export function buildBinanceSquareSection(binanceSquareInfo, options = {}) {
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
    // bapi 路径独有：官方认证作者（authorVerificationType>0）——币安官方矩阵号发文的强信号
    if (binanceSquareInfo.authorVerified) {
      section += `作者认证: 官方认证账号\n`;
    }
  }

  // 发布时间（bapi firstReleaseTime / JSON-LD datePublished；Jev timing 题的唯一时间
  // 依据——没有它 C39 BI 案 timing 只能 unknown 时效 0，帖子实际比 token 创建只早 10s）
  if (binanceSquareInfo.publishedAt) {
    const pubDate = new Date(binanceSquareInfo.publishedAt);
    if (!isNaN(pubDate.getTime())) {
      const nowMs = options.now ?? Date.now();
      const daysAgo = Math.floor((nowMs - pubDate.getTime()) / (1000 * 60 * 60 * 24));
      const rel = daysAgo <= 0 ? '今天' : `约${daysAgo}天前`;
      section += `发布时间: ${binanceSquareInfo.publishedAt}（${rel}）\n`;
    }
  }

  // 统计信息
  const stats = [];
  if (binanceSquareInfo.viewCount > 0) {
    stats.push(`浏览 ${binanceSquareInfo.viewCount}`);
  }
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
