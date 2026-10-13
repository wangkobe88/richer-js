#!/usr/bin/env node
/**
 * four.meme 实收余额差法（B3 实盘加固）零网络单测
 *
 * 覆盖 FourMemeDirectTrader.buyToken/sellToken 的实收记账与死引用清除：
 *   1. buyToken：发送前 balanceOf 快照 → 交易 → balanceOf 差 = actualAmountOut
 *      （税后真相；报价 1000 被 3% 税扣到 970 到账 → 实得 970 而非报价 1000）
 *   2. sellToken：approve 后 bnbBefore 快照 → 卖出 → bnbAfter−bnbBefore+gasCost
 *      = actualReceived（链上到账真相；approve 的 gas 不混入实收）
 *   3. sellToken fail-closed：有锚 + trySell 预估失败 → 拒绝（不裸奔）
 *   4. 事故反证：旧死引用路径已清除——this.platformContract（从未定义恒
 *      TypeError）、calculateActualBnbReceived（receipt.value 启发式恒 0）、
 *      quotePrice 的 lastPrice fallback（引用死字段，从未真正生效）
 *
 * 打桩（_test_live_hardening 同款手法）：真实 JsonRpcProvider + 实例级 RPC
 * 方法覆盖——token ERC20 合约走完整 Contract 编解码（provider.call 按 selector
 * 分发），平台合约发单走 NonceManager→broadcastTransaction 桩拦截，
 * helperContract 直接换桩对象。
 *
 * 运行：node scripts/_test_fourmeme_actual_received.cjs
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');

const ROOT = path.resolve(__dirname, '..');
const FourMemeDirectTrader = require(path.join(ROOT, 'src/trading-engine/traders/implementations/FourMemeDirectTrader'));

let passed = 0, failed = 0;
function ok(cond, label, detail) {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.error(`  ❌ ${label}${detail ? ` | ${detail}` : ''}`); }
}

const Q = (s) => ethers.parseUnits(s, 18);

/** 全套打桩 trader（每个 case 重建；st 闭包状态随时改模拟链上变化） */
function mkTrader() {
    const trader = new FourMemeDirectTrader({ network: { rpcUrl: 'http://localhost:1' } });
    trader.txWaitTimeoutMs = 1000;

    const TOKEN = '0x' + '11'.repeat(20);
    const provider = new ethers.JsonRpcProvider('http://localhost:1');
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const SEL_BALANCE_OF = '0x70a08231';
    const SEL_ALLOWANCE = '0xdd62ed3e';
    const SEL_DECIMALS = '0x313ce567';

    const st = {
        tokenBalance: 0n,
        tokenAllowance: 0n,
        walletBnb: Q('10'),
        receipt: { status: 1, hash: '0xtx', blockNumber: 5, gasUsed: 150000n, gasPrice: 10n ** 9n, logs: [] },
        broadcasts: [],      // 每次广播记录 {data 首 10 字符}
        getBalanceCalls: 0,  // getBalance 调用计数（余额差法快照验证）
    };
    provider.call = async ({ data }) => {
        const sel = data.slice(0, 10);
        if (sel === SEL_BALANCE_OF) return coder.encode(['uint256'], [st.tokenBalance]);
        if (sel === SEL_ALLOWANCE) return coder.encode(['uint256'], [st.tokenAllowance]);
        if (sel === SEL_DECIMALS) return coder.encode(['uint8'], [18]);
        throw new Error(`stub provider.call: unexpected selector ${sel}`);
    };
    provider.broadcastTransaction = async (raw) => {
        st.broadcasts.push(raw || '');
        return { hash: '0xtx' };
    };
    provider.waitForTransaction = async (hash) => ({ ...st.receipt, hash });
    provider.getTransactionReceipt = async () => null;
    provider.getBalance = async () => { st.getBalanceCalls++; return st.walletBnb; };
    provider.getNetwork = async () => ethers.Network.from(56);
    provider.getTransactionCount = async () => 1;
    provider.estimateGas = async () => 100000n;
    provider.getFeeData = async () => ({ gasPrice: 3n * 10n ** 9n, maxFeePerGas: null, maxPriorityFeePerGas: null });

    trader.provider = provider;
    trader.wallet = ethers.Wallet.createRandom().connect(provider);
    trader.signer = new ethers.NonceManager(trader.wallet);

    return { trader, st, TOKEN, V2: trader.fourMemeConfig.v2PlatformAddress };
}

