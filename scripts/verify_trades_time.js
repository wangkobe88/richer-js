/**
 * 从页面获取代币的实际交易时间
 * 验证之前的分析结论
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
  console.log('=== 验证实验2的代币交易时间 ===\n');

  // 获取实验2的 trades
  const tradesData = await get('http://localhost:3010/api/experiment/2522cab9-721f-4922-86f9-7484d644e7cc/trades?limit=1000');

  // 获取那13个代币的交易时间
  const onlyInExp2 = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛'
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【实验2独有代币的交易时间】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  onlyInExp2.forEach(symbol => {
    const tokenTrades = tradesData.trades?.filter(t => t.token_symbol === symbol && t.direction === 'buy') || [];

    if (tokenTrades.length > 0) {
      const firstTrade = tokenTrades[0];
      const tradeTime = new Date(firstTrade.timestamp);
      console.log(`${symbol}:`);
      console.log(`  首次买入时间: ${tradeTime.toLocaleString('zh-CN')}`);

      if (tokenTrades.length > 1) {
        console.log(`  共 ${tokenTrades.length} 次买入`);
      }
      console.log('');
    }
  });

  // 也检查实验1中这些代币的交易时间
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【检查这些代币在实验1中的情况】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const tradesData1 = await get('http://localhost:3010/api/experiment/209a7796-f955-4d7a-ae21-0902fef3d7cc/trades?limit=1000');

  onlyInExp2.forEach(symbol => {
    const tokenTrades = tradesData1.trades?.filter(t => t.token_symbol === symbol && t.direction === 'buy') || [];

    if (tokenTrades.length > 0) {
      const firstTrade = tokenTrades[0];
      const tradeTime = new Date(firstTrade.timestamp);
      console.log(`${symbol}: ${tradeTime.toLocaleString('zh-CN')}`);
    } else {
      console.log(`${symbol}: 无交易（或未执行）`);
    }
  });

  // 检查时间范围
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【时间范围验证】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const timestamps1 = tradesData1.trades?.map(t => new Date(t.timestamp).getTime()) || [];
  const timestamps2 = tradesData.trades?.map(t => new Date(t.timestamp).getTime()) || [];

  if (timestamps1.length > 0) {
    const min1 = new Date(Math.min(...timestamps1));
    const max1 = new Date(Math.max(...timestamps1));
    console.log(`实验1交易时间范围: ${min1.toLocaleString('zh-CN')} - ${max1.toLocaleString('zh-CN')}`);
  }

  if (timestamps2.length > 0) {
    const min2 = new Date(Math.min(...timestamps2));
    const max2 = new Date(Math.max(...timestamps2));
    console.log(`实验2交易时间范围: ${min2.toLocaleString('zh-CN')} - ${max2.toLocaleString('zh-CN')}`);
  }
}

main().catch(console.error);
