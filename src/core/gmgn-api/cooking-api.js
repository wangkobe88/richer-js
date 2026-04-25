/**
 * GMGN Cooking API
 *
 * 发币/创建代币接口：发币统计、在 Launchpad 创建代币
 *
 * API端点:
 *   GET  /v1/cooking/statistics  (Normal Auth)
 *   POST /v1/cooking/create_token (Critical Auth - 需要私钥签名)
 */

const { BaseGMGNAPI } = require('./base-api');

class GMGNCookingAPI extends BaseGMGNAPI {
    /**
     * 获取各 Launchpad 平台发币统计
     * Normal Auth - 仅需 API Key
     *
     * @returns {Promise<Object>} 包含各平台的 launchpad 和 token_count
     */
    async getCookingStatistics() {
        return this._normalRequest('GET', '/v1/cooking/statistics', {});
    }

    /**
     * 在 Launchpad 平台创建代币
     * ⚠️ Critical Auth - 需要 privateKeyPem
     *
     * @param {Object} params
     * @param {string} params.chain - 链标识: sol / bsc / base / eth / ton
     * @param {string} params.dex - Launchpad平台: pump / raydium / pancakeswap / fourmeme / flap / bonk / bags / letsbonk / clanker / flaunch / zora / virtuals_v2 / ...
     * @param {string} params.from_address - 钱包地址
     * @param {string} params.name - 代币全名
     * @param {string} params.symbol - 代币符号
     * @param {string} params.buy_amt - 初始买入数量(人类可读单位，如 '0.01' SOL)
     * @param {string} [params.image] - Logo base64 编码数据(最大2MB)
     * @param {string} [params.image_url] - Logo URL
     * @param {number} [params.slippage] - 滑点容忍度
     * @param {boolean} [params.auto_slippage] - 自动滑点
     * @param {string} [params.website] - 项目网站 URL
     * @param {string} [params.twitter] - Twitter/X URL
     * @param {string} [params.telegram] - Telegram URL
     * @param {string} [params.priority_fee] - 优先费(SOL)
     * @param {string} [params.tip_fee] - 小费
     * @param {string} [params.gas_price] - Gas price (EVM链)
     * @param {boolean} [params.is_anti_mev] - 启用反MEV保护
     * @returns {Promise<Object>} 包含 status, order_id, hash 等
     */
    async createToken(params) {
        return this._criticalRequest('POST', '/v1/cooking/create_token', {}, params);
    }
}

module.exports = { GMGNCookingAPI };
