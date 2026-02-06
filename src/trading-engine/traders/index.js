/**
 * 交易器模块入口文件
 * 从 rich-js 拷贝并简化
 */

const TraderFactory = require('./TraderFactory');
const ITrader = require('./ITrader');
const FourMemeDirectTrader = require('./implementations/FourMemeDirectTrader');
const PancakeSwapV2Trader = require('./implementations/PancakeSwapV2Trader');

// 注册 FourMeme 交易器
TraderFactory.registerTrader('fourmeme', FourMemeDirectTrader, {
    name: 'FourMeme Direct Trader',
    description: 'FourMeme 平台直接交易器 - 用于 FourMeme 内盘代币交易',
    riskLevel: 3,
    priority: 10,
    enabled: true
});

// 注册 PancakeSwap V2 交易器
TraderFactory.registerTrader('pancakeswap-v2', PancakeSwapV2Trader, {
    name: 'PancakeSwap V2 Trader',
    description: 'PancakeSwap V2 AMM 交易器 - 用于已出盘代币的外部交易',
    riskLevel: 2,
    priority: 20,
    enabled: true
});

/**
 * 创建交易器实例
 * @param {string} type - 交易器类型
 * @param {Object} config - 配置对象
 * @returns {Object} 交易器实例
 */
function createTrader(type, config = {}) {
    return TraderFactory.createTrader(type, config);
}

/**
 * 获取支持的交易器类型
 * @returns {Array} 支持的交易器类型列表
 */
function getSupportedTraderTypes() {
    return TraderFactory.getSupportedAMMs();
}

/**
 * 获取交易器工厂信息
 * @returns {Object} 工厂信息
 */
function getFactoryInfo() {
    return TraderFactory.getFactoryInfo();
}

/**
 * 验证交易器配置
 * @param {string} type - 交易器类型
 * @param {Object} config - 配置对象
 * @returns {Object} 验证结果
 */
function validateTraderConfig(type, config) {
    return TraderFactory.validateTraderConfig(type, config);
}

module.exports = {
    // 主要接口
    createTrader,
    getSupportedTraderTypes,
    getFactoryInfo,
    validateTraderConfig,

    // 类和接口
    TraderFactory,
    ITrader,
    FourMemeDirectTrader,
    PancakeSwapV2Trader,
    BaseTrader: require('./core/BaseTrader')
};
