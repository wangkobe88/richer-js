/**
 * 检查实验1中那13个代币的所有信号（包括非buy信号）
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
  console.log('=== 检查实验1中13个代币的所有信号 ===\n');

  const onlyInExp2 = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛'
  ];

  const signalsData1 = await get('http://localhost:3010/api/experiment/209a7796-f955-4d7a-ae21-0902fef3d7cc/signals?limit=5000');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【逐个检查每个代币】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const symbol of onlyInExp2) {
    const allSignals = signalsData1.signals?.filter(s => s.token_symbol === symbol) || [];

    if (allSignals.length === 0) {
      console.log(`${symbol}: 无任何信号`);
    } else {
      console.log(`${symbol}: 有 ${allSignals.length} 个信号`);
      allSignals.forEach(s => {
        const time = new Date(s.timestamp).toLocaleString('zh-CN');
        console.log(`  ${s.action} - ${time} - executed: ${s.executed}`);
        if (s.action === 'buy' && !s.executed) {
          console.log(`    拒绝原因: ${s.execution_reason || s.reason || '无'}`);
          // 打印因子
          const factors = s.metadata?.preBuyCheckFactors || {};
          console.log(`    creatorIsNotBadDevWallet: ${factors.creatorIsNotBadDevWallet ?? 'N/A'}`);
          const trendFactors = s.metadata?.trendFactors || {};
          console.log(`    drawdownFromHighest: ${trendFactors.drawdownFromHighest?.toFixed(1) ?? factors.drawdownFromHighest?.toFixed(1) ?? 'N/A'}%`);
        }
      });
    }
    console.log('');
  }

  // 统计
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【统计】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let withSignals = 0;
  let withRejectedBuy = 0;
  let noSignals = 0;

  for (const symbol of onlyInExp2) {
    const allSignals = signalsData1.signals?.filter(s => s.token_symbol === symbol) || [];
    if (allSignals.length === 0) {
      noSignals++;
    } else {
      withSignals++;
      const rejectedBuys = allSignals.filter(s => s.action === 'buy' && !s.executed);
      if (rejectedBuys.length > 0) {
        withRejectedBuy++;
      }
    }
  }

  console.log(`无任何信号的代币: ${noSignals} 个`);
  console.log(`有信号但无buy信号的代币: ${withSignals - withRejectedBuy} 个`);
  console.log(`有被拒绝的buy信号的代币: ${withRejectedBuy} 个`);
}

main().catch(console.error);
