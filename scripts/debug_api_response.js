/**
 * 调试：打印AVE API返回的原始数据
 */

const http = require('http');

function callEarlyTradesAPI(tokenAddress, chain) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      tokenAddress,
      chain,
      timeWindowMinutes: 3,
      limit: 10
    });

    const options = {
      hostname: 'localhost',
      port: 3010,
      path: '/api/token-early-trades',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

async function debugAPI() {
  const tokenAddress = '0x616ddfe8a24f95984f35de866e1570550b1a4444'; // 巨鲸
  const chain = 'bsc';

  console.log('调试巨鲸代币的API返回数据...\n');

  const result = await callEarlyTradesAPI(tokenAddress, chain);

  console.log('API返回成功！');
  console.log('success:', result.success);
  console.log('tokenInfo:', JSON.stringify(result.data.tokenInfo, null, 2));
  console.log('\nearlyTrades (前5笔):');
  result.data.earlyTrades.slice(0, 5).forEach((t, i) => {
    console.log(`\n${i + 1}. 原始数据:`);
    console.log(JSON.stringify(t, null, 2));
  });
}

debugAPI().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
