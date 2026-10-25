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

        // gas 策略（B4）：'dynamic'（默认，链上价+估算限额）| 'pinned'（恒上限价，
        // 旧行为回滚开关）
        this.gasStrategy = (this.config.trading && this.config.trading.gasStrategy)
            || this.config.gasStrategy || 'dynamic';

        // per-token decimals 缓存（B5：_assertDecimals18 首笔交易查一次）
        this._tokenDecimalsCache = new Map();

        this.initProvider();
    }

    /**
     * 初始化Web3提供者
     */
    initProvider() {
        try {
            this.provider = new ethers.JsonRpcProvider(this.network.rpcUrl);
            this.log(`📡 Provider initialized for ${this.network.name}`);
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
            // NonceManager 包装（B2 实盘加固）：发送走 this.signer——进程内串行分配 pending
            // nonce，根治跨 token 并发买 nonce 竞争。this.wallet 保持 raw Wallet 不变：
            // 引擎多处同步读 trader.wallet.address（地址校验/余额对账），NonceManager
            // 的 getAddress 是 async，不能顶替 this.wallet。
            this.signer = new ethers.NonceManager(this.wallet);

            this.log(`👛 Wallet set: ${this.wallet.address}`);

            // 验证钱包连接
            await this.verifyWalletConnection();

        } catch (error) {
            throw new Error(`Failed to set wallet: ${error.message}`);
        }
    }

    /**
     * 共享钱包/nonce（双平台 live，2026-10-14）：复用另一 trader 的 wallet 与
     * NonceManager signer——同一地址在进程内只允许一个 nonce 分配源，双 trader 各持
     * NonceManager 并发发单会互取相同 nonce 拒收。this.wallet 同步替换（引擎多处同步
     * 读 trader.wallet.address）。子类若在 prepare 里把合约绑到 this.signer（如
     * FlapPortalTrader 的 portalContract），覆写本方法并在共享后重建合约绑定。
     * 调用前置条件：本 trader 已 setWallet（各自校验路径跑通），再共享覆盖。
     */
    shareSignerFrom(other) {
        if (!other || !other.wallet || !other.signer) {
            throw new Error('shareSignerFrom: 源 trader 未初始化钱包（缺 wallet/signer）');
        }
        this.wallet = other.wallet;
        this.signer = other.signer;
    }

    /**
     * nonce 类错误识别（B2）：交易因 nonce 竞争被节点拒收的典型错误短语。
     * 只匹配 nonce 语义明确的短语，不用裸 'too low'（会误伤 'gas price too low'）。
     * 刻意不含 'already known'——那不是拒收，见 _recoverTxFromAlreadyKnown。
     */
    _isNonceError(error) {
        const msg = String((error && error.message) || error || '');
        return /nonce too low|nonce has already been used|replacement transaction|incorrect nonce/i.test(msg);
    }

    /**
     * already known 识别：raw 已在 mempool——首次 sendRawTransaction 请求到达节点
     * 入池但 HTTP 响应丢失，请求层重发同一 payload 撞出 already known。
     * 不是拒收（2026-10-25 v36 BNB传奇 0xbd2a…7777 案实证：首发 nonce 1704 已成交
     * 0xade5…bc10，引擎却判失败不记账 → 账面幽灵持仓 + 后续粉尘卖出 5 连败熔断）。
     */
    _isAlreadyKnownError(error) {
        return /already known/i.test(String((error && error.message) || ''));
    }

    /**
     * 已上链/入池 tx 恢复轮询：tx 短暂未被节点索引时轮询数秒（already-known 恢复与
     * nonce 错误取证共用同一窗口）；拿不到返回 null。
     */
    async _pollTxResponse(hash, label = '交易', context = '') {
        for (let i = 0; i < 12; i++) {
            const tx = await this.provider.getTransaction(hash);
            if (tx) return tx;
            await new Promise((res) => setTimeout(res, 500));
        }
        this.log(`${context || label}取证轮询超时：tx ${hash} 节点未见`, 'warning');
        return null;
    }

    /**
     * already known 恢复：从错误 payload 提取 raw 算出 txHash，取回 tx response 交
     * 上层照常「交易已发送 + awaitReceipt」——绝不 reset 重签重发（重发=nonce+1 的
     * 第二笔同参数交易：首发已成交时=双卖；本案第二笔靠 minOut revert 才免于双卖）。
     * 错误形状 error.info.payload.params[0]（ethers v6 JsonRpcError，日志实证）。
     */
    async _recoverTxFromAlreadyKnown(error, label = '交易') {
        const raw = error?.info?.payload?.params?.[0];
        if (typeof raw !== 'string' || !raw.startsWith('0x')) return null;
        const hash = ethers.Transaction.from(raw).hash;
        this.log(`already known=已在 mempool：恢复 ${label} tx ${hash} 追踪回执（不重签不重发）`, 'warning');
        return this._pollTxResponse(hash, label);
    }

    /**
     * nonce 类错误取证（T2）：错误 payload 里的 raw 是首发交易——先查它的链上终态。
     * 「nonce too low: next nonce N+1, tx nonce N」的 N+1 恰恰证明 nonce N 已被消费
     * =首发已上链执行（成交或 revert 均算），此时重发=nonce+1 同参数第二笔=双卖。
     * 返回 TransactionResponse=首发已在链上/入池（恢复追踪）；null=首发确认未上链
     * （可安全重试）；undefined=无法取证（payload 缺 raw）。
     */
    async _probeNonceErrorTx(error, label = '交易') {
        const raw = error?.info?.payload?.params?.[0];
        if (typeof raw !== 'string' || !raw.startsWith('0x')) return undefined;
        const hash = ethers.Transaction.from(raw).hash;
        return this._pollTxResponse(hash, label, 'nonce 错误');
    }

    /**
     * nonce 守卫（B2→T2）：包装发单调用——catch 到 nonce 类错误时，先取证首发 raw 的
     * 链上终态再决定动作，重试必须以「首发确认未上链」为前提：
     *   - 首发已在链上（已执行）→ 恢复追踪，绝不重发（2026-10-25 T2 K线人生
     *     0xfeff…7777 双卖案：首发 nonce 1735 tx 0x0017…49ff 已成交，HTTP 响应丢失后
     *     请求层重发同 raw 撞出 "nonce too low: next nonce 1736, tx nonce 1735"，
     *     旧逻辑误当拒收 reset 重发 nonce 1736 同参数卖出 → 双卖 1 卡，卡账本虚挂、
     *     幽灵持仓熔断循环；BNB 实收进钱包但无 trades 行）
     *   - 首发确认未上链（真拒收/mempool 被顶）→ reset NonceManager 重试一次（旧行为）
     *   - 提取不到 raw → 无法证明首发未上链，fail-closed 原样抛出不重试
     * already known 走恢复分支（tx 已入池，拒收假设不成立）。
     */
    async _nonceGuard(fn, label = '交易') {
        try {
            return await fn();
        } catch (error) {
            if (this._isAlreadyKnownError(error)) {
                const tx = await this._recoverTxFromAlreadyKnown(error, label);
                if (tx) return tx;
                throw error;
            }
            if (!this._isNonceError(error)) throw error;
            const probe = await this._probeNonceErrorTx(error, label);
            if (probe === undefined) {
                this.log(`nonce 错误但无法提取首发 raw（无法证明未上链），fail-closed 不重试: ${error.message}`, 'warning');
                throw error;
            }
            if (probe) {
                this.log(`nonce 错误但首发 tx ${probe.hash} 已在链上/入池（已执行或待打包）：恢复追踪，不重发（重发=nonce+1 双卖）`, 'warning');
                return probe;
            }
            console.warn(`🔁 ${this.constructor.name}: nonce 冲突拒收（首发确认未上链），reset 后重试一次`);
            this.signer.reset();
            return await fn();
        }
    }

    /**
     * 动态 gas 价解析（B4 实盘加固）
     *
     * 旧行为=恒用 maxGasPrice 精确值（上限被当保底价，gas 费系统性高估）。新行为：
     * feeData.gasPrice ≤ max 用链上价，超 max 钳到 max，异常低（<0.01 gwei，防脏数据/
     * 零价）或查询失败回落 max（=旧行为，永不因 gas 解析阻断发单）。
     * gasStrategy='pinned' 回滚开关：恒用 maxGwei（完全旧行为）。
     * 注：下限 2026-10-14 由 1 gwei 降 0.01 gwei——BSC 实际 gas 价常驻 0.05-0.3 gwei，
     * 旧 1 gwei 下限把现实低价误判为异常回落满格 max（v11 首回合实证：approve 0.05 gwei
     * 上链成功而 swap 被顶到 10 gwei，单笔多付 ~200 倍 ≈ 0.0099 BNB）。
     */
    async _resolveGasPrice(maxGasPriceGwei) {
        const maxGwei = Number(maxGasPriceGwei) || this.tradingConfig.maxGasPrice;
        const maxWei = ethers.parseUnits(String(maxGwei), 'gwei');
        if (this.gasStrategy === 'pinned') {
            return maxWei;
        }
        let chainPrice = null;
        try {
            const fee = await this.provider.getFeeData();
            chainPrice = fee.gasPrice;
        } catch (error) {
            console.warn(`⚠️ ${this.constructor.name}: getFeeData 失败，gasPrice 回落上限 ${maxGwei} gwei: ${error.message}`);
        }
        if (chainPrice == null || chainPrice < 10n ** 7n) {
            // 查询失败/链上价异常低（<0.01 gwei，防脏数据/零价）：回落 max
            return maxWei;
        }
        return chainPrice > maxWei ? maxWei : chainPrice;
    }

    /**
     * 动态 gasLimit 解析（B4）：estimateGas × 1.3 缓冲，钳 hardCap；估算失败回落
     * 固定值（=旧行为，不阻断发单——链上 revert 语义与旧行为一致）
     */
    async _resolveGasLimit(txRequest, fallbackLimit, hardCapLimit) {
        const fallback = BigInt(fallbackLimit);
        try {
            const est = await this.provider.estimateGas({ from: this.wallet.address, ...txRequest });
            const buffered = (est * 13n) / 10n;
            const cap = BigInt(hardCapLimit);
            const resolved = buffered > cap ? cap : buffered;
            this.log(`⛽ gasLimit estimate=${est} ×1.3 → ${resolved}（cap ${cap}）`);
            return resolved;
        } catch (error) {
            this.log(`⚠️ estimateGas 失败，gasLimit 回落固定值 ${fallback}: ${error.message}`, 'warning');
            return fallback;
        }
    }

    /**
     * decimals=18 断言（B5 实盘加固）：four.meme/flap 模板代币 decimals 恒 18，
     * 采集（WSS tick）→因子→PM 记账→L1 预成交锚全链按 18 假设换算；≠18 时数量/
     * 价格会错 10^n 倍（余额钳制只会把它变成意外全仓卖）——fail-closed 拒绝交易
     * （宁可错过不可买错，与 L1 预成交校验同向）。查询失败同样拒绝（fail-loud，
     * 不静默回落 18）。per-token 缓存：首笔交易一次 eth_call。
     */
    async _assertDecimals18(tokenAddress) {
        const addr = ethers.getAddress(tokenAddress);
        if (this._tokenDecimalsCache.has(addr)) {
            const dec = this._tokenDecimalsCache.get(addr);
            if (dec !== 18) {
                throw new Error(`代币 decimals=${dec} ≠ 18（全链按 18 假设换算，拒绝交易防数量错乱）: ${addr}`);
            }
            return 18;
        }
        const tokenContract = new ethers.Contract(
            addr, ['function decimals() view returns (uint8)'], this.provider);
        let dec;
        try {
            dec = Number(await tokenContract.decimals());
        } catch (error) {
            throw new Error(`decimals 查询失败（fail-closed 拒绝交易）: ${addr} ${error.message}`);
        }
        this._tokenDecimalsCache.set(addr, dec);
        if (dec !== 18) {
            throw new Error(`代币 decimals=${dec} ≠ 18（全链按 18 假设换算，拒绝交易防数量错乱）: ${addr}`);
        }
        return 18;
    }

    /**
     * 成交后余额读零重读（2026-10-15 妹珠 0xa4b8…7777 案）：余额差法的 after 读撞上
     * LB RPC 端点后面的滞后节点会答出交易前状态 → 差值 0（当日实测 3 次），而
     * status=1 的成功 swap 实收为 0 是不可能事件。isOk 判定不过时延迟重读一次
     * （balanceSettleRetryMs 默认 1500ms ≈ BSC 0.45s 出块 3 块，单测可注入缩时），
     * 仍不过则原样返回 + error 留痕（引擎侧按信号价估算兜底，不在此静默造数）。
     * @param {() => Promise<bigint>} readAfter 成交后余额读取（token balanceOf / BNB getBalance）
     * @param {(after: bigint) => boolean} isOk 差值有效性判定（买=diff>0；卖=diff+gas 补偿>0）
     * @param {string} label 日志标签
     * @returns {Promise<bigint>} 重读后的 after 余额
     */
    async _settleBalanceRead(readAfter, isOk, label) {
        let after = await readAfter();
        if (isOk(after)) return after;
        const waitMs = this.balanceSettleRetryMs ?? 1500;
        this.log(`⚠️ ${label} 读零疑似 RPC 滞后，${waitMs}ms 后重读一次`, 'warning');
        await new Promise((res) => setTimeout(res, waitMs));
        after = await readAfter();
        if (!isOk(after)) {
            this.log(`❌ ${label} 重读仍无效（after=${after.toString()}），原始值保留交引擎估算兜底`, 'error');
        }
        return after;
    }

    /**
     * 验证钱包连接
     */
    async verifyWalletConnection() {
        try {
            const balance = await this.provider.getBalance(this.wallet.address);
            this.log(`💰 Wallet balance: ${ethers.formatEther(balance)} BNB`);
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
