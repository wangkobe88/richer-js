/**
 * AVE K-line API Client for richer-js
 *
 * Provides K-line data query functionality
 * API: https://prod.ave-api.com
 */

const { BaseAveAPI } = require('./token-api');

class AveKlineAPI extends BaseAveAPI {
    constructor(baseURL = 'https://prod.ave-api.com', timeout = 30000, apiKey = null) {
        super(baseURL, timeout, apiKey);
    }

    /**
     * 获取指定代币的K线数据
     *
     * @param {string} tokenId - 代币ID，格式：{token}-{chain}
     * @param {number} interval - K线时间间隔（分钟）：1,5,15,30,60
     * @param {number} limit - 返回记录数量，默认100，最大1000
     * @returns {Promise<Object>} K线数据
     */
    async getKlineDataByToken(tokenId, interval = 1, limit = 100) {
        if (!tokenId || typeof tokenId !== 'string' || !tokenId.trim()) {
            throw new Error('tokenId必须是非空字符串');
        }

        const validIntervals = [1, 5, 15, 30, 60];
        if (!validIntervals.includes(interval)) {
            throw new Error(`interval必须是以下值之一: ${validIntervals.join(', ')}`);
        }

        if (limit > 1000) {
            throw new Error('limit不能超过1000');
        }

        const params = {
            interval: interval,
            limit: limit
        };

        const result = await this._makeRequest('GET', `/v2/klines/token/${tokenId}`, { params });
        const data = result.data || {};

        return {
            points: data.points || [],
            total_count: data.total_count || 0,
            interval: data.interval || interval,
            target_token_id: data.target_token_id || tokenId
        };
    }

    /**
     * 获取指定代币的最新价格
     *
     * @param {string} tokenId - 代币ID，格式：{token}-{chain}
     * @returns {Promise<Object>} 最新价格信息
     */
    async getLatestPriceByToken(tokenId) {
        if (!tokenId || typeof tokenId !== 'string' || !tokenId.trim()) {
            throw new Error('tokenId必须是非空字符串');
        }

        const klineData = await this.getKlineDataByToken(tokenId, 1, 1);

        if (klineData.points && klineData.points.length > 0) {
            const latestPoint = klineData.points[0];
            return {
                token_id: tokenId,
                price: latestPoint[4], // 收盘价
                timestamp: latestPoint[0],
                open: latestPoint[1],
                high: latestPoint[2],
                low: latestPoint[3],
                close: latestPoint[4],
                volume: latestPoint[5]
            };
        } else {
            throw new Error(`无法获取代币 ${tokenId} 的价格数据`);
        }
    }

    /**
     * 格式化K线数据点为更易读的格式
     *
     * @param {Array} points - 原始K线数据点数组 [timestamp, open, high, low, close, volume]
     * @returns {Array} 格式化后的K线数据
     */
    static formatKlinePoints(points) {
        if (!Array.isArray(points)) {
            return [];
        }

        return points.map(point => {
            if (Array.isArray(point)) {
                return {
                    timestamp: point[0],
                    open: parseFloat(point[1]) || 0,
                    high: parseFloat(point[2]) || 0,
                    low: parseFloat(point[3]) || 0,
                    close: parseFloat(point[4]) || 0,
                    volume: parseFloat(point[5]) || 0
                };
            }
            return null;
        }).filter(point => point !== null);
    }
}

module.exports = { AveKlineAPI };
