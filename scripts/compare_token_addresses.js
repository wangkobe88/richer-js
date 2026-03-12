/**
 * 对比两个实验中实际交易的代币地址
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
  console.log('=== 对比两个实验的代币地址 ===\n');

  const [trades1, trades2] = await Promise.all([
    get('http://localhost:3010/api/experiment/209a7796-f955-4d7a-ae21-0902fef3d7cc/trades?limit=1000'),
    get('http://localhost:3010/api/experiment/2522cab9-721f-4922-86f9-7484d644e7cc/trades?limit=1000')
  ]);

  // 获取实验2中那13个代币的地址
  const onlyInExp2 = [
    'DREAM', '吃瓜群众', 'FIGHT', 'MAC', 'Pill', '何医', 'Angel',
    'Four.meme trenches', 'AI Agent时代', '杨果福', 'FLORK', '龙虾港', '牦牛'
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【实验2中那13个代币的地址】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const exp2TokenAddresses = {};

  for (const symbol of onlyInExp2) {
    const tokenTrades = trades2.trades?.filter(t => t.token_symbol === symbol && t.direction === 'buy') || [];
    if (tokenTrades.length > 0) {
      const address = tokenTrades[0].token_address;
      exp2TokenAddresses[symbol] = address;
      console.log(`${symbol}: ${address}`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【检查实验1中是否有这些地址的 trades】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const [symbol, address] of Object.entries(exp2TokenAddresses)) {
    const tradesInExp1 = trades1.trades?.filter(t => t.token_address === address) || [];
    console.log(`${symbol} (${address.slice(0, 10)}...): ${tradesInExp1.length} trades in Exp1`);
  }

  // 检查实验1中交易的代币
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【实验1中的所有代币符号】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const exp1Symbols = [...new Set(trades1.trades?.map(t => t.token_symbol) || [])];
  exp1Symbols.sort();
  console.log(`实验1共交易 ${exp1Symbols.length} 个代币:`);
  exp1Symbols.forEach(s => console.log(`  - ${s}`));

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【实验2中的所有代币符号】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const exp2Symbols = [...new Set(trades2.trades?.map(t => t.token_symbol) || [])];
  exp2Symbols.sort();
  console.log(`实验2共交易 ${exp2Symbols.length} 个代币:`);
  exp2Symbols.forEach(s => console.log(`  - ${s}`));
}

main().catch(console.error);
