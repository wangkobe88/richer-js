require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });
const { AveTokenAPI } = require('../../src/core/ave-api/token-api.js');

async function checkSameNameTokens(symbol) {
  const aveAPI = new AveTokenAPI('https://prod.ave-api.com', 30000, process.env.AVE_API_KEY);
  const results = await aveAPI.searchTokens(symbol, null, 20, 'fdv');
  
  console.log(`\n=== Symbol: "${symbol}" ===`);
  console.log(`搜索结果数量: ${results.length}\n`);
  
  results.slice(0, 15).forEach((t, i) => {
    const name = t.name || '(no name)';
    const fdv = t.fdv || 'N/A';
    const fdvNum = parseFloat(fdv.replace(/,/g, '')) || 0;
    const fdvDisplay = fdvNum > 1000000 ? (fdvNum / 1000000).toFixed(1) + 'M' : fdv;
    console.log(`${i + 1}. Symbol: "${t.symbol.padEnd(8)}" | Name: "${name.padEnd(40)}" | FDV: $${fdvDisplay}`);
  });
}

// 检查几个symbol
const symbols = ['LEO', '1$', 'CTO', '鱼缸', 'NemoClaw', 'Life'];

(async () => {
  for (const symbol of symbols) {
    await checkSameNameTokens(symbol);
  }
})();
