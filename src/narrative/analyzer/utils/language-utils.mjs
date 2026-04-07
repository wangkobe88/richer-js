/**
 * Language Utils - 语言检测和翻译相关工具
 */

/**
 * 简单检测文本语言
 * @param {string} text - 要检测的文本
 * @returns {string|null} 语言代码（zh, en, th, ja, ko 等）
 */
export function detectLanguage(text) {
  if (!text || text.length < 10) {
    return null;
  }

  // 检查是否包含中文字符
  if (/[\u4e00-\u9fa5]/.test(text)) {
    return 'zh';
  }

  // 检查是否包含泰文字符
  if (/[\u0e00-\u0e7f]/.test(text)) {
    return 'th';
  }

  // 检查是否包含日文字符
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) {
    return 'ja';
  }

  // 检查是否包含韩文字符
  if (/[\uac00-\ud7af]/.test(text)) {
    return 'ko';
  }

  // 检查是否包含阿拉伯文字符
  if (/[\u0600-\u06ff]/.test(text)) {
    return 'ar';
  }

  // 检查是否包含俄文字符
  if (/[\u0400-\u04ff]/.test(text)) {
    return 'ru';
  }

  // 默认认为是英语
  return 'en';
}

/**
 * 标准化常见译名
 * 将翻译结果中的常见译名变体统一为标准译名
 * @param {string} text - 翻译后的文本
 * @param {string} tokenName - 代币名称
 * @returns {string} 标准化后的文本
 */
export function standardizeTranslatedNames(text, tokenName) {
  if (!text || !tokenName) {
    return text;
  }

  let standardized = text;

  // 路飞的常见译名变体
  if (tokenName === '路飞' || tokenName === 'Luffy' || tokenName === 'ルフィ') {
    standardized = standardized.replace(/卢菲/g, '路飞');
    standardized = standardized.replace(/鲁夫/g, '路飞');
    standardized = standardized.replace(/魯夫/g, '路飞');
  }

  // 特朗普的常见译名变体
  if (tokenName === '特朗普' || tokenName === 'Trump' || tokenName === 'トランプ') {
    standardized = standardized.replace(/川普/g, '特朗普');
  }

  // 可以继续添加其他常见译名的标准化规则

  return standardized;
}
