#!/usr/bin/env node
/**
 * live 加固层零 DB 单测（不打真实链、不连 Supabase）
 *
 * 覆盖：
 *   1. assertMinOut（core/preTradeCheck）纯函数全分支——含 BURNIE 事故数值复现
 *   2. FourMemeDirectTrader._awaitReceipt 超时/回查终态/reverted 路径（打桩 provider）
 *   3. FlapPortalTrader：quote 方向参数 / buyToken 预成交校验拒绝（拒单必须发生在
 *      发交易之前）/ buyToken 余额差记账 / sellToken fail-closed（有锚 + 预估失败）
 *      / sellToken 余额钳制 + approve 决策 + 实收=余额差+gas 补偿
 *   4. TraderFactory 'flap' 注册位
 *
 * 打桩方式：直接替换 trader 实例的 provider / portalContract / wallet 字段，
 * ethers.Contract 用同签名函数包装（仅 token 合约场景返回桩）。
 *
 * 运行：node scripts/_test_live_hardening.cjs
 */

const assert = require('assert');
const path = require('path');
const { ethers } = require('ethers');

const ROOT = path.resolve(__dirname, '..');
const { assertMinOut } = require(path.join(ROOT, 'src/trading-engine/traders/core/preTradeCheck'));

let passed = 0;
function ok(cond, label) {
  if (!cond) throw new Error(`FAIL: ${label}`);
  passed++;
  console.log(`  ✅ ${label}`);
}

