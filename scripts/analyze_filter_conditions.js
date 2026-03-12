/**
 * 深入分析 creatorIsNotBadDevWallet 和 drawdownFromHighest 的过滤效果
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
  console.log('=== 深入分析两个过滤条件的效果 ===\n');

  // 获取实验2的 signals 数据
  const signalsData = await get('http://localhost:3010/api/experiment/2522cab9-721f-4922-86f9-7484d644e7cc/signals?limit=1000');

  const buySignals = signalsData.signals?.filter(s => s.action === 'buy' && s.executed === true) || [];

  // 获取实验2独有的14个代币
  const onlyInExp2 = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'Claude', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛'
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【实验2独有的14个代币的因子分析】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const results = [];

  onlyInExp2.forEach(symbol => {
    const signal = buySignals.find(s => s.token_symbol === symbol);
    if (signal) {
      const factors = signal.metadata?.preBuyCheckFactors || {};
      const trendFactors = signal.metadata?.trendFactors || {};

      const creatorIsNotBadDevWallet = factors.creatorIsNotBadDevWallet;
      const drawdownFromHighest = trendFactors.drawdownFromHighest;

      results.push({
        symbol,
        returnRate: 0, // 稍后从 trades 获取
        creatorIsNotBadDevWallet,
        drawdownFromHighest,
        countPerMin: factors.earlyTradesCountPerMin,
        earlyReturn: trendFactors.earlyReturn,
      });

      const creatorStatus = creatorIsNotBadDevWallet === true ? '✅ 通过' : creatorIsNotBadDevWallet === false ? '❌ 不通过' : 'N/A';
      const drawdownStatus = drawdownFromHighest !== undefined ? (drawdownFromHighest > -25 ? '✅ 通过' : '❌ 不通过') : 'N/A';

      console.log(`${symbol}:`);
      console.log(`  creatorIsNotBadDevWallet: ${creatorStatus} (${creatorIsNotBadDevWallet})`);
      console.log(`  drawdownFromHighest: ${drawdownStatus} (${drawdownFromHighest !== undefined ? drawdownFromHighest.toFixed(1) + '%' : 'N/A'})`);
      console.log('');
    }
  });

  // 统计过滤比例
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【过滤条件统计】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const filteredByCreator = results.filter(r => r.creatorIsNotBadDevWallet === false);
  const filteredByDrawdown = results.filter(r => r.drawdownFromHighest <= -25);
  const passedAll = results.filter(r => r.creatorIsNotBadDevWallet !== false && (r.drawdownFromHighest === undefined || r.drawdownFromHighest > -25));

  console.log(`总代币数: ${results.length}\n`);

  console.log('【按 creatorIsNotBadDevWallet 过滤】');
  console.log(`  过滤掉: ${filteredByCreator.length} 个 (${(filteredByCreator.length/results.length*100).toFixed(1)}%)`);
  if (filteredByCreator.length > 0) {
    filteredByCreator.forEach(r => {
      console.log(`    ${r.symbol}: creatorIsNotBadDevWallet = ${r.creatorIsNotBadDevWallet}`);
    });
  }
  console.log('');

  console.log('【按 drawdownFromHighest > -25 过滤】');
  console.log(`  过滤掉: ${filteredByDrawdown.length} 个 (${(filteredByDrawdown.length/results.length*100).toFixed(1)}%)`);
  if (filteredByDrawdown.length > 0) {
    filteredByDrawdown.forEach(r => {
      console.log(`    ${r.symbol}: drawdownFromHighest = ${r.drawdownFromHighest.toFixed(1)}%`);
    });
  }
  console.log('');

  console.log('【同时通过两个条件的代币】');
  console.log(`  通过: ${passedAll.length} 个 (${(passedAll.length/results.length*100).toFixed(1)}%)`);
  if (passedAll.length > 0) {
    passedAll.forEach(r => {
      console.log(`    ${r.symbol}: 通过（实验2错误地买入了）`);
    });
  }
  console.log('');

  // 分析重叠
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【重叠分析】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const filteredByBoth = results.filter(r => r.creatorIsNotBadDevWallet === false && r.drawdownFromHighest <= -25);
  const filteredByCreatorOnly = results.filter(r => r.creatorIsNotBadDevWallet === false && (r.drawdownFromHighest === undefined || r.drawdownFromHighest > -25));
  const filteredByDrawdownOnly = results.filter(r => r.creatorIsNotBadDevWallet !== false && r.drawdownFromHighest <= -25);

  console.log(`被两个条件都过滤: ${filteredByBoth.length} 个`);
  if (filteredByBoth.length > 0) {
    filteredByBoth.forEach(r => console.log(`  ${r.symbol}`));
  }
  console.log('');

  console.log(`仅被 creatorIsNotBadDevWallet 过滤: ${filteredByCreatorOnly.length} 个`);
  if (filteredByCreatorOnly.length > 0) {
    filteredByCreatorOnly.forEach(r => console.log(`  ${r.symbol}`));
  }
  console.log('');

  console.log(`仅被 drawdownFromHighest 过滤: ${filteredByDrawdownOnly.length} 个`);
  if (filteredByDrawdownOnly.length > 0) {
    filteredByDrawdownOnly.forEach(r => console.log(`  ${r.symbol}`));
  }
  console.log('');

  // 结论
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎯 结论');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('【过滤贡献度】');
  console.log('');
  console.log(`1. creatorIsNotBadDevWallet >= 1: ${filteredByCreator.length}/${results.length} (${(filteredByCreator.length/results.length*100).toFixed(1)}%)`);
  console.log(`2. drawdownFromHighest > -25: ${filteredByDrawdown.length}/${results.length} (${(filteredByDrawdown.length/results.length*100).toFixed(1)}%)`);
  console.log('');

  console.log('【主要过滤条件】');
  if (filteredByCreator.length > filteredByDrawdown.length) {
    console.log(`creatorIsNotBadDevWallet >= 1 是主要过滤条件`);
    console.log(`过滤了 ${filteredByCreator.length} 个代币，占 ${(filteredByCreator.length/results.length*100).toFixed(1)}%`);
  } else if (filteredByDrawdown.length > filteredByCreator.length) {
    console.log(`drawdownFromHighest > -25 是主要过滤条件`);
    console.log(`过滤了 ${filteredByDrawdown.length} 个代币，占 ${(filteredByDrawdown.length/results.length*100).toFixed(1)}%`);
  } else {
    console.log(`两个条件过滤效果相当`);
  }
  console.log('');

  console.log('【建议】');
  console.log('');
  console.log('这两个过滤条件都非常重要：');
  console.log('- creatorIsNotBadDevWallet >= 1: 避免购买"坏钱包"创建的代币');
  console.log('- drawdownFromHighest > -25: 避免在回撤过大时买入');
  console.log('');
  console.log('建议同时使用这两个条件！');
}

main().catch(console.error);
