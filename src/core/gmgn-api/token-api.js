/**
 * GMGN Token API
 *
 * 代币信息查询：基础信息、安全审计、流动性池、Top持有人、Top交易者
 * 所有方法使用 Normal Auth（仅需 API Key）
 *
 * API端点:
 *   GET  /v1/token/info
 *   GET  /v1/token/security
 *   GET  /v1/token/pool_info
 *   GET  /v1/market/token_top_holders
 *   GET  /v1/market/token_top_traders
 */

const { BaseGMGNAPI } = require('./base-api');

class GMGNTokenAPI extends BaseGMGNAPI {
    /**
     * 获取代币基础信息
     * 包含：价格、市值(=price×circulating_supply)、流动性、持有人数、社媒链接、launchpad信息、ATH等
     *
     * @param {string} chain - 链标识: sol / bsc / base / eth
     * @param {string} address - 代币合约地址
     * @returns {Promise<Object>} 代币信息对象，包含 pool/dev/link/stat/wallet_tags_stat 嵌套对象
     */
    async getTokenInfo(chain, address) {
        return this._normalRequest('GET', '/v1/token/info', { chain, address });
    }

    /**
     * 获取代币安全信息
     * 包含：蜜罐检测、买卖税率、持仓集中度、合约风险、内部人持仓比例等
     *
     * @param {string} chain - 链标识
     * @param {string} address - 代币合约地址
     * @returns {Promise<Object>} 安全信息对象
     */
    async getTokenSecurity(chain, address) {
        return this._normalRequest('GET', '/v1/token/security', { chain, address });
    }

    /**
     * 获取代币流动性池信息
     *
     * @param {string} chain - 链标识
     * @param {string} address - 代币合约地址
     * @returns {Promise<Object>} 流动性池信息（池地址、DEX、储备量、费率等）
     */
    async getTokenPoolInfo(chain, address) {
        return this._normalRequest('GET', '/v1/token/pool_info', { chain, address });
    }

    /**
     * 获取代币 Top 持有人列表
     *
     * @param {string} chain - 链标识
     * @param {string} address - 代币合约地址
     * @param {Object} [extra] - 可选参数
     * @param {number} [extra.limit=20] - 返回数量，最大100
     * @param {string} [extra.order_by='amount_percentage'] - 排序字段: amount_percentage / profit / unrealized_profit / buy_volume_cur / sell_volume_cur
     * @param {string} [extra.direction='desc'] - 排序方向: asc / desc
     * @param {string} [extra.tag] - 钱包标签过滤: smart_degen / renowned / fresh_wallet / dev / sniper / rat_trader / bundler / transfer_in / dex_bot / bluechip_owner
     * @returns {Promise<Object>} 持有人列表
     */
    async getTokenTopHolders(chain, address, extra = {}) {
        return this._normalRequest('GET', '/v1/market/token_top_holders', { chain, address, ...extra });
    }

    /**
     * 获取代币 Top 交易者列表
     *
     * @param {string} chain - 链标识
     * @param {string} address - 代币合约地址
     * @param {Object} [extra] - 可选参数（同 getTokenTopHolders）
     * @returns {Promise<Object>} 交易者列表
     */
    async getTokenTopTraders(chain, address, extra = {}) {
        return this._normalRequest('GET', '/v1/market/token_top_traders', { chain, address, ...extra });
    }
}

module.exports = { GMGNTokenAPI };
