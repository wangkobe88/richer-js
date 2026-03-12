/**
 * 分析实验2中那13个代币的具体因子值
 * 确定是被 creatorIsNotBadDevWallet 还是 drawdownFromHighest 过滤
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
  console.log('=== 分析13个被过滤代币的因子值 ===\n');

  // 实验2中独有的13个代币
  const onlyInExp2 = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛'
  ];

  // 获取实验2的 signals
  const signalsData = await get('http://localhost:3010/api/experiment/2522cab9-721f-4922-86f9-7484d644e7cc/signals?limit=1000');
  const tradesData = await get('http://localhost:3010/api/experiment/2522cab9-721f-4922-86f9-7484d644e7cc/trades?limit=1000');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【逐个分析这13个代币】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const results = [];

  for (const symbol of onlyInExp2) {
    // 查找这个代币的第一个买入信号
    const buySignals = signalsData.signals?.filter(s =>
      s.token_symbol === symbol &&
      s.action === 'buy' &&
      s.executed === true
    ) || [];

    if (buySignals.length === 0) {
      console.log(`${symbol}: 未找到已执行的买入信号`);
      continue;
    }

    const firstBuySignal = buySignals[0];
    const factors = firstBuySignal.metadata?.preBuyCheckFactors || {};
    const trendFactors = firstBuySignal.metadata?.trendFactors || {};

    const creatorIsNotBadDevWallet = factors.creatorIsNotBadDevWallet;
    const drawdownFromHighest = trendFactors.drawdownFromHighest;

    // 判断被哪个条件过滤
    let filteredBy = [];
    if (creatorIsNotBadDevWallet !== undefined && creatorIsNotBadDevWallet < 1) {
      filteredBy.push('creatorIsNotBadDevWallet < 1');
    }
    if (drawdownFromHighest !== undefined && drawdownFromHighest <= -25) {
      filteredBy.push('drawdownFromHighest <= -25');
    }

    // 如果两个条件都不满足，说明这个代币理论上应该被实验1过滤
    // 但如果两个条件都满足，说明实验1没有过滤它（那就有其他原因）
    let status = '';
    if (filteredBy.length === 0) {
      status = '⚠️  两个条件都满足，应该不被过滤';
    } else if (filteredBy.length === 2) {
      status = '🔴 两个条件都不满足';
    } else {
      status = `🟡 ${filteredBy[0]}`;
    }

    // 获取收益情况
    const tokenTrades = tradesData.trades?.filter(t => t.token_symbol === symbol) || [];
    let pnl = 0;
    if (tokenTrades.length > 0) {
      const lastTrade = tokenTrades[tokenTrades.length - 1];
      pnl = lastTrade.pnl_percent || 0;
    }

    results.push({
      symbol,
      creatorIsNotBadDevWallet,
      drawdownFromHighest,
      filteredBy,
      status,
      pnl
    });

    console.log(`${symbol}:`);
    console.log(`  creatorIsNotBadDevWallet: ${creatorIsNotBadDevWallet ?? 'N/A'}`);
    console.log(`  drawdownFromHighest: ${drawdownFromHighest?.toFixed(1) ?? 'N/A'}%`);
    console.log(`  收益: ${pnl > 0 ? '+' : ''}${pnl.toFixed(1)}%`);
    console.log(`  ${status}`);
    console.log('');
  }

  // 统计
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【统计总结】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const byCreator = results.filter(r => r.filteredBy.includes('creatorIsNotBadDevWallet < 1'));
  const byDrawdown = results.filter(r => r.filteredBy.includes('drawdownFromHighest <= -25'));
  const byBoth = results.filter(r => r.filteredBy.length === 2);
  const byNone = results.filter(r => r.filteredBy.length === 0);

  console.log(`因 creatorIsNotBadDevWallet < 1 被过滤: ${byCreator.length} 个`);
  byCreator.forEach(r => console.log(`  - ${r.symbol} (${r.pnl > 0 ? '+' : ''}${r.pnl.toFixed(1)}%)`));
  console.log('');

  console.log(`因 drawdownFromHighest <= -25 被过滤: ${byDrawdown.length} 个`);
  byDrawdown.forEach(r => console.log(`  - ${r.symbol} (${r.pnl > 0 ? '+' : ''}${r.pnl.toFixed(1)}%)`));
  console.log('');

  console.log(`因两个条件都不满足被过滤: ${byBoth.length} 个`);
  byBoth.forEach(r => console.log(`  - ${r.symbol} (${r.pnl > 0 ? '+' : ''}${r.pnl.toFixed(1)}%)`));
  console.log('');

  console.log(`两个条件都满足（应该不被过滤）: ${byNone.length} 个`);
  byNone.forEach(r => console.log(`  - ${r.symbol} (${r.pnl > 0 ? '+' : ''}${r.pnl.toFixed(1)}%)`));
  console.log('');

  // 计算平均收益
  const avgPnlAll = results.reduce((sum, r) => sum + r.pnl, 0) / results.length;
  const avgPnlFiltered = results.filter(r => r.filteredBy.length > 0).reduce((sum, r) => sum + r.pnl, 0) / results.filter(r => r.filteredBy.length > 0).length;
  const avgPnlNotFiltered = byNone.reduce((sum, r) => sum + r.pnl, 0) / (byNone.length || 1);

  console.log('【收益分析】');
  console.log(`  全部13个代币平均收益: ${avgPnlAll > 0 ? '+' : ''}${avgPnlAll.toFixed(1)}%`);
  console.log(`  被过滤的代币平均收益: ${avgPnlFiltered > 0 ? '+' : ''}${avgPnlFiltered.toFixed(1)}%`);
  console.log(`  未被过滤的代币平均收益: ${avgPnlNotFiltered > 0 ? '+' : ''}${avgPnlNotFiltered.toFixed(1)}%`);
}

main().catch(console.error);
