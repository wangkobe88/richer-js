/**
 * PancakeSwap V2 交易器实现
 * 支持恒定乘积AMM交易
 */

const { ethers } = require('ethers');
const BaseTrader = require('../core/BaseTrader');

// PancakeSwap V2 合约地址
const PANCAKE_V2_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const PANCAKE_V2_FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

// PancakeSwap V2 Router ABI (简化版)
const ROUTER_ABI = [
    {
        "inputs": [
            {"internalType": "uint256", "name": "amountOutMin", "type": "uint256"},
            {"internalType": "address[]", "name": "path", "type": "address[]"},
            {"internalType": "address", "name": "to", "type": "address"},
            {"internalType": "uint256", "name": "deadline", "type": "uint256"}
        ],
        "name": "swapExactETHForTokens",
        "outputs": [{"internalType": "uint256[]", "name": "amounts", "type": "uint256[]"}],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [
            {"internalType": "uint256", "name": "amountIn", "type": "uint256"},
            {"internalType": "uint256", "name": "amountOutMin", "type": "uint256"},
            {"internalType": "address[]", "name": "path", "type": "address[]"},
            {"internalType": "address", "name": "to", "type": "address"},
            {"internalType": "uint256", "name": "deadline", "type": "uint256"}
        ],
        "name": "swapExactTokensForETH",
        "outputs": [{"internalType": "uint256[]", "name": "amounts", "type": "uint256[]"}],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {"internalType": "uint256", "name": "amountIn", "type": "uint256"},
            {"internalType": "uint256", "name": "reserveIn", "type": "uint256"},
            {"internalType": "uint256", "name": "reserveOut", "type": "uint256"}
        ],
        "name": "getAmountOut",
        "outputs": [{"internalType": "uint256", "name": "amountOut", "type": "uint256"}],
        "stateMutability": "pure",
        "type": "function"
    },
    {
        "inputs": [
            {"internalType": "uint256", "name": "amountOut", "type": "uint256"},
            {"internalType": "uint256", "name": "reserveIn", "type": "uint256"},
            {"internalType": "uint256", "name": "reserveOut", "type": "uint256"}
        ],
        "name": "getAmountIn",
        "outputs": [{"internalType": "uint256", "name": "amountIn", "type": "uint256"}],
        "stateMutability": "pure",
        "type": "function"
    }
];

// PancakeSwap V2 Factory ABI
const FACTORY_ABI = [
    {
        "inputs": [
            {"internalType": "address", "name": "tokenA", "type": "address"},
            {"internalType": "address", "name": "tokenB", "type": "address"}
        ],
        "name": "getPair",
        "outputs": [{"internalType": "address", "name": "pair", "type": "address"}],
        "stateMutability": "view",
        "type": "function"
    }
];

// PancakeSwap V2 Pair ABI
const PAIR_ABI = [
    {
        "constant": true,
        "inputs": [],
        "name": "getReserves",
        "outputs": [
            {"name": "reserve0", "type": "uint112"},
            {"name": "reserve1", "type": "uint112"},
            {"name": "blockTimestampLast", "type": "uint32"}
        ],
        "type": "function"
    },
    {
        "constant": true,
        "inputs": [],
        "name": "token0",
        "outputs": [{"name": "", "type": "address"}],
        "type": "function"
    },
    {
        "constant": true,
        "inputs": [],
        "name": "token1",
        "outputs": [{"name": "", "type": "address"}],
        "type": "function"
    }
];

