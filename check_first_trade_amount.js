/**
 * 检查 1$ 代币的第一笔交易金额
 */

require('dotenv').config({ path: 'config/.env' });
const { AveTxAPI } = require('./src/core/ave-api');

const txApi = new AveTxAPI('https://prod.ave-api.com', 30000, process.env.AVE_API_KEY);

async function checkFirstTrade() {
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';
  const pairId = `${tokenAddress}_fo-bsc`;

  const launchAt = 1773077436;
  const checkTime = 1773077512;

  console.log('=== 检查 1$ 代币的第一笔交易 ===\n');

  // 获取交易数据
  const trades = await txApi.getSwapTransactions(pairId, 300, launchAt, checkTime, 'asc');

  console.log('总交易数:', trades.length);
  console.log('');

  // 显示前10笔交易
  console.log('前10笔交易详情:');
  console.log('');
  console.log('序号 | 时间 | from_address | from_usd | from_amount | to_token');
  console.log('-----|------|-------------|----------|-------------|---------');

  trades.slice(0, 10).forEach((t, i) => {
    const time = new Date(t.time * 1000).toLocaleTimeString();
    const address = t.from_address?.substring(0, 10) || 'N/A';
    const fromUsd = t.from_usd || 0;
    const fromAmount = t.from_amount || 0;
    const toToken = t.to_token || 'N/A';

    console.log(`${(i + 1).toString().padStart(4)} | ${time} | ${address} | $${fromUsd.toFixed(2).padStart(8)} | ${fromAmount.toFixed(2).padStart(10)} | ${toToken}`);

    // 第一笔交易详细信息
    if (i === 0) {
      console.log('');
      console.log('第一笔交易完整数据:');
      console.log(JSON.stringify(t, null, 2));
    }
  });

  console.log('');
  console.log('=== 分析 ===\n');

  // 统计前30笔交易中金额>200的数量
  const earlyThreshold = 90; // 前30%
  const earlyTrades = trades.slice(0, earlyThreshold);

  const bigBuys = earlyTrades.filter(t => {
    const isBuy = t.from_token && ['BNB', 'USDT', 'ETH'].includes(t.from_token);
    return isBuy && (t.from_usd || 0) > 200;
  });

  console.log(`前${earlyThreshold}笔交易中，金额 > $200 的买入:`);
  console.log('  数量:', bigBuys.length);
  console.log('');

  if (bigBuys.length > 0) {
    console.log('详细信息:');
    bigBuys.forEach((t, i) => {
      console.log(`  ${i + 1}. 钱包: ${t.from_address?.substring(0, 10)}...`);
      console.log(`     金额: $${(t.from_usd || 0).toFixed(2)}`);
      console.log(`     时间: ${new Date(t.time * 1000).toLocaleTimeString()}`);
      console.log(`     时间偏移: ${(t.time - trades[0].time).toFixed(1)}秒`);
    });
  } else {
    console.log('没有找到金额 > $200 的买入');
    console.log('');
    console.log('前10笔买入的金额:');
    const buys = earlyTrades.filter(t => t.from_token && ['BNB', 'USDT', 'ETH'].includes(t.from_token));
    buys.slice(0, 10).forEach((t, i) => {
      console.log(`  ${i + 1}. $${(t.from_usd || 0).toFixed(2)} (${new Date(t.time * 1000).toLocaleTimeString()})`);
    });
  }

  console.log('');
  console.log('=== 检查早期大户识别逻辑 ===\n');

  // 模拟 EarlyWhaleService 的识别逻辑
  console.log('早期大户阈值:', earlyThreshold, '笔交易');
  console.log('早期时间阈值:', (trades[earlyThreshold - 1]?.time - trades[0]?.time).toFixed(1), '秒');
  console.log('');

  // 检查第一笔交易
  const firstTrade = trades[0];
  const isFirstTradeBuy = firstTrade.from_token && ['BNB', 'USDT', 'ETH'].includes(firstTrade.from_token);
  const firstTradeUsd = firstTrade.from_usd || 0;

  console.log('第一笔交易:');
  console.log('  是买入:', isFirstTradeBuy);
  console.log('  金额:', `$${firstTradeUsd.toFixed(2)}`);
  console.log('  金额 > $200:', firstTradeUsd > 200);
  console.log('  在早期阈值内:', true); // 第一笔肯定在早期阈值内

  if (isFirstTradeBuy && firstTradeUsd > 200) {
    console.log('');
    console.log('⚠️  第一笔交易是买入且金额 > $200！');
    console.log('  理论上应该被识别为早期大户');
    console.log('  但实际 earlyWhaleCount = 0');
    console.log('');
    console.log('可能的原因:');
    console.log('  1. 早期交易数据的 from_usd 字段可能为空或计算错误');
    console.log('  2. EarlyWhaleService 的判断逻辑可能有问题');
    console.log('  3. 交易数据的解析可能有问题');
  }
}

checkFirstTrade().catch(console.error);
