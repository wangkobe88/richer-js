/**
 * UniswapV4 最小化交易测试 (修正版)
 * 基于解码成功的 on-chain 交易编码方式重写
 *
 * 关键发现（来自成功交易 0xd6f495f0 的解码）：
 * - four.meme hooks 池子使用原生 ETH (address(0))，不是 WETH
 * - 使用 SWAP_EXACT_IN (0x07) + PathKey[] 编码（不是 SWAP_EXACT_IN_SINGLE + PoolKey）
 * - Actions 顺序: SETTLE(0x0b) + SWAP_EXACT_IN(0x07) + TAKE_ALL(0x0f)
 * - Commands: V4_SWAP(0x10) + SWEEP(0x04)
 * - 无需 WRAP_ETH，直接 SETTLE 原生 ETH
 */

require('dotenv').config({ path: './config/.env' });

const { ethers } = require('ethers');
const { CryptoUtils } = require('../src/utils/CryptoUtils');
const { dbManager } = require('../src/services/dbManager');

// ============ 配置 ============
const EXPERIMENT_ID = '60ec9bf6-5a74-427c-a029-0db2b12defef';
const TOKEN_ADDRESS = '0x5cc0846ea203ffdad359ad4c31a7dfb2f62e1110'; // CLIPPY
const TRADE_AMOUNT = '0.001'; // ETH

// V4 合约地址 (Ethereum)
const UNIVERSAL_ROUTER = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

// four.meme hooks 合约
const HOOKS_ADDRESS = '0x627fa6f76fa96b10bae1b6fba280a3c9264500cc';

// Pool params (from PoolManager Initialize events)
const POOL_FEE = 0;
const POOL_TICK_SPACING = 200;

// Universal Router command bytes
const COMMAND = {
  V4_SWAP: 0x10,
  SWEEP: 0x04,
};

// V4 Action constants (from v4-periphery Actions.sol)
const V4_ACTION = {
  SWAP_EXACT_IN: 0x07,
  SETTLE: 0x0b,
  TAKE_ALL: 0x0f,
};

// Router ABI (仅 execute)
const ROUTER_ABI = [
  {
    "inputs": [
      { "name": "commands", "type": "bytes" },
      { "name": "inputs", "type": "bytes[]" },
      { "name": "deadline", "type": "uint256" }
    ],
    "name": "execute",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  }
];

// ERC20 ABI
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address, uint256) returns (bool)"
];

// Permit2 ABI
const PERMIT2_ABI = [
  "function approve(address token, address spender, uint160 amount, uint48 expiration)"
];

const coder = ethers.AbiCoder.defaultAbiCoder();

/**
 * 编码买入 V4 swap:
 * SETTLE(native ETH) + SWAP_EXACT_IN(PathKey[]) + TAKE_ALL(token)
 *
 * PathKey 结构: (intermediateCurrency, fee, tickSpacing, hooks, hookData)
 * ExactInputParams 结构: (currencyIn, PathKey[], amountIn, amountOutMin)
 */
function encodeV4BuyInput(tokenAddress, amountIn) {
  // Actions: SETTLE + SWAP_EXACT_IN + TAKE_ALL
  const actions = ethers.hexlify(new Uint8Array([
    V4_ACTION.SETTLE,
    V4_ACTION.SWAP_EXACT_IN,
    V4_ACTION.TAKE_ALL
  ]));

  // SETTLE params: (address currency, uint256 amount, bool payerIsUser)
  // 原生 ETH 用 address(0)，payerIsUser=true 表示从 msg.value 支付
  const settleParams = coder.encode(
    ['address', 'uint256', 'bool'],
    [ethers.ZeroAddress, amountIn, true]
  );

  // SWAP_EXACT_IN params: ExactInputParams
  // currencyIn = address(0) (native ETH)
  // path = [PathKey(CLIPPY, 0, 200, hooks, "")]
  const swapParams = coder.encode(
    ['(address,(address,uint24,int24,address,bytes)[],uint128,uint128)'],
    [[
      ethers.ZeroAddress,  // currencyIn = native ETH
      [[tokenAddress, POOL_FEE, POOL_TICK_SPACING, HOOKS_ADDRESS, '0x']],  // PathKey[]
      amountIn,
      0n  // amountOutMinimum = 0 (测试用)
    ]]
  );

  // TAKE_ALL params: (address currency, uint256 minAmount)
  const takeParams = coder.encode(
    ['address', 'uint256'],
    [tokenAddress, 0n]
  );

  // Encode V4_SWAP input: (bytes actions, bytes[] params)
  return coder.encode(
    ['bytes', 'bytes[]'],
    [actions, [settleParams, swapParams, takeParams]]
  );
}

