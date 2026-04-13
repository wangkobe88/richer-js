/**
 * Amazon产品信息获取器
 * 使用 JustOneAPI 获取 Amazon 产品详情
 */

import { safeSubstring } from '../analyzer/utils/data-cleaner.mjs';

const JUSTONEAPI_KEY = 'UkWus4GxT7fqEnC1';
const JUSTONEAPI_URL = 'https://api.justoneapi.com/api/amazon/get-product-detail/v1';

/**
 * 从 Amazon URL 中提取 ASIN
 * @param {string} url - Amazon 产品 URL
 * @returns {string|null} ASIN
 */
export function extractASIN(url) {
  if (!url) return null;

  // 匹配 dp/ 后面的 ASIN
  const dpMatch = url.match(/\/dp\/([A-Z0-9]{10})/);
  if (dpMatch) return dpMatch[1];

  // 匹配 gp/product/ 后面的 ASIN
  const gpMatch = url.match(/\/gp\/product\/([A-Z0-9]{10})/);
  if (gpMatch) return gpMatch[1];

  return null;
}

/**
 * 获取 Amazon 产品详情
 * @param {string} url - Amazon 产品 URL
 * @returns {Promise<Object>} 产品信息
 */
export async function fetchProductInfo(url) {
  const asin = extractASIN(url);
  if (!asin) {
    console.log('[AmazonFetcher] 无法从URL提取ASIN:', url);
    return null;
  }

  console.log(`[AmazonFetcher] 获取Amazon产品: ASIN=${asin}`);

  try {
    const response = await fetch(`${JUSTONEAPI_URL}?token=${JUSTONEAPI_KEY}&asin=${asin}`, {
      method: 'GET'
    });

    if (!response.ok) {
      throw new Error(`Amazon API 请求失败: ${response.status}`);
    }

    const data = await response.json();

    if (data.code !== 0) {
      console.warn(`[AmazonFetcher] API返回错误: ${data.message}`);
      return null;
    }

    const product = data.data;
    if (!product) {
      console.warn('[AmazonFetcher] 产品数据为空');
      return null;
    }

    // 解析出版日期
    let publicationDate = null;
    if (product.book_publication_date) {
      publicationDate = product.book_publication_date;
    } else if (product.product_information?.['Publication date']) {
      publicationDate = product.product_information['Publication date'];
    } else if (product.product_details?.['Publication date']) {
      publicationDate = product.product_details['Publication date'];
    }

    // 构建返回结果
    const result = {
      type: 'amazon',
      asin: product.asin,
      title: product.product_title,
      publication_date: publicationDate,
      brand: product.product_byline?.replace('Visit the ', '').replace(' Store', '').replace('by ', '').split(' (')[0] || null,
      price: product.product_price || null,
      original_price: product.product_original_price || null,
      currency: product.currency || 'USD',
      star_rating: product.product_star_rating ? parseFloat(product.product_star_rating) : null,
      num_ratings: product.product_num_ratings ? parseInt(product.product_num_ratings) : null,
      sales_volume: product.sales_volume || null,
      product_url: product.product_url,
      photo: product.product_photo || null,
      photos: product.product_photos || [],
      category: product.category?.name || null,
      availability: product.product_availability || null,
      is_best_seller: product.is_best_seller || false,
      is_amazon_choice: product.is_amazon_choice || false,
      is_prime: product.is_prime || false,
      has_video: product.has_video || false,
      description: (product.about_product && product.about_product.length > 0)
        ? safeSubstring(product.about_product.join('\n'), 500)
        : safeSubstring(product.product_description || null, 500) || null,
      raw: product // 保留原始数据
    };

    console.log(`[AmazonFetcher] 成功获取产品: ${result.title}`);
    return result;

  } catch (error) {
    console.error('[AmazonFetcher] 获取产品信息失败:', error.message);
    return null;
  }
}

/**
 * 判断 URL 是否为 Amazon 产品页面
 * @param {string} url - 要检查的 URL
 * @returns {boolean} 是否为 Amazon 产品页面
 */
export function isAmazonProductUrl(url) {
  if (!url) return false;

  const amazonDomains = [
    'amazon.com',
    'www.amazon.com',
    'smile.amazon.com'
  ];

  try {
    const urlObj = new URL(url);
    return amazonDomains.includes(urlObj.hostname) &&
           (urlObj.pathname.includes('/dp/') || urlObj.pathname.includes('/gp/product/'));
  } catch {
    return false;
  }
}

/**
 * 获取 Amazon 产品的影响力等级
 * @param {Object} productInfo - 产品信息
 * @returns {string} 影响力等级
 */
export function getInfluenceLevel(productInfo) {
  if (!productInfo) return 'niche';

  const salesVolume = productInfo.sales_volume || '';
  const numRatings = productInfo.num_ratings || 0;
  const isBestSeller = productInfo.is_best_seller;
  const isAmazonChoice = productInfo.is_amazon_choice;

  // 基于 Best Seller/Amazon Choice 状态和评分数量
  if (isBestSeller || isAmazonChoice) {
    if (numRatings > 1000 || (salesVolume && salesVolume.includes('1000+'))) {
      return 'world'; // 世界级
    }
    if (numRatings > 500 || (salesVolume && salesVolume.includes('200+'))) {
      return 'platform'; // 平台级
    }
    return 'community'; // 社区级
  }

  // 基于评分数量
  if (numRatings > 1000) return 'world';
  if (numRatings > 500) return 'platform';
  if (numRatings > 100) return 'community';
  if (numRatings > 10) return 'niche';

  return 'niche'; // 小众
}

/**
 * 获取影响力等级描述
 * @param {string} level - 影响力等级
 * @returns {string} 描述
 */
export function getInfluenceDescription(level) {
  const descriptions = {
    'world': '世界级影响力（Amazon Best Seller/Amazon Choice，1000+评价）',
    'platform': '平台级影响力（500+评价，热销产品）',
    'community': '社区级影响力（100+评价，受认可产品）',
    'niche': '小众影响力（评价较少）'
  };
  return descriptions[level] || '未知影响力';
}
