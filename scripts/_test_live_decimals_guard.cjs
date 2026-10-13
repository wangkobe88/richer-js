#!/usr/bin/env node
/**
 * B5 decimals 断言 + four.meme 卖出舍入/卖0防护 零 DB 单测（不打真实链）
 *
 * 覆盖：
 *   1. BaseTrader._assertDecimals18：=18 通过+per-token 缓存（二次零查询）/
 *      ≠18 拒绝 / 查询失败拒绝（fail-loud 不静默回落 18）
 *   2. FourMeme sellToken 6 位舍入（bigint 域向下截断）：大数量精确性
 *      （不经 float 往返——1e23 量级 float 只剩 ~16 位有效数字会错尾数）
 *   3. 卖0防护：舍入后 0 且有余额 → 卖全额（残仓整清）；链上余额 0 → 拒绝
 *   4. Flap buyToken：≠18 fail-closed 拒绝且不触达 swap
 *
 * 打桩方式：真实 JsonRpcProvider/Wallet + 实例级 RPC 覆盖（同 _test_live_hardening
 * 段 3）；four.meme 卖出量从 broadcastTransaction 拦截的签名 tx 解码（Transaction.from）。
 *
 * 运行：node scripts/_test_live_decimals_guard.cjs
 */

const assert = require('assert');
const path = require('path');
const { ethers } = require('ethers');

const ROOT = path.resolve(__dirname, '..');

let passed = 0;
function ok(cond, label) {
  if (!cond) throw new Error(`FAIL: ${label}`);
  passed++;
  console.log(`  ✅ ${label}`);
}

/** 打桩基建：provider.call 按 selector 分发（decimals 可注入），其余 RPC 全填桩 */
function makeStubbedProvider({ decimals, decimalsThrow } = {}) {
  const provider = new ethers.JsonRpcProvider('http://localhost:1');
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const sel = (sig) => ethers.id(sig).slice(0, 10);
  const SEL_BALANCE_OF = '0x70a08231';
  const SEL_ALLOWANCE = '0xdd62ed3e';
  const SEL_DECIMALS = '0x313ce567';
  const SEL_TRY_SELL = sel('trySell(address,uint256)');
  const st = {
    tokenBalance: 0n,
    tokenAllowance: 0n,
    walletBnb: ethers.parseEther('10'),
    decimalsCalls: 0,
    calls: [],
    broadcasts: [], // 签名 raw tx
    receipt: { status: 1, hash: '0xtx', blockNumber: 5, gasUsed: 150000n, gasPrice: 10n ** 9n, logs: [] },
  };
  provider.call = async ({ data }) => {
    const s = data.slice(0, 10);
    st.calls.push(s);
    if (s === SEL_BALANCE_OF) return coder.encode(['uint256'], [st.tokenBalance]);
    if (s === SEL_ALLOWANCE) return coder.encode(['uint256'], [st.tokenAllowance]);
    if (s === SEL_DECIMALS) {
      st.decimalsCalls++;
      if (decimalsThrow) throw new Error('rpc down');
      return coder.encode(['uint8'], [decimals]);
    }
    if (s === SEL_TRY_SELL) {
      // trySell(tokenManager=v2, quote=0x0, funds=0.3 BNB, fee=0.003)
      return coder.encode(
        ['address', 'address', 'uint256', 'uint256'],
        ['0x5c952063c7fc8610FFDB798152D69F0B9550762b', ethers.ZeroAddress, ethers.parseEther('0.3'), ethers.parseEther('0.003')],
      );
    }
    throw new Error(`stub provider.call: unexpected selector ${s}`);
  };
  provider.broadcastTransaction = async (raw) => { st.broadcasts.push(raw); return { hash: '0xbtx' }; };
  provider.waitForTransaction = async (hash) => ({ ...st.receipt, hash });
  provider.getTransactionReceipt = async () => null;
  provider.getBalance = async () => st.walletBnb;
  provider.getNetwork = async () => ethers.Network.from(56);
  provider.getTransactionCount = async () => 1;
  provider.estimateGas = async () => 100000n;
  provider.getFeeData = async () => ({ gasPrice: 10n ** 9n, maxFeePerGas: null, maxPriorityFeePerGas: null });
  return { provider, st };
}

/** four.meme trader 手动接线（不跑 setWallet/prepare：绕开 getCode 探测，合约现场即建） */
function makeFourMemeTrader(provider, wallet) {
  const FourMemeDirectTrader = require(path.join(ROOT, 'src/trading-engine/traders/implementations/FourMemeDirectTrader'));
  const trader = new FourMemeDirectTrader({ network: { rpcUrl: 'http://localhost:1' } });
  trader.provider = provider;
  trader.wallet = wallet;
  trader.signer = new ethers.NonceManager(wallet);
  trader.helperContract = new ethers.Contract(trader.fourMemeConfig.helperAddress, trader.helperAbi, provider);
  return trader;
}

/** 解码 broadcastTransaction 拦截到的签名 tx → four.meme 4参数 sellToken amount */
function decodeSellAmount(raw) {
  const iface = new ethers.Interface(['function sellToken(uint256 origin, address token, uint256 amount, uint256 minFunds) external']);
  const decoded = iface.decodeFunctionData('sellToken(uint256,address,uint256,uint256)', ethers.Transaction.from(raw).data);
  return decoded.amount;
}

