/**
 * 交易器基类
 * 提供通用的交易器功能和抽象方法
 */

const { ethers } = require('ethers');
const ITrader = require('../ITrader');

class BaseTrader extends ITrader {
    constructor(config) {
        super(config);

        this.config = this.validateAndMergeConfig(config);
        this.wallet = null;
        this.provider = null;
        this.signer = null;

        // 基础配置
        this.network = this.config.network || {
            name: 'BSC',
            chainId: 56,
            rpcUrl: 'https://bsc-dataseed1.binance.org/',
            blockExplorer: 'https://bscscan.com'
        };

        // 交易配置
        this.tradingConfig = this.config.trading || {
            maxGasPrice: parseInt(process.env.MAX_GAS_PRICE) || 10,
            maxGasLimit: parseInt(process.env.MAX_GAS_LIMIT) || 500000,
            defaultSlippage: 0.02,
            maxSlippage: 0.05,
            confirmations: 1
        };

        this.initProvider();
    }

    /**
     * 初始化Web3提供者
     */
    initProvider() {
        try {
            this.provider = new ethers.JsonRpcProvider(this.network.rpcUrl);
            console.log(`📡 ${this.constructor.name}: Provider initialized for ${this.network.name}`);
        } catch (error) {
            throw new Error(`Failed to initialize provider: ${error.message}`);
        }
    }

    /**
     * 设置钱包
     * @param {string} privateKey - 钱包私钥
     */
    async setWallet(privateKey) {
        try {
            if (!privateKey || typeof privateKey !== 'string') {
                throw new Error('Private key is required and must be a string');
            }

            // 私钥格式检查
            if (!privateKey.startsWith('0x')) {
                privateKey = '0x' + privateKey;
            }

            // 验证私钥长度
            if (privateKey.length !== 66) {
                throw new Error('Invalid private key length');
            }

            this.wallet = new ethers.Wallet(privateKey, this.provider);
            this.signer = this.wallet;

            console.log(`👛 ${this.constructor.name}: Wallet set: ${this.wallet.address}`);

            // 验证钱包连接
            await this.verifyWalletConnection();

        } catch (error) {
            throw new Error(`Failed to set wallet: ${error.message}`);
        }
    }

    /**
     * 验证钱包连接
     */
    async verifyWalletConnection() {
        try {
            const balance = await this.provider.getBalance(this.wallet.address);
            console.log(`💰 ${this.constructor.name}: Wallet balance: ${ethers.formatEther(balance)} BNB`);
        } catch (error) {
            console.warn(`⚠️ ${this.constructor.name}: Could not verify wallet connection: ${error.message}`);
        }
    }

    /**
     * 获取BNB余额
     * @returns {Promise<string>}
     */
    async getBNBBalance() {
        if (!this.wallet) {
            throw new Error('Wallet not set. Please call setWallet() first.');
        }

        try {
            const balance = await this.provider.getBalance(this.wallet.address);
            return ethers.formatEther(balance);
        } catch (error) {
            throw new Error(`Failed to get BNB balance: ${error.message}`);
        }
    }

    /**
     * 获取主币余额（兼容ITrader接口）
     * @returns {Promise<string>} 主币余额
     */
    async getNativeBalance() {
        return await this.getBNBBalance();
    }

    /**
     * 计算推荐金额
     * @param {string} tokenAddress - 代币地址
     * @param {Object} tokenInfo - 代币信息
     * @param {string} maxAmount - 最大金额
     * @returns {Promise<string>}
     */
    async calculateRecommendedAmount(tokenAddress, tokenInfo, maxAmount) {
        try {
            const maxAmountFloat = parseFloat(maxAmount);
            const minAmount = parseFloat(this.config.minAmount || 0.001);

            // 基础推荐金额 (默认为最大金额的20%)
            let recommendedAmount = maxAmountFloat * 0.2;

            // 根据代币信息调整
            if (tokenInfo) {
                // 根据市值调整
                if (tokenInfo.marketCap) {
                    const marketCap = parseFloat(tokenInfo.marketCap);
                    if (marketCap < 50000) {
                        recommendedAmount *= 0.5; // 小市值代币，减少交易金额
                    } else if (marketCap > 1000000) {
                        recommendedAmount *= 1.2; // 大市值代币，可以适当增加
                    }
                }

                // 根据TVL调整
                if (tokenInfo.tvl) {
                    const tvl = parseFloat(tokenInfo.tvl);
                    if (tvl < 10000) {
                        recommendedAmount *= 0.7; // 低TVL，减少风险
                    } else if (tvl > 100000) {
                        recommendedAmount *= 1.1; // 高TVL，流动性充足
                    }
                }
            }

            // 确保在合理范围内
            recommendedAmount = Math.max(minAmount, Math.min(recommendedAmount, maxAmountFloat));

            return recommendedAmount.toString();

        } catch (error) {
            console.warn(`⚠️ ${this.constructor.name}: Error calculating recommended amount: ${error.message}`);
            return (parseFloat(maxAmount) * 0.1).toString(); // 默认返回最大金额的10%
        }
    }

    /**
     * 估算Gas费用
     * @param {string} tokenAddress - 代币地址
     * @param {string} amountIn - 输入金额
     * @param {string} tradeType - 交易类型
     * @returns {Promise<Object>}
     */
    async estimateGas(tokenAddress, amountIn, tradeType = 'buy') {
        try {
            const gasPrice = await this.provider.getFeeData();
            const gasLimit = this.tradingConfig.maxGasLimit;

            const gasFee = {
                gasPrice: gasPrice.gasPrice,
                gasLimit: gasLimit,
                maxFeePerGas: gasPrice.maxFeePerGas,
                maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas,
                estimatedCost: ethers.formatEther(gasPrice.gasPrice * BigInt(gasLimit))
            };

            return {
                success: true,
                gasFee,
                estimatedWeiCost: (gasPrice.gasPrice * BigInt(gasLimit)).toString()
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                estimatedCost: '0'
            };
        }
    }

