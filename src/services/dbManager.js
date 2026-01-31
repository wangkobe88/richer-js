/**
 * 数据库客户端管理器
 * 管理 Supabase 连接
 */

require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

class DatabaseClientManager {
    constructor() {
        this.client = null;
        this.isInitialized = false;
    }

    /**
     * 获取数据库客户端
     * @returns {SupabaseClient}
     */
    getClient() {
        if (!this.isInitialized || !this.client) {
            const supabaseUrl = process.env.SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;

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
                    }
                }
            );
            this.isInitialized = true;
            console.log('✅ 数据库客户端已初始化');
        }
        return this.client;
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