/**
 * 编码卖出 V4 swap:
 * SETTLE(token via Permit2) + SWAP_EXACT_IN(PathKey[]) + TAKE_ALL(native ETH)
 */
function encodeV4SellInput(tokenAddress, tokenAmount) {
  const actions = ethers.hexlify(new Uint8Array([
    V4_ACTION.SETTLE,
    V4_ACTION.SWAP_EXACT_IN,
    V4_ACTION.TAKE_ALL
  ]));

  // SETTLE: (CLIPPY, amount, payerIsUser=true)
  // payerIsUser=true 时，router 通过 Permit2 从用户拉取代币
  const settleParams = coder.encode(
    ['address', 'uint256', 'bool'],
    [tokenAddress, tokenAmount, true]
  );

  // SWAP_EXACT_IN: currencyIn=CLIPPY, path=[PathKey(ETH, 0, 200, hooks, "")]
  const swapParams = coder.encode(
    ['(address,(address,uint24,int24,address,bytes)[],uint128,uint128)'],
    [[
      tokenAddress,  // currencyIn = CLIPPY
      [[ethers.ZeroAddress, POOL_FEE, POOL_TICK_SPACING, HOOKS_ADDRESS, '0x']],  // PathKey to native ETH
      tokenAmount,
      0n
    ]]
  );

  // TAKE_ALL: native ETH
  const takeParams = coder.encode(
    ['address', 'uint256'],
    [ethers.ZeroAddress, 0n]
  );

  return coder.encode(
    ['bytes', 'bytes[]'],
    [actions, [settleParams, swapParams, takeParams]]
  );
}

