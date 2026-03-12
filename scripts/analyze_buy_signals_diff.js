/**
 * 检查实验1是否根本没有这14个代币的 buy signals
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
  console.log('=== 检查两个实验的 buy signals 差异 ===\n');

  const [signals1, signals2] = await Promise.all([
    get('http://localhost:3010/api/experiment/209a7796-f955-4d7a-ae21-0902fef3d7cc/signals?limit=1000'),
    get('http://localhost:3010/api/experiment/2522cab9-721f-4922-86f9-7484d644e7cc/signals?limit=1000')
  ]);

  const buySignals1 = signals1.signals?.filter(s => s.action === 'buy') || [];
  const buySignals2 = signals2.signals?.filter(s => s.action === 'buy') || [];

  const onlyInExp2 = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'Claude', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛'
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【检查实验1是否有这14个代币的 buy signals】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  onlyInExp2.forEach(symbol => {
    const signalsInExp1 = buySignals1.filter(s => s.token_symbol === symbol);
    const signalsInExp2 = buySignals2.filter(s => s.token_symbol === symbol);

    console.log(`${symbol}:`);
    console.log(`  实验1: ${signalsInExp1.length} 个 buy signals`);
    console.log(`  实验2: ${signalsInExp2.length} 个 buy signals`);

    if (signalsInExp1.length === 0 && signalsInExp2.length > 0) {
      console.log(`  ⚠️  实验1没有这个代币的 buy signal！`);
    } else if (signalsInExp1.length > 0 && signalsInExp2.length > 0) {
      // 检查是否都被拒绝
      const executed1 = signalsInExp1.filter(s => s.executed === true);
      const executed2 = signalsInExp2.filter(s => s.executed === true);
      console.log(`  实验1 executed: ${executed1.length}, 实验2 executed: ${executed2.length}`);

      if (executed1.length === 0 && executed2.length > 0) {
        console.log(`  ⚠️  实验1都拒绝了，实验2执行了！`);
        // 检查拒绝原因
        const rejected1 = signalsInExp1.filter(s => s.executed === false);
        rejected1.forEach(s => {
          console.log(`    拒绝原因: ${s.execution_reason || '无'}`);
        });
      }
    }
    console.log('');
  });

  // 检查时间范围
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【检查回测时间范围】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const exp1Detail = await get('http://localhost:3010/api/experiment/209a7796-f955-4d7a-ae21-0902fef3d7cc');
  const exp2Detail = await get('http://localhost:3010/api/experiment/2522cab9-721f-4922-86f9-7484d644e7cc');

  const backtest1 = exp1Detail.data?.config?.backtest || {};
  const backtest2 = exp2Detail.data?.config?.backtest || {};

  console.log('实验1:');
  console.log(`  sourceExperimentId: ${backtest1.sourceExperimentId || 'N/A'}`);
  console.log(`  startedAt: ${backtest1.startedAt || 'N/A'}`);
  console.log(`  stoppedAt: ${backtest1.stoppedAt || 'N/A'}`);
  console.log('');

  console.log('实验2:');
  console.log(`  sourceExperimentId: ${backtest2.sourceExperimentId || 'N/A'}`);
  console.log(`  startedAt: ${backtest2.startedAt || 'N/A'}`);
  console.log(`  stoppedAt: ${backtest2.stoppedAt || 'N/A'}`);
  console.log('');

  // 检查是否使用相同的 source experiment
  if (backtest1.sourceExperimentId && backtest1.sourceExperimentId === backtest2.sourceExperimentId) {
    console.log('✅ 两个实验基于同一个虚拟实验');
  } else {
    console.log('❌ 两个实验基于不同的虚拟实验！');
    console.log(`  实验1: ${backtest1.sourceExperimentId}`);
    console.log(`  实验2: ${backtest2.sourceExperimentId}`);
  }
}

main().catch(console.error);
