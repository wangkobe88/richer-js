/**
 * 检查实验2中那13个代币的 preBuyCheckFactors 是否有 drawdownFromHighest
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
  console.log('=== 检查 preBuyCheckFactors 中的 drawdownFromHighest ===\n');

  const onlyInExp2 = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛'
  ];

  const signalsData = await get('http://localhost:3010/api/experiment/2522cab9-721f-4922-86f9-7484d644e7cc/signals?limit=1000');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【检查 preBuyCheckFactors 中的 drawdownFromHighest】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const symbol of onlyInExp2.slice(0, 3)) { // 只检查前3个
    const buySignals = signalsData.signals?.filter(s =>
      s.token_symbol === symbol &&
      s.action === 'buy' &&
      s.executed === true
    ) || [];

    if (buySignals.length > 0) {
      const firstBuy = buySignals[0];
      const preBuyFactors = firstBuy.metadata?.preBuyCheckFactors || {};
      const trendFactors = firstBuy.metadata?.trendFactors || {};

      console.log(`${symbol}:`);
      console.log(`  preBuyCheckFactors.drawdownFromHighest: ${preBuyFactors.drawdownFromHighest ?? 'undefined'}`);
      console.log(`  trendFactors.drawdownFromHighest: ${trendFactors.drawdownFromHighest?.toFixed(1) ?? 'undefined'}%`);
      console.log('');
    }
  }

  // 对比实验1
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【对比实验1的相同代币】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const signalsData1 = await get('http://localhost:3010/api/experiment/209a7796-f955-4d7a-ae21-0902fef3d7cc/signals?limit=1000');

  // 找一个在实验1中存在的代币进行对比
  const testToken = 'DREAM';
  const buySignals1 = signalsData1.signals?.filter(s =>
    s.token_symbol === testToken &&
    s.action === 'buy'
  ) || [];

  console.log(`${testToken} 在实验1中的情况:`);
  if (buySignals1.length === 0) {
    console.log('  没有任何 buy 信号');

    // 检查是否有被拒绝的信号
    const allSignals1 = signalsData1.signals?.filter(s => s.token_symbol === testToken) || [];
    if (allSignals1.length > 0) {
      console.log(`  但有 ${allSignals1.length} 个信号（可能被拒绝）`);
      allSignals1.forEach(s => {
        console.log(`    ${s.action} - executed: ${s.executed} - ${s.reason || s.execution_reason || ''}`);
      });
    }
  } else {
    buySignals1.forEach(s => {
      console.log(`  ${s.action} - executed: ${s.executed}`);
      if (!s.executed) {
        console.log(`    原因: ${s.execution_reason || '无'}`);
      }
    });
  }
}

main().catch(console.error);