async function main() {
  const Q = (s) => ethers.parseUnits(s, 18);

  // ============ 1. assertMinOut 纯函数 ============
  console.log('\n[1] assertMinOut 纯函数');
  {
    // 通过：ratio 0.6 ≥ 0.5
    const r = assertMinOut({ expectedOut: '100', decimals: 18, quoteOutRaw: Q('60'), minOutRatio: 0.5, context: 't' });
    ok(r.ratio === '0.600000', 'ratio 0.6 放行并返回换算');

    // 边界：恰 0.5 通过（lt 语义，等于不拒）
    assertMinOut({ expectedOut: '100', decimals: 18, quoteOutRaw: Q('50'), minOutRatio: 0.5, context: 't' });
    ok(true, '边界 ratio=0.5 恰好放行');

    // 拒绝：ratio 0.499
    assert.throws(
      () => assertMinOut({ expectedOut: '100', decimals: 18, quoteOutRaw: Q('49.9'), minOutRatio: 0.5, context: 't' }),
      /拒绝执行/,
    );
    ok(true, 'ratio 0.499 拒绝');

    // BURNIE 复现：预期 98855 实报 139.34 → ratio≈0.0014 必拦
    assert.throws(
      () => assertMinOut({ expectedOut: '98855', decimals: 18, quoteOutRaw: Q('139.34'), minOutRatio: 0.5, context: 'BURNIE' }),
      /ratio=0\.0014/,
    );
    ok(true, 'BURNIE 数值复现被拦截 (ratio=0.001410)');

    // 参数契约：缺 expectedOut / 非法 ratio / 非法 decimals / 零报价
    assert.throws(() => assertMinOut({ decimals: 18, quoteOutRaw: Q('1'), minOutRatio: 0.5 }), /参数缺失/);
    assert.throws(() => assertMinOut({ expectedOut: '1', decimals: 18, quoteOutRaw: Q('1'), minOutRatio: 1.5 }), /参数非法/);
    assert.throws(() => assertMinOut({ expectedOut: '1', decimals: 19, quoteOutRaw: Q('1'), minOutRatio: 0.5 }), /参数非法/);
    assert.throws(() => assertMinOut({ expectedOut: '1', decimals: 18, quoteOutRaw: 0n, minOutRatio: 0.5 }), /报价到手量非法/);
    ok(true, '参数契约四分支全部 throw');
  }

  // ============ 2. _awaitReceipt 超时语义（打桩 provider；Flap 实现同语义，用 FourMeme 验证） ============
  console.log('\n[2] _awaitReceipt 超时语义（打桩 provider）');
  {
    const FourMemeDirectTrader = require(path.join(ROOT, 'src/trading-engine/traders/implementations/FourMemeDirectTrader'));
    const trader = new FourMemeDirectTrader({ network: { rpcUrl: 'http://localhost:1' } }); // JsonRpcProvider 构造不发请求
    trader.txWaitTimeoutMs = 1000;

    // 2a. 超时 + 回查 null → throw 带 txHash（绝不重发）
    trader.provider = {
      waitForTransaction: async () => { throw new Error('timeout'); },
      getTransactionReceipt: async () => null,
    };
    await assert.rejects(
      () => trader._awaitReceipt({ hash: '0xabc' }, '买入'),
      /确认超时\(1s\)，txHash=0xabc/,
    );
    ok(true, '超时未上链 → throw 带 txHash（不重发）');

    // 2b. 超时 + 回查已上链成功 → 返回 receipt
    const receiptStub = { status: 1, hash: '0xabc', blockNumber: 123, gasUsed: 21000n, logs: [] };
    trader.provider = {
      waitForTransaction: async () => { throw new Error('timeout'); },
      getTransactionReceipt: async () => receiptStub,
    };
    const got = await trader._awaitReceipt({ hash: '0xabc' }, '买入');
    ok(got === receiptStub, '超时回查已上链 → 返回完整 receipt');

    // 2c. reverted → throw
    trader.provider = {
      waitForTransaction: async () => ({ ...receiptStub, status: 0 }),
      getTransactionReceipt: async () => { throw new Error('should not be called'); },
    };
    await assert.rejects(() => trader._awaitReceipt({ hash: '0xabc' }, '卖出'), /reverted/);
    ok(true, 'reverted → throw');

    // 2d. 正常成功
    trader.provider = {
      waitForTransaction: async () => receiptStub,
      getTransactionReceipt: async () => { throw new Error('should not be called'); },
    };
    ok((await trader._awaitReceipt({ hash: '0xabc' }, '买入')) === receiptStub, '正常确认 → 返回 receipt');
  }

  // ============ 3. FlapPortalTrader ============
  console.log('\n[3] FlapPortalTrader（打桩 Portal 合约 + Provider RPC 层）');
  {
    const FlapPortalTrader = require(path.join(ROOT, 'src/trading-engine/traders/implementations/FlapPortalTrader'));
    const trader = new FlapPortalTrader({ network: { rpcUrl: 'http://localhost:1' } });
    trader.txWaitTimeoutMs = 1000;

    const TOKEN = '0x' + '11'.repeat(20); // 纯数字地址：EIP-55 checksum 后原样

    // ---- 打桩基建 ----
    // ethers.Contract 无法 monkey-patch（v6 导出属性 getter-only），改用真实
    // JsonRpcProvider/Wallet 实例 + 实例级 RPC 方法覆盖：token ERC20 合约走完整
    // Contract 编解码（provider.call 按 selector 分发），approve 走真实签名链
    // （broadcastTransaction 桩拦截），仅 Portal 合约直接换桩对象。
    const provider = new ethers.JsonRpcProvider('http://localhost:1');
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const SEL_BALANCE_OF = '0x70a08231';
    const SEL_ALLOWANCE = '0xdd62ed3e';
    const st = {
      tokenBalance: 0n,       // token balanceOf 应答（闭包，测试随时改）
      tokenAllowance: 0n,     // allowance 应答
      walletBnb: Q('10'),     // getBalance(wallet) 应答（恒值 → 差 0）
      receipt: { status: 1, hash: '0x', blockNumber: 5, gasUsed: 150000n, gasPrice: 10n ** 9n, logs: [] },
      broadcastCount: 0,      // approve（wallet.sendTransaction）广播次数
    };
    provider.call = async ({ data }) => {
      const sel = data.slice(0, 10);
      if (sel === SEL_BALANCE_OF) return coder.encode(['uint256'], [st.tokenBalance]);
      if (sel === SEL_ALLOWANCE) return coder.encode(['uint256'], [st.tokenAllowance]);
      throw new Error(`stub provider.call: unexpected selector ${sel}`);
    };
    provider.broadcastTransaction = async () => { st.broadcastCount++; return { hash: '0xtx-ap' }; };
    provider.waitForTransaction = async (hash) => ({ ...st.receipt, hash });
    provider.getTransactionReceipt = async () => null;
    provider.getBalance = async (addr) => (addr.toLowerCase() === trader.wallet.address.toLowerCase() ? st.walletBnb : 0n);
    provider.getNetwork = async () => ethers.Network.from(56); // chainId 填充（否则真实 eth_chainId 请求）
    provider.getTransactionCount = async () => 1;          // nonce 填充
    provider.estimateGas = async () => 100000n;            // tx gasLimit 填充
    provider.getFeeData = async () => ({ gasPrice: 10n ** 9n, maxFeePerGas: null, maxPriorityFeePerGas: null });

    trader.provider = provider;
    trader.wallet = ethers.Wallet.createRandom().connect(provider); // 真实 Signer（Contract runner 校验需要）

    // ---- 3a. quote 方向参数（buy: 0x0→token；sell: token→0x0）----
    let quoteCalls = [];
    trader.portalContract = {
      quoteExactInput: { staticCall: async (params) => { quoteCalls.push(params); return Q('100'); } },
      swapExactInput: async () => { throw new Error('should not be called'); },
    };
    await trader.quote(TOKEN, Q('1'), 'buy');
    await trader.quote(TOKEN, Q('100'), 'sell');
    ok(quoteCalls[0].inputToken === ethers.ZeroAddress && quoteCalls[0].outputToken === TOKEN, 'buy 方向 0x0→token');
    ok(quoteCalls[1].inputToken === TOKEN && quoteCalls[1].outputToken === ethers.ZeroAddress, 'sell 方向 token→0x0');

    // ---- 3b. buyToken 校验拒绝：拒单必须发生在发交易之前 ----
    let swapSent = false;
    trader.portalContract = {
      quoteExactInput: { staticCall: async () => Q('139.34') }, // BURNIE 报价
      swapExactInput: async () => { swapSent = true; throw new Error('MUST NOT SEND TX'); },
    };
    const buyReject = await trader.buyToken(TOKEN, Q('0.001'), { expectedTokenOut: 98855, minOutRatio: 0.5 });
    ok(buyReject.success === false && /拒绝执行/.test(buyReject.error), 'buyToken 灾难报价拒单');
    ok(swapSent === false, '拒单发生在签名之前（swapExactInput 未被调用）');

    // ---- 3c. buyToken 成功路径：余额差记账（税后到手）----
    let swapParams = null, swapOpts = null;
    st.tokenBalance = 0n;
    trader.portalContract = {
      quoteExactInput: { staticCall: async () => Q('1000') },
      swapExactInput: async (params, opts) => {
        swapParams = params; swapOpts = opts;
        st.tokenBalance = Q('990'); // 模拟链上：报价 1000 被 1% 税扣到 990 到账
        return { hash: '0xtx1' };
      },
    };
    const broadcastBefore = st.broadcastCount;
    const buyOk = await trader.buyToken(TOKEN, Q('0.001'), { expectedTokenOut: '900', minOutRatio: 0.5 });
    ok(buyOk.success === true, 'buyToken 成功');
    ok(buyOk.transactionHash === '0xtx1', 'txHash 透传');
    ok(buyOk.actualAmountOut === ethers.formatUnits(Q('990'), 18), `实际到手=余额差(税后) ${buyOk.actualAmountOut}`);
    ok(swapParams.minOutputAmount > 0n && swapParams.minOutputAmount < Q('1000'), 'minOutputAmount = 报价×(1-滑点1%)');
    ok(swapOpts.value === swapParams.inputAmount && swapOpts.value === Q('0.001'), 'payable value = inputAmount');
    ok(swapParams.permitData === '0x', 'permitData 走 approve 路径传 0x');
    ok(st.broadcastCount === broadcastBefore, '买入路径不经 wallet 广播（swap 走 Portal 桩）');

    // ---- 3d. sellToken fail-closed：有锚 + quote 失败 → 拒绝（不裸奔）----
    swapSent = false;
    trader.portalContract = {
      quoteExactInput: { staticCall: async () => { throw new Error('portal quote reverted'); } },
      swapExactInput: async () => { swapSent = true; throw new Error('MUST NOT SEND TX'); },
    };
    st.tokenBalance = Q('500');
    st.tokenAllowance = Q('500'); // 足额：approve 不触发
    const bcBefore3d = st.broadcastCount;
    const sellReject = await trader.sellToken(TOKEN, Q('100'), { expectedNativeOut: '0.05', minOutRatio: 0.5 });
    ok(sellReject.success === false && /fail-closed/.test(sellReject.error), 'sell 预估失败+有锚 → fail-closed 拒绝');
    ok(swapSent === false && st.broadcastCount === bcBefore3d, 'fail-closed 拒单未发交易未广播');

    // ---- 3e. sellToken 灾难报价拒绝（尘埃报价，相对滑点失效场景）----
    swapSent = false;
    trader.portalContract = {
      quoteExactInput: { staticCall: async () => Q('0.0001') },
      swapExactInput: async () => { swapSent = true; throw new Error('MUST NOT SEND TX'); },
    };
    st.tokenBalance = Q('500');
    st.tokenAllowance = Q('500');
    const sellDust = await trader.sellToken(TOKEN, Q('100'), { expectedNativeOut: '0.5', minOutRatio: 0.5 });
    ok(sellDust.success === false && /拒绝执行/.test(sellDust.error), 'sell 尘埃报价拒绝 (ratio≈0.0002)');
    ok(swapSent === false, '尘埃报价拒单未发交易');

    // ---- 3f. sellToken 余额钳制 + approve 决策 + 实收=BNB余额差+gas 补偿 ----
    swapSent = false; swapParams = null;
    trader.portalContract = {
      quoteExactInput: { staticCall: async () => Q('0.3') }, // 锚 0.25 → ratio 1.2 放行
      swapExactInput: async (params) => { swapSent = true; swapParams = params; return { hash: '0xtx2' }; },
    };
    st.tokenBalance = Q('500'); // 余额 < 请求的 600 → 钳制
    st.tokenAllowance = 0n;     // 不足 → 触发 approve
    const bcBefore3f = st.broadcastCount;
    const sellOk = await trader.sellToken(TOKEN, Q('600'), { expectedNativeOut: '0.25', minOutRatio: 0.5 });
    ok(sellOk.success === true, 'sell 成功路径（钳制后）');
    ok(st.broadcastCount === bcBefore3f + 1, 'allowance 不足触发 approve（真实签名链广播一次）');
    ok(swapSent && swapParams.inputAmount === Q('500'), `超卖请求钳制到链上余额（${ethers.formatUnits(swapParams ? swapParams.inputAmount : 0n, 18)}）`);
    // getBalance 恒 Q('10') → 差 0，实收 = 0 + gas 补偿（150000 gas × 1 gwei）
    const expectedGasComp = ethers.formatEther(150000n * (10n ** 9n));
    ok(sellOk.actualReceived === expectedGasComp, `实收=BNB余额差+gas补偿 (${sellOk.actualReceived})`);
  }

  // ============ 4. TraderFactory 注册位 ============
  console.log('\n[4] TraderFactory 注册位');
  {
    const { createTrader, getSupportedTraderTypes } = require(path.join(ROOT, 'src/trading-engine/traders'));
    const types = getSupportedTraderTypes();
    ok(types.includes('flap'), `'flap' 已注册（${types.join(',')}）`);
    const t = createTrader('flap', { network: { rpcUrl: 'http://localhost:1' } });
    ok(t.constructor.name === 'FlapPortalTrader', "createTrader('flap') → FlapPortalTrader");
    ok(t.getInfo().portalAddress === '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0', 'Portal 地址对齐官方文档');
  }

  console.log(`\n✅ 全部通过（${passed} 断言）`);
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
