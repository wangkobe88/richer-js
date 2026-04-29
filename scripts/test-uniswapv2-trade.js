/**
 * UniswapV2 交易测试脚本
 * 在 ETH 链上测试买入和卖出 0.001 ETH 的代币
 *
 * 用法: node scripts/test-uniswapv2-trade.js
 */

require('dotenv').config({ path: './config/.env' });

const { CryptoUtils } = require('../src/utils/CryptoUtils');
const { dbManager } = require('../src/services/dbManager');
const UniswapV2Trader = require('../src/trading-engine/traders/implementations/UniswapV2Trader');

// ============ 配置 ============
const EXPERIMENT_ID = '60ec9bf6-5a74-427c-a029-0db2b12defef';
const TOKEN_ADDRESS = '0xbeed9c9d9d782f978030a2a34e4b3e3b8dbb02c1'; // APHEX (AMM: uniswapv2)
const TRADE_AMOUNT = '0.001'; // ETH
// ==============================

async function main() {
  console.log('=== UniswapV2 交易测试 ===\n');

  // 1. 从数据库获取实验配置中的钱包信息
  console.log('[1/8] 加载钱包配置...');
  const supabase = dbManager.getClient();
  const { data: experiment, error } = await supabase
    .from('experiments')
    .select('config')
    .eq('id', EXPERIMENT_ID)
    .single();

  if (error || !experiment) {
    console.error('查询实验失败:', error?.message || '实验不存在');
    process.exit(1);
  }

  const walletConfig = experiment.config?.wallet;
  if (!walletConfig?.privateKey) {
    console.error('实验缺少钱包配置');
    process.exit(1);
  }

  // 2. 解密私钥
  console.log('[2/8] 解密私钥...');
  const cryptoUtils = new CryptoUtils();
  const privateKey = cryptoUtils.decrypt(walletConfig.privateKey);
  console.log(`  钱包地址: ${walletConfig.address}`);

  // 3. 创建交易器
  console.log('[3/8] 初始化 UniswapV2 交易器...');
  const trader = new UniswapV2Trader({
    slippage: 0.05,    // 5% 滑点容忍
    maxSlippage: 0.10,  // 最大 10%
    gasLimit: 300000,
    deadline: 600       // 10 分钟
  });

  // 覆盖 RPC（llamarpc 被限速）
  const { ethers } = require('ethers');
  trader.provider = new ethers.JsonRpcProvider('https://ethereum.publicnode.com');
  trader.initContracts();

  await trader.setWallet(privateKey);

  // 4. 查询余额
  console.log('\n[4/8] 查询余额...');
  const ethBalance = await trader.getNativeBalance();
  console.log(`  ETH 余额: ${ethBalance}`);

  const tokenBalanceBefore = await trader.getTokenBalance(TOKEN_ADDRESS);
  console.log(`  APHEX 余额: ${tokenBalanceBefore}`);

  // 5. 买入
  console.log(`\n[5/8] 买入 ${TRADE_AMOUNT} ETH 的 APHEX...`);
  const buyResult = await trader.buyToken(TOKEN_ADDRESS, TRADE_AMOUNT, {
    slippage: 0.05,
    maxRetries: 2
  });

  if (buyResult.success) {
    console.log(`  买入成功!`);
    console.log(`  txHash: ${buyResult.txHash}`);
    console.log(`  gasUsed: ${buyResult.gasUsed}`);
    console.log(`  预期输出: ${buyResult.amountOut}`);
    console.log(`  Etherscan: https://etherscan.io/tx/${buyResult.txHash}`);
  } else {
    console.error(`  买入失败: ${buyResult.error}`);
    process.exit(1);
  }

  // 6. 等待确认并查询余额
  console.log('\n[6/8] 等待 5 秒后查询代币余额...');
  await new Promise(r => setTimeout(r, 5000));

  const tokenBalanceAfter = await trader.getTokenBalance(TOKEN_ADDRESS);
  console.log(`  APHEX 余额: ${tokenBalanceAfter}`);

  // 7. 卖出全部代币
  console.log(`\n[7/8] 卖出全部 APHEX (${tokenBalanceAfter})...`);
  const sellResult = await trader.sellToken(TOKEN_ADDRESS, tokenBalanceAfter, {
    slippage: 0.05,
    maxRetries: 2
  });

  if (sellResult.success) {
    console.log(`  卖出成功!`);
    console.log(`  txHash: ${sellResult.txHash}`);
    console.log(`  gasUsed: ${sellResult.gasUsed}`);
    console.log(`  Etherscan: https://etherscan.io/tx/${sellResult.txHash}`);
  } else {
    console.error(`  卖出失败: ${sellResult.error}`);
    process.exit(1);
  }

  // 8. 最终余额
  console.log('\n[8/8] 等待 5 秒后查询最终余额...');
  await new Promise(r => setTimeout(r, 5000));

  const finalEthBalance = await trader.getNativeBalance();
  const finalTokenBalance = await trader.getTokenBalance(TOKEN_ADDRESS);
  console.log(`  ETH 余额: ${finalEthBalance}`);
  console.log(`  APHEX 余额: ${finalTokenBalance}`);

  console.log('\n=== 测试完成 ===');
  process.exit(0);
}

main().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
