/**
 * 检查那14个代币的 creatorIsNotBadDevWallet 因子值
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
  console.log('=== 检查那14个代币的 creatorIsNotBadDevWallet 值 ===\n');

  const exp2Id = '2522cab9-721f-4922-86f9-7484d644e7cc';

  // 获取实验2的 signals
  const signalsData = await get(`http://localhost:3010/api/experiment/${exp2Id}/signals?limit=5000`);

  const onlyInExp2Symbols = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛', 'Claude '
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【那14个代币的 creatorIsNotBadDevWallet 值】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const results = [];

  for (const symbol of onlyInExp2Symbols) {
    const buySignals = signalsData.signals?.filter(s =>
      s.token_symbol === symbol &&
      s.action === 'buy' &&
      s.executed === true
    ) || [];

    if (buySignals.length > 0) {
      const firstBuy = buySignals[0];
      const factors = firstBuy.metadata?.preBuyCheckFactors || {};
      const creatorIsNotBadDevWallet = factors.creatorIsNotBadDevWallet;

      results.push({
        symbol,
        creatorIsNotBadDevWallet,
        filteredByCreator: creatorIsNotBadDevWallet !== undefined && creatorIsNotBadDevWallet < 1
      });

      const status = creatorIsNotBadDevWallet < 1 ? '❌ 会被 creatorIsNotBadDevWallet >= 1 过滤' : '✅ 通过 creatorIsNotBadDevWallet >= 1';
      console.log(`${symbol}: ${creatorIsNotBadDevWallet ?? 'N/A'} - ${status}`);
    }
  }

  // 统计
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【统计】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const filteredByCreator = results.filter(r => r.filteredByCreator);
  const notFilteredByCreator = results.filter(r => !r.filteredByCreator);

  console.log(`会被 creatorIsNotBadDevWallet >= 1 过滤: ${filteredByCreator.length} 个`);
  filteredByCreator.forEach(r => console.log(`  - ${r.symbol}`));

  console.log(`\n不会被 creatorIsNotBadDevWallet >= 1 过滤: ${notFilteredByCreator.length} 个`);
  notFilteredByCreator.forEach(r => console.log(`  - ${r.symbol}`));
}

main().catch(console.error);
