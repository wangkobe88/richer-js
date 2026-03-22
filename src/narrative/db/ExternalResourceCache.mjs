/**
 * 外部资源缓存服务
 * 用于缓存推特、微博、抖音等外部API获取的内容
 * 避免重复调用昂贵的API
 */

import dbManager from '../../services/dbManager.js';

const RAPIDAPI_KEY = 'b2d183d4cbmshe79b303f1de4b64p18e56ejsna95529b3f9ef';

export class ExternalResourceCache {

  /**
   * 从缓存获取资源
   * @param {string} url - 资源URL
   * @param {string} resourceType - 资源类型
   * @param {Object} options - 选项
   * @param {number} options.maxAge - 最大缓存时间（秒），默认30天
   * @returns {Promise<Object|null>} 缓存的内容或null
   */
  static async get(url, resourceType, options = {}) {
    const { maxAge = 30 * 24 * 60 * 60 } = options; // 默认30天

    try {
      const supabase = dbManager.getSupabase();

      // 构建查询条件
      let query = supabase
        .from('external_resource_cache')
        .select('*')
        .eq('url', url)
        .eq('resource_type', resourceType)
        .eq('status', 'success');

      // 检查过期时间
      const expiresBefore = new Date(Date.now() - maxAge * 1000).toISOString();
      query = query.or(`expires_at.is.null,expires_at.gte.${expiresBefore}`);

      const { data, error } = await query.maybeSingle();

      if (error) {
        console.error('[ExternalResourceCache] 查询缓存失败:', error.message);
        return null;
      }

      if (data) {
        console.log(`[ExternalResourceCache] 缓存命中: ${resourceType} - ${url}`);
        return data.content;
      }

      console.log(`[ExternalResourceCache] 缓存未命中: ${resourceType} - ${url}`);
      return null;
    } catch (error) {
      console.error('[ExternalResourceCache] 查询缓存异常:', error.message);
      return null;
    }
  }

  /**
   * 设置缓存
   * @param {string} url - 资源URL
   * @param {string} resourceType - 资源类型
   * @param {Object} content - 缓存内容
   * @param {Object} options - 选项
   * @param {number} options.ttl - 过期时间（秒），默认30天
   * @param {Object} options.metadata - 元数据
   * @returns {Promise<boolean>} 是否成功
   */
  static async set(url, resourceType, content, options = {}) {
    const { ttl = 30 * 24 * 60 * 60, metadata = {} } = options;

    try {
      const supabase = dbManager.getSupabase();

      // 计算过期时间
      const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

      const { error } = await supabase
        .from('external_resource_cache')
        .upsert({
          url,
          resource_type: resourceType,
          content,
          status: 'success',
          metadata,
          cached_at: new Date().toISOString(),
          expires_at: expiresAt
        }, {
          onConflict: 'url,resource_type'
        });

      if (error) {
        console.error('[ExternalResourceCache] 设置缓存失败:', error.message);
        return false;
      }

      console.log(`[ExternalResourceCache] 缓存已保存: ${resourceType} - ${url}`);
      return true;
    } catch (error) {
      console.error('[ExternalResourceCache] 设置缓存异常:', error.message);
      return false;
    }
  }

  /**
   * 标记缓存失败
   * @param {string} url - 资源URL
   * @param {string} resourceType - 资源类型
   * @param {string} errorMessage - 错误信息
   * @returns {Promise<boolean>} 是否成功
   */
  static async markFailed(url, resourceType, errorMessage) {
    try {
      const supabase = dbManager.getSupabase();

      const { error } = await supabase
        .from('external_resource_cache')
        .upsert({
          url,
          resource_type: resourceType,
          content: null,
          status: 'failed',
          error_message: errorMessage,
          cached_at: new Date().toISOString()
        }, {
          onConflict: 'url,resource_type'
        });

      if (error) {
        console.error('[ExternalResourceCache] 标记失败失败:', error.message);
        return false;
      }

      console.log(`[ExternalResourceCache] 已标记失败: ${resourceType} - ${url}`);
      return true;
    } catch (error) {
      console.error('[ExternalResourceCache] 标记失败异常:', error.message);
      return false;
    }
  }

  /**
   * 检查是否是失败的缓存
   * @param {string} url - 资源URL
   * @param {string} resourceType - 资源类型
   * @param {number} cooldown - 失败冷却时间（秒），默认1小时
   * @returns {Promise<boolean>} 是否在失败冷却期内
   */
  static async isFailed(url, resourceType, cooldown = 60 * 60) {
    try {
      const supabase = dbManager.getSupabase();

      const cooldownAfter = new Date(Date.now() - cooldown * 1000).toISOString();

      const { data, error } = await supabase
        .from('external_resource_cache')
        .select('cached_at')
        .eq('url', url)
        .eq('resource_type', resourceType)
        .eq('status', 'failed')
        .gte('cached_at', cooldownAfter)
        .maybeSingle();

      if (error) {
        return false;
      }

      return !!data;
    } catch (error) {
      return false;
    }
  }

  /**
   * 清理过期缓存
   * @param {number} daysBefore - 清理多少天前的缓存，默认90天
   * @returns {Promise<number>} 清理的记录数
   */
  static async cleanup(daysBefore = 90) {
    try {
      const supabase = dbManager.getSupabase();

      const beforeDate = new Date(Date.now() - daysBefore * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('external_resource_cache')
        .delete()
        .lt('cached_at', beforeDate)
        .select('id');

      if (error) {
        console.error('[ExternalResourceCache] 清理缓存失败:', error.message);
        return 0;
      }

      const count = data?.length || 0;
      console.log(`[ExternalResourceCache] 清理了 ${count} 条过期缓存`);
      return count;
    } catch (error) {
      console.error('[ExternalResourceCache] 清理缓存异常:', error.message);
      return 0;
    }
  }
}

/**
 * 带缓存的外部资源获取基类
 */
export class CachedFetcher {
  /**
   * 带缓存的获取方法
   * @param {string} url - 资源URL
   * @param {string} resourceType - 资源类型
   * @param {Function} fetchFn - 实际的获取函数
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 获取的内容
   */
  static async fetchWithCache(url, resourceType, fetchFn, options = {}) {
    const { maxAge = 30 * 24 * 60 * 60, ttl = 30 * 24 * 60 * 60 } = options;

    // 1. 检查是否在失败冷却期内
    const isFailed = await ExternalResourceCache.isFailed(url, resourceType);
    if (isFailed) {
      console.log(`[CachedFetcher] 资源在失败冷却期内，跳过: ${url}`);
      return null;
    }

    // 2. 尝试从缓存获取
    const cached = await ExternalResourceCache.get(url, resourceType, { maxAge });
    if (cached) {
      return cached;
    }

    // 3. 执行实际获取
    try {
      const result = await fetchFn(url);

      if (result) {
        // 成功：保存缓存
        await ExternalResourceCache.set(url, resourceType, result, { ttl });
        return result;
      } else {
        // 失败：标记为失败
        await ExternalResourceCache.markFailed(url, resourceType, '获取结果为空');
        return null;
      }
    } catch (error) {
      // 异常：标记为失败
      await ExternalResourceCache.markFailed(url, resourceType, error.message);
      throw error;
    }
  }
}