    /**
     * 检查交易状态
     * @param {string} transactionHash - 交易哈希
     * @returns {Promise<Object>}
     */
    async checkTransactionStatus(transactionHash) {
        try {
            const receipt = await this.provider.getTransactionReceipt(transactionHash);

            if (!receipt) {
                return {
                    success: false,
                    status: 'pending',
                    hash: transactionHash
                };
            }

            const status = receipt.status === 1 ? 'success' : 'failed';
            const gasUsed = receipt.gasUsed ? receipt.gasUsed.toString() : '0';

            return {
                success: receipt.status === 1,
                status,
                hash: transactionHash,
                blockNumber: receipt.blockNumber ? receipt.blockNumber.toString() : null,
                gasUsed,
                logs: receipt.logs || []
            };

        } catch (error) {
            return {
                success: false,
                status: 'error',
                hash: transactionHash,
                error: error.message
            };
        }
    }

    /**
     * 等待交易确认
     * @param {string} transactionHash - 交易哈希
     * @param {number} confirmations - 确认数
     * @param {number} timeout - 超时时间(毫秒)
     * @returns {Promise<Object>}
     */
    async waitForTransactionConfirmation(transactionHash, confirmations = 1, timeout = 60000) {
        try {
            const receipt = await this.provider.waitForTransaction(transactionHash, confirmations, timeout);

            return {
                success: true,
                status: receipt.status === 1 ? 'success' : 'failed',
                hash: transactionHash,
                blockNumber: receipt.blockNumber.toString(),
                gasUsed: receipt.gasUsed ? receipt.gasUsed.toString() : '0'
            };

        } catch (error) {
            return {
                success: false,
                status: 'timeout',
                hash: transactionHash,
                error: error.message
            };
        }
    }

    /**
     * 格式化金额
     * @param {string|number} amount - 金额
     * @param {number} decimals - 小数位数
     * @returns {string} 格式化后的金额
     */
    formatAmount(amount, decimals = 18) {
        try {
            return ethers.parseUnits(amount.toString(), decimals).toString();
        } catch (error) {
            console.warn(`⚠️ ${this.constructor.name}: Error formatting amount: ${error.message}`);
            return amount.toString();
        }
    }

    /**
     * 解析金额
     * @param {string|bigint} amount - 金额
     * @param {number} decimals - 小数位数
     * @returns {string} 解析后的金额
     */
    parseAmount(amount, decimals = 18) {
        try {
            return ethers.formatUnits(amount, decimals);
        } catch (error) {
            console.warn(`⚠️ ${this.constructor.name}: Error parsing amount: ${error.message}`);
            return amount.toString();
        }
    }

    /**
     * 验证并合并配置
     * @param {Object} config - 用户配置
     * @returns {Object} 合并后的配置
     */
    validateAndMergeConfig(config) {
        const defaultConfig = {
            network: {
                name: 'BSC',
                chainId: 56,
                rpcUrl: 'https://bsc-dataseed1.binance.org/',
                blockExplorer: 'https://bscscan.com'
            },
            trading: {
                maxGasPrice: 10,
                maxGasLimit: 500000,
                defaultSlippage: 0.02,
                maxSlippage: 0.05,
                confirmations: 1
            },
            minAmount: '0.001',
            maxAmount: '0.1',
            enabled: false
        };

        // 深度合并配置
        const mergedConfig = this.deepMerge(defaultConfig, config);

        // 验证必需配置
        this.validateConfig(mergedConfig);

        return mergedConfig;
    }

    /**
     * 深度合并对象
     * @param {Object} target - 目标对象
     * @param {Object} source - 源对象
     * @returns {Object} 合并后的对象
     */
    deepMerge(target, source) {
        const result = { ...target };

        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = this.deepMerge(result[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }

        return result;
    }

    /**
     * 获取交易器信息
     * @returns {Object} 交易器信息
     */
    getInfo() {
        return {
            name: this.constructor.name,
            version: this.getVersion(),
            network: this.network,
            config: this.config,
            walletAddress: this.wallet ? this.wallet.address : null,
            isConnected: !!this.provider
        };
    }

    /**
     * 获取版本信息
     * @returns {string} 版本号
     */
    getVersion() {
        return '1.0.0';
    }

    /**
     * 抽象方法：验证配置
     * @param {Object} config - 配置对象
     * @returns {Object} 验证结果
     */
    validateConfig(config) {
        const errors = [];
        const warnings = [];

        // 基础验证
        if (!config.network) {
            errors.push('Network configuration is required');
        }

        if (!config.trading) {
            errors.push('Trading configuration is required');
        }

        // 数值范围验证
        if (config.trading && config.trading.maxGasPrice <= 0) {
            errors.push('Max gas price must be greater than 0');
        }

        if (config.trading && config.trading.maxGasLimit <= 0) {
            errors.push('Max gas limit must be greater than 0');
        }

        if (config.minAmount && parseFloat(config.minAmount) <= 0) {
            errors.push('Min amount must be greater than 0');
        }

        if (config.maxAmount && parseFloat(config.maxAmount) <= parseFloat(config.minAmount)) {
            errors.push('Max amount must be greater than min amount');
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }
}

module.exports = BaseTrader;
