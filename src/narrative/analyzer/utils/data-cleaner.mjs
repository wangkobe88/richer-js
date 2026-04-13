/**
 * Data Cleaner - 数据清理工具
 * 用于清理数据以便保存到数据库（移除PostgreSQL不支持的控制字符）
 */

/**
 * 安全截断字符串，避免在UTF-16代理对中间切割
 * JavaScript的substring按UTF-16码元操作，可能在emoji等字符的代理对中间切断，
 * 导致PostgreSQL JSONB拒绝存储（PGRST102/22P05错误）
 * @param {string} str - 要截断的字符串
 * @param {number} maxLen - 最大长度（UTF-16码元数）
 * @param {string} suffix - 截断后添加的后缀
 * @returns {string} 截断后的字符串
 */
export function safeSubstring(str, maxLen, suffix = '...') {
  if (!str || str.length <= maxLen) return str;

  let result = str.substring(0, maxLen);

  // 检查最后一个字符是否是孤立的高代理项（0xD800-0xDBFF）
  const lastCharCode = result.charCodeAt(result.length - 1);
  if (lastCharCode >= 0xD800 && lastCharCode <= 0xDBFF) {
    // 切断了代理对，移除孤立的高代理项
    result = result.substring(0, result.length - 1);
  }

  return result + suffix;
}

/**
 * 清理数据以便保存到数据库（移除PostgreSQL不支持的控制字符）
 * @param {*} data - 要清理的数据
 * @returns {*} 清理后的数据
 */
export function cleanDataForDB(data) {
  if (!data) return null;

  // 处理字符串
  if (typeof data === 'string') {
    // 移除空字符和其他控制字符（0x00-0x1F），但保留换行、回车、制表符
    return data.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  // 处理数组
  if (Array.isArray(data)) {
    return data.map(item => cleanDataForDB(item));
  }

  if (typeof data === 'object') {
    const cleaned = {};
    for (const [key, value] of Object.entries(data)) {
      cleaned[key] = cleanDataForDB(value);
    }
    return cleaned;
  }

  return data;
}
