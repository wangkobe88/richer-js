/**
 * 交易器接口定义
 * 所有交易器实现都必须遵循此接口
 * 从 rich-js 拷贝而来
 */

class ITrader {
    /**
     * 构造函数
     * @param {Object} config - 交易器配置
     */
    constructor(config) {
        if (this.constructor === ITrader) {
            throw new Error('ITrader is an abstract class and cannot be instantiated directly');
        }
    }

    /**
     * 设置钱包私钥
     * @param {string} privateKey - 钱包私钥
     * @returns {Promise<void>}
     */
    async setWallet(privateKey) {
        throw new Error('setWallet method must be implemented');
    }

    /**
     * 获取主币余额
     * @returns {Promise<string>} 主币余额
     */
    async getNativeBalance() {
        throw new Error('getNativeBalance method must be implemented');
    }

    /**
     * 检查流动性
     * @param {string} tokenAddress - 代币地址
     * @param {string} amountIn - 输入金额
     * @param {boolean} forEstimate - 是否为估算
     * @returns {Promise<boolean>} 是否有足够流动性
     */
    async checkLiquidity(tokenAddress, amountIn, forEstimate = false) {
        throw new Error('checkLiquidity method must be implemented');
    }

    /**
     * 购买代币
     * @param {string} tokenAddress - 代币地址
     * @param {string} amountIn - 输入金额
     * @param {Object} options - 交易选项
     * @returns {Promise<Object>} 交易结果
     */
    async buyToken(tokenAddress, amountIn, options = {}) {
        throw new Error('buyToken method must be implemented');
    }

    /**
     * 出售代币
     * @param {string} tokenAddress - 代币地址
     * @param {string} amountIn - 输入金额
     * @param {Object} options - 交易选项
     * @returns {Promise<Object>} 交易结果
     */
    async sellToken(tokenAddress, amountIn, options = {}) {
        throw new Error('sellToken method must be implemented');
    }

    /**
     * 获取代币价格
     * @param {string} tokenAddress - 代币地址
     * @returns {Promise<string>} 代币价格
     */
    async getTokenPrice(tokenAddress) {
        throw new Error('getTokenPrice method must be implemented');
    }

    /**
     * 获取交易器信息
     * @returns {Object} 交易器信息
     */
    getInfo() {
        throw new Error('getInfo method must be implemented');
    }
}

module.exports = ITrader;