async function main() {
  const Q = (s) => ethers.parseUnits(s, 18);
  const wallet = ethers.Wallet.createRandom();

  // ============ 1. _assertDecimals18 ============
  console.log('\n[1] BaseTrader._assertDecimals18');
  {
    // 1a. =18 通过 + 缓存（二次零查询）
    const { provider, st } = makeStubbedProvider({ decimals: 18 });
    const trader = makeFourMemeTrader(provider, wallet.connect(provider));
    ok((await trader._assertDecimals18('0x' + '11'.repeat(20))) === 18, 'decimals=18 通过');
    ok(st.decimalsCalls === 1, '首查一次 eth_call');
    await trader._assertDecimals18('0x' + '11'.repeat(20));
    ok(st.decimalsCalls === 1, '缓存命中二次零查询');

    // 1b. ≠18 拒绝
    const { provider: p2 } = makeStubbedProvider({ decimals: 9 });
    const trader2 = makeFourMemeTrader(p2, wallet.connect(p2));
    await assert.rejects(() => trader2._assertDecimals18('0x' + '11'.repeat(20)), /decimals=9 ≠ 18/);
    ok(true, '≠18 throw fail-closed');

    // 1c. 查询失败拒绝（fail-loud 不回落 18）
    const { provider: p3 } = makeStubbedProvider({ decimalsThrow: true });
    const trader3 = makeFourMemeTrader(p3, wallet.connect(p3));
    await assert.rejects(() => trader3._assertDecimals18('0x' + '11'.repeat(20)), /decimals 查询失败/);
    ok(true, '查询失败 throw（不静默回落 18）');
  }

  // ============ 2. four.meme 卖出 6 位舍入（bigint 域向下截断）============
  console.log('\n[2] FourMeme sellToken 6 位舍入（bigint 域）');
  {
    const { provider, st } = makeStubbedProvider({ decimals: 18 });
    const trader = makeFourMemeTrader(provider, wallet.connect(provider));
    const TOKEN = '0x' + '11'.repeat(20);

    // 大数量：1e23 量级 wei。期望 = 向下截断 6 位小数（10^12 步长）
    const amt = 987654321098765432109876543210n;
    const expected = amt - (amt % 10n ** 12n);
    st.tokenBalance = amt;          // 余额足额：不触发钳制
    st.tokenAllowance = amt;        // 授权足额：跳过 approve，只广播 sell 一次
    const res = await trader.sellToken(TOKEN, amt, {});
    ok(res.success === true, '大数量卖出成功');
    ok(st.broadcasts.length === 1, '足额授权只广播 sell（无 approve）');
    ok(decodeSellAmount(st.broadcasts[0]) === expected,
      `bigint 域向下截断: ${decodeSellAmount(st.broadcasts[0])} === ${expected}`);
    // float 往返对拍（旧算法在 1e23 量级丢精度——证明重构动机）
    const floatPath = ethers.parseUnits(
      (Math.round(parseFloat(ethers.formatUnits(amt, 18)) * 1e6) / 1e6).toFixed(6), 18);
    ok(floatPath !== expected, `旧 float 往返在此量级错尾数（${floatPath} ≠ ${expected}）——重构动机成立`);
  }

  // ============ 3. 卖0防护 ============
  console.log('\n[3] 卖0防护（残仓整清 / 无余额拒绝）');
  {
    // 3a. 舍入后 0 且有余额 → 卖全额
    const { provider, st } = makeStubbedProvider({ decimals: 18 });
    const trader = makeFourMemeTrader(provider, wallet.connect(provider));
    const TOKEN = '0x' + '11'.repeat(20);
    const dustBalance = 500000000000n;  // 0.0000005 token（< 1e-6 舍入步长）
    st.tokenBalance = dustBalance;
    st.tokenAllowance = 0n;     // 触发 approve（全额 5e11）+ sell 两次广播
    const res = await trader.sellToken(TOKEN, 400000000000n, {}); // 4e11 舍入 → 0
    ok(res.success === true, '残仓卖出成功');
    const sellAmount = decodeSellAmount(st.broadcasts[st.broadcasts.length - 1]);
    ok(sellAmount === dustBalance, `舍入后 0 → 改卖链上全额 ${sellAmount}`);

    // 3b. 链上余额 0 → 拒绝
    const { provider: p2, st: st2 } = makeStubbedProvider({ decimals: 18 });
    const trader2 = makeFourMemeTrader(p2, wallet.connect(p2));
    st2.tokenBalance = 0n;
    const res2 = await trader2.sellToken(TOKEN, Q('100'), {});
    ok(res2.success === false && /为 0/.test(res2.error), '链上余额 0 → 拒绝（不广播）');
    ok(st2.broadcasts.length === 0, '无余额拒绝零广播');
  }

  // ============ 4. Flap buyToken ≠18 fail-closed ============
  console.log('\n[4] Flap buyToken decimals≠18 fail-closed');
  {
    const FlapPortalTrader = require(path.join(ROOT, 'src/trading-engine/traders/implementations/FlapPortalTrader'));
    const { provider, st } = makeStubbedProvider({ decimals: 9 });
    const trader = new FlapPortalTrader({ network: { rpcUrl: 'http://localhost:1' } });
    trader.provider = provider;
    trader.wallet = wallet.connect(provider);
    trader.signer = new ethers.NonceManager(trader.wallet);
    const TOKEN = '0x' + '11'.repeat(20);
    let swapSent = false;
    trader.portalContract = {
      interface: { encodeFunctionData: () => '0xswapdata' },
      quoteExactInput: { staticCall: async () => Q('1000') },
      swapExactInput: async () => { swapSent = true; throw new Error('MUST NOT SEND TX'); },
    };
    const res = await trader.buyToken(TOKEN, Q('0.001'), { expectedTokenOut: '900', minOutRatio: 0.5 });
    ok(res.success === false && /decimals=9 ≠ 18/.test(res.error), '≠18 拒绝（错误消息带 decimals）');
    ok(swapSent === false, '拒单不触达 swapExactInput');
    ok(st.broadcasts.length === 0, '零广播');
  }

  console.log(`\n✅ 全部通过（${passed} 断言）`);
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
