/**
 * Flap Portal 交易器（BSC flap.sh 内盘 live 直连）
 *
 * Portal（0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0）是 TransparentUpgradeableProxy
 * （ERC1967），交易接口按官方文档（docs.flap.sh trade-tokens）：
 *   - quoteExactInput((address,address,uint256)) → uint256（非 view，staticCall 模拟；
 *     inputToken/outputToken 用 0x0 表示 BNB）
 *   - swapExactInput((address,address,uint256,uint256,bytes)) payable → uint256
 *     （permitData 走 approve 路径传 '0x'；仅支持 bonding curve 内盘状态，毕业盘 revert）
 *   - fee：1% 协议费 + 税币 transfer 税（V1-V3 税币地址后缀 7777）
 *
 * live 加固（与 FourMemeDirectTrader 同层防线）：
 *   - L1 预成交校验（core/preTradeCheck）：报价 vs 引擎信号价预期（BURNIE/尘埃报价防线）
 *   - _awaitReceipt 超时等待（120s 默认；超时不重发防双买）
 *   - 实际成交用余额差法（BNB/token balanceOf 前后差 + gas 补偿）——对税币到手量、
 *     非 BNB quote 盘内部换路径天然免疫（TokenSold 事件 eth 字段在非 BNB 盘记 quote 币，
 *     事件解析有口径歧义；余额差到账即真相）
 *
 * 非 BNB 计价盘（quote_token 非 NULL）买入：BNB→quote 内部换需项目方 nativeToQuoteSwap
 * 启用，未启用时 swapExactInput 直接 revert（fail-closed 天然形成"live 只买 BNB 盘"的
 * 收窄，无需引擎侧预判）；卖出 token→0x0 全盘支持。
 */

const { ethers } = require('ethers');
const BaseTrader = require('../core/BaseTrader');
const { assertMinOut } = require('../core/preTradeCheck');

const BNB_ADDRESS = ethers.ZeroAddress; // Portal 契约口径：0x0 = BNB

class FlapPortalTrader extends BaseTrader {
    constructor(config = {}) {
        super({
            name: 'Flap Portal',
            type: 'flap-portal',
            description: 'Flap.sh Portal swapExactInput - BSC 内盘直连交易',
            riskLevel: 3, // 高风险
            ...config
        });

        this.flapConfig = {
            // Portal 代理合约（配置可覆盖；默认对齐 config/default.json flapWs.contracts.portal）
            portalAddress: (config.contracts && config.contracts.portal)
                || '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0',
            gasLimit: 350000, // swap + 潜在内部换路径（rich-js PCS 同级）
            gasPrice: ethers.parseUnits('10', 'gwei'),
        };

        // 官方文档接口（元组单参数形态；与 implementation 0x27a0...4e20 选择器比对一致：
        // swapExactInput 0xef7ec2e7 / quoteExactInput 0xfc847c2b）
        this.portalAbi = [
            'function quoteExactInput((address inputToken, address outputToken, uint256 inputAmount) params) returns (uint256 outputAmount)',
            'function swapExactInput((address inputToken, address outputToken, uint256 inputAmount, uint256 minOutputAmount, bytes permitData) params) payable returns (uint256 outputAmount)',
            'event TokenBought(uint256 ts, address token, address trader, uint256 amount, uint256 eth, uint256 fee, uint256 postPrice)',
            'event TokenSold(uint256 ts, address token, address trader, uint256 amount, uint256 eth, uint256 fee, uint256 postPrice)',
        ];

        this.erc20Abi = [
            'function balanceOf(address) view returns (uint256)',
            'function approve(address spender, uint256 amount) returns (bool)',
            'function allowance(address owner, address spender) view returns (uint256)',
            'function decimals() view returns (uint8)',
            'function symbol() view returns (string)',
        ];
    }

    log(message, type = 'info') {
        const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️';
        if (this.logger) {
            try {
                const logMethod = type === 'error' ? 'error' : type === 'success' ? 'info' : type === 'warning' ? 'warn' : 'info';
                this.logger[logMethod](`[FlapPortalTrader] ${message}`);
            } catch {
                console.log(`[${prefix}] [FlapPortalTrader] ${message}`);
            }
        } else {
            console.log(`[${prefix}] [FlapPortalTrader] ${message}`);
        }
    }

    setLogger(logger) {
        this.logger = logger;
    }

