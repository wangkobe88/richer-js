#!/usr/bin/env node
/**
 * Flap buyToken minOut 锚取较低者（quote vs 信号价期望）零 DB 零网络单测
 *
 * 事故现场（2026-10-16 蓝蛙 0x94995372faa9fa949ca11c1c2f0724cd89ae7777，
 * live bbbe2561）：暴涨盘 quote staticCall 基于滞后块状态报价 551,500.82 token
 * （信号价期望 498,800，ratio=1.10 L1 放行），minOut=quote×0.95=523,925.78 >
 * tx 上块真实可得 ~501k → swapExactInput revert 烧 gas（0xef02db4d，8.6s 等
 * revert 回执——WSS 盲区）。修复：minOutAnchor = min(expected, quote)。
 *
 *   1. 事故现场反证：expected=498,800 / quote=551,500.82 → minOut=473,860e18
 *      （=498,800×0.95，低于旧行为 523,925.779e18，低于上块真实可得 → 可成交）
 *   2. 平稳盘行为不变：expected 略高于 quote（正常报价偏差）→ 锚 quote，
 *      minOut 与旧算法 bit-identical
 *   3. 暴跌臂保护语义不变：quote 低于 expected → 锚 quote（minOut 跟着报价走低，
 *      绝不冒充乐观锚）
 *   4. 边界：expected == quote → 锚 quote（严格 <）
 *   5. 锚改动不影响 L1 预成交校验（assertMinOut ratio 门在锚之前独立生效）
 *   6. trader.log 三参标准形状：setLogger(logger, expId) 后行进实验日志文件形状
 *      （experimentId, 'FlapPortalTrader', message）——蓝蛙案 trader 现场散落
 *      stdout 短名文件的第二修复
 *
 * 打桩：真实 JsonRpcProvider + 实例级 RPC 覆盖（同 _test_live_decimals_guard）；
 * portalContract.quoteExactInput.staticCall / swapExactInput 全桩（swap 捕获
 * minOutputAmount 断言，零广播）。
 *
 * 运行：node scripts/_test_flap_minout_signal_anchor.cjs
 */

const assert = require('assert');
const path = require('path');
const { ethers } = require('ethers');

const ROOT = path.resolve(__dirname, '..');

let passed = 0;
function ok(cond, label, detail) {
  if (!cond) throw new Error(`FAIL: ${label}${detail ? ` | ${detail}` : ''}`);
  passed++;
  console.log(`  ✅ ${label}`);
}

function makeStubbedProvider({ decimals = 18, balanceAfter } = {}) {
  const provider = new ethers.JsonRpcProvider('http://localhost:1');
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const SEL_BALANCE_OF = '0x70a08231';
  const SEL_DECIMALS = '0x313ce567';
  const st = { balanceReads: 0 };
  provider.call = async ({ data }) => {
    const s = data.slice(0, 10);
    if (s === SEL_BALANCE_OF) {
      // 余额差法：首读 before=0，次读 after（_settleBalanceRead 内部重读计数）
      st.balanceReads++;
      return coder.encode(['uint256'], [st.balanceReads === 1 ? 0n : balanceAfter]);
    }
    if (s === SEL_DECIMALS) return coder.encode(['uint8'], [decimals]);
    throw new Error(`stub provider.call: unexpected selector ${s}`);
  };
  provider.estimateGas = async () => 100000n;
  provider.getFeeData = async () => ({ gasPrice: 10n ** 9n, maxFeePerGas: null, maxPriorityFeePerGas: null });
  return { provider, st };
}

/** FlapPortalTrader 手动接线（同 _test_live_decimals_guard：绕开 setWallet/prepare） */
function makeFlapTrader(provider, { quoteOutUi, swapCapture, logger } = {}) {
  const FlapPortalTrader = require(path.join(ROOT, 'src/trading-engine/traders/implementations/FlapPortalTrader'));
  const trader = new FlapPortalTrader({ network: { rpcUrl: 'http://localhost:1' } });
  trader.provider = provider;
  trader.wallet = { address: '0x' + '22'.repeat(20) };
  trader.signer = {};
  if (logger) trader.setLogger(logger, 'exp-9499');
  trader.portalContract = {
    interface: { encodeFunctionData: () => '0xswapdata' },
    quoteExactInput: { staticCall: async () => ethers.parseUnits(String(quoteOutUi), 18) },
    swapExactInput: async (params) => {
      swapCapture.params = params;
      return { hash: '0xstx' };
    },
  };
  trader._awaitReceipt = async () => ({ status: 1, hash: '0xstx', blockNumber: 5, gasUsed: 150000n, gasPrice: 10n ** 9n, logs: [] });
  trader._nonceGuard = (fn) => fn();
  return trader;
}

/** 跑一次 buyToken，返回 swapExactInput 捕获的 minOutputAmount（raw wei） */
async function buyOnce(quoteOutUi, expectedTokenOut, slippageTolerance) {
  const { provider } = makeStubbedProvider({ balanceAfter: ethers.parseUnits('600000', 18) });
  const swapCapture = {};
  const trader = makeFlapTrader(provider, { quoteOutUi, swapCapture });
  const res = await trader.buyToken('0x' + '11'.repeat(20), ethers.parseEther('0.00262'), {
    expectedTokenOut, ...(slippageTolerance === undefined ? {} : { slippageTolerance }), minOutRatio: 0.5,
  });
  assert.strictEqual(res.success, true, `buyToken 应成功（桩链路）: ${res.error || ''}`);
  return swapCapture.params.minOutputAmount;
}