async function main() {
  console.log('=== UniswapV4 最小化交易测试 (修正版) ===\n');

  // 1. 加载钱包
  console.log('[1] 加载钱包...');
  const supabase = dbManager.getClient();
  const { data: experiment, error } = await supabase
    .from('experiments')
    .select('config')
    .eq('id', EXPERIMENT_ID)
    .single();

  if (error || !experiment) {
    console.error('查询实验失败:', error?.message);
    process.exit(1);
  }

  const cryptoUtils = new CryptoUtils();
  const privateKey = cryptoUtils.decrypt(experiment.config.wallet.privateKey);
  const walletAddress = experiment.config.wallet.address;
  console.log(`  钱包: ${walletAddress}`);

  const provider = new ethers.JsonRpcProvider('https://ethereum.publicnode.com');
  const wallet = new ethers.Wallet(privateKey, provider);

  // 2. 查询余额
  console.log('\n[2] 查询余额...');
  const ethBalance = await provider.getBalance(walletAddress);
  console.log(`  ETH: ${ethers.formatEther(ethBalance)}`);

  const tokenContract = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, provider);
  const decimals = await tokenContract.decimals();
  const tokenBalance = await tokenContract.balanceOf(walletAddress);
  console.log(`  CLIPPY: ${ethers.formatUnits(tokenBalance, decimals)} (decimals: ${decimals})`);

  // 3. 买入
  console.log(`\n[3] 买入 ${TRADE_AMOUNT} ETH 的 CLIPPY...`);
  const amountIn = ethers.parseEther(TRADE_AMOUNT);

  // Commands: V4_SWAP + SWEEP
  // SWEEP 用于将多余的 native ETH 返还给用户
  const commands = ethers.hexlify(new Uint8Array([COMMAND.V4_SWAP, COMMAND.SWEEP]));

  // V4_SWAP input
  const v4Input = encodeV4BuyInput(TOKEN_ADDRESS, amountIn);

  // SWEEP input: (address token, address recipient, uint256 amountMin)
  const sweepInput = coder.encode(
    ['address', 'address', 'uint256'],
    [ethers.ZeroAddress, walletAddress, 0n]
  );

  const inputs = [v4Input, sweepInput];
  const deadline = Math.floor(Date.now() / 1000) + 600;

  const router = new ethers.Contract(UNIVERSAL_ROUTER, ROUTER_ABI, wallet);

  console.log('  估算 gas...');
  let gasEstimate;
  try {
    gasEstimate = await router.execute.estimateGas(commands, inputs, deadline, { value: amountIn });
    console.log(`  Gas 估算: ${gasEstimate}`);
  } catch (err) {
    console.error(`  Gas 估算失败: ${err.message?.slice(0, 500)}`);
    if (err.info?.error?.data) {
      console.error(`  Error data: ${err.info.error.data?.slice(0, 200)}`);
    }
    process.exit(1);
  }

  const gasLimit = (gasEstimate * 150n) / 100n;
  const feeData = await provider.getFeeData();

  console.log('  发送买入交易...');
  const buyTx = await router.execute(commands, inputs, deadline, {
    value: amountIn,
    gasLimit,
    maxFeePerGas: feeData.gasPrice * 2n,
    maxPriorityFeePerGas: feeData.gasPrice
  });

  console.log(`  txHash: ${buyTx.hash}`);
  console.log(`  Etherscan: https://etherscan.io/tx/${buyTx.hash}`);

  const buyReceipt = await buyTx.wait();
  if (buyReceipt.status === 1) {
    console.log(`  买入成功! Gas used: ${buyReceipt.gasUsed}`);
  } else {
    console.error('  买入失败 (receipt status=0)');
    process.exit(1);
  }

  // 4. 查询获得的代币
  console.log('\n[4] 等待 3 秒后查询代币余额...');
  await new Promise(r => setTimeout(r, 3000));
  const tokenBalanceAfter = await tokenContract.balanceOf(walletAddress);
  console.log(`  CLIPPY: ${ethers.formatUnits(tokenBalanceAfter, decimals)}`);

  // 5. 卖出
  if (tokenBalanceAfter > 0n) {
    console.log(`\n[5] 卖出全部 CLIPPY...`);

    // 授权: ERC20 -> Permit2 -> UniversalRouter
    console.log('  设置授权...');
    const tokenWithSigner = tokenContract.connect(wallet);

    const approveTx = await tokenWithSigner.approve(PERMIT2, tokenBalanceAfter, {
      gasLimit: 100000n,
      maxFeePerGas: feeData.gasPrice * 2n,
      maxPriorityFeePerGas: feeData.gasPrice
    });
    await approveTx.wait();
    console.log('  ERC20 approve(Permit2) 成功');

    const permit2Contract = new ethers.Contract(PERMIT2, PERMIT2_ABI, wallet);
    const maxUint160 = 2n ** 160n - 1n;
    const maxUint48 = 2n ** 48n - 1n;
    const p2ApproveTx = await permit2Contract.approve(
      TOKEN_ADDRESS, UNIVERSAL_ROUTER, maxUint160, maxUint48,
      { gasLimit: 100000n, maxFeePerGas: feeData.gasPrice * 2n, maxPriorityFeePerGas: feeData.gasPrice }
    );
    await p2ApproveTx.wait();
    console.log('  Permit2 approve(UniversalRouter) 成功');

    // 构建卖出交易: V4_SWAP + SWEEP
    const sellCommands = ethers.hexlify(new Uint8Array([COMMAND.V4_SWAP, COMMAND.SWEEP]));
    const sellV4Input = encodeV4SellInput(TOKEN_ADDRESS, tokenBalanceAfter);

    // SWEEP: sweep any remaining tokens back to wallet
    const sellSweepInput = coder.encode(
      ['address', 'address', 'uint256'],
      [TOKEN_ADDRESS, walletAddress, 0n]
    );

    const sellInputs = [sellV4Input, sellSweepInput];
    const sellDeadline = Math.floor(Date.now() / 1000) + 600;

    console.log('  发送卖出交易...');
    const sellTx = await router.execute(sellCommands, sellInputs, sellDeadline, {
      gasLimit: 600000n,
      maxFeePerGas: feeData.gasPrice * 2n,
      maxPriorityFeePerGas: feeData.gasPrice
    });

    console.log(`  txHash: ${sellTx.hash}`);
    console.log(`  Etherscan: https://etherscan.io/tx/${sellTx.hash}`);

    const sellReceipt = await sellTx.wait();
    if (sellReceipt.status === 1) {
      console.log(`  卖出成功! Gas used: ${sellReceipt.gasUsed}`);
    } else {
      console.error('  卖出失败 (receipt status=0)');
    }
  } else {
    console.log('\n[5] 没有代币可卖出');
  }

  // 6. 最终余额
  console.log('\n[6] 最终余额...');
  const finalEth = await provider.getBalance(walletAddress);
  const finalToken = await tokenContract.balanceOf(walletAddress);
  console.log(`  ETH: ${ethers.formatEther(finalEth)}`);
  console.log(`  CLIPPY: ${ethers.formatUnits(finalToken, decimals)}`);

  console.log('\n=== 测试完成 ===');
  process.exit(0);
}

main().catch(err => {
  console.error('测试失败:', err.message || err);
  process.exit(1);
});
