/**
 * 数据加载器
 * 负责从Web API加载实验数据
 */

const http = require('http');

class DataLoader {
  constructor(experimentId, baseUrl = 'http://localhost:3010/api') {
    this.experimentId = experimentId;
    this.baseUrl = baseUrl;
    this.cache = new Map();
  }

  /**
   * 发起HTTP请求
   */
  async request(path) {
    const cacheKey = path;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    return new Promise((resolve, reject) => {
      const url = `${this.baseUrl}${path}`;
      http.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            this.cache.set(cacheKey, json);
            resolve(json);
          } catch (e) {
            reject(new Error(`JSON解析失败: ${e.message}`));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * 获取实验基本信息
   */
  async getExperiment() {
    const res = await this.request(`/experiment/${this.experimentId}`);
    return res.data;
  }

  /**
   * 获取交易数据
   */
  async getTrades() {
    const res = await this.request(`/experiment/${this.experimentId}/trades?limit=10000`);
    return res.trades || [];
  }

  /**
   * 获取信号数据
   */
  async getSignals() {
    const res = await this.request(`/experiment/${this.experimentId}/signals?limit=10000`);
    return res.signals || [];
  }

  /**
   * 获取代币数据
   */
  async getTokens() {
    const res = await this.request(`/experiment/${this.experimentId}/tokens?limit=10000`);
    return res.tokens || [];
  }

  /**
   * 获取黑名单统计
   */
  async getBlacklistStats() {
    const res = await this.request(`/experiment/${this.experimentId}/holder-blacklist-stats`);
    return res.data || null;
  }

  /**
   * 获取时序数据
   */
  async getTimeSeries(tokenAddress) {
    const res = await this.request(`/experiment/time-series/tokens/${this.experimentId}?token=${tokenAddress}`);
    return res.data || [];
  }

  /**
   * 获取单个代币的信号
   */
  async getTokenSignals(tokenAddress) {
    const signals = await this.getSignals();
    return signals.filter(s => s.token_address === tokenAddress);
  }

  /**
   * 清空缓存
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = { DataLoader };
