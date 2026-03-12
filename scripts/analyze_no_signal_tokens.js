/**
 * 分析那12个无信号代币的 trendFactors
 * 看看为什么它们在实验1中没有信号
 */

const http = require('http');

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== 分析12个无信号代币 ===\n');

  const noSignalTokens = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港'
  ];

  const signalsData2 = await get('http://localhost:3010/api/experiment/2522cab9-721f-4922-86f9-7484d644e7cc/signals?limit=5000');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【检查实验2中这些代币的 trendFactors】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const symbol of noSignalTokens.slice(0, 5)) { // 先检查前5个
    const buySignals = signalsData2.signals?.filter(s =>
      s.token_symbol === symbol &&
      s.action === 'buy' &&
      s.executed === true
    ) || [];

    if (buySignals.length > 0) {
      const firstBuy = buySignals[0];
      const trendFactors = firstBuy.metadata?.trendFactors || {};

      console.log(`${symbol}:`);
      console.log(`  trendCV: ${trendFactors.trendCV?.toFixed(3) ?? 'N/A'}`);
      console.log(`  trendSlope: ${trendFactors.trendSlope?.toFixed(3) ?? 'N/A'}`);
      console.log(`  trendPriceUp: ${trendFactors.trendPriceUp ?? 'N/A'}`);
      console.log(`  trendMedianUp: ${trendFactors.trendMedianUp ?? 'N/A'}`);
      console.log(`  trendStrengthScore: ${trendFactors.trendStrengthScore ?? 'N/A'}`);
      console.log(`  trendTotalReturn: ${trendFactors.trendTotalReturn?.toFixed(1) ?? 'N/A'}%`);
      console.log(`  earlyReturn: ${trendFactors.earlyReturn?.toFixed(1) ?? 'N/A'}%`);
      console.log(`  trendRecentDownRatio: ${trendFactors.trendRecentDownRatio?.toFixed(2) ?? 'N/A'}`);
      console.log(`  age: ${trendFactors.age?.toFixed(1) ?? 'N/A'} 分钟`);
      console.log(`  trendRiseRatio: ${trendFactors.trendRiseRatio?.toFixed(2) ?? 'N/A'}`);
      console.log(`  tvl: ${trendFactors.tvl ?? 'N/A'}`);
      console.log('');

      // 检查是否满足实验1的 buyCondition
      const exp1BuyConditionMet =
        (trendFactors.trendCV ?? 0) > 0.02 &&
        (trendFactors.trendSlope ?? 0) > 0.02 &&
        (trendFactors.trendPriceUp ?? 0) >= 1 &&
        (trendFactors.trendMedianUp ?? 0) >= 1 &&
        (trendFactors.trendStrengthScore ?? 0) >= 30 &&
        (trendFactors.trendTotalReturn ?? 0) >= 10 &&
        (trendFactors.earlyReturn ?? 0) > 15 &&
        (trendFactors.trendRecentDownRatio ?? 1) < 0.6 &&
        (trendFactors.age ?? 0) > 1.2 &&
        (trendFactors.trendRiseRatio ?? 0) >= 0.6 &&
        (trendFactors.tvl ?? 0) >= 5000;

      console.log(`  满足实验1 buyCondition: ${exp1BuyConditionMet ? '是' : '否'}`);
      console.log('');
    }
  }

  // 对比实验2中所有代币的 trendFactors
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【对比实验2中所有代币的 trendFactors】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 获取实验1中一个代币的 trendFactors 作为对比
  const signalsData1 = await get('http://localhost:3010/api/experiment/209a7796-f955-4d7a-ae21-0902fef3d7cc/signals?limit=5000');

  const exp1BuySignals = signalsData1.signals?.filter(s => s.action === 'buy' && s.executed === true) || [];

  if (exp1BuySignals.length > 0) {
    const sampleExp1 = exp1BuySignals[0];
    const sampleExp1Trend = sampleExp1.metadata?.trendFactors || {};
    console.log('实验1示例代币的 trendFactors:');
    console.log(`  代币: ${sampleExp1.token_symbol}`);
    console.log(`  trendCV: ${sampleExp1Trend.trendCV?.toFixed(3) ?? 'N/A'}`);
    console.log(`  trendSlope: ${sampleExp1Trend.trendSlope?.toFixed(3) ?? 'N/A'}`);
    console.log(`  earlyReturn: ${sampleExp1Trend.earlyReturn?.toFixed(1) ?? 'N/A'}%`);
    console.log(`  drawdownFromHighest: ${sampleExp1Trend.drawdownFromHighest?.toFixed(1) ?? 'N/A'}%`);
  }
}

main().catch(console.error);
