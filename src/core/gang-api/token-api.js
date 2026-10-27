/**
 * Gang.fun Indexer Token API（只读，免鉴权）
 *
 * 端点实测（2026-10-27）：GET /api/tokens/:addr 直接返回 token 对象（非
 * {code,data} 包裹）；不存在 → HTTP 404 {"error":"not found"}。语料字段
 * website/twitter 实测常态恒 null，creatorHandle 恒 SPACE ID .ai handle
 * （gang 创建者链上绑定 Agent ID，.ai 名即账号名——非 twitter handle）。
 *
 * 消费方：TokenCorpusEnricher._enrichGang（叙事语料补采）。价格/进度一律
 * 走 WSS collector（本 client 不做行情用途）。
 */

const axios = require('axios');

class GangTokenAPI {
  constructor(baseURL = 'https://gang.fun', timeout = 10 * 1000) {
    this.client = axios.create({
      baseURL,
      timeout,
      headers: { Accept: 'application/json' },
    });
  }

  /**
   * 取代币详情（叙事语料用）
   *
   * @param {string} tokenAddress - BSC 代币地址
   * @returns {Promise<Object|null>} 规范化对象；404/空 → null（调用方可重试）
   * @throws 网络错误等异常向上抛（调用方统一记日志）
   */
  async getTokenDetail(tokenAddress) {
    if (!tokenAddress || !tokenAddress.startsWith('0x') || tokenAddress.length !== 42) {
      throw new Error('无效的BSC代币地址格式');
    }
    const resp = await this.client.get(`/api/tokens/${tokenAddress}`);
    const data = resp.data;
    if (!data || typeof data !== 'object' || !data.address) return null;
    return {
      address: data.address,
      name: data.name,
      symbol: data.symbol,
      creator: data.creator,
      creatorHandle: data.creatorHandle,   // SPACE ID .ai handle（gang 独有账号语料）
      website: data.website,
      twitter: data.twitter,
      graduated: !!data.graduated,
      progressPct: data.progressPct,
      raw: data,
    };
  }
}

module.exports = { GangTokenAPI };
