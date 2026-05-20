/**
 * PumpFun 统一交易器
 * 支持 pump.fun 内盘（bonding curve）和外盘（PumpSwap AMM）交易
 *
 * 内盘使用 @pump-fun/pump-sdk V2 指令
 * 外盘使用 @pump-fun/pump-swap-sdk
 */

const ITrader = require('../ITrader');
const {
    PublicKey,
    Transaction,
    LAMPORTS_PER_SOL,
    Connection,
    ComputeBudgetProgram
} = require('@solana/web3.js');
const {
    getAssociatedTokenAddressSync,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID
} = require('@solana/spl-token');
const {
    OnlinePumpSdk,
    PUMP_SDK,
    PUMP_PROGRAM_ID,
    bondingCurvePda,
    getBuyTokenAmountFromSolAmount,
    getSellSolAmountFromTokenAmount
} = require('@pump-fun/pump-sdk');
const {
    OnlinePumpAmmSdk,
    PUMP_AMM_SDK,
    PUMP_AMM_PROGRAM_ID,
    canonicalPumpPoolPda,
    buyQuoteInput,
    sellBaseInput
} = require('@pump-fun/pump-swap-sdk');
const BN = require('bn.js');

const PUMPFUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

class PumpFunTrader extends ITrader {
    constructor(config = {}) {
        super(config);

        let slippage = config.slippage || config.defaultSlippage || 3;
        // 统一转换为百分比格式（如 0.05 → 5）
        if (slippage < 1) slippage = slippage * 100;

        this.config = {
            priorityFee: config.priorityFee || 0.001,
            maxRetries: config.maxRetries || 3,
            rpcUrl: config.rpcUrl || 'https://api.mainnet-beta.solana.com',
            confirmTimeout: config.confirmTimeout || 30000,
            slippage
        };

        this.connection = new Connection(this.config.rpcUrl, {
            commitment: 'confirmed',
            confirmTransactionInitialTimeout: this.config.confirmTimeout
        });

        this.onlinePumpSdk = new OnlinePumpSdk(this.connection);
        this.onlineAmmSdk = new OnlinePumpAmmSdk(this.connection);

        this.wallet = null;

        this.logger = config.logger || console;

        this.logger.info('PumpFunTrader 初始化完成', {
            pumpProgramId: PUMP_PROGRAM_ID.toBase58(),
            ammProgramId: PUMP_AMM_PROGRAM_ID.toBase58(),
            rpcUrl: this.config.rpcUrl
        });
    }

    async setWallet(privateKey) {
        const { Keypair } = require('@solana/web3.js');

        if (typeof privateKey === 'string') {
            const bs58 = require('bs58');
            const secretKey = bs58.decode(privateKey);
            this.wallet = Keypair.fromSecretKey(secretKey);
        } else if (privateKey instanceof Keypair) {
            this.wallet = privateKey;
        } else if (privateKey instanceof Uint8Array || Buffer.isBuffer(privateKey)) {
            this.wallet = Keypair.fromSecretKey(privateKey);
        } else {
            throw new Error('无效的私钥格式，支持 bs58 字符串、Keypair 或 Uint8Array');
        }

        this.logger.info('PumpFunTrader 钱包已设置', {
            address: this.wallet.publicKey.toBase58()
        });

        await this._verifyWalletConnection();
    }

    async _verifyWalletConnection() {
        const balance = await this.connection.getBalance(this.wallet.publicKey);
        this.logger.info('钱包余额', {
            address: this.wallet.publicKey.toBase58(),
            balance: `${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL`
        });
    }

    async getNativeBalance() {
        if (!this.wallet) throw new Error('请先设置钱包');
        const balance = await this.connection.getBalance(this.wallet.publicKey);
        return (balance / LAMPORTS_PER_SOL).toString();
    }

