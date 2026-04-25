/**
 * GMGN Track API
 *
 * 追踪接口：关注钱包交易动态、KOL交易、聪明钱交易
 *
 * API端点:
 *   GET /v1/trade/follow_wallet  (Critical Auth - 需要私钥签名)
 *   GET /v1/user/kol             (Normal Auth)
 *   GET /v1/user/smartmoney      (Normal Auth)
 */

const { BaseGMGNAPI } = require('./base-api');

class GMGNTrackAPI extends BaseGMGNAPI {
    /**
     * 获取关注钱包的交易动态
     * ⚠️ Critical Auth - 需要 privateKeyPem
     * 返回你在 GMGN 平台关注的钱包的交易记录
     *
     * @param {string} chain - 链标识: sol / bsc / base / eth
     * @param {Object} [extra] - 可选参数
     * @param {string} [extra.wallet_address] - 过滤特定钱包
     * @param {number} [extra.limit=10] - 每页数量(1-100)
     * @param {string} [extra.side] - 交易方向过滤: buy / sell
     * @param {string[]} [extra.filters] - 过滤条件标签数组
     * @param {number} [extra.min_amount_usd] - 最小交易金额(USD)
     * @param {number} [extra.max_amount_usd] - 最大交易金额(USD)
     * @returns {Promise<Object>} 包含 list 数组和 next_page_token
     */
    async getFollowWallet(chain, extra = {}) {
        return this._criticalRequest('GET', '/v1/trade/follow_wallet', { chain, ...extra }, null);
    }

    /**
     * 获取 KOL 交易记录
     * Normal Auth - 仅需 API Key
     *
     * @param {string} chain - 链标识
     * @param {number} [limit=100] - 返回数量(1-200)
     * @returns {Promise<Object>} 包含 list 数组，每条包含 transaction_hash, maker, side, base_address, amount_usd 等
     */
    async getKolTrades(chain, limit) {
        const query = {};
        if (chain) query.chain = chain;
        if (limit != null) query.limit = limit;
        return this._normalRequest('GET', '/v1/user/kol', query);
    }

    /**
     * 获取聪明钱交易记录
     * Normal Auth - 仅需 API Key
     *
     * @param {string} chain - 链标识
     * @param {number} [limit=100] - 返回数量(1-200)
     * @returns {Promise<Object>} 包含 list 数组，每条包含 transaction_hash, maker, side, base_address, amount_usd 等
     */
    async getSmartMoneyTrades(chain, limit) {
        const query = {};
        if (chain) query.chain = chain;
        if (limit != null) query.limit = limit;
        return this._normalRequest('GET', '/v1/user/smartmoney', query);
    }
}

module.exports = { GMGNTrackAPI };
