/**
 * 早期交易服务 - 获取代币的早期交易者
 * 使用 AVE API 获取代币的早期交易数据
 */

import { createClient } from '@supabase/supabase-js';
import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenvConfig({ path: resolve(__dirname, '../config/.env') });

import config from '../config.js';

export class EarlyTradesService {
  constructor() {
    // 暂时注释掉 Supabase 客户端初始化
    this.supabase = null;

    this.cache = new Map();

    // 直接使用固定的 AVE API 地址
    this.aveApiKey = process.env.AVE_API_KEY;
    this.aveTimeout = config.earlyTrades?.timeout || 30000;

    // 调试：打印 AVE_API_KEY 状态
    if (!this.aveApiKey) {
      console.error('⚠️ AVE_API_KEY 未设置！早期交易功能将无法工作。');
    } else {
      console.log(`✅ AVE_API_KEY 已设置 (${this.aveApiKey.substring(0, 10)}...)`);
    }
  }

  /**
   * 调用 AVE API (使用原生 https 模块，避免 axios 与 Supabase 冲突)
   * @private
   */
  async _callAveApi(endpoint, params = {}) {
    // 手动构造查询字符串
    let queryString = '';
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined) {
        const param = `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
        queryString = queryString ? `${queryString}&${param}` : param;
      }
    }

    const fullPath = queryString ? `${endpoint}?${queryString}` : endpoint;

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'prod.ave-api.com',
        port: 443,
        path: fullPath,
        method: 'GET',
        headers: {
          'X-API-KEY': this.aveApiKey,
          'Accept': '*/*'
        },
        timeout: this.aveTimeout
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`解析 AVE API 响应失败: ${e.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`AVE API 网络错误: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('AVE API 请求超时'));
      });

      req.end();
    });
  }

  /**
   * 获取代币的早期交易者
   * @param {string} tokenAddress - 代币地址
   * @param {string} chain - 链
   * @returns {Promise<Set<string>>} 钱包地址集合
   */
  async getEarlyTraders(tokenAddress, chain = 'bsc') {
    // 检查缓存
    const cacheKey = `${tokenAddress}_${chain}`;
    if (config.analysis.enableCache && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < config.analysis.cacheTTL) {
        return cached.traders;
      }
    }

    try {
      // 1. 获取代币详情（包括 launch_at）
      const tokenId = `${tokenAddress}-${chain}`;
      let tokenDetail;

      try {
        tokenDetail = await this._callAveApi(`/v2/tokens/${tokenId}`);
      } catch (apiError) {
        console.warn(`   ⚠️  代币 ${tokenAddress.slice(0, 10)}... AVE API 详情获取失败: ${apiError.message}`);
        // 尝试从数据库获取
        tokenDetail = await this._getTokenDetailFromDB(tokenAddress, chain);
      }

      // AVE API 返回格式: {status, data: {token: ..., pairs: ...}}
      // 数据库回退格式: {token: ...}
      const token = tokenDetail.data?.token || tokenDetail.token;
      if (!token) {
        console.warn(`   ⚠️  代币 ${tokenAddress.slice(0, 10)}... 详情获取失败`);
        return new Set();
      }

      const launchAt = token.launch_at || null;

      // 2. 获取 inner pair
      const innerPair = await this._getInnerPair(tokenAddress, chain, tokenDetail);
      if (!innerPair) {
        console.warn(`   ⚠️  代币 ${tokenAddress.slice(0, 10)}... 没有 inner pair`);
        return new Set();
      }

      // 3. 获取早期交易
      const toTime = launchAt ? launchAt + config.analysis.earlyTradeWindow : null;

      // 方式1：使用时间范围
      let earlyTrades = await this._getSwapTransactions(`${innerPair}-${chain}`, launchAt, toTime);

      // 方式2：如果没有结果，不使用时间范围
      if (!earlyTrades || earlyTrades.length === 0) {
        earlyTrades = await this._getSwapTransactions(`${innerPair}-${chain}`, null, null);
      }

      const traders = new Set();
      if (earlyTrades && Array.isArray(earlyTrades)) {
        for (const trade of earlyTrades) {
          // from_address (sender_address) 是交易发起者（买入者）
          const traderAddress = trade.from_address || trade.sender_address;
          if (traderAddress && typeof traderAddress === 'string') {
            traders.add(traderAddress.toLowerCase());
          }
        }
      }

      // 缓存结果
      if (config.analysis.enableCache) {
        this.cache.set(cacheKey, {
          traders,
          timestamp: Date.now()
        });
      }

      return traders;
    } catch (error) {
      console.warn(`   ⚠️  获取代币 ${tokenAddress.slice(0, 10)}... 早期交易者失败: ${error.message}`);
      return new Set();
    }
  }

  /**
   * 获取交易对的交换交易记录
   * @private
   */
  async _getSwapTransactions(pairId, fromTime = null, toTime = null) {
    const params = {
      limit: 300,
      sort: 'asc'
    };

    if (fromTime) params.from_time = fromTime;
    if (toTime) params.to_time = toTime;

    try {
      const result = await this._callAveApi(`/v2/txs/swap/${pairId}`, params);

      // 处理不同的响应格式
      let data = [];
      if (result && result.data) {
        if (result.data.txs && Array.isArray(result.data.txs)) {
          data = result.data.txs;
        } else if (Array.isArray(result.data)) {
          data = result.data;
        }
      }

      // 提取需要的字段
      const transactions = [];
      for (const txData of data) {
        transactions.push({
          from_address: txData.sender_address || '',
          to_address: txData.to_address || '',
          // ... 其他字段
        });
      }

      return transactions;
    } catch (error) {
      console.warn(`   ⚠️  获取 swap 交易失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 从数据库获取代币详情
   * @private
   */
  async _getTokenDetailFromDB(tokenAddress, chain) {
    try {
      const { data } = await this.supabase
        .from('experiment_tokens')
        .select('raw_api_data')
        .eq('token_address', tokenAddress)
        .eq('blockchain', chain)
        .order('discovered_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data && data.raw_api_data) {
        return { token: data.raw_api_data };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 获取代币的 inner pair
   * @private
   */
  async _getInnerPair(tokenAddress, chain, tokenDetail = null) {
    // 先尝试从 tokenDetail 获取
    if (tokenDetail && tokenDetail.token) {
      const token = tokenDetail.token;

      // 尝试从 main_pair 获取
      let mainPair = token.main_pair;
      if (!mainPair && tokenDetail.pairs && tokenDetail.pairs.length > 0) {
        mainPair = tokenDetail.pairs[0].pair;
      }

      // 检查 pair 后缀判断平台
      let platform = null;
      if (mainPair) {
        if (mainPair.endsWith('_fo')) {
          platform = 'fourmeme';
        } else if (mainPair.endsWith('_iportal')) {
          platform = 'flap';
        }
      }

      // 从数据库查询 platform
      if (!platform) {
        try {
          const { data } = await this.supabase
            .from('experiment_tokens')
            .select('platform')
            .eq('token_address', tokenAddress)
            .eq('blockchain', chain)
            .limit(1)
            .maybeSingle();

          platform = data?.platform || null;
        } catch (e) {
          // 忽略数据库查询错误
        }
      }

      // 根据 platform 构造 inner pair
      if (platform === 'fourmeme') {
        return `${tokenAddress}_fo`;
      } else if (platform === 'flap') {
        return `${tokenAddress}_iportal`;
      }

      // 使用 main_pair 作为 inner pair
      if (mainPair) {
        return mainPair;
      }
    }

    // 默认使用 fourmeme 格式
    return `${tokenAddress}_fo`;
  }

  /**
   * 清空缓存
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}