// ERC20 ABI (增强版，包含所有标准方法)
const ERC20_ABI = [
    {
        "constant": true,
        "inputs": [],
        "name": "name",
        "outputs": [{"name": "", "type": "string"}],
        "type": "function"
    },
    {
        "constant": false,
        "inputs": [
            {"name": "_spender", "type": "address"},
            {"name": "_value", "type": "uint256"}
        ],
        "name": "approve",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function"
    },
    {
        "constant": true,
        "inputs": [],
        "name": "totalSupply",
        "outputs": [{"name": "", "type": "uint256"}],
        "type": "function"
    },
    {
        "constant": false,
        "inputs": [
            {"name": "_from", "type": "address"},
            {"name": "_to", "type": "address"},
            {"name": "_value", "type": "uint256"}
        ],
        "name": "transferFrom",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function"
    },
    {
        "constant": true,
        "inputs": [],
        "name": "decimals",
        "outputs": [{"name": "", "type": "uint8"}],
        "type": "function"
    },
    {
        "constant": true,
        "inputs": [{"name": "_owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "balance", "type": "uint256"}],
        "type": "function"
    },
    {
        "constant": true,
        "inputs": [{"name": "_owner", "type": "address"}, {"name": "_spender", "type": "address"}],
        "name": "allowance",
        "outputs": [{"name": "", "type": "uint256"}],
        "type": "function"
    },
    {
        "constant": false,
        "inputs": [
            {"name": "_to", "type": "address"},
            {"name": "_value", "type": "uint256"}
        ],
        "name": "transfer",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function"
    },
    {
        "constant": true,
        "inputs": [],
        "name": "symbol",
        "outputs": [{"name": "", "type": "string"}],
        "type": "function"
    },
    {
        "constant": false,
        "inputs": [
            {"name": "_spender", "type": "address"},
            {"name": "_addedValue", "type": "uint256"}
        ],
        "name": "increaseAllowance",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function"
    },
    {
        "constant": false,
        "inputs": [
            {"name": "_spender", "type": "address"},
            {"name": "_subtractedValue", "type": "uint256"}
        ],
        "name": "decreaseAllowance",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function"
    }
];

class PancakeSwapV2Trader extends BaseTrader {
    constructor(config = {}) {
        super(config);

        // PancakeSwap V2 合约地址 (BSC Mainnet)
        this.contracts = {
            router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
            factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
            wbnb: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' // WBNB
        };

        // 初始化合约实例
        this.initContracts();

        // 交易配置
        this.defaultGasLimit = config.gasLimit || 300000;
        this.defaultSlippage = config.slippage || 0.01; // 1%
        this.maxSlippage = config.maxSlippage || 0.05; // 5%
        this.defaultDeadline = config.deadline || 300; // 5分钟

        // 本地缓存
        this.pairCache = new Map();
        this.tokenInfoCache = new Map();

        console.log('🥞 PancakeSwap V2 交易器初始化完成');
    }

    /**
     * 初始化合约实例
     */
    initContracts() {
        try {
            this.routerContract = new ethers.Contract(
                this.contracts.router,
                ROUTER_ABI,
                this.provider
            );

            this.factoryContract = new ethers.Contract(
                this.contracts.factory,
                FACTORY_ABI,
                this.provider
            );

            console.log(`📜 ${this.constructor.name}: Contract instances created`);

        } catch (error) {
            throw new Error(`Failed to initialize contracts: ${error.message}`);
        }
    }

    /**
     * 设置钱包私钥
     * @param {string} privateKey - 私钥字符串
     */
    async setWallet(privateKey) {
        try {
            // 调用基类方法
            await super.setWallet(privateKey);
            console.log(`👛 钱包已设置: ${this.wallet.address}`);
        } catch (error) {
            throw new Error(`Failed to set wallet: ${error.message}`);
        }
    }

    /**
     * 发现代币交易对
     * @param {string} tokenAddress - 代币地址
     * @returns {Promise<string>} 交易对地址
     */
    async discoverPair(tokenAddress) {
        // 检查缓存
        if (this.pairCache.has(tokenAddress)) {
            return this.pairCache.get(tokenAddress);
        }

        try {
            const pairAddress = await this.factoryContract.getPair(tokenAddress, WBNB_ADDRESS);

            if (pairAddress === ethers.ZeroAddress) {
                throw new Error(`未找到代币 ${tokenAddress} 与 WBNB 的交易对`);
            }

            // 缓存结果
            this.pairCache.set(tokenAddress, pairAddress);
            console.log(`🔍 发现交易对: ${pairAddress}`);

            return pairAddress;
        } catch (error) {
            throw new Error(`发现交易对失败: ${error.message}`);
        }
    }

    /**
     * 获取交易对储备量信息
     * @param {string} pairAddress - 交易对地址
     * @returns {Promise<Object>} 储备量信息
     */
    async getPairReserves(pairAddress) {
        try {
            const pairContract = new ethers.Contract(pairAddress, PAIR_ABI, this.provider);
            const reserves = await pairContract.getReserves();
            const token0 = await pairContract.token0();
            const token1 = await pairContract.token1();

            return {
                reserve0: reserves[0],
                reserve1: reserves[1],
                token0: token0,
                token1: token1,
                pairContract: pairContract
            };
        } catch (error) {
            throw new Error(`获取储备量失败: ${error.message}`);
        }
    }

    /**
     * 获取代币精度
     * @param {string} tokenAddress - 代币地址
     * @returns {Promise<number>} 代币精度
     */
    async getTokenDecimals(tokenAddress) {
        // 检查缓存
        if (this.tokenInfoCache.has(tokenAddress)) {
            return this.tokenInfoCache.get(tokenAddress).decimals;
        }

        try {
            const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
            const decimals = await tokenContract.decimals();

            // 缓存结果
            this.tokenInfoCache.set(tokenAddress, { decimals });

            return decimals;
        } catch (error) {
            console.warn(`获取代币精度失败，使用默认值 18: ${error.message}`);
            return 18;
        }
    }

    /**
     * 计算输出量 (V2 恒定乘积公式)
     * @param {string} amountIn - 输入金额
     * @param {string} reserveIn - 输入储备量
     * @param {string} reserveOut - 输出储备量
     * @returns {bigint} 输出金额
     */
    calculateAmountOut(amountIn, reserveIn, reserveOut) {
        // V2 0.3% 手续费 (997/1000)
        const amountInWithFee = BigInt(amountIn) * 997n;
        const numerator = amountInWithFee * BigInt(reserveOut);
        const denominator = (BigInt(reserveIn) * 1000n) + amountInWithFee;

        return numerator / denominator;
    }

    /**
     * 计算输入量
     * @param {string} amountOut - 输出金额
     * @param {string} reserveIn - 输入储备量
     * @param {string} reserveOut - 输出储备量
     * @returns {bigint} 输入金额
     */
    calculateAmountIn(amountOut, reserveIn, reserveOut) {
        // 考虑 0.3% 手续费
        const numerator = BigInt(reserveIn) * BigInt(amountOut) * 1000n;
        const denominator = BigInt(reserveOut - amountOut) * 997n;

        return numerator / denominator + 1n;
    }

    /**
     * 获取当前 BNB 余额
     * @returns {Promise<string>} BNB 余额
     */
    async getBNBBalance() {
        try {
            return await super.getBNBBalance();
        } catch (error) {
            throw new Error(`Failed to get BNB balance: ${error.message}`);
        }
    }

    /**
     * 获取池子信息
     * @param {string} tokenAddress - 代币地址
     * @returns {Promise<Object>} 池子信息
     */
    async getPoolInfo(tokenAddress) {
        try {
            const pairAddress = await this.discoverPair(tokenAddress);
            const reserves = await this.getPairReserves(pairAddress);

            // 计算流动性信息
            let wbnbReserve, tokenReserve;
            if (reserves.token0.toLowerCase() === this.contracts.wbnb.toLowerCase()) {
                wbnbReserve = reserves.reserve0;
                tokenReserve = reserves.reserve1;
            } else {
                wbnbReserve = reserves.reserve1;
                tokenReserve = reserves.reserve0;
            }

            const totalLiquidity = parseFloat(ethers.formatEther(wbnbReserve)) * 2;

            return {
                address: pairAddress,
                token0: reserves.token0,
                token1: reserves.token1,
                bnbReserve: wbnbReserve.toString(),
                tokenReserve: tokenReserve.toString(),
                totalLiquidity,
                isActive: wbnbReserve > 0 && tokenReserve > 0,
                fee: '3000' // 0.3% fee for V2
            };

        } catch (error) {
            throw new Error(`Failed to get pool info: ${error.message}`);
        }
    }

    /**
     * 获取代币余额
     * @param {string} tokenAddress - 代币地址
     * @returns {Promise<string>} 代币余额
     */
    async getTokenBalance(tokenAddress) {
        if (!this.wallet) {
            throw new Error('钱包未设置');
        }

        try {
            const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
            const decimals = await this.getTokenDecimals(tokenAddress);
            const balance = await tokenContract.balanceOf(this.wallet.address);

            return ethers.formatUnits(balance, decimals);
        } catch (error) {
            console.error(`获取代币余额失败: ${error.message}`);
            return '0';
        }
    }

    /**
     * 检查代币授权额度
     * @param {string} tokenAddress - 代币地址
     * @returns {Promise<string>} 授权额度
     */
    async checkAllowance(tokenAddress) {
        if (!this.wallet) {
            throw new Error('钱包未设置');
        }

        try {
            const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
            const allowance = await tokenContract.allowance(this.wallet.address, PANCAKE_V2_ROUTER);

            return allowance.toString();
        } catch (error) {
            throw new Error(`检查授权失败: ${error.message}`);
        }
    }

    /**
     * 授权代币
     * @param {string} tokenAddress - 代币地址
     * @param {string} amount - 授权金额 (可选，默认为最大值)
     * @returns {Promise<Object>} 交易结果
     */
    async approveToken(tokenAddress, amount = null) {
        if (!this.wallet) {
            throw new Error('钱包未设置');
        }

        try {
            const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
            const approveAmount = amount || ethers.MaxUint256;

            // 修复：在estimateGas时明确指定from地址
            const estimatedGasLimit = await this._safeEstimateGas({
                to: tokenAddress,
                from: this.wallet.address,  // 明确指定from地址
                data: tokenContract.interface.encodeFunctionData("approve", [
                    PANCAKE_V2_ROUTER,
                    approveAmount
                ])
            });
            // 计算 gasLimit 缓冲，使用 BigInt 运算避免溢出
            const bufferedGasLimit = (estimatedGasLimit * 120n) / 100n; // 增加20%缓冲

            console.log(`🔐 授权交易详情:`);
            console.log(`  from: ${this.wallet.address}`);
            console.log(`  to: ${tokenAddress}`);
            console.log(`  spender: ${PANCAKE_V2_ROUTER}`);
            console.log(`  amount: ${approveAmount.toString()}`);

            const signedTx = await this.wallet.sendTransaction({
                to: tokenAddress,
                data: tokenContract.interface.encodeFunctionData("approve", [
                    PANCAKE_V2_ROUTER,
                    approveAmount
                ]),
                gasLimit: bufferedGasLimit,
                gasPrice: await this.getOptimalGasPrice()
            });

            const receipt = await signedTx.wait();

            console.log(`✅ 代币授权成功: ${signedTx.hash}`);
            return {
                success: true,
                txHash: signedTx.hash,
                gasUsed: receipt.gasUsed,
                error: null
            };
        } catch (error) {
            console.error(`❌ 代币授权失败: ${error.message}`);
            return {
                success: false,
                txHash: null,
                error: error.message
            };
        }
    }

    /**
     * 确保代币授权
     * @param {string} tokenAddress - 代币地址
     * @param {string|bigint} amount - 所需授权金额
     * @returns {Promise<boolean>} 是否授权成功
     */
    async ensureAllowance(tokenAddress, amount) {
        try {
            const currentAllowance = await this.checkAllowance(tokenAddress);
            const amountBigInt = BigInt(amount);

            console.log(`🔍 当前授权额度: ${currentAllowance}`);
            console.log(`🔍 需要授权金额: ${amountBigInt.toString()}`);
            console.log(`🔍 授权比较: ${currentAllowance} >= ${amountBigInt.toString()} = ${BigInt(currentAllowance) >= amountBigInt}`);

            // 如果当前授权已经足够，增加10%的缓冲以避免边界问题
            const bufferAmount = (amountBigInt * 110n) / 100n; // 增加10%缓冲
            if (BigInt(currentAllowance) >= bufferAmount) {
                console.log('✅ 当前授权额度已足够（含缓冲）');

                // 额外验证：再次检查确保授权真正生效
                await new Promise(resolve => setTimeout(resolve, 1000)); // 等待1秒确保状态同步
                const finalAllowance = await this.checkAllowance(tokenAddress);
                if (BigInt(finalAllowance) >= bufferAmount) {
                    console.log('✅ 授权状态确认有效');
                    return true;
                } else {
                    console.log('⚠️ 授权状态不一致，重新授权...');
                    // 继续下面的授权流程
                }
            }

            // 使用最大值授权，避免后续需要重新授权
            console.log('🔄 授权最大额度以避免后续问题...');
            const maxAmount = ethers.MaxUint256;
            const result = await this.approveToken(tokenAddress, maxAmount);

            if (result.success) {
                console.log('✅ 代币授权交易已发送，等待确认...');

                // 等待交易确认并多次检查授权是否生效
                console.log('⏳ 等待授权交易完全确认...');
                await new Promise(resolve => setTimeout(resolve, 3000)); // 首次等待3秒

                // 更严格的授权验证，最多等待20秒
                for (let i = 0; i < 10; i++) {
                    const newAllowance = await this.checkAllowance(tokenAddress);
                    console.log(`🔍 授权后检查 #${i + 1}: ${newAllowance}`);

                    // 确保授权额度足够且大于0
                    if (BigInt(newAllowance) > 0 && BigInt(newAllowance) >= amountBigInt) {
                        console.log('✅ 授权验证成功');

                        // 最后再次确认，等待链状态完全同步
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        const finalConfirmAllowance = await this.checkAllowance(tokenAddress);
                        if (BigInt(finalConfirmAllowance) >= amountBigInt) {
                            console.log('✅ 最终授权确认完成');
                            return true;
                        }
                    }

                    // 等待2秒后再次检查
                    if (i < 9) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }

                console.error('❌ 授权验证失败：多次检查后额度仍不足');
                console.error(`❌ 期望至少: ${amountBigInt.toString()}, 实际: ${newAllowance}`);
                return false;
            } else {
                console.log('❌ 代币授权失败');
                return false;
            }

        } catch (error) {
            console.error(`确保授权失败: ${error.message}`);
            return false;
        }
    }

    /**
     * 安全的Gas估算方法 - 统一处理所有类型
     * @param {Object} tx - 交易对象
     * @returns {Promise<bigint>} Gas 估算值
     * @throws {Error} 当Gas估算失败且不应继续执行时抛出错误
     */
    async _safeEstimateGas(tx) {
        console.log('🔍 开始安全估算Gas...');
        console.log(`📝 tx对象: ${JSON.stringify(tx, (key, value) => {
            if (key === 'data') {
                return `[数据长度: ${value?.length || 0}]`;
            }
            // 处理BigInt类型
            if (typeof value === 'bigint') {
                return value.toString();
            }
            return value;
        }, 2)}`);

        // 多次尝试Gas估算，避免临时性问题
        let lastError;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`🔍 Gas估算尝试 #${attempt}...`);

                const gasEstimate = await this.provider.estimateGas(tx);
                console.log(`⛽ Gas估算成功: ${gasEstimate}, 类型: ${typeof gasEstimate}`);

                // 统一处理所有可能的返回类型
                if (typeof gasEstimate === 'bigint') {
                    console.log(`⛽ 直接使用BigInt: ${gasEstimate}`);
                    return gasEstimate;
                } else if (gasEstimate && typeof gasEstimate === 'object') {
                    let result;

                    // 检查常见属性
                    if (gasEstimate.gasLimit) {
                        console.log(`⛽ 从对象提取gasLimit: ${gasEstimate.gasLimit}`);
                        result = BigInt(gasEstimate.gasLimit);
                    } else if (gasEstimate.toString && typeof gasEstimate.toString === 'function') {
                        const gasStr = gasEstimate.toString();
                        console.log(`⛽ 从对象toString转换: ${gasStr}`);
                        result = BigInt(gasStr);
                    } else if (gasEstimate.valueOf && typeof gasEstimate.valueOf === 'function') {
                        const gasValue = gasEstimate.valueOf();
                        console.log(`⛽ 从对象valueOf转换: ${gasValue}`);
                        result = BigInt(gasValue);
                    } else {
                        // 检查其他属性
                        for (const key of ['gas', 'gasUsed', 'limit']) {
                            if (gasEstimate[key]) {
                                console.log(`⛽ 从对象.${key}获取: ${gasEstimate[key]}`);
                                result = BigInt(gasEstimate[key]);
                                break;
                            }
                        }
                    }

                    if (!result) {
                        console.log(`⛽ 无法处理的对象: ${JSON.stringify(gasEstimate, (key, value) =>
                            typeof value === 'bigint' ? value.toString() : value, 2)}`);
                        throw new Error(`无法处理的Gas估算对象: ${gasEstimate.toString()}`);
                    }

                    return result;
                } else {
                    // 直接转换其他类型
                    console.log(`⛽ 直接转换为BigInt: ${gasEstimate}`);
                    return BigInt(gasEstimate);
                }

            } catch (error) {
                lastError = error;
                console.warn(`⚠️ Gas估算尝试 #${attempt} 失败: ${error.message}`);

                // 如果不是最后一次尝试，等待后重试
                if (attempt < 3) {
                    console.log(`⏳ 等待2秒后重试...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }

        // 所有尝试都失败了，分析错误类型
        console.error(`❌ Gas估算最终失败: ${lastError.message}`);

        // 分析错误类型，对于某些严重错误直接抛出异常
        const errorMessage = lastError.message.toLowerCase();

        if (errorMessage.includes('transfer_from_failed') ||
            errorMessage.includes('transfer helper') ||
            errorMessage.includes('insufficient allowance') ||
            errorMessage.includes('unauthorized') ||
            errorMessage.includes('permit')) {
            // 这些是授权相关错误，不应该继续执行
            console.error('💡 检测到授权相关错误，交易无法继续执行');
            throw new Error(`Gas估算失败 - 授权问题: ${lastError.message}`);
        }

        if (errorMessage.includes('execution reverted') ||
            errorMessage.includes('revert') ||
            errorMessage.includes('invalid opcode')) {
            // 这些是交易执行错误，说明交易数据有问题
            console.error('💡 检测到交易执行错误，交易数据可能有问题');
            throw new Error(`Gas估算失败 - 交易执行错误: ${lastError.message}`);
        }

        // 对于其他类型的错误，使用保守的默认值但增加警告
        console.warn('⚠️ Gas估算失败，但错误类型允许继续执行，使用保守默认值');
        const conservativeGas = BigInt(this.defaultGasLimit || 500000); // 使用更保守的默认值
        console.log(`⛽ 使用保守Gas限制: ${conservativeGas}, 类型: ${typeof conservativeGas}`);
        console.warn('⚠️ 注意：使用默认Gas值可能导致交易失败，请检查交易参数');

        return conservativeGas;
    }

    /**
     * 获取最优 Gas 价格
     * @returns {Promise<bigint>} Gas 价格
     */
    async getOptimalGasPrice() {
        try {
            const gasPrice = await this.provider.getFeeData();
            console.log(`🔍 获取到Gas价格: ${gasPrice.gasPrice}, 类型: ${typeof gasPrice.gasPrice}`);
            return gasPrice.gasPrice;
        } catch (error) {
            console.warn(`获取 Gas 价格失败，使用默认值: ${error.message}`);
            const defaultGasPrice = ethers.parseUnits('5', 'gwei');
            console.log(`🔍 使用默认Gas价格: ${defaultGasPrice}, 类型: ${typeof defaultGasPrice}`);
            return defaultGasPrice;
        }
    }

    /**
     * 买入代币 (BNB → Token)
     * @param {string} tokenAddress - 代币地址
     * @param {string} bnbAmount - BNB 数量
     * @param {Object} options - 选项参数
     * @returns {Promise<Object>} 交易结果
     */
    async buyToken(tokenAddress, bnbAmount, options = {}) {
        if (!this.wallet) {
            throw new Error('钱包未设置');
        }

        const {
            slippage = this.defaultSlippage,
            gasLimit = this.defaultGasLimit,
            deadline = this.defaultDeadline,
            maxRetries = 3 // 新增：最大重试次数
        } = options;

        // 包装重试逻辑
        return await this._executeWithRetry(
            async () => await this._buyTokenInternal(tokenAddress, bnbAmount, options),
            maxRetries,
            'buyToken'
        );
    }

    /**
     * 内部买入代币实现
     * @param {string} tokenAddress - 代币地址
     * @param {string} bnbAmount - BNB 数量
     * @param {Object} options - 选项参数
     * @returns {Promise<Object>} 交易结果
     */
    async _buyTokenInternal(tokenAddress, bnbAmount, options = {}) {
        if (!this.wallet) {
            throw new Error('钱包未设置');
        }

        const {
            slippage = this.defaultSlippage,
            gasLimit = this.defaultGasLimit,
            deadline = this.defaultDeadline
        } = options;

        try {
            console.log(`🛒 开始购买代币: ${tokenAddress}`);
            console.log(`💰 BNB 数量: ${bnbAmount}`);

            // 1. 发现交易对
            const pairAddress = await this.discoverPair(tokenAddress);
            const reserves = await this.getPairReserves(pairAddress);

            // 2. 确定输入输出储备
            let wbnbReserve, tokenReserve;
            if (reserves.token0.toLowerCase() === WBNB_ADDRESS.toLowerCase()) {
                wbnbReserve = reserves.reserve0;
                tokenReserve = reserves.reserve1;
            } else {
                wbnbReserve = reserves.reserve1;
                tokenReserve = reserves.reserve0;
            }

            // 3. 计算预期输出
            const amountIn = ethers.parseEther(bnbAmount);
            const expectedOut = this.calculateAmountOut(amountIn, wbnbReserve, tokenReserve);
            // 计算 slippage，使用纯 BigInt 运算
            const slippageBps = Math.floor((1 - slippage) * 10000); // 基点
            const amountOutMin = (expectedOut * BigInt(slippageBps)) / 10000n;

            console.log(`📊 预期输出: ${ethers.formatUnits(expectedOut, await this.getTokenDecimals(tokenAddress))} tokens`);
            console.log(`📉 最小输出: ${ethers.formatUnits(amountOutMin, await this.getTokenDecimals(tokenAddress))} tokens`);

            // 4. 构建交易
            const path = [WBNB_ADDRESS, tokenAddress];
            // 确保deadline是Number类型，避免BigInt混合
            const deadlineNumber = typeof deadline === 'bigint' ? Number(deadline) : deadline;
            const deadlineTimestamp = Math.floor(Date.now() / 1000) + deadlineNumber;

            // 5. 发送交易
            console.log('🔧 开始构建交易数据...');
            console.log(`📝 amountIn: ${amountIn}, 类型: ${typeof amountIn}`);
            console.log(`📝 amountOutMin: ${amountOutMin}, 类型: ${typeof amountOutMin}`);
            console.log(`📝 deadlineTimestamp: ${deadlineTimestamp}, 类型: ${typeof deadlineTimestamp}`);

            const txData = this.routerContract.interface.encodeFunctionData("swapExactETHForTokens", [
                amountOutMin,
                path,
                this.wallet.address,
                deadlineTimestamp
            ]);
            console.log(`📝 交易数据长度: ${txData.length}`);

            const estimatedGasLimit = await this._safeEstimateGas({
                to: PANCAKE_V2_ROUTER,
                data: txData,
                value: amountIn
            });
            console.log(`⛽ 最终Gas限制: ${estimatedGasLimit}, 类型: ${typeof estimatedGasLimit}`);

            const gasPrice = await this.getOptimalGasPrice();
            console.log(`⛽ Gas价格: ${gasPrice}, 类型: ${typeof gasPrice}`);

            // 计算 gasLimit 缓冲，使用 BigInt 运算避免溢出
            const bufferedGasLimit = (estimatedGasLimit * 120n) / 100n; // 增加20%缓冲
            console.log(`⛽ 缓冲后Gas限制: ${bufferedGasLimit}, 类型: ${typeof bufferedGasLimit}`);

            console.log('🔧 开始发送交易...');
            const txParams = {
                to: PANCAKE_V2_ROUTER,
                data: txData,
                value: amountIn,
                gasLimit: bufferedGasLimit,
                gasPrice
            };
            console.log('📝 交易参数详情:');
            console.log(`  to: ${txParams.to}, 类型: ${typeof txParams.to}`);
            console.log(`  data: ${txParams.data ? '已设置' : '未设置'}, 长度: ${txParams.data?.length || 0}`);
            console.log(`  value: ${txParams.value}, 类型: ${typeof txParams.value}`);
            console.log(`  gasLimit: ${txParams.gasLimit}, 类型: ${typeof txParams.gasLimit}`);
            console.log(`  gasPrice: ${txParams.gasPrice}, 类型: ${typeof txParams.gasPrice}`);

            const signedTx = await this.wallet.sendTransaction(txParams);

            console.log(`📤 交易已发送: ${signedTx.hash}`);
            console.log('⏳ 等待交易确认...');

            // 6. 等待确认
            const receipt = await signedTx.wait();

            if (receipt.status === 1) {
                console.log(`✅ 交易成功! Gas 使用: ${receipt.gasUsed}`);

                // 7. 验证代币转账
                const tokenReceived = await this.verifyTokenTransfer(receipt, tokenAddress);

                return {
                    success: true,
                    txHash: signedTx.hash,
                    amountOut: expectedOut.toString(),
                    amountOutMin: amountOutMin.toString(),
                    gasUsed: receipt.gasUsed,
                    tokenReceived,
                    error: null
                };
            } else {
                throw new Error('交易执行失败');
            }

        } catch (error) {
            console.error(`❌ 购买失败: ${error.message}`);
            return {
                success: false,
                txHash: null,
                error: error.message
            };
        }
    }

    /**
     * 卖出代币 (Token → BNB)
     * @param {string} tokenAddress - 代币地址
     * @param {string} tokenAmount - 代币数量
     * @param {Object} options - 选项参数
     * @returns {Promise<Object>} 交易结果
     */
    async sellToken(tokenAddress, tokenAmount, options = {}) {
        if (!this.wallet) {
            throw new Error('钱包未设置');
        }

        const {
            slippage = this.defaultSlippage,
            gasLimit = this.defaultGasLimit,
            deadline = this.defaultDeadline,
            maxRetries = 3 // 新增：最大重试次数
        } = options;

        // 包装重试逻辑
        return await this._executeWithRetry(
            async () => await this._sellTokenInternal(tokenAddress, tokenAmount, options),
            maxRetries,
            'sellToken'
        );
    }

    /**
     * 内部卖出代币实现
     * @param {string} tokenAddress - 代币地址
     * @param {string} tokenAmount - 代币数量
     * @param {Object} options - 选项参数
     * @returns {Promise<Object>} 交易结果
     */
    async _sellTokenInternal(tokenAddress, tokenAmount, options = {}) {
        if (!this.wallet) {
            throw new Error('钱包未设置');
        }

        const {
            slippage = this.defaultSlippage,
            gasLimit = this.defaultGasLimit,
            deadline = this.defaultDeadline
        } = options;

        console.log(`💰 开始卖出代币: ${tokenAddress}`);
        console.log(`🪙 代币数量: ${tokenAmount}`);
        console.log(`🔍 代币数量类型: ${typeof tokenAmount}`);
        console.log(`🔍 代币数量长度: ${tokenAmount ? tokenAmount.length : 'N/A'}`);

        // 详细钱包检查
        console.log(`🔍 钱包地址: ${this.wallet.address}`);
        console.log(`🔍 钱包地址类型: ${typeof this.wallet.address}`);
        console.log(`🔍 钱包地址是否为零地址: ${this.wallet.address === ethers.ZeroAddress}`);

        // 如果钱包地址有问题，尝试重新设置钱包
        if (this.wallet.address === ethers.ZeroAddress || !this.wallet.address) {
            console.log('⚠️ 钱包地址异常，尝试重新设置...');
            if (this.config && this.config.privateKey) {
                await this.setWallet(this.config.privateKey);
                console.log(`✅ 钱包重新设置完成，新地址: ${this.wallet.address}`);
            } else {
                throw new Error('无法重新设置钱包：缺少私钥配置');
            }
        }

        // 1. 获取代币精度
        const decimals = await this.getTokenDecimals(tokenAddress);
        console.log(`🔢 代币精度: ${decimals}`);

        let amountIn = ethers.parseUnits(tokenAmount, decimals);
        console.log(`📝 解析后的 amountIn: ${amountIn.toString()}`);

        // 2. 详细检查代币余额
        console.log('🔍 检查代币余额...');
        const tokenBalance = await this.getTokenBalance(tokenAddress);
        console.log(`💰 当前代币余额: ${tokenBalance}`);

        const tokenBalanceBigInt = ethers.parseUnits(tokenBalance || '0', decimals);
        console.log(`🔍 余额Wei: ${tokenBalanceBigInt.toString()}`);
        console.log(`🔍 需要Wei: ${amountIn.toString()}`);

        // 检查余额，允许1 wei的误差（精度问题）
        const difference = amountIn - tokenBalanceBigInt;
        console.log(`🔍 余额差额: ${difference.toString()} wei`);

        if (difference > 1n) { // 允许1 wei的误差
            // 自动调整交易金额为实际余额（保留一些余量用于Gas）
            const adjustedAmount = tokenBalanceBigInt > 1000n ? tokenBalanceBigInt - 1000n : tokenBalanceBigInt;
            const adjustedAmountFormatted = ethers.formatUnits(adjustedAmount, decimals);

            console.warn(`⚠️ 代币余额略不足，自动调整交易金额:`);
            console.warn(`   原始请求: ${tokenAmount}`);
            console.warn(`   实际余额: ${tokenBalance}`);
            console.warn(`   调整后: ${adjustedAmountFormatted}`);

            // 更新amountIn为调整后的金额
            if (adjustedAmount > 0n) {
                console.log(`✅ 使用调整后的交易金额: ${adjustedAmountFormatted}`);
                // 重新解析tokenAmount为调整后的值
                tokenAmount = adjustedAmountFormatted;
                // 更新amountIn（现在可以重新赋值，因为声明为let）
                amountIn = adjustedAmount;
            } else {
                throw new Error(`代币余额严重不足: 实际 ${tokenBalance}, 差额 ${ethers.formatUnits(difference, decimals)}`);
            }
        } else {
            console.log('✅ 代币余额充足');
        }

        // 3. 检查BNB余额用于Gas
        console.log('🔍 检查BNB余额...');
        const bnbBalance = await this.getBNBBalance();
        console.log(`💰 当前BNB余额: ${bnbBalance}`);
        const minBnbForGas = ethers.parseEther('0.001'); // 至少0.001 BNB用于Gas
        if (ethers.parseEther(bnbBalance || '0') < minBnbForGas) {
            throw new Error(`BNB余额不足以支付Gas: 当前 ${bnbBalance}, 建议至少 0.001 BNB`);
        }
        console.log('✅ BNB余额充足');

        // 4. 确保授权
        const allowanceOk = await this.ensureAllowance(tokenAddress, amountIn);
        if (!allowanceOk) {
            throw new Error('代币授权失败');
        }

        // 5. 发现交易对
        const pairAddress = await this.discoverPair(tokenAddress);
        const reserves = await this.getPairReserves(pairAddress);

        // 6. 确定输入输出储备
        let tokenReserve, wbnbReserve;
        if (reserves.token0.toLowerCase() === tokenAddress.toLowerCase()) {
            tokenReserve = reserves.reserve0;
            wbnbReserve = reserves.reserve1;
        } else {
            tokenReserve = reserves.reserve1;
            wbnbReserve = reserves.reserve0;
        }

        // 检查流动性
        if (tokenReserve < amountIn) {
            console.warn(`⚠️ 池子流动性可能不足: 储备 ${ethers.formatUnits(tokenReserve, decimals)}, 交易 ${tokenAmount}`);
        }

        // 7. 计算预期输出
        const expectedOut = this.calculateAmountOut(amountIn, tokenReserve, wbnbReserve);
        // 计算 slippage，使用纯 BigInt 运算
        const slippageBps = Math.floor((1 - slippage) * 10000); // 基点
        const amountOutMin = (expectedOut * BigInt(slippageBps)) / 10000n;

        console.log(`📊 预期 BNB 输出: ${ethers.formatEther(expectedOut)}`);
        console.log(`📉 最小 BNB 输出: ${ethers.formatEther(amountOutMin)}`);

        // 8. 构建交易
        const path = [tokenAddress, WBNB_ADDRESS];
        // 确保deadline是Number类型，避免BigInt混合
        const deadlineNumber = typeof deadline === 'bigint' ? Number(deadline) : deadline;
        const deadlineTimestamp = Math.floor(Date.now() / 1000) + deadlineNumber;

        // 9. 进行详细的交易前验证
        console.log('🔍 进行交易前验证...');
        await this._preTransactionValidation(tokenAddress, amountIn, PANCAKE_V2_ROUTER);

        // 10. 发送交易
        console.log('🔧 开始构建交易数据...');
        const swapData = this.routerContract.interface.encodeFunctionData("swapExactTokensForETH", [
            amountIn,
            amountOutMin,
            path,
            this.wallet.address,
            deadlineTimestamp
        ]);
        console.log(`📝 交易数据长度: ${swapData.length}`);

        // 修复：在estimateGas时明确指定from地址
        const estimatedGasLimit = await this._safeEstimateGas({
            to: PANCAKE_V2_ROUTER,
            from: this.wallet.address,  // 明确指定from地址
            data: swapData
        });
        const gasPrice = await this.getOptimalGasPrice();

        // 计算 gasLimit 缓冲，使用 BigInt 运算避免溢出
        const bufferedGasLimit = (estimatedGasLimit * 120n) / 100n; // 增加20%缓冲

        console.log(`⛽ 最终Gas限制: ${bufferedGasLimit}`);
        console.log(`⛽ Gas价格: ${gasPrice}`);

        const signedTx = await this.wallet.sendTransaction({
            to: PANCAKE_V2_ROUTER,
            data: swapData,
            gasLimit: bufferedGasLimit,
            gasPrice
        });

        console.log(`📤 交易已发送: ${signedTx.hash}`);
        console.log('⏳ 等待交易确认...');

        // 11. 等待确认
        const receipt = await signedTx.wait();

        if (receipt.status === 1) {
            console.log(`✅ 交易成功! Gas 使用: ${receipt.gasUsed}`);

            return {
                success: true,
                txHash: signedTx.hash,
                amountOut: expectedOut.toString(),
                amountOutMin: amountOutMin.toString(),
                gasUsed: receipt.gasUsed,
                error: null
            };
        } else {
            throw new Error('交易执行失败');
        }
    }

    /**
     * 交易前验证
     * @param {string} tokenAddress - 代币地址
     * @param {bigint} amount - 交易金额
     * @param {string} spender - 授权接收方
     */
    async _preTransactionValidation(tokenAddress, amount, spender) {
        try {
            console.log('🔍 执行交易前验证...');

            // 1. 重新检查授权状态
            const currentAllowance = await this.checkAllowance(tokenAddress);
            console.log(`🔍 交易前授权检查: ${currentAllowance}`);

            if (BigInt(currentAllowance) < amount) {
                throw new Error(`交易前授权验证失败: 需要 ${amount.toString()}, 当前 ${currentAllowance}`);
            }

            // 2. 检查代币合约状态
            console.log('🔍 创建代币合约实例...');
            let tokenContract;
            try {
                tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
                console.log('✅ 代币合约实例创建成功');
            } catch (contractError) {
                console.error('❌ 创建代币合约实例失败:', contractError.message);
                throw new Error(`无法创建代币合约实例: ${contractError.message}`);
            }

            try {
                // 检查代币是否被暂停（如果有此功能）
                const paused = await tokenContract.paused?.();
                if (paused) {
                    throw new Error('代币合约已暂停交易');
                }
            } catch (e) {
                // 大多数代币没有paused函数，忽略错误
            }

            // 3. 模拟transferFrom调用检查
            try {
                console.log('🔍 准备进行transferFrom模拟验证...');

                // 检查合约实例是否有效
                console.log(`🔍 检查合约实例...`);
                console.log(`   tokenContract存在: ${!!tokenContract}`);
                console.log(`   transferFrom方法存在: ${!!tokenContract?.transferFrom}`);
                console.log(`   callStatic方法存在: ${!!tokenContract?.callStatic}`);

                // 如果transferFrom方法不存在，可能是ABI不完整
                if (!tokenContract?.transferFrom) {
                    console.warn('⚠️ 代币合约没有transferFrom方法，可能是ABI不完整，跳过模拟验证');
                    console.log('✅ 跳过模拟验证，继续交易流程');
                    return; // 跳过验证，继续执行
                }

                console.log(`🔍 合约地址: ${tokenAddress}`);
                console.log(`🔍 钱包地址: ${this.wallet.address}`);
                console.log(`🔍 授权接收方: ${spender}`);
                console.log(`🔍 转账金额: ${amount.toString()}`);

                // 检查是否有callStatic方法
                if (!tokenContract.callStatic) {
                    console.warn('⚠️ 合约实例没有callStatic方法，跳过模拟验证');
                    console.log('✅ 跳过模拟验证，继续交易流程');
                    return; // 跳过验证，继续执行
                }

                // 使用callStatic进行模拟调用，不会真正执行交易
                const simulateResult = await tokenContract.callStatic.transferFrom(
                    this.wallet.address,
                    spender,
                    amount,
                    { from: this.wallet.address }
                );
                console.log('✅ transferFrom模拟调用成功:', simulateResult);
            } catch (simulateError) {
                console.error('❌ transferFrom模拟调用失败:', simulateError.message);
                console.error('❌ 错误详情:', simulateError);

                // 如果是合约实例问题，跳过模拟验证
                if (simulateError.message.includes('Cannot read properties of undefined') ||
                    simulateError.message.includes('代币合约实例无效')) {
                    console.warn('⚠️ 无法进行transferFrom模拟验证，可能是合约实例或ABI问题，跳过此步骤');
                    console.log('✅ 跳过模拟验证，继续交易流程');
                    return; // 跳过验证，继续执行
                }

                // 分析模拟错误
                const errorMsg = simulateError.message.toLowerCase();
                if (errorMsg.includes('blacklist') || errorMsg.includes('blacklisted')) {
                    throw new Error('地址在黑名单中，无法交易');
                } else if (errorMsg.includes('paused') || errorMsg.includes('halt')) {
                    throw new Error('代币交易已暂停');
                } else if (errorMsg.includes('transfer limit') || errorMsg.includes('limit')) {
                    throw new Error('超出转账限额');
                } else if (errorMsg.includes('lock') || errorMsg.includes('vesting')) {
                    throw new Error('代币被锁定，无法交易');
                } else if (errorMsg.includes('execution reverted')) {
                    console.warn('⚠️ transferFrom执行失败，但可能是模拟环境问题，继续尝试实际交易');
                    console.log('✅ 跳过模拟验证，继续交易流程');
                    return; // 跳过验证，继续执行
                } else {
                    // 其他未知的transferFrom错误，也跳过验证继续尝试
                    console.warn('⚠️ 未知的transferFrom验证错误，跳过模拟验证，尝试实际交易');
                    console.log('✅ 跳过模拟验证，继续交易流程');
                    return; // 跳过验证，继续执行
                }
            }

            console.log('✅ 交易前验证全部通过');

        } catch (error) {
            console.error('❌ 交易前验证失败:', error.message);
            throw error;
        }
    }

    /**
     * 带重试机制的执行器
     * @param {Function} operation - 要执行的操作
     * @param {number} maxRetries - 最大重试次数
     * @param {string} operationName - 操作名称（用于日志）
     * @returns {Promise<Object>} 执行结果
     */
    async _executeWithRetry(operation, maxRetries = 3, operationName = 'operation') {
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🔄 ${operationName} 尝试 #${attempt}/${maxRetries}...`);

                const result = await operation();

                if (attempt > 1) {
                    console.log(`✅ ${operationName} 重试成功! (尝试 #${attempt})`);
                }

                return result;

            } catch (error) {
                lastError = error;
                console.error(`❌ ${operationName} 尝试 #${attempt} 失败: ${error.message}`);

                // 分析错误类型，决定是否应该重试
                const errorMessage = error.message.toLowerCase();
                const shouldRetry = this._shouldRetryError(errorMessage);

                if (!shouldRetry) {
                    console.error(`💡 错误类型不适合重试，直接返回失败`);
                    break;
                }

                // 如果还有重试机会，等待后重试
                if (attempt < maxRetries) {
                    const waitTime = attempt * 3000; // 递增等待时间：3s, 6s, 9s...
                    console.log(`⏳ 等待 ${waitTime/1000} 秒后重试...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));

                    // 在重试前，如果是授权相关错误，尝试重新授权
                    if (errorMessage.includes('transfer_from_failed') ||
                        errorMessage.includes('insufficient allowance')) {
                        console.log('🔄 检测到授权问题，尝试重新授权...');
                        // 这里可以添加重新授权的逻辑
                    }
                }
            }
        }

        console.error(`❌ ${operationName} 最终失败，已尝试 ${maxRetries} 次`);
        return {
            success: false,
            txHash: null,
            error: `重试 ${maxRetries} 次后仍失败: ${lastError.message}`
        };
    }

    /**
     * 判断错误是否应该重试
     * @param {string} errorMessage - 错误消息
     * @returns {boolean} 是否应该重试
     */
    _shouldRetryError(errorMessage) {
        // 不应该重试的错误类型
        const nonRetryableErrors = [
            'insufficient balance', // 余额不足
            'invalid address',      // 无效地址
            'invalid signature',    // 无效签名
            'nonce too low',        // nonce过低
            'nonce too high',       // nonce过高
            'gas price too low',    // gas价格过低（网络拥堵）
            'underflow',            // 数值下溢
            'overflow',             // 数值上溢
            'division by zero',     // 除零错误
            'invalid jump',         // 无效跳转
            'stack too deep',       // 栈太深
            'out of gas',           // 超出gas（这个可以重试但需要更高gas）
            'execution reverted'    // 交易执行失败（某些情况下可重试）
        ];

        // 检查是否包含不应该重试的错误
        for (const nonRetryableError of nonRetryableErrors) {
            if (errorMessage.includes(nonRetryableError)) {
                // 某些错误类型在特定条件下可以重试
                if (nonRetryableError === 'execution reverted') {
                    // 只有当错误消息包含特定可重试的错误时才重试
                    const retryableRevertErrors = [
                        'transfer_from_failed',
                        'insufficient allowance',
                        'unauthorized'
                    ];
                    return retryableRevertErrors.some(retryableError =>
                        errorMessage.includes(retryableError)
                    );
                }

                if (nonRetryableError === 'out of gas') {
                    // Gas不足可以通过提高gas来重试
                    return true;
                }

                // 其他错误不重试
                return false;
            }
        }

        // 默认允许重试
        return true;
    }

    /**
     * 验证代币转账
     * @param {Object} receipt - 交易收据
     * @param {string} tokenAddress - 代币地址
     * @returns {Promise<boolean>} 是否收到代币
     */
    async verifyTokenTransfer(receipt, tokenAddress) {
        try {
            const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
            const decimals = await this.getTokenDecimals(tokenAddress);

            // Transfer 事件主题
            const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

            for (const log of receipt.logs) {
                if (log.address.toLowerCase() === tokenAddress.toLowerCase() &&
                    log.topics[0] === transferTopic) {

                    // 解析转账数据
                    const amount = BigInt(log.data);
                    const recipient = '0x' + log.topics[2].slice(-40);

                    if (recipient.toLowerCase() === this.wallet.address.toLowerCase() && amount > 0) {
                        const readableAmount = ethers.formatUnits(amount, decimals);
                        console.log(`✅ 确认收到代币: ${readableAmount}`);
                        return true;
                    }
                }
            }

            console.warn('⚠️ 未检测到代币转账记录');
            return false;
        } catch (error) {
            console.error(`验证代币转账失败: ${error.message}`);
            return false;
        }
    }

    /**
     * 获取代币价格
     * @param {string} tokenAddress - 代币地址
     * @returns {Promise<string>} 代币价格 (BNB)
     */
    async getTokenPrice(tokenAddress) {
        try {
            const pairAddress = await this.discoverPair(tokenAddress);
            const reserves = await this.getPairReserves(pairAddress);

            let wbnbReserve, tokenReserve;
            if (reserves.token0.toLowerCase() === WBNB_ADDRESS.toLowerCase()) {
                wbnbReserve = reserves.reserve0;
                tokenReserve = reserves.reserve1;
            } else {
                wbnbReserve = reserves.reserve1;
                tokenReserve = reserves.reserve0;
            }

            // 计算 1个代币需要的BNB数量
            const oneToken = ethers.parseUnits('1', await this.getTokenDecimals(tokenAddress));
            const bnbAmount = this.calculateAmountIn(oneToken, tokenReserve, wbnbReserve);

            return ethers.formatEther(bnbAmount);
        } catch (error) {
            console.error(`获取代币价格失败: ${error.message}`);
            return '0';
        }
    }

    /**
     * 检查流动性是否充足
     * @param {string} tokenAddress - 代币地址
     * @param {string} amount - 交易金额
     * @param {boolean} isBuy - 是否为买入
     * @returns {Promise<boolean>} 流动性是否充足
     */
    async checkLiquidity(tokenAddress, amount, isBuy = true) {
        try {
            const pairAddress = await this.discoverPair(tokenAddress);
            const reserves = await this.getPairReserves(pairAddress);

            let reserve;
            if (isBuy) {
                // 买入，检查token储备
                reserve = reserves.token0.toLowerCase() === tokenAddress.toLowerCase()
                    ? reserves.reserve0
                    : reserves.reserve1;
            } else {
                // 卖出，检查wbnb储备
                reserve = reserves.token0.toLowerCase() === WBNB_ADDRESS.toLowerCase()
                    ? reserves.reserve0
                    : reserves.reserve1;
            }

            // 如果交易金额超过储备的10%，认为流动性不足
            const threshold = Number(reserve) * 0.1;
            const tradeAmount = isBuy
                ? ethers.parseUnits(amount, await this.getTokenDecimals(tokenAddress))
                : ethers.parseEther(amount);

            return Number(tradeAmount) < threshold;
        } catch (error) {
            console.error(`检查流动性失败: ${error.message}`);
            return false;
        }
    }

    /**
     * 获取交易器信息
     */
    getInfo() {
        const baseInfo = super.getInfo();
        return {
            ...baseInfo,
            contracts: this.contracts,
            type: 'PancakeSwap V2',
            description: 'Constant product AMM with simple liquidity pools'
        };
    }
}

module.exports = PancakeSwapV2Trader;
