/**
 * 检查代币 0xfe874780eca65226e3efea2eedacfaf477784444 在实验2中的情况
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
  const tokenAddress = '0xfe874780eca65226e3efea2eedacfaf477784444';

  console.log('=== 检查代币 0xfe874780...444 ===\n');

  // 获取实验2的数据
  const [signals2, trades2] = await Promise.all([
    get('http://localhost:3010/api/experiment/2522cab9-721f-4922-86f9-7484d644e7cc/signals?limit=1000'),
    get('http://localhost:3010/api/experiment/2522cab9-721f-4922-86f9-7484d644e7cc/trades?limit=1000')
  ]);

  // 查找这个代币的 signals
  const tokenSignals = signals2.signals?.filter(s => s.token_address === tokenAddress) || [];

  console.log(`实验2中找到 ${tokenSignals.length} 个 signals\n`);

  if (tokenSignals.length > 0) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('【该代币的所有 signals】');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    tokenSignals.forEach(s => {
      const time = new Date(s.timestamp);
      console.log(`${s.action} - ${time.toLocaleString('zh-CN')}`);
      console.log(`  executed: ${s.executed}`);
      console.log(`  reason: ${s.reason || '无'}`);
      console.log(`  confidence: ${s.confidence || 'N/A'}`);
      console.log('');
    });

    // 分析 buy signals
    const buySignals = tokenSignals.filter(s => s.action === 'buy');

    if (buySignals.length > 0) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('【Buy signals 详细分析】');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      buySignals.forEach(s => {
        const factors = s.metadata?.preBuyCheckFactors || {};
        const trendFactors = s.metadata?.trendFactors || {};

        console.log(`时间: ${new Date(s.timestamp).toLocaleString('zh-CN')}`);
        console.log(`executed: ${s.executed}`);

        if (s.executed === false) {
          console.log(`拒绝原因: ${s.execution_reason || '无'}`);
        }

        console.log('');
        console.log('因子:');
        console.log(`  countPerMin: ${factors.earlyTradesCountPerMin?.toFixed(1) || 'N/A'}`);
        console.log(`  earlyReturn: ${trendFactors.earlyReturn?.toFixed(1) || 'N/A'}%`);
        console.log(`  drawdownFromHighest: ${trendFactors.drawdownFromHighest?.toFixed(1) || 'N/A'}%`);
        console.log(`  creatorIsNotBadDevWallet: ${factors.creatorIsNotBadDevWallet || 'N/A'}`);
        console.log('');
      });
    }
  }

  // 检查实验1是否有这个代币
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【检查实验1是否有这个代币】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const [signals1] = await Promise.all([
    get('http://localhost:3010/api/experiment/209a7796-f955-4d7a-ae21-0902fef3d7cc/signals?limit=1000')
  ]);

  const tokenSignals1 = signals1.signals?.filter(s => s.token_address === tokenAddress) || [];

  console.log(`实验1中找到 ${tokenSignals1.length} 个 signals\n`);

  if (tokenSignals1.length > 0) {
    console.log('实验1的 signals:');
    tokenSignals1.forEach(s => {
      const time = new Date(s.timestamp);
      console.log(`  ${s.action} - ${time.toLocaleString('zh-CN')} - executed: ${s.executed}`);
    });
  } else {
    console.log('实验1没有这个代币的 signals');
  }
}

main().catch(console.error);
