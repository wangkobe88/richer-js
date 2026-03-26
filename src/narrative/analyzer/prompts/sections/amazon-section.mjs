/**
 * Amazon Section - Amazon产品信息
 */

/**
 * 构建Amazon产品section
 * @param {Object} amazonInfo - Amazon产品信息
 * @returns {string} Amazon section或空字符串
 */
export function buildAmazonSection(amazonInfo) {
  if (!amazonInfo) {
    return '';
  }

  const parts = [];

  parts.push(`【Amazon】${amazonInfo.title || '未知产品'}`);

  if (amazonInfo.brand) {
    parts.push(`品牌: ${amazonInfo.brand}`);
  }

  if (amazonInfo.price) {
    parts.push(`价格: ${amazonInfo.price}${amazonInfo.currency || 'USD'}`);
    if (amazonInfo.original_price && amazonInfo.original_price !== amazonInfo.price) {
      parts.push(`原价: ${amazonInfo.original_price}${amazonInfo.currency || 'USD'}`);
    }
  }

  if (amazonInfo.star_rating) {
    parts.push(`评分: ${amazonInfo.star_rating}★`);
    if (amazonInfo.num_ratings) {
      parts.push(`评价数: ${amazonInfo.num_ratings}`);
    }
  }

  if (amazonInfo.sales_volume) {
    parts.push(`销量: ${amazonInfo.sales_volume}`);
  }

  if (amazonInfo.category) {
    parts.push(`分类: ${amazonInfo.category}`);
  }

  // 特殊标签
  const tags = [];
  if (amazonInfo.is_best_seller) tags.push('Best Seller');
  if (amazonInfo.is_amazon_choice) tags.push("Amazon's Choice");
  if (amazonInfo.is_prime) tags.push('Prime');
  if (tags.length > 0) {
    parts.push(`标签: ${tags.join(', ')}`);
  }

  if (amazonInfo.influence_level) {
    parts.push(`影响力: ${amazonInfo.influence_description}`);
  }

  if (amazonInfo.description) {
    parts.push(`简介: ${amazonInfo.description}`);
  }

  return parts.join('\n');
}
