/**
 * 外部资源缓存服务
 * 用于缓存推特、微博、抖音等外部API获取的内容
 * 避免重复调用昂贵的API
 */

import { dbManager } from '../../services/dbManager.js';

export class ExternalResourceCache {

  /**
   * 预载层（回测叙事预载 2026-10-12）：`${resourceType}\u0000${url}` → 行快照
   * （{url, resource_type, status, content, expires_at}）。回测装载时按 token 集合
   * 批量预拉推文缓存行灌入，analyze 缓存命中路径的 reassembleTwitterInfo → get
   * 由此短路（每 token 首次直调省一次 external_resource_cache DB 往返）。
   * 进程内快照：仅回测语境灌入，实时链路空 Map 行为不变
   */
  static _preloadStore = new Map();

  /**
   * miss 负缓存（回测叙事预载 2026-10-12，perf5 终验画像）：analyze 缓存命中路径的
   * reassembleTwitterInfo → get 在预载集合外/无行 URL 上每次直调重打一次 DB miss
   * （perf5 实测 2994 次 × ~25ms ≈ 75s 纯浪费）。启用后 DB miss 登记键，后续 get
   * 直接 null 零 DB；set 写入成功即清除该键（真析 fetch→set→下次命中的闭环自洽）。
   * 口径统一（与 token_narrative 预载快照 25c02dd 同族）：回放中段外部进程新写入的
   * 行不再被回测读到——回测 = 装载时点快照。默认关：实时链路每查 DB 的行为不变
   * （失败冷却/竞态窗口语义保留）。preloadCache 开启，进程生命周期有效。
   */
  static _negativeCacheEnabled = false;
  static _missStore = new Set();

  /** 回测预载语境开关（NarrativeAnalyzer.preloadCache 开启；关时清空登记） */
  static setNegativeCacheEnabled(v) {
    this._negativeCacheEnabled = !!v;
    if (!v) this._missStore.clear();
  }

  /**
   * 批量预拉缓存行灌预载层（回测叙事预载专用）
   * @param {Array<[string, string]>} keys - [resourceType, url] 对数组
   * @returns {Promise<number>} 灌入行数
   */
  static async preloadByKeys(keys) {
    if (!keys || !keys.length) return 0;
    const urlSet = new Set(keys.map(([, u]) => u));
    const urls = [...urlSet];
    const CHUNK = 100; // .in() URL 长度坑（8KB）——既有批 100 先例
    let loaded = 0;
    const returned = new Set();
    for (let i = 0; i < urls.length; i += CHUNK) {
      const { data, error } = await dbManager.getSupabase()
        .from('external_resource_cache')
        .select('url,resource_type,status,content,expires_at')
        .eq('status', 'success')
        .in('url', urls.slice(i, i + CHUNK));
      if (error) throw error;
      for (const row of data || []) {
        this._preloadStore.set(`${row.resource_type}\u0000${row.url}`, row);
        returned.add(`${row.resource_type}\u0000${row.url}`);
        loaded++;
      }
    }
    // 预载时无行的键直接登记 miss（启用语境下首次 get 也零 DB；
    // 未启用不登记——实时链路行为不变）
    if (this._negativeCacheEnabled) {
      for (const [rt, u] of keys) {
        const k = `${rt}\u0000${u}`;
        if (!returned.has(k) && !this._preloadStore.has(k)) this._missStore.add(k);
      }
    }
    return loaded;
  }

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

    // 预载层短路（回测叙事预载 2026-10-12）：命中且未过期 → 直接返回行 content 零 DB；
    // 过期 → null（DB 行同样会被下方 or(expires_at...) 条件排除，miss 语义一致）；
    // 无键 → 走原 DB 路径（预载集合外 URL 行为不变）
    const pre = this._preloadStore.get(`${resourceType}\u0000${url}`);
    if (pre) {
      const expiresBefore = new Date(Date.now() - maxAge * 1000);
      return (!pre.expires_at || new Date(pre.expires_at) >= expiresBefore) ? pre.content : null;
    }

    // miss 负缓存短路（回测预载语境，同日）：已确认无行的键直接 null 零 DB——
    // 未启用（实时链路）永不短路，每查 DB 的原行为保留
    const missKey = `${resourceType}\u0000${url}`;
    if (this._negativeCacheEnabled && this._missStore.has(missKey)) {
      return null;
    }

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
      // DB miss 登记（启用语境；error 异常路径不登记——瞬时故障不固化）
      if (this._negativeCacheEnabled) this._missStore.add(missKey);
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

