/**
 * FourMeme 平台交易器
 * 基于 0x0240f3d2 方法签名的直接购买实现
 */

const { ethers } = require('ethers');
const BaseTrader = require('../core/BaseTrader');

class FourMemeDirectTrader extends BaseTrader {
    constructor(config = {}) {
        super({
            name: 'FourMeme TokenManager2',
            type: 'fourmeme-tm2',
            description: 'FourMeme TokenManager2 V2 - 支持通过 BNB 购买和卖出代币',
            riskLevel: 3, // 高风险
            ...config
        });

        // FourMeme 平台配置
        this.fourMemeConfig = {
            // TokenManager1 (V1) 合约地址 - 2024年9月5日之前创建的代币
            v1PlatformAddress: '0xEC4549caDcE5DA21Df6E6422d448034B5233bFbC',
            // TokenManager2 (V2) 合约地址 - 2024年9月5日之后创建的代币
            v2PlatformAddress: '0x5c952063c7fc8610FFDB798152D69F0B9550762b',
            // TokenManagerHelper3 (V3) 合约地址 - 用于查询代币信息
            helperAddress: '0xF251F83e40a78868FcfA3FA4599Dad6494E46034',
            wbnbAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
            // 方法签名
            v1PurchaseMethodId: '0x0240f3d2', // purchase 方法签名 (V1)
            v2PurchaseMethodId: '0x0da74935', // buyToken 方法签名 (V2)
            // Gas 配置
            gasLimit: 300000, // 根据实际交易记录调整
            gasPrice: ethers.parseUnits('10', 'gwei') // 根据实际交易记录调整
        };

        // 当前使用的平台地址（将通过查询确定）
        this.currentPlatformAddress = null;
        this.currentVersion = null;

        // TokenManager1 (V1) 官方 ABI (从 fourmeme_files/TokenManager.lite.abi)
        this.v1PlatformAbi = [
            // 购买函数 (V1)
            'function purchaseToken(address token, uint256 amount, uint256 maxFunds) external payable',
            'function purchaseToken(uint256 origin, address token, address to, uint256 amount, uint256 maxFunds) external payable',
            'function purchaseToken(uint256 origin, address token, uint256 amount, uint256 maxFunds) external payable',
            'function purchaseTokenAMAP(address token, uint256 funds, uint256 minAmount) external payable',
            'function purchaseTokenAMAP(uint256 origin, address token, uint256 funds, uint256 minAmount) external payable',
            'function purchaseTokenAMAP(uint256 origin, address token, address to, uint256 funds, uint256 minAmount) external payable',
            // 卖出函数 (V1)
            'function saleToken(address token, uint256 amount) external',
            'function saleToken(uint256 origin, address token, uint256 amount) external',
            // 查询函数
            'function lastPrice(address tokenAddress) view returns (uint256)',
            'function _tokenInfos(address) view returns (bool initialized, uint256 launchTime, uint256 K, uint256 T, uint256 offers, uint256 ethers, bool tradeEnable, bool liquidityAdded, bool tradingHalt)',
            // 状态查询
            'function _tradingHalt() view returns (bool)',
            'function _minTradeFee() view returns (uint256)',
            'function _tradeFeeRate() view returns (uint256)',
            // 常量
            'function STATUS_COMPLETED() view returns (uint256)',
            'function STATUS_TRADING() view returns (uint256)',
            'function STATUS_HALT() view returns (uint256)',
            'function STATUS_ADDING_LIQUIDITY() view returns (uint256)'
        ];

        // TokenManager2 官方 ABI (从 fourmeme_files/TokenManager2.lite.abi)
        this.v2PlatformAbi = [
            // 购买函数
            'function buyToken(address token, uint256 amount, uint256 maxFunds) external payable',
            'function buyToken(address token, address to, uint256 amount, uint256 maxFunds) external payable',
            'function buyToken(uint256 origin, address token, address to, uint256 amount, uint256 maxFunds) external payable',
            'function buyTokenAMAP(address token, uint256 funds, uint256 minAmount) external payable',
            'function buyTokenAMAP(address token, address to, uint256 funds, uint256 minAmount) external payable',
            'function buyTokenAMAP(uint256 origin, address token, uint256 funds, uint256 minAmount) external payable',
            // 卖出函数
            'function sellToken(address token, uint256 amount) external',
            'function sellToken(uint256 origin, address token, uint256 amount, uint256 minFunds, uint256 feeRate, address feeRecipient) external',
            'function sellToken(uint256 origin, address token, address from, uint256 amount, uint256 minFunds, uint256 feeRate, address feeRecipient) external',
            'function sellToken(address token, uint256 amount, uint256 minFunds, uint256 feeRate, address feeRecipient) external',
            'function sellToken(uint256 origin, address token, address from, uint256 amount, uint256 minFunds, uint256 feeRate, address feeRecipient) external',
            // 查询函数 (移除 struct 语法，因为这些函数在 ethers.js 中需要不同的处理)
            // 'function calcBuyAmount(struct TokenManager3.TokenInfo ti, uint256 funds) pure returns (uint256)',
            // 'function calcBuyCost(struct TokenManager3.TokenInfo ti, uint256 amount) pure returns (uint256)',
            // 'function calcSellCost(struct TokenManager3.TokenInfo ti, uint256 amount) pure returns (uint256)',
            'function calcInitialPrice(uint256 maxRaising, uint256 totalSupply, uint256 offers, uint256 reserves) pure returns (uint256)',
            'function lastPrice(address tokenAddress) view returns (uint256)',
            // 状态查询
            'function _tokenInfos(address) view returns (address base, address quote, uint256 template, uint256 totalSupply, uint256 maxOffers, uint256 maxRaising, uint256 launchTime, uint256 offers, uint256 funds, uint256 lastPrice, uint256 K, uint256 T, uint256 status)',
            'function _tradingFeeRate() view returns (uint256)',
            'function _minTradeFee() view returns (uint256)',
            // 常量
            'function STATUS_COMPLETED() view returns (uint256)',
            'function STATUS_TRADING() view returns (uint256)',
            'function STATUS_HALT() view returns (uint256)',
            'function STATUS_ADDING_LIQUIDITY() view returns (uint256)'
        ];

        // TokenManagerHelper3 ABI (从 fourmeme_files/TokenManagerHelper3.abi)
        this.helperAbi = [
            // 代币信息查询
            'function getTokenInfo(address token) view returns (uint256 version, address tokenManager, address quote, uint256 lastPrice, uint256 tradingFeeRate, uint256 minTradingFee, uint256 launchTime, uint256 offers, uint256 maxOffers, uint256 funds, uint256 maxFunds, bool liquidityAdded)',
            // 交易预估
            'function tryBuy(address token, uint256 amount, uint256 funds) view returns (address tokenManager, address quote, uint256 estimatedAmount, uint256 estimatedCost, uint256 estimatedFee, uint256 amountMsgValue, uint256 amountApproval, uint256 amountFunds)',
            'function trySell(address token, uint256 amount) view returns (address tokenManager, address quote, uint256 funds, uint256 fee)',
            // 交易计算
            'function calcTokenIn(address token, uint256 amountEth) returns (uint256)',
            'function calcTokenOut(address token, uint256 amountEth) returns (uint256)',
            'function calcEthIn(address token, uint256 amount) returns (uint256)',
            'function calcEthOut(address token, uint256 amount) returns (uint256)',
            // 特殊交易 (仅适用于 ERC20/ERC20 交易对)
            'function buyWithEth(uint256 origin, address token, address to, uint256 funds, uint256 minAmount) payable',
            'function sellForEth(uint256 origin, address token, uint256 amount, uint256 minFunds, uint256 feeRate, address feeRecipient) external',
            'function sellForEth(uint256 origin, address token, address from, uint256 amount, uint256 minFunds, uint256 feeRate, address feeRecipient) external',
            'function sellForEth(uint256 origin, address token, address from, address to, uint256 amount, uint256 minFunds) external',
            // Pancake 相关
            'function getPancakePair(address token) view returns (address)',
            // 常量
            'function WETH() view returns (address)',
            'function PANCAKE_FACTORY() view returns (address)',
            'function PANCAKE_V3_FACTORY() view returns (address)',
            'function TOKEN_MANAGER() view returns (address)',
            'function TOKEN_MANAGER_2() view returns (address)',
            'function TOKEN_SWAP() view returns (address)',
            'function WHITE_LIST() view returns (address)',
            'function DEFAULT_ADMIN_ROLE() view returns (bytes32)'
        ];

        // ERC20 ABI（用于代币操作）
        this.erc20Abi = [
            'function balanceOf(address) view returns (uint256)',
            'function transfer(address to, uint256 amount) returns (bool)',
            'function approve(address spender, uint256 amount) returns (bool)',
            'function name() view returns (string)',
            'function symbol() view returns (string)',
            'function decimals() view returns (uint8)',
            'function totalSupply() view returns (uint256)'
        ];
    }