async function main() {
    // ═══════════════ 1. buyToken 余额差实收 ═══════════════
    console.log('\n[1] buyToken：token 余额差 = 实得（税后真相）');
    {
        const { trader, st, TOKEN, V2 } = mkTrader();
        trader.helperContract = {
            tryBuy: async () => ({
                tokenManager: V2,
                estimatedAmount: Q('1000'),
                estimatedCost: Q('0.001'),
                estimatedFee: 0n,
                amountMsgValue: Q('0.001'),
                quote: 0n,
            }),
        };

        st.tokenBalance = 0n;
        // 平台合约 buyTokenAMAP 走 NonceManager→broadcastTransaction 桩；
        // 广播即模拟链上变化：报价 1000 被 3% 税扣到 970 到账
        const origBroadcast = trader.provider.broadcastTransaction;
        trader.provider.broadcastTransaction = async (raw) => {
            st.tokenBalance = Q('970');
            return origBroadcast(raw);
        };

        const r = await trader.buyToken(TOKEN, Q('0.001'), { expectedTokenOut: '900', minOutRatio: 0.5 });
        ok(r.success === true, `buyToken 成功${r.success ? '' : `（${r.error}）`}`);
        ok(r.actualAmountOut === ethers.formatUnits(Q('970'), 18),
            `实得=余额差 970（3% 税后真相，≠报价 1000）: ${r.actualAmountOut}`);
        ok(r.expectedAmount === ethers.formatUnits(Q('1000'), 18), 'expectedAmount 保留报价口径（对照用）');
        ok(st.broadcasts.length === 1, '单笔广播（无重发）');
    }

    // buyToken 灾难报价拒单（L1 预成交锚）——B3 前置防线回归
    {
        const { trader, st, TOKEN, V2 } = mkTrader();
        trader.helperContract = {
            tryBuy: async () => ({
                tokenManager: V2, estimatedAmount: Q('139.34'), estimatedCost: Q('0.001'),
                estimatedFee: 0n, amountMsgValue: Q('0.001'), quote: 0n,
            }),
        };
        const bc = st.broadcasts.length;
        const r = await trader.buyToken(TOKEN, Q('0.001'), { expectedTokenOut: 98855, minOutRatio: 0.5 });
        ok(r.success === false && /拒绝执行/.test(r.error), 'BURNIE 级报价偏离拒单');
        ok(st.broadcasts.length === bc, '拒单发生在发交易之前');
    }

    // ═══════════════ 2. sellToken 余额差+gas 补偿实收 ═══════════════
    console.log('\n[2] sellToken：BNB 余额差 + gas 补偿 = 实收');
    {
        const { trader, st, TOKEN, V2 } = mkTrader();
        trader.helperContract = {
            trySell: async () => ({
                tokenManager: V2, quote: 0n, funds: Q('0.25'), fee: 0n,
            }),
        };

        st.tokenBalance = Q('500');
        st.tokenAllowance = 0n; // 触发 approve
        // 卖出广播时模拟 BNB 到账 0.24（预估净得 0.25，实收含池费差异）
        const origBroadcast = trader.provider.broadcastTransaction;
        let approveDone = false;
        trader.provider.broadcastTransaction = async (raw) => {
            if (!approveDone) { approveDone = true; return origBroadcast(raw); } // 第一笔=approve
            st.walletBnb = Q('10.24');
            return origBroadcast(raw);
        };

        const r = await trader.sellToken(TOKEN, Q('500'), { expectedNativeOut: '0.2', minOutRatio: 0.5 });
        ok(r.success === true, `sellToken 成功${r.success ? '' : `（${r.error}）`}`);
        ok(st.broadcasts.length === 2, '两笔广播（approve + sell）');
        // 实收 = 0.24（余额差）+ gas 补偿（150000 × 1 gwei）
        const expected = ethers.formatEther(Q('0.24') + 150000n * 10n ** 9n);
        ok(r.actualReceived === expected, `实收=余额差 0.24 + gas 补偿: ${r.actualReceived}`);
        ok(st.getBalanceCalls === 2, 'getBalance 恰两次（approve 后 bnbBefore + 卖出后 bnbAfter，approve gas 不混入）');
    }

    // 卖出超卖钳制 + 残仓整清（B5 关联语义回归）
    {
        const { trader, st, TOKEN, V2 } = mkTrader();
        trader.helperContract = {
            trySell: async () => ({ tokenManager: V2, quote: 0n, funds: Q('0.25'), fee: 0n }),
        };
        st.tokenBalance = Q('500');
        st.tokenAllowance = Q('500'); // 免 approve
        const r = await trader.sellToken(TOKEN, Q('600'), { expectedNativeOut: '0.2', minOutRatio: 0.5 });
        ok(r.success === true && r.amountOut === ethers.formatUnits(Q('500'), 18),
            `超卖请求钳制到链上余额: ${r.success ? r.amountOut : r.error}`);
        ok(st.broadcasts.length === 1, '免 approve 单笔广播');
    }

    // ═══════════════ 3. sellToken fail-closed（有锚+预估失败拒裸奔）═══════════════
    console.log('\n[3] sellToken fail-closed');
    {
        const { trader, st, TOKEN } = mkTrader();
        trader.helperContract = {
            trySell: async () => { throw new Error('trySell reverted'); },
        };
        st.tokenBalance = Q('500');
        st.tokenAllowance = Q('500');
        const bc = st.broadcasts.length;
        const r = await trader.sellToken(TOKEN, Q('100'), { expectedNativeOut: '0.05', minOutRatio: 0.5 });
        ok(r.success === false && /fail-closed/.test(r.error), '预估失败+有锚 → fail-closed 拒绝');
        ok(st.broadcasts.length === bc, '未发任何交易');
    }

    // ═══════════════ 4. 事故反证：死引用路径清除 ═══════════════
    console.log('\n[4] 死引用清除（事故反证）');
    {
        const raw = fs.readFileSync(path.join(ROOT, 'src/trading-engine/traders/implementations/FourMemeDirectTrader.js'), 'utf8');
        // 剥注释（B3 修复说明注释里保留了历史死引用名——注释非代码，断言只对可执行代码生效）
        const src = raw.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
        // 4a. this.platformContract 从未在构造器赋值——所有 this.platformContract 引用都是死代码
        ok(!/this\.platformContract\b/.test(src), 'this.platformContract 死引用已全清（B3 前恒 TypeError→catch）');
        // 4b. calculateActualBnbReceived（「日志启发式+receipt.value」实收恒 0/未知）已删
        ok(!src.includes('calculateActualBnbReceived'), 'calculateActualBnbReceived 死方法已删（余额差法替代）');
        // 4c. quotePrice 无 lastPrice fallback（tryBuy 失败即报价失败，catch 段干净）
        const quoteSeg = raw.slice(raw.indexOf('async quotePrice'), raw.indexOf('async buyToken'));
        ok(quoteSeg.includes('tryBuy 失败即报价失败') && !/this\.(platformContract|lastPrice)/.test(quoteSeg.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')),
            'quotePrice catch 段无死引用 fallback');
        // 4d. 实收两条主链在位：买 balanceOf 差 / 卖 getBalance 差
        ok(src.includes('tokenBalanceAfter - tokenBalanceBefore'), '买实收=balanceOf 差（源码口径）');
        ok(src.includes('bnbAfter - bnbBefore + gasCost'), '卖实收=BNB 余额差+gas 补偿（源码口径）');
        // 4e. bnbBefore 快照点在 approve 完成后（approve gas 不混入卖出实收）
        const approveIdx = src.indexOf("_awaitReceipt(approveTx, 'approve')");
        const bnbBeforeIdx = src.indexOf('const bnbBefore = await this.provider.getBalance');
        ok(approveIdx > 0 && bnbBeforeIdx > approveIdx, 'bnbBefore 快照在 approve 之后（approve gas 不混入实收）');
    }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('测试执行异常:', err); process.exit(1); });