    /**
     * 检测代币交易模式：bonding curve（内盘）或 AMM（外盘）
     * 通过读取 bonding curve 账户的 complete 标志判断
     */
    async _detectTokenMode(tokenMint) {
        const [bondingCurve] = PublicKey.findProgramAddressSync(
            [Buffer.from('bonding-curve'), tokenMint.toBuffer()],
            PUMPFUN_PROGRAM_ID
        );

        const accountInfo = await this.connection.getAccountInfo(bondingCurve);
        if (!accountInfo || !accountInfo.data) {
            // bonding curve 账户不存在，代币已毕业到 AMM
            return { mode: 'amm', bondingCurve: null };
        }

        const decoded = PUMP_SDK.decodeBondingCurve(accountInfo.data);
        if (decoded.complete) {
            return { mode: 'amm', bondingCurve: decoded };
        }

        return { mode: 'bonding', bondingCurve: decoded };
    }

    // ==================== 统一买卖接口 ====================

    async buyToken(tokenAddress, amountIn, options = {}) {
        const operationId = this._generateOperationId();
        const startTime = Date.now();

        if (!this.wallet) throw new Error('请先设置钱包（调用 setWallet）');

        const tokenMint = new PublicKey(tokenAddress);

        // 统一处理 amountIn → SOL 数值 → lamports
        const solAmount = this._parseSolAmount(amountIn);
        const amountInLamports = new BN(Math.floor(solAmount * LAMPORTS_PER_SOL));

        let slippage = this._normalizeSlippage(options.slippage || this.config.slippage);

        const { mode } = await this._detectTokenMode(tokenMint);

        this.logger.info('PumpFun 买入', {
            operationId, tokenAddress, solAmount, mode,
            lamports: amountInLamports.toString()
        });

        let result;
        if (mode === 'bonding') {
            result = await this._buyBondingCurve(tokenMint, amountInLamports, slippage, operationId, startTime);
        } else {
            result = await this._buyAMM(tokenMint, amountInLamports, slippage, operationId, startTime);
        }

        result.details = { ...result.details, mode, tokenAddress, operationId };
        return result;
    }

    async sellToken(tokenAddress, amountIn, options = {}) {
        const operationId = this._generateOperationId();
        const startTime = Date.now();

        if (!this.wallet) throw new Error('请先设置钱包（调用 setWallet）');

        const tokenMint = new PublicKey(tokenAddress);

        let slippage = this._normalizeSlippage(options.slippage || this.config.slippage);

        // 解析卖出数量
        const baseAmountIn = await this._resolveSellAmount(tokenMint, amountIn);

        const { mode } = await this._detectTokenMode(tokenMint);

        this.logger.info('PumpFun 卖出', {
            operationId, tokenAddress, amountIn, mode,
            baseAmount: baseAmountIn.toString()
        });

        let result;
        if (mode === 'bonding') {
            result = await this._sellBondingCurve(tokenMint, baseAmountIn, slippage, operationId, startTime);
        } else {
            result = await this._sellAMM(tokenMint, baseAmountIn, slippage, operationId, startTime);
        }

        result.details = { ...result.details, mode, tokenAddress, operationId };
        return result;
    }

    // ==================== Bonding Curve 交易（内盘） ====================

    async _buyBondingCurve(tokenMint, amountInLamports, slippage, operationId, startTime) {
        // 获取全局状态和 fee config
        const global = await this.onlinePumpSdk.fetchGlobal();
        const feeConfig = await this.onlinePumpSdk.fetchFeeConfig();

        // 获取 bonding curve 买卖状态
        const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } =
            await this.onlinePumpSdk.fetchBuyState(tokenMint, this.wallet.publicKey);

        // 获取 mint info 以确定 tokenProgram
        const mintAccountInfo = await this.connection.getParsedAccountInfo(tokenMint);
        const tokenProgram = this._detectTokenProgram(mintAccountInfo);

