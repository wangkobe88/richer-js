/**
 * 钱包分析工具配置
 */

export default {
  database: {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_ANON_KEY
  },

  analysis: {
    // 早期交易时间窗口（代币创建后多少秒内）
    earlyTradeWindow: 300, // 5分钟

    // 最小交易金额（USD），过滤掉小额测试
    minTradeAmountUSD: 5,

    // 并发请求数限制（逐个调用以避免网络问题）
    concurrency: 1,

    // 请求间隔（毫秒）
    requestDelay: 500,

    // 是否启用缓存
    enableCache: true,
    cacheDir: './cache',
    cacheTTL: 24 * 60 * 60 * 1000 // 24小时
  },

  earlyTrades: {
    // AVE API 配置
    aveApiUrl: 'https://api.ave.ai/api/v1',
    timeout: 30000
  },

  output: {
    dir: './output',
    formats: ['json', 'csv']
  }
};
