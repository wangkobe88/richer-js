/**
 * 验证"开头连续卖出"的真实含义
 * 检查FREEDOM的前几笔交易的详细信息
 */

const { AveTokenAPI, AveTxAPI } = require('../src/core/ave-api');
const config = require('../config/default.json');

async function checkFirstTrades() {
  const tokenAddress = '0x67e4c7e7b6b0a3431dd9fed80df2c56ecdfb4444'; // FREEDOM
  const chain = 'bsc';

  const tokenId = `${tokenAddress}-${chain}`;
  const tokenApi = new AveTokenAPI(config.ave?.apiUrl, config.ave?.timeout || 30000, process.env.AVE_API_KEY);
  const txApi = new AveTxAPI(config.ave?.apiUrl, config.ave?.timeout || 30000, process.env.AVE_API_KEY);

  // 获取代币详情
  const tokenDetail = await tokenApi.getTokenDetail(tokenId);
  const launchAt = tokenDetail.token.launch_at || tokenDetail.token.created_at;

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    验证"开头连续卖出"的真实含义                              ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log(`代币: ${tokenDetail.token.symbol || tokenAddress}`);
  console.log(`发布时间: ${new Date(launchAt * 1000).toISOString()}`);
  console.log(`Launch At: ${launchAt}`);
  console.log('');

  // 获取前3分钟的交易
  const innerPair = `${tokenAddress}_fo`;
  const pairId = `${innerPair}-${chain}`;
  const toTime = launchAt + 180; // 前3分钟

  const rawTrades = await txApi.getSwapTransactions(pairId, 300, launchAt, toTime, 'asc');

  console.log(`获取到 ${rawTrades.length} 条交易\n`);

  console.log('【原始交易数据（前15笔）】\n');
  console.log('序号   时间(秒)    类型         from_token                to_token                  USD');
  console.log('─'.repeat(115));

  rawTrades.slice(0, 15).forEach((t, i) => {
    const secondsFromLaunch = t.time - launchAt;
    const timeStr = `${secondsFromLaunch.toFixed(1).padStart(6)}s`;

    // 判断是新代币的买入还是卖出
    const isBuy = t.to_token?.toLowerCase() === tokenAddress.toLowerCase();
    const type = isBuy ? '买入' : '卖出';

    const fromToken = t.from_token_address?.substring(0, 10) || 'unknown';
    const toToken = t.to_token_address?.substring(0, 10) || 'unknown';

    const fromSymbol = t.from_token_symbol || '';
    const toSymbol = t.to_token_symbol || '';

    const fromAmount = t.from_token_amount || 0;
    const toAmount = t.to_token_amount || 0;
    const usdValue = t.amount_usd || 0;

    // 显示交易详情
    console.log(`${(i + 1).toString().padStart(3)}  ${timeStr}  ${type.padStart(4)}  ${fromToken}(${fromSymbol}) ${fromAmount.toFixed(0).padStart(10)}  ->  ${toToken}(${toSymbol}) ${toAmount.toFixed(0).padStart(10)}  ${usdValue.toFixed(0).padStart(8)}`);
  });

  console.log('');
  console.log('【分析】\n');

  // 检查前几笔交易
  const leadingSells = [];
  const leadingBuys = [];

  for (let i = 0; i < Math.min(10, rawTrades.length); i++) {
    const t = rawTrades[i];
    const isBuy = t.to_token?.toLowerCase() === tokenAddress.toLowerCase();

    if (isBuy) {
      if (leadingSells.length === 0) {
        leadingBuys.push(t);
      }
    } else {
      if (leadingBuys.length === 0) {
        leadingSells.push(t);
      }
    }

    if (leadingSells.length > 0 || leadingBuys.length > 0) {
      if (leadingSells.length >= 3 || leadingBuys.length >= 3) {
        break;
      }
    }
  }

  if (leadingSells.length >= 3) {
    console.log(`⚠️ 前${leadingSells.length}笔交易全部是卖出！`);
    console.log('');
    console.log('这意味着什么？');
    console.log('1. 开发者在代币发布后立即卖出？');
    console.log('2. 还是交易对创建时就有流动性提供？');
    console.log('3. 或者是其他机制？');
    console.log('');
    console.log('验证思路：检查第一笔"卖出"交易');
    const firstSell = leadingSells[0];
    console.log(`  - 时间: +${(firstSell.time - launchAt).toFixed(1)}秒`);
    console.log(`  - from_token: ${firstSell.from_token_address}`);
    console.log(`  - to_token: ${firstSell.to_token_address}`);
    console.log(`  - from_amount: ${firstSell.from_token_amount || 0}`);
    console.log(`  - to_amount: ${firstSell.to_token_amount || 0}`);
    console.log(`  - wallet: ${firstSell.wallet_address || firstSell.sender_address || 'N/A'}`);
  } else if (leadingBuys.length >= 3) {
    console.log(`✓ 前${leadingBuys.length}笔交易全部是买入`);
    console.log('这是正常的代币启动模式');
  } else {
    console.log('前几笔交易混合模式');
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

checkFirstTrades().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