        // 计算预期获得的代币数量
        const expectedTokens = getBuyTokenAmountFromSolAmount({
            global,
            feeConfig,
            mintSupply: bondingCurve.tokenTotalSupply,
            bondingCurve,
            amount: amountInLamports,
            quoteMint: bondingCurve.quoteMint || WSOL_MINT
        });

        // 计算含滑点的最大 SOL 支付（slippage 为百分比，如 3 表示 3%）
        const maxSolAmount = amountInLamports.muln(100 + slippage).divn(100);

        this.logger.info('Bonding Curve 买入参数', {
            operationId,
            solIn: amountInLamports.toString(),
            expectedTokens: expectedTokens.toString(),
            maxSol: maxSolAmount.toString(),
            tokenProgram: tokenProgram.toBase58()
        });

        // 使用 buyV2Instructions（内部处理 ATA 创建、fee recipient 等）
        const instructions = await PUMP_SDK.buyV2Instructions({
            global,
            bondingCurveAccountInfo,
            bondingCurve,
            associatedUserAccountInfo,
            mint: tokenMint,
            user: this.wallet.publicKey,
            amount: expectedTokens,
            quoteAmount: maxSolAmount,
            slippage,
            tokenProgram
        });

        const transaction = new Transaction();
        transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
        for (const ix of instructions) {
            transaction.add(ix);
        }

        const signature = await this._sendTransaction(transaction);
        const executionTime = Date.now() - startTime;

        this.logger.info('Bonding Curve 买入成功', {
            operationId, signature, executionTime: `${executionTime}ms`
        });

