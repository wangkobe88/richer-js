/**
 * 检查两个实验的 loopCount 范围
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
  console.log('=== 检查两个实验的 loopCount 范围 ===\n');

  const exp1Id = '209a7796-f955-4d7a-ae21-0902fef3d7cc';
  const exp2Id = '2522cab9-721f-4922-86f9-7484d644e7cc';

  // 获取两个实验的 signals
  const [signals1, signals2] = await Promise.all([
    get(`http://localhost:3010/api/experiment/${exp1Id}/signals?limit=10000`),
    get(`http://localhost:3010/api/experiment/${exp2Id}/signals?limit=10000`)
  ]);

  // 提取 loopCount
  const loopCounts1 = signals1.signals?.map(s => s.metadata?.loopCount).filter(n => n != null) || [];
  const loopCounts2 = signals2.signals?.map(s => s.metadata?.loopCount).filter(n => n != null) || [];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【loopCount 范围】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`实验1: ${Math.min(...loopCounts1)} - ${Math.max(...loopCounts1)} (共 ${[...new Set(loopCounts1)].length} 个不同的 loopCount)`);
  console.log(`实验2: ${Math.min(...loopCounts2)} - ${Math.max(...loopCounts2)} (共 ${[...new Set(loopCounts2)].length} 个不同的 loopCount)`);

  // 检查那14个代币的 loopCount
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【那14个代币在实验2中的 loopCount】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const onlyInExp2Symbols = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛', 'Claude '
  ];

  for (const symbol of onlyInExp2Symbols.slice(0, 5)) {
    const buySignals = signals2.signals?.filter(s =>
      s.token_symbol === symbol &&
      s.action === 'buy' &&
      s.executed === true
    ) || [];

    if (buySignals.length > 0) {
      const loopCount = buySignals[0].metadata?.loopCount;
      console.log(`${symbol}: loopCount ${loopCount}`);
    }
  }

  // 检查实验1在这些 loopCount 时有哪些信号
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【实验1在这些 loopCount 时的信号】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const targetLoopCounts = [...new Set(onlyInExp2Symbols.slice(0, 5).map(symbol => {
    const buySignals = signals2.signals?.filter(s =>
      s.token_symbol === symbol &&
      s.action === 'buy' &&
      s.executed === true
    ) || [];
    return buySignals[0]?.metadata?.loopCount;
  }).filter(n => n != null))];

  console.log(`实验1在这些 loopCount 的信号数量:`);
  for (const loopCount of targetLoopCounts.slice(0, 3)) {
    const signalsAtLoop = signals1.signals?.filter(s => s.metadata?.loopCount === loopCount) || [];
    console.log(`  loopCount ${loopCount}: ${signalsAtLoop.length} 个信号`);
  }
}

main().catch(console.error);
