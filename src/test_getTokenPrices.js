const { AveTokenAPI } = require('./core/ave-api/token-api');

const AVE_API_KEY = 'Jt0zVB6vOd2UEKfcNuCHSfXR44LMTD9IGKZoEAo54ao3RG6FgbXfMBsjhd3lN5cX';
const EXPERIMENT_ID = '90916ad8-9690-453c-8ae7-d17715e602e5';
const BASE_URL = 'http://localhost:3010';

// Fetch with native Node.js
function fetch(url) {
  const protocol = url.startsWith('https') ? require('https') : require('http');
  return new Promise((resolve, reject) => {
    protocol.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ json: () => JSON.parse(data) });
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// 获取实验代币
async function getTokens() {
  const response = await fetch(BASE_URL + '/api/experiment/' + EXPERIMENT_ID + '/tokens?limit=1000');
  const result = await response.json();
  return result.tokens || result.data || [];
}

async function main() {
  console.log('正在获取实验代币列表...\n');
  const tokens = await getTokens();
  console.log('找到 ' + tokens.length + ' 个代币\n');

  // 构建tokenId列表
  const tokenIds = tokens.map(function(t) {
    return t.token_address + '-bsc';
  });

  console.log('准备批量获取价格...\n');

  // 创建AVE API客户端
  const aveApi = new AveTokenAPI(
    'https://prod.ave-api.com',
    30000,
    AVE_API_KEY
  );

  // 批量获取价格（设置较低的阈值以确保获取新代币数据）
  const startTime = Date.now();
  const prices = await aveApi.getTokenPrices(tokenIds, 0, 0);
  const elapsed = Date.now() - startTime;

  console.log('获取完成! 耗时: ' + elapsed + 'ms\n');

  // 统计结果
  let withPrice = 0;
  let withoutPrice = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const tokenId = token.token_address + '-bsc';
    const priceInfo = prices[tokenId];

    if (priceInfo && priceInfo.current_price_usd) {
      const price = parseFloat(priceInfo.current_price_usd);
      if (price > 0) {
        console.log('[$] ' + token.token_symbol + ': $' + price.toFixed(6));
        withPrice++;
      } else {
        console.log('[无价格] ' + token.token_symbol + ': 价格为0');
        withoutPrice++;
      }
    } else {
      console.log('[无价格] ' + token.token_symbol + ': API未返回');
      withoutPrice++;
    }
  }

  console.log('\n========== 统计结果 ==========');
  console.log('总代币数: ' + tokens.length);
  console.log('有实时价格: ' + withPrice + ' (' + (withPrice/tokens.length*100).toFixed(1) + '%)');
  console.log('无实时价格: ' + withoutPrice + ' (' + (withoutPrice/tokens.length*100).toFixed(1) + '%)');
  console.log('API请求耗时: ' + elapsed + 'ms');
}

main().catch(console.error);
