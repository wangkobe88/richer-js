/**
 * 检查两个实验的时间范围差异
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
  console.log('=== 检查两个实验的时间范围 ===\n');

  const [signals1, signals2] = await Promise.all([
    get('http://localhost:3010/api/experiment/209a7796-f955-4d7a-ae21-0902fef3d7cc/signals?limit=10000'),
    get('http://localhost:3010/api/experiment/2522cab9-721f-4922-86f9-7484d644e7cc/signals?limit=10000')
  ]);

  const timestamps1 = signals1.signals?.map(s => new Date(s.timestamp).getTime()) || [];
  const timestamps2 = signals2.signals?.map(s => new Date(s.timestamp).getTime()) || [];

  if (timestamps1.length > 0) {
    const min1 = new Date(Math.min(...timestamps1));
    const max1 = new Date(Math.max(...timestamps1));
    console.log(`实验1时间范围:`);
    console.log(`  开始: ${min1.toLocaleString('zh-CN')}`);
    console.log(`  结束: ${max1.toLocaleString('zh-CN')}`);
    console.log(`  跨度: ${Math.round((max1 - min1) / 1000 / 60)} 分钟`);
  }

  console.log('');

  if (timestamps2.length > 0) {
    const min2 = new Date(Math.min(...timestamps2));
    const max2 = new Date(Math.max(...timestamps2));
    console.log(`实验2时间范围:`);
    console.log(`  开始: ${min2.toLocaleString('zh-CN')}`);
    console.log(`  结束: ${max2.toLocaleString('zh-CN')}`);
    console.log(`  跨度: ${Math.round((max2 - min2) / 1000 / 60)} 分钟`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【那13个代币在实验2的信号时间】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const onlyInExp2 = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'Claude', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛'
  ];

  const buySignals2 = signals2.signals?.filter(s => s.action === 'buy') || [];

  onlyInExp2.forEach(symbol => {
    const tokenSignals = buySignals2.filter(s => s.token_symbol === symbol);
    if (tokenSignals.length > 0) {
      const firstSignal = tokenSignals[0];
      const time = new Date(firstSignal.timestamp);
      console.log(`${symbol}: ${time.toLocaleString('zh-CN')}`);
    }
  });
}

main().catch(console.error);