      // 写入成功即解除 miss 登记（负缓存闭环：真析 fetch→set→下次 get 命中）
      this._missStore.delete(`${resourceType}\u0000${url}`);

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
   * 单次拉行（任意 status，N2 叙事提速案 2026-10-13）：fetchWithCache 的
   * isFailed+get 两次 DB 往返合一——(url,resource_type) 唯一行由 upsert
   * onConflict 保证，一次 select 拿全行由调用方行内判定失败冷却/缓存过期。
   * 预载层短路返回 preload 行（preloadByKeys 恒拉 success 行，行内判定等价）；
   * miss 负缓存短路返回 null（已确认无行=无 failed 行=不在冷却，miss 语义一致）；
   * DB 无行 → 登记负缓存（启用语境，与 get 同口径）
   * @param {string} url - 资源URL
   * @param {string} resourceType - 资源类型
   * @returns {Promise<Object|null>} 行对象（status/cached_at/expires_at/content 等）；无行 null
   */
  static async getRow(url, resourceType) {
    const pre = this._preloadStore.get(`${resourceType}\u0000${url}`);
    if (pre) return pre;

    const missKey = `${resourceType}\u0000${url}`;
    if (this._negativeCacheEnabled && this._missStore.has(missKey)) {
      return null;
    }

    try {
      const { data, error } = await dbManager.getSupabase()
        .from('external_resource_cache')
        .select('url,resource_type,status,cached_at,expires_at,content')
        .eq('url', url)
        .eq('resource_type', resourceType)
        .maybeSingle();

      if (error) {
        console.error('[ExternalResourceCache] getRow 查询失败:', error.message);
        return null;
      }
      if (!data) {
        if (this._negativeCacheEnabled) this._missStore.add(missKey);
        return null;
      }
      return data;
    } catch (error) {
      console.error('[ExternalResourceCache] getRow 查询异常:', error.message);
      return null;
    }
  }

  /**
   * 删除指定缓存条目
   * @param {string} url - 资源URL
   * @param {string} resourceType - 资源类型
   * @returns {Promise<boolean>}
   */
  static async invalidate(url, resourceType) {
    try {
      const supabase = dbManager.getSupabase();
      const { error } = await supabase
        .from('external_resource_cache')
        .delete()
        .eq('url', url)
        .eq('resource_type', resourceType);

      if (error) {
        console.error('[ExternalResourceCache] 删除缓存失败:', error.message);
        return false;
      }
      // 显式失效同步清 miss 登记（下次 get 重查 DB 而非吃负缓存）
      this._missStore.delete(`${resourceType}\u0000${url}`);
      return true;
    } catch (error) {
      console.error('[ExternalResourceCache] 删除缓存异常:', error.message);
      return false;
    }
  }

  /**
   * 从缓存表组装完整的 twitterInfo
   * 用于替代 token_narrative.twitter_info 的读取
   *
   * @param {Array} classifiedTwitterUrls - classified_urls.twitter 数组
   * @returns {Promise<Object|null>} 组装后的 twitterInfo
   */
  static async reassembleTwitterInfo(classifiedTwitterUrls) {
    if (!classifiedTwitterUrls || classifiedTwitterUrls.length === 0) return null;

    // 选择主推文 URL（优先级：tweet > community > 其他）
    const mainUrlInfo = classifiedTwitterUrls.find(u => u.type === 'tweet')
                     || classifiedTwitterUrls.find(u => u.type === 'community')
                     || classifiedTwitterUrls[0];

    if (!mainUrlInfo) return null;

    const resourceType = mainUrlInfo.type === 'community' ? 'twitter_community' : 'tweet';
    const mainInfo = await ExternalResourceCache.get(mainUrlInfo.url, resourceType, {
      maxAge: 365 * 24 * 60 * 60 // 推文缓存有效期1年
    });

    if (!mainInfo) return null;

    // 检查是否有第二推文（website_tweet）
    if (classifiedTwitterUrls.length > 1) {
      const mainUrl = mainUrlInfo.url;
      const secondUrlInfo = classifiedTwitterUrls.find(
        t => t.url !== mainUrl && t.type === 'tweet'
      );
      if (secondUrlInfo && !mainInfo.website_tweet) {
        const secondTweet = await ExternalResourceCache.get(secondUrlInfo.url, 'tweet', {
          maxAge: 365 * 24 * 60 * 60
        });
        if (secondTweet) {
          mainInfo.website_tweet = secondTweet;
        }
      }
    }

    return mainInfo;
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

    // 1+2. 单次拉行 + 行内判定（N2 合一 2026-10-13 叙事提速案）：原 isFailed
    // +get 两次 DB 往返 → getRow 一次。语义逐条对齐原两查：failed 行且
    // cached_at ≥ now-1h → 冷却跳过（原 isFailed 默认 cooldown=3600s，NULL
    // cached_at 的 gte 恒 false 不冷却）；success 行且（expires_at null 或
    // ≥ now-maxAge）→ 命中（原 get 的 status + or(expires_at) 条件）；
    // 其余（无行/过冷却/过期/其他 status）→ 真析
    const row = await ExternalResourceCache.getRow(url, resourceType);
    if (row) {
      if (row.status === 'failed') {
        const cooldownAfter = new Date(Date.now() - 60 * 60 * 1000);
        if (row.cached_at && new Date(row.cached_at) >= cooldownAfter) {
          console.log(`[CachedFetcher] 资源在失败冷却期内，跳过: ${url}`);
          return null;
        }
      } else if (row.status === 'success') {
        const expiresBefore = new Date(Date.now() - maxAge * 1000);
        if (!row.expires_at || new Date(row.expires_at) >= expiresBefore) {
          console.log(`[ExternalResourceCache] 缓存命中: ${resourceType} - ${url}`);
          return row.content;
        }
      }
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