    /** 交易器配置验证（连通性：Portal 代理合约 bytecode 存在） */
    async validate() {
        try {
            if (!this.config.network?.rpcUrl) {
                throw new Error('网络 RPC URL 未配置');
            }
            const code = await this.provider.getCode(this.flapConfig.portalAddress);
            if (code === '0x') {
                throw new Error(`Portal 合约不存在: ${this.flapConfig.portalAddress}`);
            }
            return { valid: true };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    }

    async prepare() {
        const code = await this.provider.getCode(this.flapConfig.portalAddress);
        if (code === '0x') {
            throw new Error(`Flap Portal 合约不存在于地址: ${this.flapConfig.portalAddress}`);
        }
        this.portalContract = new ethers.Contract(this.flapConfig.portalAddress, this.portalAbi, this.wallet);
        this.log(`✅ Flap Portal 连接成功: ${this.flapConfig.portalAddress}`);
        return { success: true, message: 'Flap Portal Trader 准备完成' };
    }

    /** 设置钱包（重写：BaseTrader 建 wallet 后挂 Portal 合约） */
    async setWallet(privateKey) {
        await super.setWallet(privateKey);
        const prepareResult = await this.prepare();
        if (!prepareResult.success) {
            throw new Error(`Failed to prepare trader: ${prepareResult.error}`);
        }
    }

    /**
     * 报价（staticCall 模拟，不上链）：买入 direction='buy' 即 BNB→token，
     * 卖出 direction='sell' 即 token→BNB
     * @returns {Promise<bigint>} 到手量 base units（token 或 BNB，18 decimals）
     */
    async quote(tokenAddress, amountInWei, direction = 'buy') {
        const params = direction === 'buy'
            ? { inputToken: BNB_ADDRESS, outputToken: tokenAddress, inputAmount: amountInWei }
            : { inputToken: tokenAddress, outputToken: BNB_ADDRESS, inputAmount: amountInWei };
        return await this.portalContract.quoteExactInput.staticCall(params);
    }

    /** 带超时的交易回执等待（与 FourMemeDirectTrader._awaitReceipt 同语义：超时不重发防双买） */
    async _awaitReceipt(tx, label) {
        const timeoutMs = this.txWaitTimeoutMs ?? 120000;
        let receipt;
        try {
            receipt = await this.provider.waitForTransaction(tx.hash, 1, timeoutMs);
        } catch (error) {
            const isTimeout = String(error.message || '').toLowerCase().includes('timeout')
                || error.code === 'TIMEOUT';
            if (!isTimeout) throw error;
            receipt = await this.provider.getTransactionReceipt(tx.hash);
            if (!receipt) {
                throw new Error(
                    `${label}确认超时(${timeoutMs / 1000}s)，txHash=${tx.hash} —— 请人工核查链上终态（已停止等待，未重发防双买）`);
            }
            this.log(`${label} waitForTransaction 超时但回查已上链: ${tx.hash} status=${receipt.status}`, 'warning');
        }
        if (receipt.status !== 1) {
            throw new Error(`${label}链上执行失败(reverted): ${tx.hash}`);
        }
        return receipt;
    }

    /**
     * 购买代币：BNB → token（swapExactInput payable）
     * options.expectedTokenOut：引擎按信号价推导的预期 token 数（UI 单位）——契约必传
     * （缺失即拒绝，见 preTradeCheck）；options.minOutRatio 默认 0.5
     */
    async buyToken(tokenAddress, amountInWei, options = {}) {
        try {
            tokenAddress = ethers.getAddress(tokenAddress);
            if (typeof amountInWei !== 'bigint') {
                amountInWei = BigInt(amountInWei.toString());
            }

            this.log(`准备通过 Flap Portal 购买: ${tokenAddress} 金额 ${ethers.formatEther(amountInWei)} BNB`);

            // 报价（staticCall；毕业盘/未启用的非 BNB 盘在此 revert = fail-closed）
            const quoteOut = await this.quote(tokenAddress, amountInWei, 'buy');

            // L1 预成交校验（BURNIE 防线）：expectedTokenOut 契约必传
            const minOutRatio = typeof options.minOutRatio === 'number' ? options.minOutRatio : 0.5;
            const assertRes = assertMinOut({
                expectedOut: options.expectedTokenOut,
                decimals: 18,
                quoteOutRaw: quoteOut,
                minOutRatio,
                context: `flap buyToken ${tokenAddress}`,
            });
            this.log(`[预成交校验通过] ratio=${assertRes.ratio} 报价到手=${assertRes.quoteOutUi}（minOutRatio=${minOutRatio}）`);

            const minOutputAmount = options.slippageTolerance
                ? (quoteOut * BigInt(10000 - Math.round(options.slippageTolerance * 100))) / BigInt(10000)
                : (quoteOut * BigInt(9900)) / BigInt(10000); // 默认 1% 滑点容忍（fee 已在报价内）

            const gasLimit = options.gasLimit || this.flapConfig.gasLimit;
            const gasPrice = options.maxGasPrice
                ? ethers.parseUnits(options.maxGasPrice.toString(), 'gwei')
                : this.flapConfig.gasPrice;

            // 余额差法基准：买入前 token 余额（税币到手量 = 税后）
            const tokenContract = new ethers.Contract(tokenAddress, this.erc20Abi, this.provider);
            const balanceBefore = await tokenContract.balanceOf(this.wallet.address);

            this.log(`执行 swapExactInput: BNB→token value=${ethers.formatEther(amountInWei)} minOut=${ethers.formatUnits(minOutputAmount, 18)}`);
            const tx = await this.portalContract.swapExactInput(
                { inputToken: BNB_ADDRESS, outputToken: tokenAddress, inputAmount: amountInWei, minOutputAmount, permitData: '0x' },
                { value: amountInWei, gasLimit, gasPrice },
            );
            this.log(`交易已发送，哈希: ${tx.hash}`);

            const receipt = await this._awaitReceipt(tx, '买入');

            // 实得 token（余额差，税后真相）
            const balanceAfter = await tokenContract.balanceOf(this.wallet.address);
            const actualAmountOut = balanceAfter - balanceBefore;
            this.log(`✅ 购买成功 | 区块 ${receipt.blockNumber} 实得 ${ethers.formatUnits(actualAmountOut, 18)}`);

            return {
                success: true,
                transactionHash: receipt.hash,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString(),
                gasPrice: ethers.formatUnits(receipt.gasPrice || gasPrice, 'gwei'),
                amountIn: ethers.formatEther(amountInWei),
                actualAmountOut: ethers.formatUnits(actualAmountOut, 18),
                expectedAmount: ethers.formatUnits(quoteOut, 18),
                protocol: 'Flap Portal',
                method: 'swapExactInput',
            };
        } catch (error) {
            this.log(`❌ 购买失败: ${error.message}`, 'error');
            return { success: false, error: error.message, protocol: 'Flap Portal' };
        }
    }

    /**
     * 卖出代币：token → BNB。
     * options.expectedNativeOut：引擎推导的预期实收 BNB（UI 单位）；提供时启用绝对锚
     * 校验 + 预估失败 fail-closed（与 FourMemeDirectTrader 卖出契约一致）
     */
    async sellToken(tokenAddress, amountOutWei, options = {}) {
        try {
            tokenAddress = ethers.getAddress(tokenAddress);
            if (typeof amountOutWei !== 'bigint') {
                amountOutWei = BigInt(amountOutWei.toString());
            }

            this.log(`准备通过 Flap Portal 卖出: ${tokenAddress} 数量 ${ethers.formatUnits(amountOutWei, 18)}`);

            const tokenContract = new ethers.Contract(tokenAddress, this.erc20Abi, this.wallet);

            // 余额钳制（rich-js 防线：三层权威钳制中的余额层；税币可卖量=余额）
            const tokenBalance = await tokenContract.balanceOf(this.wallet.address);
            if (amountOutWei > tokenBalance) {
                this.log(`⚠️ 卖出数量超过余额，钳制为余额 | 请求 ${ethers.formatUnits(amountOutWei, 18)} 余额 ${ethers.formatUnits(tokenBalance, 18)}`, 'warning');
                amountOutWei = tokenBalance;
            }
            if (amountOutWei <= 0n) {
                throw new Error('卖出数量钳制后为 0（链上无余额）');
            }

            // approve（精确额度，与 four.meme 同口径）
            const currentAllowance = await tokenContract.allowance(this.wallet.address, this.flapConfig.portalAddress);
            if (currentAllowance < amountOutWei) {
                this.log('授权 Portal 使用代币...');
                const approveTx = await tokenContract.approve(this.flapConfig.portalAddress, amountOutWei);
                await this._awaitReceipt(approveTx, 'approve');
                this.log('✅ 授权完成');
            }

            // 报价 + L1 绝对锚（expectedNativeOut 提供时）
            const hasExpectedAnchor = options.expectedNativeOut !== undefined && options.expectedNativeOut !== null;
            let quoteOut;
            try {
                quoteOut = await this.quote(tokenAddress, amountOutWei, 'sell');
            } catch (error) {
                if (hasExpectedAnchor) {
                    this.log(`❌ quoteExactInput 失败且引擎提供了预期锚，fail-closed 拒绝卖出: ${error.message}`, 'error');
                    throw new Error(`quoteExactInput 失败（fail-closed 拒绝裸奔卖出）: ${error.message}`);
                }
                this.log(`预估失败（无预期锚，独立工具路径继续）: ${error.message}`, 'warning');
            }

            if (hasExpectedAnchor && quoteOut !== undefined && quoteOut > 0n) {
                const minOutRatio = typeof options.minOutRatio === 'number' ? options.minOutRatio : 0.5;
                const assertRes = assertMinOut({
                    expectedOut: options.expectedNativeOut,
                    decimals: 18,
                    quoteOutRaw: quoteOut,
                    minOutRatio,
                    context: `flap sellToken ${tokenAddress}`,
                });
                this.log(`[预成交校验通过] ratio=${assertRes.ratio} 报价净得=${assertRes.quoteOutUi} BNB（minOutRatio=${minOutRatio}）`);
            }

            const minOutputAmount = (quoteOut && quoteOut > 0n)
                ? (options.slippageTolerance
                    ? (quoteOut * BigInt(10000 - Math.round(options.slippageTolerance * 100))) / BigInt(10000)
                    : (quoteOut * BigInt(9900)) / BigInt(10000))
                : 1n; // 无报价（预估失败且无锚）：最小非零值，合约语义 minOutput>0

            const gasLimit = options.gasLimit || this.flapConfig.gasLimit;
            const gasPrice = options.maxGasPrice
                ? ethers.parseUnits(options.maxGasPrice.toString(), 'gwei')
                : this.flapConfig.gasPrice;

            // 余额差法基准：卖出前 BNB 余额
            const bnbBefore = await this.provider.getBalance(this.wallet.address);

            this.log(`执行 swapExactInput: token→BNB amount=${ethers.formatUnits(amountOutWei, 18)} minOut=${ethers.formatEther(minOutputAmount)}`);
            const tx = await this.portalContract.swapExactInput(
                { inputToken: tokenAddress, outputToken: BNB_ADDRESS, inputAmount: amountOutWei, minOutputAmount, permitData: '0x' },
                { gasLimit, gasPrice },
            );
            this.log(`交易已发送，哈希: ${tx.hash}`);

            const receipt = await this._awaitReceipt(tx, '卖出');

            // 实收 BNB（余额差 + gas 补偿——交易费也出自钱包）
            const bnbAfter = await this.provider.getBalance(this.wallet.address);
            const gasCost = (receipt.gasUsed || 0n) * (receipt.gasPrice || gasPrice);
            const actualBnbReceived = bnbAfter - bnbBefore + gasCost;
            this.log(`✅ 卖出成功 | 区块 ${receipt.blockNumber} 实收 ${ethers.formatEther(actualBnbReceived)} BNB`);

            return {
                success: true,
                transactionHash: receipt.hash,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString(),
                gasPrice: ethers.formatUnits(receipt.gasPrice || gasPrice, 'gwei'),
                amountOut: ethers.formatUnits(amountOutWei, 18),
                actualReceived: ethers.formatEther(actualBnbReceived),
                protocol: 'Flap Portal',
                method: 'swapExactInput',
            };
        } catch (error) {
            this.log(`❌ 卖出失败: ${error.message}`, 'error');
            return { success: false, error: error.message, protocol: 'Flap Portal' };
        }
    }

    /** 流动性检查：quoteExactInput 可得即有内盘流动性（毕业盘/未初始化盘 revert） */
    async checkLiquidity(tokenAddress, amountIn, forEstimate = false) {
        try {
            const amountInWei = typeof amountIn === 'bigint' ? amountIn : ethers.parseEther(amountIn.toString());
            const quoteOut = await this.quote(tokenAddress, amountInWei, 'buy');
            return {
                hasLiquidity: quoteOut > 0n,
                message: 'Flap Portal 内盘报价可用',
                estimatedAmountOut: ethers.formatUnits(quoteOut, 18),
            };
        } catch (error) {
            return { hasLiquidity: false, message: `Flap Portal 报价失败（毕业盘或不可交易）: ${error.message}` };
        }
    }

    /** 代币价格（BNB/token 口径，quote 1 BNB 反推；兼容 ITrader 接口） */
    async getTokenPrice(tokenAddress) {
        const quoteOut = await this.quote(tokenAddress, ethers.parseEther('1'), 'buy');
        if (quoteOut <= 0n) return '0';
        // price = 1 / amountOut（BNB per token）
        return ethers.formatEther(ethers.parseEther('1') / quoteOut);
    }

    getInfo() {
        return {
            name: this.config.name || 'Flap Portal',
            type: 'flap-portal',
            platform: 'flap',
            chain: 'bsc',
            portalAddress: this.flapConfig.portalAddress,
            description: this.config.description || 'Flap.sh Portal 内盘直连交易器（swapExactInput）',
        };
    }
}

module.exports = FlapPortalTrader;