        return {
            success: true,
            transactionHash: signature,
            amountIn: (Number(amountInLamports) / LAMPORTS_PER_SOL).toString(),
            expectedAmountOut: expectedTokens.toString(),
            executionTime,
            details: {
                operationId,
                type: 'pumpfun_bonding_buy'
            }
        };
    }

    async _sellBondingCurve(tokenMint, baseAmountIn, slippage, operationId, startTime) {
        const global = await this.onlinePumpSdk.fetchGlobal();
        const feeConfig = await this.onlinePumpSdk.fetchFeeConfig();

        const { bondingCurveAccountInfo, bondingCurve } =
            await this.onlinePumpSdk.fetchSellState(tokenMint, this.wallet.publicKey);

        const mintAccountInfo = await this.connection.getParsedAccountInfo(tokenMint);
        const tokenProgram = this._detectTokenProgram(mintAccountInfo);

        // 计算预期获得的 SOL 数量
        const expectedSol = getSellSolAmountFromTokenAmount({
            global,
            feeConfig,
            mintSupply: bondingCurve.tokenTotalSupply,
            bondingCurve,
            amount: baseAmountIn
        });

        this.logger.info('Bonding Curve 卖出参数', {
            operationId,
            tokensIn: baseAmountIn.toString(),
            expectedSol: expectedSol.toString(),
            tokenProgram: tokenProgram.toBase58()
        });

        const instructions = await PUMP_SDK.sellV2Instructions({
            global,
            bondingCurveAccountInfo,
            bondingCurve,
            mint: tokenMint,
            user: this.wallet.publicKey,
            amount: baseAmountIn,
            quoteAmount: expectedSol,
            slippage,
            tokenProgram
        });

        const transaction = new Transaction();
        transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
        for (const ix of instructions) {
            transaction.add(ix);
        }

        const signature = await this._sendTransaction(transaction);
        const executionTime = Date.now() - startTime;

        this.logger.info('Bonding Curve 卖出成功', {
            operationId, signature, executionTime: `${executionTime}ms`
        });

        return {
            success: true,
            transactionHash: signature,
            amountIn: baseAmountIn.toString(),
            expectedAmountOut: (Number(expectedSol) / LAMPORTS_PER_SOL).toString(),
            executionTime,
            details: {
                operationId,
                type: 'pumpfun_bonding_sell'
            }
        };
    }

    // ==================== AMM 交易（外盘） ====================

    async _buyAMM(tokenMint, amountInLamports, slippage, operationId, startTime) {
        const poolKey = canonicalPumpPoolPda(tokenMint);

        const swapState = await this.onlineAmmSdk.swapSolanaState(
            poolKey,
            this.wallet.publicKey
        );

        const { base, maxQuote } = buyQuoteInput({
            quote: amountInLamports,
            slippage,
            baseReserve: swapState.poolBaseAmount,
            quoteReserve: swapState.poolQuoteAmount,
            baseMintAccount: swapState.baseMintAccount,
            baseMint: swapState.baseMint,
            coinCreator: swapState.pool.coinCreator,
            creator: swapState.pool.creator,
            feeConfig: swapState.feeConfig,
            globalConfig: swapState.globalConfig
        });

        this.logger.info('AMM 买入参数', {
            operationId,
            solIn: amountInLamports.toString(),
            baseOut: base.toString(),
            maxQuote: maxQuote.toString()
        });

        const instructions = await PUMP_AMM_SDK.buyInstructions(
            swapState, base, maxQuote
        );

        const transaction = new Transaction();
        transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
        for (const ix of instructions) {
            transaction.add(ix);
        }

        const signature = await this._sendTransaction(transaction);
        const executionTime = Date.now() - startTime;

        this.logger.info('AMM 买入成功', {
            operationId, signature, executionTime: `${executionTime}ms`
        });

        return {
            success: true,
            transactionHash: signature,
            amountIn: (Number(amountInLamports) / LAMPORTS_PER_SOL).toString(),
            expectedAmountOut: base.toString(),
            executionTime,
            details: {
                operationId,
                poolAddress: poolKey.toBase58(),
                type: 'pumpfun_amm_buy'
            }
        };
    }

    async _sellAMM(tokenMint, baseAmountIn, slippage, operationId, startTime) {
        const poolKey = canonicalPumpPoolPda(tokenMint);

        const swapState = await this.onlineAmmSdk.swapSolanaState(
            poolKey,
            this.wallet.publicKey
        );

        const { uiQuote, minQuote } = sellBaseInput({
            base: baseAmountIn,
            slippage,
            baseReserve: swapState.poolBaseAmount,
            quoteReserve: swapState.poolQuoteAmount,
            baseMintAccount: swapState.baseMintAccount,
            baseMint: swapState.baseMint,
            coinCreator: swapState.pool.coinCreator,
            creator: swapState.pool.creator,
            feeConfig: swapState.feeConfig,
            globalConfig: swapState.globalConfig
        });

        this.logger.info('AMM 卖出参数', {
            operationId,
            tokensIn: baseAmountIn.toString(),
            expectedQuote: uiQuote.toString(),
            minQuote: minQuote.toString()
        });

        const instructions = await PUMP_AMM_SDK.sellInstructions(
            swapState, baseAmountIn, minQuote
        );

        const transaction = new Transaction();
        transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
        for (const ix of instructions) {
            transaction.add(ix);
        }

        const signature = await this._sendTransaction(transaction);
        const executionTime = Date.now() - startTime;

        this.logger.info('AMM 卖出成功', {
            operationId, signature, executionTime: `${executionTime}ms`
        });

        return {
            success: true,
            transactionHash: signature,
            amountIn: baseAmountIn.toString(),
            expectedAmountOut: (Number(uiQuote) / LAMPORTS_PER_SOL).toString(),
            executionTime,
            details: {
                operationId,
                poolAddress: poolKey.toBase58(),
                type: 'pumpfun_amm_sell'
            }
        };
    }

    // ==================== 辅助方法 ====================

    _normalizeSlippage(slippage) {
        if (slippage < 1) slippage = slippage * 100;
        return slippage;
    }

    _parseSolAmount(amountIn) {
        if (typeof amountIn === 'number') return amountIn;
        if (typeof amountIn === 'string') return parseFloat(amountIn);
        if (typeof amountIn === 'object' && amountIn?.toString) {
            return parseFloat(amountIn.toString()) / LAMPORTS_PER_SOL;
        }
        throw new Error(`无法解析 SOL 金额: ${amountIn}`);
    }

    async _resolveSellAmount(tokenMint, amountIn) {
        if (amountIn === '100' || amountIn === 'max' || amountIn === 'all') {
            // 获取全部代币余额
            const tokenAccounts = await this.connection.getTokenAccountsByOwner(
                this.wallet.publicKey,
                { mint: tokenMint }
            );
            if (tokenAccounts.value.length === 0) {
                throw new Error(`钱包没有代币 ${tokenMint.toBase58()} 的账户`);
            }
            const tokenAccount = tokenAccounts.value[0].pubkey;
            const balance = await this.connection.getTokenAccountBalance(tokenAccount);
            return new BN(balance.value.amount);
        }

        // 指定数量：需要考虑代币精度
        const amountValue = typeof amountIn === 'object' && amountIn?.toString
            ? parseFloat(amountIn.toString())
            : parseFloat(amountIn);

        // 如果已经是很大的数字（可能是链上原始单位），直接使用
        if (amountValue > 1e9) {
            return new BN(Math.floor(amountValue).toString());
        }

        // 获取代币精度
        const mintInfo = await this.connection.getParsedAccountInfo(tokenMint);
        const decimals = mintInfo.value?.data?.parsed?.info?.decimals || 6;
        return new BN(Math.floor(amountValue * Math.pow(10, decimals)));
    }

    _detectTokenProgram(mintAccountInfo) {
        if (!mintAccountInfo.value) return TOKEN_PROGRAM_ID;
        const owner = mintAccountInfo.value.owner;
        if (owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
        return TOKEN_PROGRAM_ID;
    }

    async _sendTransaction(transaction) {
        const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = this.wallet.publicKey;
        transaction.sign(this.wallet);

        const serialized = transaction.serialize();

        const maxRetries = this.config.maxRetries || 3;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.logger.info('PumpFun 发送交易', { attempt, maxRetries });

                const signature = await this.connection.sendRawTransaction(
                    serialized,
                    { skipPreflight: true, preflightCommitment: 'confirmed' }
                );

                // 使用 lastValidBlockHeight 控制确认超时
                const confirmation = await this.connection.confirmTransaction(
                    {
                        signature,
                        blockhash,
                        lastValidBlockHeight
                    },
                    'confirmed'
                );

                if (confirmation.value.err) {
                    throw new Error(`交易失败: ${JSON.stringify(confirmation.value.err)}`);
                }

                if (attempt > 1) {
                    this.logger.info('PumpFun 交易重试成功', { attempt, signature });
                }

                return signature;

            } catch (error) {
                lastError = error;
                const errorMessage = error.message?.toLowerCase() || '';

                // 不应重试的错误
                const nonRetryable = [
                    'transaction failed',
                    'insufficient funds',
                    'invalid signature',
                    'already processed',
                    'custom program error'
                ];
                if (nonRetryable.some(e => errorMessage.includes(e))) {
                    this.logger.error('PumpFun 交易不可重试错误', { attempt, error: error.message });
                    break;
                }

                this.logger.warn('PumpFun 交易尝试失败', { attempt, error: error.message });

                if (attempt < maxRetries) {
                    // 递增等待：1s, 2s, 3s
                    const waitTime = attempt * 1000;
                    this.logger.info('PumpFun 等待后重试', { waitMs: waitTime });
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
        }

        throw new Error(`交易在 ${maxRetries} 次尝试后仍失败: ${lastError?.message}`);
    }

    async checkLiquidity(tokenAddress) {
        const tokenMint = new PublicKey(tokenAddress);
        const { mode } = await this._detectTokenMode(tokenMint);

        if (mode === 'amm') {
            const poolKey = canonicalPumpPoolPda(tokenMint);
            const poolAccount = await this.connection.getAccountInfo(poolKey);
            return !!poolAccount;
        }

        // Bonding curve 模式：只要 bonding curve 存在就有流动性
        return true;
    }

    async getTokenPrice(tokenAddress) {
        const tokenMint = new PublicKey(tokenAddress);
        const { mode } = await this._detectTokenMode(tokenMint);

        if (mode === 'amm') {
            const poolKey = canonicalPumpPoolPda(tokenMint);
            const swapState = await this.onlineAmmSdk.swapSolanaState(
                poolKey, PublicKey.default
            );
            const baseReserve = swapState.poolBaseAmount;
            const quoteReserve = swapState.poolQuoteAmount;
            if (baseReserve.isZero()) return '0';
            const pricePerToken = quoteReserve.mul(new BN(LAMPORTS_PER_SOL)).div(baseReserve);
            return (Number(pricePerToken) / LAMPORTS_PER_SOL).toString();
        }

        // Bonding curve 价格
        const global = await this.onlinePumpSdk.fetchGlobal();
        const feeConfig = await this.onlinePumpSdk.fetchFeeConfig();
        const { bondingCurve } = await this._detectTokenMode(tokenMint);
        if (!bondingCurve || bondingCurve.virtualTokenReserves.isZero()) return '0';

        // 用 1 SOL 的买入量来反推价格
        const oneSol = new BN(LAMPORTS_PER_SOL);
        const tokensForOneSol = getBuyTokenAmountFromSolAmount({
            global, feeConfig,
            mintSupply: bondingCurve.tokenTotalSupply,
            bondingCurve,
            amount: oneSol,
            quoteMint: bondingCurve.quoteMint || WSOL_MINT
        });

        if (tokensForOneSol.isZero()) return '0';
        // 价格 = 1 SOL / tokensForOneSol（以 SOL 为单位）
        const price = oneSol.mul(new BN(LAMPORTS_PER_SOL)).div(tokensForOneSol);
        return (Number(price) / LAMPORTS_PER_SOL).toString();
    }

    async swap(params) {
        let isBuy;
        let tokenAddress;
        let amount;
        let slippage;

        if (params.direction) {
            isBuy = params.direction === 'buy';
            tokenAddress = params.tokenAddress;
            amount = params.amount;
            slippage = params.slippage;
        } else {
            const { from, to } = params;
            amount = params.amount;
            slippage = params.slippage;
            isBuy = from === WSOL_MINT.toBase58() ||
                from?.toLowerCase() === WSOL_MINT.toBase58().toLowerCase();
            tokenAddress = isBuy ? to : from;
        }

        if (isBuy) {
            return await this.buyToken(tokenAddress, amount, { slippage });
        }
        return await this.sellToken(tokenAddress, amount, { slippage });
    }

    getInfo() {
        return {
            name: 'PumpFunTrader',
            version: '1.0.0',
            description: 'Pump.fun 内外盘统一交易器（bonding curve + PumpSwap AMM）',
            network: {
                name: 'Solana',
                chainId: 'mainnet-beta',
                pumpProgramId: PUMP_PROGRAM_ID.toBase58(),
                ammProgramId: PUMP_AMM_PROGRAM_ID.toBase58()
            },
            config: this.config,
            walletAddress: this.wallet ? this.wallet.publicKey.toBase58() : null,
            isConnected: !!this.connection,
            supportedChains: ['solana']
        };
    }

    async healthCheck() {
        const slot = await this.connection.getSlot();
        return {
            status: 'healthy',
            timestamp: Date.now(),
            slot,
            wallet: this.wallet ? {
                address: this.wallet.publicKey.toBase58(),
                isConnected: true
            } : { address: null, isConnected: false },
            pumpProgramId: PUMP_PROGRAM_ID.toBase58(),
            ammProgramId: PUMP_AMM_PROGRAM_ID.toBase58()
        };
    }

    _generateOperationId() {
        return `pumpfun_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

module.exports = PumpFunTrader;
