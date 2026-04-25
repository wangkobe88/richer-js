/**
 * Uniswap V2 交易器实现
 * 支持 Ethereum 链上的恒定乘积 AMM 交易
 *
 * 合约接口与 PancakeSwap V2 完全一致（同源 fork），
 * 唯一区别是合约地址和原生代币（ETH/WETH vs BNB/WBNB）。
 */

const { ethers } = require('ethers');
const BaseTrader = require('../core/BaseTrader');

// Uniswap V2 合约地址 (Ethereum Mainnet)
const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

// Uniswap V2 Router ABI
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

// Uniswap V2 Factory ABI
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

// Uniswap V2 Pair ABI
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

// ERC20 ABI
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
        "constant": false,
        "inputs": [
            {"name": "_spender", "type": "address"},
            {"name": "_addedValue", "type": "uint256"}
        ],
        "name": "increaseAllowance",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function"
    }
];

class UniswapV2Trader extends BaseTrader {
    constructor(config = {}) {
        super(config);

        // Uniswap V2 合约地址 (Ethereum Mainnet)
        this.contracts = {
            router: UNISWAP_V2_ROUTER,
            factory: UNISWAP_V2_FACTORY,
            weth: WETH_ADDRESS
        };

        // 覆盖基类的 provider 为 Ethereum RPC
        const ethRpcUrl = 'https://eth.llamarpc.com';
        this.provider = new ethers.JsonRpcProvider(ethRpcUrl);
        this.wallet = null;

        // 初始化合约实例（使用 ETH provider）
        this.initContracts();

        // 交易配置
        this.defaultGasLimit = config.gasLimit || 300000;
        this.defaultSlippage = config.slippage || 0.01; // 1%
        this.maxSlippage = config.maxSlippage || 0.05; // 5%
        this.defaultDeadline = config.deadline || 300; // 5分钟

        // 本地缓存
        this.pairCache = new Map();
        this.tokenInfoCache = new Map();

        console.log('🦄 Uniswap V2 交易器初始化完成 (Ethereum Mainnet)');
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
        if (this.pairCache.has(tokenAddress)) {
            return this.pairCache.get(tokenAddress);
        }

        try {
            const pairAddress = await this.factoryContract.getPair(tokenAddress, WETH_ADDRESS);

            if (pairAddress === ethers.ZeroAddress) {
                throw new Error(`未找到代币 ${tokenAddress} 与 WETH 的交易对`);
            }

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
                token0,
                token1,
                pairContract
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
        if (this.tokenInfoCache.has(tokenAddress)) {
            return this.tokenInfoCache.get(tokenAddress).decimals;
        }

        try {
            const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
            const decimals = await tokenContract.decimals();
            this.tokenInfoCache.set(tokenAddress, { decimals });
            return decimals;
        } catch (error) {
            console.warn(`获取代币精度失败，使用默认值 18: ${error.message}`);
            return 18;
        }
    }

    /**
     * 计算输出量 (V2 恒定乘积公式, 0.3% 手续费)
     */
    calculateAmountOut(amountIn, reserveIn, reserveOut) {
        const amountInWithFee = BigInt(amountIn) * 997n;
        const numerator = amountInWithFee * BigInt(reserveOut);
        const denominator = (BigInt(reserveIn) * 1000n) + amountInWithFee;
        return numerator / denominator;
    }

    /**
     * 计算输入量
     */
    calculateAmountIn(amountOut, reserveIn, reserveOut) {
        const numerator = BigInt(reserveIn) * BigInt(amountOut) * 1000n;
        const denominator = BigInt(reserveOut - amountOut) * 997n;
        return numerator / denominator + 1n;
    }

    /**
     * 获取当前原生代币余额
     * @returns {Promise<string>} ETH 余额
     */
    async getNativeBalance() {
        return await super.getNativeBalance();
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

            let wethReserve, tokenReserve;
            if (reserves.token0.toLowerCase() === this.contracts.weth.toLowerCase()) {
                wethReserve = reserves.reserve0;
                tokenReserve = reserves.reserve1;
            } else {
                wethReserve = reserves.reserve1;
                tokenReserve = reserves.reserve0;
            }

            const totalLiquidity = parseFloat(ethers.formatEther(wethReserve)) * 2;

            return {
                address: pairAddress,
                token0: reserves.token0,
                token1: reserves.token1,
                ethReserve: wethReserve.toString(),
                tokenReserve: tokenReserve.toString(),
                totalLiquidity,
                isActive: wethReserve > 0 && tokenReserve > 0,
                fee: '3000' // 0.3%
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
            const allowance = await tokenContract.allowance(this.wallet.address, UNISWAP_V2_ROUTER);
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

            const estimatedGasLimit = await this._safeEstimateGas({
                to: tokenAddress,
                from: this.wallet.address,
                data: tokenContract.interface.encodeFunctionData("approve", [
                    UNISWAP_V2_ROUTER,
                    approveAmount
                ])
            });
            const bufferedGasLimit = (estimatedGasLimit * 120n) / 100n;

            console.log(`🔐 授权交易详情:`);
            console.log(`  from: ${this.wallet.address}`);
            console.log(`  to: ${tokenAddress}`);
            console.log(`  spender: ${UNISWAP_V2_ROUTER}`);

            const signedTx = await this.wallet.sendTransaction({
                to: tokenAddress,
                data: tokenContract.interface.encodeFunctionData("approve", [
                    UNISWAP_V2_ROUTER,
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

            const bufferAmount = (amountBigInt * 110n) / 100n;
            if (BigInt(currentAllowance) >= bufferAmount) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                const finalAllowance = await this.checkAllowance(tokenAddress);
                if (BigInt(finalAllowance) >= bufferAmount) {
                    return true;
                }
            }

            const result = await this.approveToken(tokenAddress, ethers.MaxUint256);

            if (result.success) {
                await new Promise(resolve => setTimeout(resolve, 3000));

                for (let i = 0; i < 10; i++) {
                    const newAllowance = await this.checkAllowance(tokenAddress);
                    if (BigInt(newAllowance) > 0n && BigInt(newAllowance) >= amountBigInt) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        const finalConfirmAllowance = await this.checkAllowance(tokenAddress);
                        if (BigInt(finalConfirmAllowance) >= amountBigInt) {
                            return true;
                        }
                    }
                    if (i < 9) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }

                console.error('❌ 授权验证失败：多次检查后额度仍不足');
                return false;
            }
            return false;
        } catch (error) {
            console.error(`确保授权失败: ${error.message}`);
            return false;
        }
    }

    /**
     * 安全的Gas估算方法
     */
    async _safeEstimateGas(tx) {
        let lastError;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const gasEstimate = await this.provider.estimateGas(tx);

                if (typeof gasEstimate === 'bigint') {
                    return gasEstimate;
                } else if (gasEstimate && typeof gasEstimate === 'object') {
                    let result;
                    if (gasEstimate.gasLimit) {
                        result = BigInt(gasEstimate.gasLimit);
                    } else if (gasEstimate.toString && typeof gasEstimate.toString === 'function') {
                        result = BigInt(gasEstimate.toString());
                    } else {
                        for (const key of ['gas', 'gasUsed', 'limit']) {
                            if (gasEstimate[key]) {
                                result = BigInt(gasEstimate[key]);
                                break;
                            }
                        }
                    }
                    if (!result) {
                        throw new Error(`无法处理的Gas估算对象: ${gasEstimate.toString()}`);
                    }
                    return result;
                } else {
                    return BigInt(gasEstimate);
                }
            } catch (error) {
                lastError = error;
                console.warn(`⚠️ Gas估算尝试 #${attempt} 失败: ${error.message}`);
                if (attempt < 3) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }

        const errorMessage = lastError.message.toLowerCase();
        if (errorMessage.includes('transfer_from_failed') ||
            errorMessage.includes('insufficient allowance') ||
            errorMessage.includes('unauthorized')) {
            throw new Error(`Gas估算失败 - 授权问题: ${lastError.message}`);
        }
        if (errorMessage.includes('execution reverted') ||
            errorMessage.includes('revert')) {
            throw new Error(`Gas估算失败 - 交易执行错误: ${lastError.message}`);
        }

        console.warn('⚠️ Gas估算失败，使用保守默认值');
        return BigInt(this.defaultGasLimit || 500000);
    }

    /**
     * 获取最优 Gas 价格
     * @returns {Promise<bigint>} Gas 价格
     */
    async getOptimalGasPrice() {
        try {
            const gasPrice = await this.provider.getFeeData();
            return gasPrice.gasPrice;
        } catch (error) {
            console.warn(`获取 Gas 价格失败，使用默认值: ${error.message}`);
            return ethers.parseUnits('20', 'gwei'); // ETH 链默认 20 gwei
        }
    }

    /**
     * 买入代币 (ETH → Token)
     * @param {string} tokenAddress - 代币地址
     * @param {string} ethAmount - ETH 数量
     * @param {Object} options - 选项参数
     * @returns {Promise<Object>} 交易结果
     */
    async buyToken(tokenAddress, ethAmount, options = {}) {
        if (!this.wallet) {
            throw new Error('钱包未设置');
        }

        const { maxRetries = 3 } = options;
        return await this._executeWithRetry(
            async () => await this._buyTokenInternal(tokenAddress, ethAmount, options),
            maxRetries,
            'buyToken'
        );
    }

    /**
     * 内部买入代币实现
     */
    async _buyTokenInternal(tokenAddress, ethAmount, options = {}) {
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
            console.log(`💰 ETH 数量: ${ethAmount}`);

            // 1. 发现交易对
            const pairAddress = await this.discoverPair(tokenAddress);
            const reserves = await this.getPairReserves(pairAddress);

            // 2. 确定输入输出储备
            let wethReserve, tokenReserve;
            if (reserves.token0.toLowerCase() === WETH_ADDRESS.toLowerCase()) {
                wethReserve = reserves.reserve0;
                tokenReserve = reserves.reserve1;
            } else {
                wethReserve = reserves.reserve1;
                tokenReserve = reserves.reserve0;
            }

            // 3. 计算预期输出
            const amountIn = ethers.parseEther(ethAmount);
            const expectedOut = this.calculateAmountOut(amountIn, wethReserve, tokenReserve);
            const slippageBps = Math.floor((1 - slippage) * 10000);
            const amountOutMin = (expectedOut * BigInt(slippageBps)) / 10000n;

            const tokenDecimals = await this.getTokenDecimals(tokenAddress);
            console.log(`📊 预期输出: ${ethers.formatUnits(expectedOut, tokenDecimals)} tokens`);
            console.log(`📉 最小输出: ${ethers.formatUnits(amountOutMin, tokenDecimals)} tokens`);

            // 4. 构建交易
            const path = [WETH_ADDRESS, tokenAddress];
            const deadlineNumber = typeof deadline === 'bigint' ? Number(deadline) : deadline;
            const deadlineTimestamp = Math.floor(Date.now() / 1000) + deadlineNumber;

            // 5. 发送交易
            const txData = this.routerContract.interface.encodeFunctionData("swapExactETHForTokens", [
                amountOutMin,
                path,
                this.wallet.address,
                deadlineTimestamp
            ]);

            const estimatedGasLimit = await this._safeEstimateGas({
                to: UNISWAP_V2_ROUTER,
                data: txData,
                value: amountIn
            });

            const gasPrice = await this.getOptimalGasPrice();
            const bufferedGasLimit = (estimatedGasLimit * 120n) / 100n;

            const signedTx = await this.wallet.sendTransaction({
                to: UNISWAP_V2_ROUTER,
                data: txData,
                value: amountIn,
                gasLimit: bufferedGasLimit,
                gasPrice
            });

            console.log(`📤 交易已发送: ${signedTx.hash}`);
            const receipt = await signedTx.wait();

            if (receipt.status === 1) {
                console.log(`✅ 交易成功! Gas 使用: ${receipt.gasUsed}`);
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
     * 卖出代币 (Token → ETH)
     * @param {string} tokenAddress - 代币地址
     * @param {string|bigint} tokenAmount - 代币数量
     * @param {Object} options - 选项参数
     * @returns {Promise<Object>} 交易结果
     */
    async sellToken(tokenAddress, tokenAmount, options = {}) {
        if (!this.wallet) {
            throw new Error('钱包未设置');
        }

        const { maxRetries = 3 } = options;
        return await this._executeWithRetry(
            async () => await this._sellTokenInternal(tokenAddress, tokenAmount, options),
            maxRetries,
            'sellToken'
        );
    }

    /**
     * 内部卖出代币实现
     */
    async _sellTokenInternal(tokenAddress, tokenAmount, options = {}) {
        if (!this.wallet) {
            throw new Error('钱包未设置');
        }

        const {
            slippage = this.defaultSlippage,
            deadline = this.defaultDeadline
        } = options;

        console.log(`💰 开始卖出代币: ${tokenAddress}`);
        console.log(`🪙 代币数量: ${tokenAmount}`);

        // 转换 tokenAmount 为字符串格式
        let tokenAmountStr = tokenAmount;
        if (typeof tokenAmount === 'bigint') {
            tokenAmountStr = tokenAmount.toString();
        }

        // 1. 获取代币精度
        const decimals = await this.getTokenDecimals(tokenAddress);
        let amountIn = ethers.parseUnits(tokenAmountStr, decimals);

        // 2. 检查代币余额
        const tokenBalance = await this.getTokenBalance(tokenAddress);
        const tokenBalanceBigInt = ethers.parseUnits(tokenBalance || '0', decimals);

        const difference = amountIn - tokenBalanceBigInt;
        if (difference > 1n) {
            const adjustedAmount = tokenBalanceBigInt > 1000n ? tokenBalanceBigInt - 1000n : tokenBalanceBigInt;
            if (adjustedAmount > 0n) {
                amountIn = adjustedAmount;
            } else {
                throw new Error(`代币余额严重不足: 实际 ${tokenBalance}`);
            }
        }

        // 3. 检查 ETH 余额用于 Gas
        const ethBalance = await this.getNativeBalance();
        const minEthForGas = ethers.parseEther('0.001');
        if (ethers.parseEther(ethBalance || '0') < minEthForGas) {
            throw new Error(`ETH余额不足以支付Gas: 当前 ${ethBalance}`);
        }

        // 4. 确保授权
        const allowanceOk = await this.ensureAllowance(tokenAddress, amountIn);
        if (!allowanceOk) {
            throw new Error('代币授权失败');
        }

        // 5. 发现交易对
        const pairAddress = await this.discoverPair(tokenAddress);
        const reserves = await this.getPairReserves(pairAddress);

        // 6. 确定输入输出储备
        let tokenReserve, wethReserve;
        if (reserves.token0.toLowerCase() === tokenAddress.toLowerCase()) {
            tokenReserve = reserves.reserve0;
            wethReserve = reserves.reserve1;
        } else {
            tokenReserve = reserves.reserve1;
            wethReserve = reserves.reserve0;
        }

        // 7. 计算预期输出
        const expectedOut = this.calculateAmountOut(amountIn, tokenReserve, wethReserve);
        const slippageBps = Math.floor((1 - slippage) * 10000);
        const amountOutMin = (expectedOut * BigInt(slippageBps)) / 10000n;

        console.log(`📊 预期 ETH 输出: ${ethers.formatEther(expectedOut)}`);
        console.log(`📉 最小 ETH 输出: ${ethers.formatEther(amountOutMin)}`);

        // 8. 构建交易
        const path = [tokenAddress, WETH_ADDRESS];
        const deadlineNumber = typeof deadline === 'bigint' ? Number(deadline) : deadline;
        const deadlineTimestamp = Math.floor(Date.now() / 1000) + deadlineNumber;

        // 9. 发送交易
        const swapData = this.routerContract.interface.encodeFunctionData("swapExactTokensForETH", [
            amountIn,
            amountOutMin,
            path,
            this.wallet.address,
            deadlineTimestamp
        ]);

        const estimatedGasLimit = await this._safeEstimateGas({
            to: UNISWAP_V2_ROUTER,
            from: this.wallet.address,
            data: swapData
        });
        const gasPrice = await this.getOptimalGasPrice();
        const bufferedGasLimit = (estimatedGasLimit * 120n) / 100n;

        const signedTx = await this.wallet.sendTransaction({
            to: UNISWAP_V2_ROUTER,
            data: swapData,
            gasLimit: bufferedGasLimit,
            gasPrice
        });

        console.log(`📤 交易已发送: ${signedTx.hash}`);
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
     * 验证代币转账
     */
    async verifyTokenTransfer(receipt, tokenAddress) {
        try {
            const decimals = await this.getTokenDecimals(tokenAddress);
            const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

            for (const log of receipt.logs) {
                if (log.address.toLowerCase() === tokenAddress.toLowerCase() &&
                    log.topics[0] === transferTopic) {
                    const amount = BigInt(log.data);
                    const recipient = '0x' + log.topics[2].slice(-40);
                    if (recipient.toLowerCase() === this.wallet.address.toLowerCase() && amount > 0n) {
                        console.log(`✅ 确认收到代币: ${ethers.formatUnits(amount, decimals)}`);
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
     * @returns {Promise<string>} 代币价格 (ETH)
     */
    async getTokenPrice(tokenAddress) {
        try {
            const pairAddress = await this.discoverPair(tokenAddress);
            const reserves = await this.getPairReserves(pairAddress);

            let wethReserve, tokenReserve;
            if (reserves.token0.toLowerCase() === WETH_ADDRESS.toLowerCase()) {
                wethReserve = reserves.reserve0;
                tokenReserve = reserves.reserve1;
            } else {
                wethReserve = reserves.reserve1;
                tokenReserve = reserves.reserve0;
            }

            const oneToken = ethers.parseUnits('1', await this.getTokenDecimals(tokenAddress));
            const ethAmount = this.calculateAmountIn(oneToken, tokenReserve, wethReserve);

            return ethers.formatEther(ethAmount);
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
                reserve = reserves.token0.toLowerCase() === tokenAddress.toLowerCase()
                    ? reserves.reserve0
                    : reserves.reserve1;
            } else {
                reserve = reserves.token0.toLowerCase() === WETH_ADDRESS.toLowerCase()
                    ? reserves.reserve0
                    : reserves.reserve1;
            }

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
     * 带重试机制的执行器
     */
    async _executeWithRetry(operation, maxRetries = 3, operationName = 'operation') {
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const result = await operation();
                if (attempt > 1) {
                    console.log(`✅ ${operationName} 重试成功! (尝试 #${attempt})`);
                }
                return result;
            } catch (error) {
                lastError = error;
                console.error(`❌ ${operationName} 尝试 #${attempt} 失败: ${error.message}`);

                const errorMessage = error.message.toLowerCase();
                const shouldRetry = this._shouldRetryError(errorMessage);

                if (!shouldRetry) {
                    break;
                }

                if (attempt < maxRetries) {
                    const waitTime = attempt * 3000;
                    console.log(`⏳ 等待 ${waitTime/1000} 秒后重试...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
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
     */
    _shouldRetryError(errorMessage) {
        const nonRetryableErrors = [
            'insufficient balance',
            'invalid address',
            'invalid signature',
            'nonce too low',
            'nonce too high',
            'underflow',
            'overflow',
            'division by zero',
            'invalid jump',
            'stack too deep'
        ];

        for (const nonRetryableError of nonRetryableErrors) {
            if (errorMessage.includes(nonRetryableError)) {
                return false;
            }
        }

        return true;
    }

    /**
     * 获取交易器信息
     */
    getInfo() {
        const baseInfo = super.getInfo();
        return {
            ...baseInfo,
            contracts: this.contracts,
            type: 'Uniswap V2',
            description: 'Ethereum mainnet constant product AMM'
        };
    }
}

module.exports = UniswapV2Trader;
