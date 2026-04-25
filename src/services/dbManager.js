/**
 * 数据库客户端管理器
 * 管理 Supabase 连接
 */

require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

// 默认超时配置（1.2分钟 = 72秒）
const DEFAULT_TIMEOUT_MS = 72000;

/**
 * 创建带超时的 fetch 函数
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Function} fetch 函数
 */
function createFetchWithTimeout(timeout = DEFAULT_TIMEOUT_MS) {
  return async (url, options = {}) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`请求超时（超过 ${timeout / 1000} 秒）`);
      }
      throw error;
    }
  };
}

class DatabaseClientManager {
    constructor() {
        this.client = null;
        this.isInitialized = false;
        this.timeout = DEFAULT_TIMEOUT_MS;
    }

    /**
     * 设置超时时间
     * @param {number} timeout - 超时时间（毫秒）
     */
    setTimeout(timeout) {
        this.timeout = timeout;
        // 如果已经初始化，需要重新创建客户端
        if (this.isInitialized) {
            this.resetClient();
        }
    }

    /**
     * 获取数据库客户端
     * @returns {SupabaseClient}
     */
    getClient() {
        if (!this.isInitialized || !this.client) {
            const supabaseUrl = process.env.SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

            if (!supabaseUrl) {
                throw new Error('SUPABASE_URL 环境变量未设置');
            }

            if (!supabaseKey) {
                throw new Error('SUPABASE_ANON_KEY 或 SUPABASE_SERVICE_KEY 环境变量未设置');
            }

            this.client = createClient(
                supabaseUrl,
                supabaseKey,
                {
                    db: {
                        schema: 'public'
                    },
                    auth: {
                        persistSession: false
                    },
                    global: {
                        fetch: createFetchWithTimeout(this.timeout)
                    }
                }
            );
            this.isInitialized = true;
            console.log(`✅ 数据库客户端已初始化（超时: ${this.timeout / 1000} 秒）`);
        }
        return this.client;
    }

    /**
     * 获取Supabase客户端（getClient的别名）
     * @returns {SupabaseClient}
     */
    getSupabase() {
        return this.getClient();
    }

    /**
     * 重置客户端连接
     */
    resetClient() {
        if (this.client) {
            console.log('🔄 重置数据库客户端');
            this.client = null;
            this.isInitialized = false;
        }
    }

    /**
     * 清理资源
     */
    cleanup() {
        if (this.client) {
            console.log('🧹 清理数据库客户端资源');
            this.client = null;
            this.isInitialized = false;
        }
    }
}

// 单例实例
const dbManager = new DatabaseClientManager();

module.exports = {
    DatabaseClientManager,
    dbManager
};
