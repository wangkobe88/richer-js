/**
 * 交易器工厂 - 简化版本
 * 从 rich-js 拷贝并简化
 */

const ITrader = require('./ITrader');
const PlaceholderTrader = require('./PlaceholderTrader');
const FourMemeDirectTrader = require('./implementations/FourMemeDirectTrader');
const PancakeSwapV2Trader = require('./implementations/PancakeSwapV2Trader');

/**
 * 交易器工厂类
 */
class TraderFactory {
    constructor() {
        // 注册的交易器类型
        this.registeredTraders = new Map();

        console.log('🏭 TraderFactory initialized (简化版)');
    }

    /**
     * 注册交易器类型
     * @param {string} type - 交易器类型标识
     * @param {Class} TraderClass - 交易器类
     * @param {Object} defaultConfig - 默认配置
     */
    registerTrader(type, TraderClass, defaultConfig = {}) {
        if (typeof TraderClass !== 'function') {
            throw new Error('TraderClass must be a constructor function');
        }

        this.registeredTraders.set(type.toLowerCase(), {
            TraderClass,
            defaultConfig: { ...defaultConfig }
        });

        console.log(`✅ Registered trader: ${type}`);
    }

    /**
     * 创建交易器实例
     * @param {string} type - 交易器类型
     * @param {Object} config - 交易器配置
     * @returns {Object} 交易器实例
     */
    createTrader(type, config = {}) {
        const normalizedType = type.toLowerCase();

        console.log(`🏭 TraderFactory: 创建交易器 ${normalizedType}`);

        if (!this.registeredTraders.has(normalizedType)) {
            throw new Error(`不支持的交易器类型: ${type}. 支持的类型: ${Array.from(this.registeredTraders.keys()).join(', ')}`);
        }

        const { TraderClass, defaultConfig } = this.registeredTraders.get(normalizedType);

        // 合并默认配置和用户配置
        const finalConfig = { ...defaultConfig, ...config };

        try {
            console.log(`🏭 创建 ${normalizedType} 交易器`);
            const trader = new TraderClass(finalConfig);
            console.log(`✅ 成功创建 ${normalizedType} 交易器`);
            return trader;
        } catch (error) {
            console.error(`❌ 创建 ${normalizedType} 交易器失败:`, error.message);
            throw new Error(`创建交易器失败: ${error.message}`);
        }
    }

    /**
     * 获取支持的AMM列表
     * @returns {Array} 支持的AMM类型列表
     */
    getSupportedAMMs() {
        return Array.from(this.registeredTraders.keys());
    }

    /**
     * 获取AMM配置
     * @param {string} type - AMM类型
     * @returns {Object} AMM配置信息
     */
    getAMMConfig(type) {
        const normalizedType = type.toLowerCase();

        if (!this.registeredTraders.has(normalizedType)) {
            throw new Error(`Unsupported AMM type: ${type}`);
        }

        const { defaultConfig } = this.registeredTraders.get(normalizedType);
        return { ...defaultConfig };
    }

    /**
     * 验证交易器配置
     * @param {string} type - 交易器类型
     * @param {Object} config - 配置对象
     * @returns {Object} 验证结果
     */
    validateTraderConfig(type, config) {
        const errors = [];
        const warnings = [];

        // 基础验证：必须有 enabled 字段或默认为 true
        if (config.enabled === undefined) {
            warnings.push('enabled 未设置，将使用默认值 true');
        }

        // 验证网络配置
        if (!config.network && !config.chain && !config.blockchain) {
            errors.push('必须提供 network、chain 或 blockchain 配置');
        }

        // 验证 trading 配置
        if (config.trading) {
            if (config.trading.defaultSlippage && (config.trading.defaultSlippage < 0 || config.trading.defaultSlippage > 1)) {
                errors.push('defaultSlippage 必须在 0-1 之间');
            }
            if (config.trading.maxSlippage && (config.trading.maxSlippage < 0 || config.trading.maxSlippage > 1)) {
                errors.push('maxSlippage 必须在 0-1 之间');
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * 获取工厂信息
     * @returns {Object} 工厂信息
     */
    getFactoryInfo() {
        return {
            registeredTraders: Array.from(this.registeredTraders.keys()).map(type => {
                const config = this.getAMMConfig(type);
                return {
                    type,
                    name: config.name,
                    description: config.description
                };
            }),
            totalRegistered: this.registeredTraders.size,
            version: '1.0.0 (简化版)'
        };
    }

    /**
     * 卸载交易器
     * @param {string} type - 交易器类型
     */
    unregisterTrader(type) {
        const normalizedType = type.toLowerCase();

        if (this.registeredTraders.has(normalizedType)) {
            this.registeredTraders.delete(normalizedType);
            console.log(`🗑️ Unregistered trader: ${type}`);
        }
    }
}

// 创建单例实例
const traderFactory = new TraderFactory();

module.exports = traderFactory;
