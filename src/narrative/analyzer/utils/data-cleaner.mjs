/**
 * Data Cleaner - 数据清理工具
 * 用于清理数据以便保存到数据库（移除PostgreSQL不支持的控制字符）
 */

/**
 * 清理数据以便保存到数据库（移除PostgreSQL不支持的控制字符）
 * @param {*} data - 要清理的数据
 * @returns {*} 清理后的数据
 */
export function cleanDataForDB(data) {
  if (!data) return null;

  // 处理字符串
  if (typeof data === 'string') {
    // 移除空字符和其他控制字符（0x00-0x1F）
    return data.replace(/[\x00-\x1F\x7F]/g, '');
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
