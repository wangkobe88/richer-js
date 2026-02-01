/**
 * AVE Token API Client for richer-js
 *
 * Simplified version for fourmeme token trading
 * API: https://prod.ave-api.com
 */

const axios = require('axios');

class AveAPIError extends Error {
    constructor(message, code = null) {
        super(message);
        this.name = 'AveAPIError';
        this.code = code;
    }
}

/**
 * AVE API 基类
 * 包含通用的HTTP请求功能
 */
class BaseAveAPI {
    constructor(baseURL = 'https://prod.ave-api.com', timeout = 30000, apiKey = null) {
        this.baseURL = baseURL;
        this.timeout = timeout;

        const headers = {};
        if (apiKey) {
            headers['X-API-KEY'] = apiKey;
            headers['Accept'] = '*/*';
        }

        this.client = axios.create({
            baseURL,
            timeout,
            headers
        });

        this.client.interceptors.response.use(
            response => response,
            error => {
                if (error.response) {
                    throw new AveAPIError(
                        `API请求失败: ${error.response.status} - ${error.response.data?.message || error.message}`,
                        error.response.status
                    );
                } else if (error.request) {
                    throw new AveAPIError('网络请求失败，请检查网络连接');
                } else {
                    throw new AveAPIError(`请求配置错误: ${error.message}`);
                }
            }
        );
    }

    async _makeRequest(method, endpoint, options = {}) {
        try {
            const config = {
                method: method.toLowerCase(),
                url: endpoint,
                ...options
            };
            const response = await this.client.request(config);
            return response.data;
        } catch (error) {
            if (error instanceof AveAPIError) throw error;
            throw new AveAPIError(`请求失败: ${error.message}`);
        }
    }
}

/**
 * AVE Token API
 * 用于获取代币信息和平台代币列表
 */
class AveTokenAPI extends BaseAveAPI {
    /**
     * 根据标签获取平台发行的代币
     * 用于获取 fourmeme 新代币
     *
     * @param {string} tag - 平台标签 (fourmeme_in_new, pump_in_new, etc.)
     * @param {string} chain - 区块链名称，默认'bsc'
     * @param {number} limit - 返回数量，默认100
     * @param {string} orderby - 排序字段，默认'created_at'
     * @returns {Promise<Array>} 代币列表
     */
    async getPlatformTokens(tag, chain = 'bsc', limit = 100, orderby = 'created_at') {
        if (!tag) {
            throw new Error('tag不能为空');
        }

        const params = { tag };
        if (chain) params.chain = chain;
        if (limit !== 100) params.limit = limit;
        if (orderby && orderby !== 'tx_volume_u_24h') params.orderby = orderby;

        const result = await this._makeRequest('GET', '/v2/tokens/platform', { params });
        const data = result.data || [];

        return data.map(tokenData => ({
            token: tokenData.token || '',
            token_address: tokenData.token || '',
            chain: tokenData.chain || '',
            name: tokenData.name || '',
            symbol: tokenData.symbol || '',
            logo_url: tokenData.logo_url || '',
            current_price_usd: tokenData.current_price_usd || '',
            market_cap: tokenData.market_cap || '',
            fdv: tokenData.fdv || '',
            tvl: tokenData.tvl || '',
            created_at: tokenData.created_at || 0,
            launch_at: tokenData.launch_at || 0,
            issue_platform: tokenData.issue_platform || '',
            intro_cn: tokenData.intro_cn || '',
            intro_en: tokenData.intro_en || '',
            updated_at: tokenData.updated_at || 0
        }));
    }

    /**
     * 获取代币详细信息
     *
     * @param {string} tokenId - 代币ID，格式：{token}-{chain}
     * @returns {Promise<Object>} 代币详细信息
     */
    async getTokenDetail(tokenId) {
        if (!tokenId) {
            throw new Error('tokenId不能为空');
        }

        const result = await this._makeRequest('GET', `/v2/tokens/${tokenId}`);
        const data = result.data || {};
        const tokenData = data.token || {};

        return {
            token: tokenData.token || '',
            chain: tokenData.chain || '',
            name: tokenData.name || '',
            symbol: tokenData.symbol || '',
            logo_url: tokenData.logo_url || '',
            current_price_usd: String(tokenData.current_price_usd || 0),
            market_cap: String(tokenData.market_cap || 0),
            fdv: String(tokenData.fdv || 0),
            tvl: String(tokenData.tvl || 0),
            created_at: parseInt(tokenData.created_at) || 0,
            launch_at: parseInt(tokenData.launch_at) || 0
        };
    }

    /**
     * 批量获取代币价格信息
     *
     * @param {Array<string>} tokenIds - 代币ID列表，最多200个，格式：{CA}-{chain}
     * @param {number} tvlMin - 代币最小TVL阈值，默认1000，0表示无阈值
     * @param {number} tx24hVolumeMin - 代币最小24小时交易量阈值，默认0
     * @returns {Promise<Object>} 代币价格信息字典
     */
    async getTokenPrices(tokenIds, tvlMin = 1000, tx24hVolumeMin = 0) {
        if (!tokenIds || tokenIds.length === 0) {
            throw new Error('tokenIds不能为空');
        }

        if (tokenIds.length > 200) {
            throw new Error('tokenIds不能超过200个');
        }

        const data = {
            token_ids: tokenIds,
            tvl_min: tvlMin,
            tx_24h_volume_min: tx24hVolumeMin
        };

        const result = await this._makeRequest('POST', '/v2/tokens/price', { data });

        const prices = {};
        const dataSection = result.data || {};

        for (const [tokenId, priceData] of Object.entries(dataSection)) {
            prices[tokenId] = {
                current_price_usd: priceData.current_price_usd || '',
                price_change_1d: priceData.price_change_1d || '',
                price_change_24h: priceData.price_change_24h || '',
                tvl: priceData.tvl || '',
                tx_volume_u_24h: priceData.tx_volume_u_24h || '',
                token_id: priceData.token_id || tokenId,
                updated_at: priceData.updated_at || 0
            };
        }

        return prices;
    }
}

module.exports = { AveAPIError, BaseAveAPI, AveTokenAPI };
