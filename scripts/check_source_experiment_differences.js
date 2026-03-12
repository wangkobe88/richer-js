/**
 * 检查两个回测实验的源实验数据
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
  console.log('=== 检查源实验差异 ===\n');

  // 获取源实验 ID
  const { data: exp1 } = await get('http://localhost:3010/api/experiment/209a7796-f955-4d7a-ae21-0902fef3d7cc');
  const { data: exp2 } = await get('http://localhost:3010/api/experiment/2522cab9-721f-4922-86f9-7484d644e7cc');

  const sourceId1 = exp1.experiment?.config?.backtest?.sourceExperimentId;
  const sourceId2 = exp2.experiment?.config?.backtest?.sourceExperimentId;

  console.log(`实验1的源实验ID: ${sourceId1 || 'N/A'}`);
  console.log(`实验2的源实验ID: ${sourceId2 || 'N/A'}`);

  if (sourceId1 && sourceId1 === sourceId2) {
    console.log('\n两个实验使用相同的源实验');

    // 检查源实验中有多少代币
    const { data: sourceTrades } = await get(`http://localhost:3010/api/experiment/${sourceId1}/trades?limit=10000`);
    const sourceTokens = [...new Set(sourceTrades.trades?.map(t => t.token_symbol) || [])];
    console.log(`源实验中有 ${sourceTokens.length} 个代币`);

    // 检查那14个只在实验2中的代币是否在源实验中
    const onlyInExp2 = [
      'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
      'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛', 'Claude '
    ];

    console.log('\n检查这14个代币是否在源实验中:');
    for (const symbol of onlyInExp2) {
      const inSource = sourceTokens.includes(symbol);
      console.log(`  ${symbol}: ${inSource ? '在' : '不在'}`);
    }

    // 检查这些代币在源实验中的 trades 数量
    console.log('\n这些代币在源实验中的交易数量:');
    for (const symbol of onlyInExp2) {
      const trades = sourceTrades.trades?.filter(t => t.token_symbol === symbol) || [];
      if (trades.length > 0) {
        const firstBuy = trades.find(t => t.direction === 'buy');
        if (firstBuy) {
          const time = new Date(firstBuy.timestamp);
          console.log(`  ${symbol}: ${trades.length} trades, 首次买入: ${time.toLocaleString('zh-CN')}`);
        }
      }
    }
  }
}

main().catch(console.error);