async function main() {
  const Q = ethers.parseUnits;

  // ============ 1. 事故现场反证 ============
  console.log('\n[1] 蓝蛙事故现场反证（expected < quote 滞后虚高 → 锚 expected）');
  {
    const minOut = await buyOnce('551500.82', 498800, 5);
    // 新行为：anchor=498,800 → ×(10000-500)/10000
    const expectedNew = (Q('498800') * 9500n) / 10000n;
    ok(minOut === expectedNew, `minOut=anchor(expected)×0.95=${expectedNew}（实际 ${minOut}）`);
    // 反证：旧算法锚 quote 的值（事故日志 minOut=523,925.78）> 上块真实可得 ~501k → revert
    const oldMinOut = (Q('551500.82') * 9500n) / 10000n;
    ok(oldMinOut === 523925779000000000000000n,
      `旧算法事故数字锁定 quote×0.95=${oldMinOut}（现场日志 523925.78）`);
    ok(minOut < oldMinOut, `新 minOut < 旧（滞后块虚高不再卡死 revert）`);
    ok(minOut < Q('501000'), `新 minOut 低于上块真实可得 ~501k（本可成交）`);
    // 期望锚以 Decimal 域取整：498800（UI）→ 498800e18 精确无误差
    ok(minOut % Q('1') === 0n, 'minOut 整数 token 量（Decimal 取整无碎尾）');
  }

  // ============ 2. 平稳盘行为不变 ============
  console.log('\n[2] 平稳盘（expected 略高于 quote）→ 锚 quote，bit-identical 旧行为');
  {
    const minOut = await buyOnce('551500.82', 560000, 5);
    const oldAlgo = (Q('551500.82') * 9500n) / 10000n;
    ok(minOut === oldAlgo, `锚 quote：${minOut} === 旧算法 ${oldAlgo}`);
  }

  // ============ 3. 暴跌臂保护语义不变 ============
  console.log('\n[3] 暴跌臂（quote < expected）→ 锚 quote（跟报价走低，绝不乐观冒充）');
  {
    const minOut = await buyOnce('450000', 498800, 5);
    const quoteAnchor = (Q('450000') * 9500n) / 10000n;
    ok(minOut === quoteAnchor, `锚 quote：${minOut} === ${quoteAnchor}`);
    ok(minOut < (Q('498800') * 9500n) / 10000n, 'minOut 低于锚 expected 的值（保护方向正确）');
  }

  // ============ 4. 边界：expected == quote ============
  console.log('\n[4] 边界 expected == quote → 锚 quote（严格 <）');
  {
    const minOut = await buyOnce('498800', 498800, 5);
    ok(minOut === (Q('498800') * 9500n) / 10000n, '等值锚 quote');
  }

  // ============ 5. 默认滑点容忍（options.slippageTolerance 缺省 1%）============
  console.log('\n[5] slippageTolerance 缺省 → 1% 容忍沿用');
  {
    const minOut = await buyOnce('551500.82', 498800, undefined);
    ok(minOut === (Q('498800') * 9900n) / 10000n, `默认 1%：${minOut}`);
  }

  // ============ 6. trader.log 三参形状 + L1 校验先行 ============
  console.log('\n[6] trader 日志接线（setLogger 三参）+ L1 预成交校验独立生效');
  {
    const rows = [];
    const logger = {
      info: (...a) => rows.push(['info', ...a]),
      warn: (...a) => rows.push(['warn', ...a]),
      error: (...a) => rows.push(['error', ...a]),
    };
    const { provider } = makeStubbedProvider({ balanceAfter: ethers.parseUnits('600000', 18) });
    const swapCapture = {};
    const trader = makeFlapTrader(provider, { quoteOutUi: '551500.82', swapCapture, logger });
    await trader.buyToken('0x' + '11'.repeat(20), ethers.parseEther('0.00262'), {
      expectedTokenOut: 498800, slippageTolerance: 5, minOutRatio: 0.5,
    });
    ok(rows.length > 0, 'trader 行进注入 logger（不再散落 stdout）');
    ok(rows.every(r => r[1] === 'exp-9499' && r[2] === 'FlapPortalTrader'),
      '全部行三参标准形状（experimentId, module, message）');
    ok(rows.some(r => typeof r[3] === 'string' && r[3].includes('预成交校验通过')),
      'L1 预成交校验（ratio 门）在锚计算之前独立生效');

    // L1 拦截臂：quote 低于 expected 的 50%（ratio=quote/expected<0.5）→ assertMinOut 拒
    // （与本修复正交：锚改动只动 minOutputAmount，不动预成交校验）
    const trader2 = makeFlapTrader(provider, { quoteOutUi: '40000', swapCapture: {} });
    const res2 = await trader2.buyToken('0x' + '11'.repeat(20), ethers.parseEther('0.00262'), {
      expectedTokenOut: 100000, slippageTolerance: 5, minOutRatio: 0.5,
    });
    ok(res2.success === false && /ratio/i.test(res2.error || ''), 'quote/expected<0.5 L1 仍拒（修复不触碰防线）');
  }

  console.log(`\n✅ 全部通过（${passed} 断言）`);
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