    /**
     * 日志输出方法
     */
    log(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️';
        console.log(`[${timestamp}] ${prefix} ${message}`);
    }

    /**
     * 验证交易器配置
     */
    async validate() {
        try {
            if (!this.config.network?.rpcUrl) {
                throw new Error('网络 RPC URL 未配置');
            }

            // 测试网络连接
            const provider = new ethers.JsonRpcProvider(this.config.network.rpcUrl);
            const network = await provider.getNetwork();

            if (Number(network.chainId) !== 56) {
                throw new Error(`网络不匹配，期望 BSC (56)，实际 (${network.chainId})`);
            }

            return { valid: true, network: network.name };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    }

    /**
     * 准备交易器
     */
    async prepare(wallet) {
        try {
            this.provider = wallet.provider || new ethers.JsonRpcProvider(this.config.network.rpcUrl);
            this.wallet = wallet;

            // 创建 TokenManagerHelper3 合约实例（用于查询代币信息）
            this.helperContract = new ethers.Contract(
                this.fourMemeConfig.helperAddress,
                this.helperAbi,
                this.provider
            );

            // 验证 helper 合约是否存在
            const helperCode = await this.provider.getCode(this.fourMemeConfig.helperAddress);
            if (helperCode === '0x') {
                throw new Error(`FourMeme TokenManagerHelper3 合约不存在于地址: ${this.fourMemeConfig.helperAddress}`);
            }

            // 验证两个平台合约是否存在
            const [v1Code, v2Code] = await Promise.all([
                this.provider.getCode(this.fourMemeConfig.v1PlatformAddress),
                this.provider.getCode(this.fourMemeConfig.v2PlatformAddress)
            ]);

            if (v1Code === '0x') {
                this.log(`⚠️ FourMeme TokenManager1 合约不存在: ${this.fourMemeConfig.v1PlatformAddress}`, 'warning');
            }

            if (v2Code === '0x') {
                this.log(`⚠️ FourMeme TokenManager2 合约不存在: ${this.fourMemeConfig.v2PlatformAddress}`, 'warning');
            }

            this.log('✅ FourMeme 合约连接成功');
            this.log(`   TokenManagerHelper3: ${this.fourMemeConfig.helperAddress}`);
            this.log(`   TokenManager1: ${this.fourMemeConfig.v1PlatformAddress}`);
            this.log(`   TokenManager2: ${this.fourMemeConfig.v2PlatformAddress}`);

            return { success: true, message: 'FourMeme Direct Trader 准备完成' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * 设置钱包（重写BaseTrader方法）
     * @param {string} privateKey - 钱包私钥
     */
    async setWallet(privateKey) {
        try {
            // 调用父类的setWallet方法
            await super.setWallet(privateKey);

            // 调用prepare方法初始化合约
            const prepareResult = await this.prepare(this.wallet);
            if (!prepareResult.success) {
                throw new Error(`Failed to prepare trader: ${prepareResult.error}`);
            }

            this.log('✅ FourMemeDirectTrader 钱包和合约初始化完成');
        } catch (error) {
            throw new Error(`Failed to set wallet: ${error.message}`);
        }
    }

    /**
     * 获取池信息（使用 TokenManagerHelper3 查询代币信息）
     */
    async getPoolInfo(tokenAddress) {
        try {
            const tokenContract = new ethers.Contract(tokenAddress, this.erc20Abi, this.provider);

            let name, symbol, decimals, totalSupply;
            let tokenInfo = null;
            let isSupported = false;

            // 尝试获取代币基本信息，如果失败则使用默认值
            try {
                [name, symbol, decimals, totalSupply] = await Promise.all([
                    tokenContract.name(),
                    tokenContract.symbol(),
                    tokenContract.decimals(),
                    tokenContract.totalSupply()
                ]);
            } catch (error) {
                this.log(`代币基本信息获取失败: ${error.message}`, 'warning');
                // 使用默认值
                name = 'Unknown Token';
                symbol = 'UNKNOWN';
                decimals = 18;
                totalSupply = '0';
            }

            // 使用 TokenManagerHelper3 查询代币信息
            try {
                const tokenInfoResult = await this.helperContract.getTokenInfo(tokenAddress);
                tokenInfo = {
                    version: tokenInfoResult.version.toString(),
                    tokenManager: tokenInfoResult.tokenManager,
                    quote: tokenInfoResult.quote,
                    lastPrice: tokenInfoResult.lastPrice.toString(),
                    tradingFeeRate: tokenInfoResult.tradingFeeRate.toString(),
                    minTradingFee: tokenInfoResult.minTradingFee.toString(),
                    launchTime: tokenInfoResult.launchTime.toString(),
                    offers: tokenInfoResult.offers.toString(),
                    maxOffers: tokenInfoResult.maxOffers.toString(),
                    funds: tokenInfoResult.funds.toString(),
                    maxFunds: tokenInfoResult.maxFunds.toString(),
                    liquidityAdded: tokenInfoResult.liquidityAdded
                };

                // 检查代币属于哪个版本的 TokenManager
                if (tokenInfo.tokenManager === ethers.ZeroAddress) {
                    // 如果返回零地址，说明代币不存在或未在 FourMeme 平台注册
                    this.log(`代币未在 FourMeme 平台注册`, 'warning');
                    isSupported = false;
                } else {
                    // 检查是否匹配 V1 或 V2
                    isSupported = tokenInfo.tokenManager.toLowerCase() === this.fourMemeConfig.v1PlatformAddress.toLowerCase() ||
                              tokenInfo.tokenManager.toLowerCase() === this.fourMemeConfig.v2PlatformAddress.toLowerCase();

                    if (isSupported) {
                        // 设置当前使用的平台地址和版本
                        if (tokenInfo.tokenManager.toLowerCase() === this.fourMemeConfig.v1PlatformAddress.toLowerCase()) {
                            this.currentPlatformAddress = this.fourMemeConfig.v1PlatformAddress;
                            this.currentVersion = 1;
                            this.log(`✅ 检测到 TokenManager V1 合约`);
                        } else {
                            this.currentPlatformAddress = this.fourMemeConfig.v2PlatformAddress;
                            this.currentVersion = 2;
                            this.log(`✅ 检测到 TokenManager V2 合约`);
                        }
                    }
                }

                this.log(`代币信息查询成功:`);
                this.log(`   代币名称: ${name} (${symbol})`);
                this.log(`   版本: ${tokenInfo.version}`);
                this.log(`   TokenManager: ${tokenInfo.tokenManager}`);
                this.log(`   报价代币: ${tokenInfo.quote === '0x0000000000000000000000000000000000000000' ? 'BNB' : tokenInfo.quote}`);
                this.log(`   最后价格: ${ethers.formatEther(tokenInfo.lastPrice)} BNB`);
                this.log(`   交易费率: ${Number(tokenInfo.tradingFeeRate) / 10000}%`);
                this.log(`   是否支持: ${isSupported ? '✅' : '❌'}`);

            } catch (error) {
                this.log(`TokenManagerHelper3 查询失败: ${error.message}`, 'warning');

                // 如果 helper 查询失败，尝试直接查询两个版本的合约
                let foundVersion = null;

                // 尝试 TokenManager1 (V1)
                try {
                    this.v1PlatformContract = new ethers.Contract(
                        this.fourMemeConfig.v1PlatformAddress,
                        this.v1PlatformAbi,
                        this.wallet
                    );

                    const v1Price = await this.v1PlatformContract.lastPrice(tokenAddress);
                    if (v1Price > 0) {
                        tokenInfo = {
                            lastPrice: v1Price.toString(),
                            version: '1',
                            tokenManager: this.fourMemeConfig.v1PlatformAddress,
                            quote: '0x0000000000000000000000000000000000000000'
                        };
                        foundVersion = 1;
                        isSupported = true;
                        this.currentPlatformAddress = this.fourMemeConfig.v1PlatformAddress;
                        this.currentVersion = 1;
                        this.log(`✅ 找到 TokenManager V1 合约中的代币信息`);
                        this.log(`   最后价格: ${ethers.formatEther(v1Price)} BNB`);
                    }
                } catch (v1Error) {
                    this.log(`TokenManager1 查询失败: ${v1Error.message}`, 'warning');
                }

                // 如果 V1 没找到，尝试 TokenManager2 (V2)
                if (!foundVersion) {
                    try {
                        this.v2PlatformContract = new ethers.Contract(
                            this.fourMemeConfig.v2PlatformAddress,
                            this.v2PlatformAbi,
                            this.wallet
                        );

                        const v2Price = await this.v2PlatformContract.lastPrice(tokenAddress);
                        if (v2Price > 0) {
                            tokenInfo = {
                                lastPrice: v2Price.toString(),
                                version: '2',
                                tokenManager: this.fourMemeConfig.v2PlatformAddress,
                                quote: '0x0000000000000000000000000000000000000000'
                            };
                            foundVersion = 2;
                            isSupported = true;
                            this.currentPlatformAddress = this.fourMemeConfig.v2PlatformAddress;
                            this.currentVersion = 2;
                            this.log(`✅ 找到 TokenManager V2 合约中的代币信息`);
                            this.log(`   最后价格: ${ethers.formatEther(v2Price)} BNB`);
                        }
                    } catch (v2Error) {
                        this.log(`TokenManager2 查询失败: ${v2Error.message}`, 'warning');
                        isSupported = false;
                    }
                }

                if (!foundVersion) {
                    this.log(`⚠️ 该代币不在任何 FourMeme TokenManager 合约中`, 'warning');
                    isSupported = false;
                }
            }

            return {
                success: true,
                token: {
                    address: tokenAddress,
                    name,
                    symbol,
                    decimals: Number(decimals),
                    totalSupply: totalSupply.toString(),
                    isSupported,
                    tokenInfo
                },
                platform: 'FourMeme TokenManager2',
                type: 'bonding_curve' // FourMeme 使用联合曲线
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取流动性（对于 FourMeme 是检查代币是否可交易）
     */
    async getLiquidity(tokenAddress) {
        try {
            // 尝试获取代币价格来验证流动性
            const priceCheck = await this.platformContract.getTokenPrice(tokenAddress);
            return {
                success: true,
                liquidity: priceCheck.toString(),
                hasLiquidity: priceCheck > 0,
                type: 'bonding_curve'
            };
        } catch (error) {
            // 如果无法获取价格，可能不支持该代币
            return {
                success: false,
                error: `无法获取代币流动性: ${error.message}`,
                hasLiquidity: false
            };
        }
    }

    /**
     * 获取价格报价（使用 TokenManagerHelper3）
     */
    async quotePrice(tokenAddress, amountIn) {
        try {
            // 使用 TokenManagerHelper3 的 tryBuy 函数进行精确预估
            const quoteResult = await this.helperContract.tryBuy(tokenAddress, 0, amountIn);

            // 动态确定使用的 TokenManager
            const actualTokenManager = quoteResult.tokenManager;
            this.log(`检测到 TokenManager: ${actualTokenManager}`);

            // 验证是否是支持的 TokenManager
            const supportedManagers = [this.fourMemeConfig.v1PlatformAddress, this.fourMemeConfig.v2PlatformAddress];
            if (!supportedManagers.includes(actualTokenManager)) {
                throw new Error(`不支持的 TokenManager: ${actualTokenManager}`);
            }

            // 更新当前使用的平台地址
            this.currentPlatformAddress = actualTokenManager;

            const estimatedAmount = quoteResult.estimatedAmount;
            const estimatedCost = quoteResult.estimatedCost;
            const estimatedFee = quoteResult.estimatedFee;
            const amountMsgValue = quoteResult.amountMsgValue;

            this.log(`价格报价成功:`);
            this.log(`   输入 BNB: ${ethers.formatEther(amountIn)} BNB`);
            this.log(`   预估代币: ${ethers.formatUnits(estimatedAmount, 18)} tokens`);
            this.log(`   预估成本: ${ethers.formatEther(estimatedCost)} BNB`);
            this.log(`   预估费用: ${ethers.formatEther(estimatedFee)} BNB`);
            this.log(`   实际需发送: ${ethers.formatEther(amountMsgValue)} BNB`);

            const price = Number(estimatedCost) / Number(estimatedAmount);

            return {
                success: true,
                amountOut: estimatedAmount,
                price,
                estimatedCost,
                estimatedFee,
                amountMsgValue,
                quote: quoteResult.quote,
                route: {
                    protocol: 'FourMeme TokenManager2',
                    method: 'buyTokenAMAP',
                    methodId: this.fourMemeConfig.purchaseMethodId
                }
            };
        } catch (error) {
            // 如果 tryBuy 失败，尝试使用 getLastPrice 方法
            try {
                const lastPrice = await this.platformContract.lastPrice(tokenAddress);
                if (lastPrice > 0) {
                    const estimatedAmount = (amountIn * BigInt(1e18)) / lastPrice;
                    this.log(`使用 lastPrice 计算价格: ${ethers.formatEther(lastPrice)} BNB per token`);

                    return {
                        success: true,
                        amountOut: estimatedAmount,
                        price: Number(lastPrice) / Number(1e18),
                        route: {
                            protocol: 'FourMeme TokenManager2',
                            method: 'buyToken (estimated)',
                            methodId: this.fourMemeConfig.purchaseMethodId
                        }
                    };
                }
            } catch (priceError) {
                this.log(`lastPrice 查询也失败: ${priceError.message}`, 'warning');
            }

            return {
                success: false,
                error: `价格查询失败: ${error.message}`
            };
        }
    }

    /**
     * 估算 Gas 费用
     */
    async estimateGas(tokenAddress, amountIn, operation = 'buy') {
        try {
            let gasEstimate;

            if (operation === 'buy') {
                // 估算购买 Gas
                try {
                    gasEstimate = await this.platformContract.purchase.estimateGas(tokenAddress, {
                        value: amountIn
                    });
                } catch (error) {
                    // 如果估算失败，使用默认值
                    gasEstimate = BigInt(this.fourMemeConfig.gasLimit);
                }
            } else {
                // 卖出操作通过 PancakeSwap（代币需要先添加到流动性池）
                return {
                    success: false,
                    error: 'FourMeme Direct 不支持直接卖出，请使用 PancakeSwap'
                };
            }

            const gasPrice = this.fourMemeConfig.gasPrice;
            const estimatedCost = (gasEstimate * gasPrice) / BigInt(1e18);

            return {
                success: true,
                gasFee: {
                    gasLimit: gasEstimate.toString(),
                    gasPrice: ethers.formatUnits(gasPrice, 'gwei'),
                    estimatedCost: ethers.formatEther(estimatedCost)
                }
            };
        } catch (error) {
            return {
                success: false,
                error: `Gas 估算失败: ${error.message}`
            };
        }
    }

    /**
     * 购买代币（使用 FourMeme TokenManager2）
     */
    async buyToken(tokenAddress, amountIn, options = {}) {
        try {
            this.log(`准备通过 FourMeme TokenManager2 购买代币: ${tokenAddress}`);
            this.log(`购买金额: ${ethers.formatEther(amountIn)} BNB`);

            // 首先获取价格报价
            const priceQuote = await this.quotePrice(tokenAddress, amountIn);
            if (!priceQuote.success) {
                throw new Error(`无法获取价格报价: ${priceQuote.error}`);
            }

            // 准备交易参数
            const gasLimit = options.gasLimit || this.fourMemeConfig.gasLimit;
            const gasPrice = options.maxGasPrice ?
                ethers.parseUnits(options.maxGasPrice.toString(), 'gwei') :
                this.fourMemeConfig.gasPrice;

            // 动态创建正确的平台合约
            const platformAddress = this.currentPlatformAddress || this.fourMemeConfig.v2PlatformAddress;
            const platformAbi = this.currentVersion === 1 ? this.v1PlatformAbi : this.v2PlatformAbi;
            const platformContract = new ethers.Contract(platformAddress, platformAbi, this.wallet);

            this.log(`使用 TokenManager${this.currentVersion || 2} 合约: ${platformAddress}`);

            // 使用 buyTokenAMAP 方法 (Buy As Much As Possible)
            const minAmountOut = options.slippageTolerance ?
                (priceQuote.amountOut * BigInt(10000 - options.slippageTolerance * 100)) / BigInt(10000) :
                (priceQuote.amountOut * BigInt(9500)) / BigInt(10000); // 默认5%滑点

            this.log(`执行购买:`);
            this.log(`   预期获得: ${ethers.formatUnits(priceQuote.amountOut, 18)} tokens`);
            this.log(`   最小获得: ${ethers.formatUnits(minAmountOut, 18)} tokens`);
            this.log(`   实际需发送: ${ethers.formatEther(priceQuote.amountMsgValue || amountIn)} BNB`);

            let tx;
            try {
                // 使用 buyTokenAMAP 函数 - 明确指定重载版本
                tx = await platformContract['buyTokenAMAP(address,uint256,uint256)'](
                    tokenAddress,
                    priceQuote.amountMsgValue || amountIn,
                    minAmountOut,
                    {
                        value: priceQuote.amountMsgValue || amountIn,
                        gasLimit,
                        gasPrice
                    }
                );
            } catch (error) {
                this.log(`buyTokenAMAP 失败，尝试 buyToken: ${error.message}`, 'warning');

                // 如果 buyTokenAMAP 失败，尝试使用 buyToken (指定代币数量)
                tx = await platformContract['buyToken(address,uint256,uint256)'](
                    tokenAddress,
                    priceQuote.amountOut,
                    (priceQuote.estimatedCost || amountIn) + BigInt(1000000000000000), // 添加一点缓冲
                    {
                        value: priceQuote.amountMsgValue || amountIn,
                        gasLimit,
                        gasPrice
                    }
                );
            }

            this.log(`交易已发送，哈希: ${tx.hash}`);
            this.log('等待交易确认...');

            const receipt = await tx.wait();

            if (receipt.status === 1) {
                this.log(`✅ 购买成功！`);
                this.log(`   区块号: ${receipt.blockNumber}`);
                this.log(`   Gas 使用: ${receipt.gasUsed.toString()}`);
                this.log(`   Gas 价格: ${ethers.formatUnits(receipt.gasPrice || gasPrice, 'gwei')} Gwei`);

                // 计算实际获得的代币数量
                const actualAmountOut = await this.calculateActualTokensReceived(tokenAddress, receipt);

                return {
                    success: true,
                    transactionHash: receipt.hash,
                    blockNumber: receipt.blockNumber,
                    gasUsed: receipt.gasUsed.toString(),
                    gasPrice: ethers.formatUnits(receipt.gasPrice || gasPrice, 'gwei'),
                    amountIn: ethers.formatEther(priceQuote.amountMsgValue || amountIn),
                    actualAmountOut,
                    expectedAmount: ethers.formatUnits(priceQuote.amountOut, 18),
                    protocol: 'FourMeme TokenManager2',
                    method: 'buyTokenAMAP',
                    methodId: this.fourMemeConfig.purchaseMethodId
                };
            } else {
                throw new Error('交易失败');
            }
        } catch (error) {
            this.log(`❌ 购买失败: ${error.message}`, 'error');
            return {
                success: false,
                error: error.message,
                protocol: 'FourMeme TokenManager2'
            };
        }
    }

    /**
     * 卖出代币（使用 FourMeme TokenManager2）
     */
    async sellToken(tokenAddress, amountOut, options = {}) {
        try {
            this.log(`准备通过 FourMeme TokenManager2 卖出代币: ${tokenAddress}`);
            this.log(`卖出数量: ${ethers.formatUnits(amountOut, 18)} tokens`);

            // 首先需要授权 TokenManager2 使用我们的代币
            const tokenContract = new ethers.Contract(tokenAddress, [
                'function balanceOf(address) view returns (uint256)',
                'function transfer(address to, uint256 amount) returns (bool)',
                'function approve(address spender, uint256 amount) returns (bool)',
                'function allowance(address owner, address spender) view returns (uint256)',
                'function name() view returns (string)',
                'function symbol() view returns (string)',
                'function decimals() view returns (uint8)',
                'function totalSupply() view returns (uint256)'
            ], this.wallet);

            // 检查当前授权
            const platformAddress = this.currentPlatformAddress || this.fourMemeConfig.v2PlatformAddress;
            const currentAllowance = await tokenContract.allowance(this.wallet.address, platformAddress);
            if (currentAllowance < amountOut) {
                this.log('授权 TokenManager2 使用代币...');
                const approveTx = await tokenContract.approve(platformAddress, amountOut);
                await approveTx.wait();
                this.log('✅ 授权完成');
            }

            // 使用 TokenManagerHelper3 预估卖出结果
            let sellEstimate;
            try {
                sellEstimate = await this.helperContract.trySell(tokenAddress, amountOut);

                if (sellEstimate.tokenManager !== platformAddress) {
                    throw new Error(`代币由不同的 TokenManager 管理: ${sellEstimate.tokenManager}`);
                }

                this.log(`卖出预估:`);
                this.log(`   预估获得 BNB: ${ethers.formatEther(sellEstimate.funds)} BNB`);
                this.log(`   预估费用: ${ethers.formatEther(sellEstimate.fee)} BNB`);
                this.log(`   净收入: ${ethers.formatEther(sellEstimate.funds - sellEstimate.fee)} BNB`);
            } catch (error) {
                this.log(`预估失败: ${error.message}`, 'warning');
            }

            // 准备交易参数
            const gasLimit = options.gasLimit || 300000;
            const gasPrice = options.maxGasPrice ?
                ethers.parseUnits(options.maxGasPrice.toString(), 'gwei') :
                this.fourMemeConfig.gasPrice;

            // 设置最小接收金额 (考虑滑点)
            const minFunds = sellEstimate ?
                (sellEstimate.funds * BigInt(10000 - (options.slippageTolerance || 5) * 100)) / BigInt(10000) :
                BigInt(1); // 如果没有预估，设置为最小值

            // 确定使用哪个版本的ABI
            const platformAbi = this.currentVersion === 1 ? this.v1PlatformAbi : this.v2PlatformAbi;

            // 创建平台合约实例（使用钱包签名）
            const platformContract = new ethers.Contract(
                platformAddress,
                platformAbi,
                this.wallet
            );

            this.log(`执行卖出:`);
            this.log(`   最小接收: ${ethers.formatEther(minFunds)} BNB`);
            this.log(`   使用平台合约: ${platformAddress}`);

            let tx;
            try {
                // 使用 sellToken 函数
                tx = await platformContract.sellToken(
                    tokenAddress,
                    amountOut,
                    {
                        gasLimit,
                        gasPrice
                    }
                );
            } catch (error) {
                this.log(`sellToken 失败，尝试带费用参数的版本: ${error.message}`, 'warning');

                // 尝试使用带费用参数的版本
                tx = await platformContract.sellToken(
                    0, // origin
                    tokenAddress,
                    amountOut,
                    minFunds,
                    0, // feeRate = 0 (无额外费用)
                    this.wallet.address, // feeRecipient
                    {
                        gasLimit,
                        gasPrice
                    }
                );
            }

            this.log(`交易已发送，哈希: ${tx.hash}`);
            this.log('等待交易确认...');

            const receipt = await tx.wait();

            if (receipt.status === 1) {
                this.log(`✅ 卖出成功！`);
                this.log(`   区块号: ${receipt.blockNumber}`);
                this.log(`   Gas 使用: ${receipt.gasUsed.toString()}`);

                // 计算实际收到的 BNB 数量
                const actualBnbReceived = await this.calculateActualBnbReceived(receipt);

                return {
                    success: true,
                    transactionHash: receipt.hash,
                    blockNumber: receipt.blockNumber,
                    gasUsed: receipt.gasUsed.toString(),
                    amountOut: ethers.formatUnits(amountOut, 18),
                    actualReceived: actualBnbReceived,
                    protocol: 'FourMeme TokenManager2',
                    method: 'sellToken'
                };
            } else {
                throw new Error('交易失败');
            }
        } catch (error) {
            this.log(`❌ 卖出失败: ${error.message}`, 'error');
            return {
                success: false,
                error: error.message,
                protocol: 'FourMeme TokenManager2'
            };
        }
    }

    /**
     * 计算实际收到的代币数量
     */
    async calculateActualTokensReceived(tokenAddress, receipt) {
        try {
            // 查找 Transfer 事件来计算实际收到的代币数量
            const tokenContract = new ethers.Contract(tokenAddress, this.erc20Abi, this.provider);
            const transferFilter = tokenContract.filters.Transfer(null, this.wallet.address);
            const events = await tokenContract.queryFilter(transferFilter, receipt.blockNumber, receipt.blockNumber);

            if (events.length > 0) {
                const transferEvent = events[events.length - 1]; // 使用最后一个事件
                return ethers.formatUnits(transferEvent.args.value, 18);
            }

            return '未知';
        } catch (error) {
            this.log(`无法计算实际代币数量: ${error.message}`, 'warning');
            return '未知';
        }
    }

    /**
     * 计算实际收到的 BNB 数量
     */
    async calculateActualBnbReceived(receipt) {
        try {
            // 检查交易日志中的 BNB 转入事件
            if (receipt.logs && receipt.logs.length > 0) {
                // 查找可能的 BNB 转入日志 (通常来自 TokenManager2)
                for (const log of receipt.logs) {
                    // 检查是否是 TokenManager2 发出的事件
                    if (log.address.toLowerCase() === this.fourMemeConfig.platformAddress.toLowerCase()) {
                        // 检查主题是否匹配卖出事件
                        if (log.topics[0] && log.topics[0].includes('sell')) {
                            // 解析日志数据获取 BNB 数量
                            try {
                                const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                                    ['uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
                                    log.data
                                );
                                return ethers.formatEther(decoded[3] || decoded[1]); // 尝试不同的位置
                            } catch (decodeError) {
                                this.log(`日志解析失败: ${decodeError.message}`, 'warning');
                            }
                        }
                    }
                }
            }

            // 如果无法从日志解析，使用交易的 value 字段（对于卖出交易，这是收到的 BNB）
            return ethers.formatEther(receipt.value || 0);
        } catch (error) {
            this.log(`无法计算实际 BNB 数量: ${error.message}`, 'warning');
            return '未知';
        }
    }

    /**
     * 检查流动性（针对 FourMeme 的特殊检查）
     */
    async checkLiquidity(tokenAddress, amountIn, isBuy = true) {
        if (!isBuy) {
            return {
                hasLiquidity: false,
                message: 'FourMeme Direct 不支持卖出操作',
                suggestion: '请使用 PancakeSwap 进行卖出'
            };
        }

        try {
            // 检查代币是否支持
            const poolInfo = await this.getPoolInfo(tokenAddress);
            if (!poolInfo.success) {
                return {
                    hasLiquidity: false,
                    message: `无法获取代币信息: ${poolInfo.error}`
                };
            }

            if (!poolInfo.token.isSupported) {
                return {
                    hasLiquidity: false,
                    message: '该代币不被 FourMeme 平台支持'
                };
            }

            // 尝试价格查询
            const priceQuote = await this.quotePrice(tokenAddress, amountIn);
            if (!priceQuote.success) {
                return {
                    hasLiquidity: false,
                    message: `无法获取价格: ${priceQuote.error}`
                };
            }

            return {
                hasLiquidity: true,
                message: '代币可以通过 FourMeme 平台购买',
                price: priceQuote.price,
                estimatedAmountOut: ethers.formatUnits(priceQuote.amountOut, 18)
            };
        } catch (error) {
            return {
                hasLiquidity: false,
                message: `流动性检查失败: ${error.message}`
            };
        }
    }

    /**
     * 获取代币价格（兼容ITrader接口）
     */
    async getTokenPrice(tokenAddress) {
        try {
            const poolInfo = await this.getPoolInfo(tokenAddress);
            if (poolInfo.success && poolInfo.token.tokenInfo) {
                return poolInfo.token.tokenInfo.lastPrice || '0';
            }
            return '0';
        } catch (error) {
            this.log(`获取代币价格失败: ${error.message}`, 'warning');
            return '0';
        }
    }

    /**
     * 获取交易器信息
     */
    getInfo() {
        return {
            ...super.getInfo(),
            platformAddress: this.fourMemeConfig.platformAddress,
            helperAddress: this.fourMemeConfig.helperAddress,
            purchaseMethodId: this.fourMemeConfig.purchaseMethodId,
            supportedOperations: ['buy', 'sell'],
            contractVersion: 'TokenManager2 V2',
            notes: 'FourMeme TokenManager2 V2 - 支持通过 BNB 购买和卖出代币，使用官方 ABI'
        };
    }
}

module.exports = FourMemeDirectTrader;
