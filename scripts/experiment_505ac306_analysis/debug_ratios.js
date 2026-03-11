const fs = require('fs');
const path = require('path');
const http = require('http');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';
const EXPERIMENT_ID = '505ac306-97fc-43d6-b027-00b909469b81';
const SOURCE_EXPERIMENT_ID = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

const tokenEarlyInvestments = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data/token_early_participants_with_investment.json'), 'utf8'));

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    }).on('error', reject);
  });
}

function classifyWalletsByInvestment(walletInvestments, thresholds) {
  const classified = { large: [], medium: [], small: [] };

  Object.entries(walletInvestments).forEach(([addr, amount]) => {
    if (amount >= thresholds.large) {
      classified.large.push(addr);
    } else if (amount >= thresholds.medium) {
      classified.medium.push(addr);
    } else {
      classified.small.push(addr);
    }
  });

  return classified;
}

async function debug() {
  const [tradesRes, tokensRes] = await Promise.all([
    get(`http://localhost:3010/api/experiment/${EXPERIMENT_ID}/trades?limit=10000`),
    get(`http://localhost:3010/api/experiment/${SOURCE_EXPERIMENT_ID}/tokens?limit=10000`)
  ]);

  const trades = tradesRes.trades || [];
  const labelsMap = new Map();
  if (tokensRes.success && tokensRes.data) {
    tokensRes.data.forEach(token => {
      if (token.human_judges && token.human_judges.category) {
        labelsMap.set(token.token_address.toLowerCase(), token.human_judges);
      }
    });
  }

  const tokenTrades = {};
  trades.forEach(t => {
    if (!tokenTrades[t.token_address]) tokenTrades[t.token_address] = [];
    tokenTrades[t.token_address].push(t);
  });

  const investmentMap = {};
  tokenEarlyInvestments.forEach(t => {
    investmentMap[t.token_address.toLowerCase()] = t;
  });

  const thresholds = { large: 500, medium: 50 };
  const ratios = [];

  Object.keys(tokenTrades).forEach(tokenAddress => {
    if (!labelsMap.has(tokenAddress.toLowerCase())) return;

    const invData = investmentMap[tokenAddress.toLowerCase()];
    if (!invData || invData.wallet_count === 0) return;

    const classified = classifyWalletsByInvestment(invData.wallet_investments, thresholds);
    const total = classified.large.length + classified.medium.length + classified.small.length;

    const largeRatio = classified.large.length / total;
    const mediumRatio = classified.medium.length / total;
    const smallRatio = classified.small.length / total;

    const quality = labelsMap.get(tokenAddress.toLowerCase()).category;

    ratios.push({ token: tokenAddress.slice(0,10)+'...', quality, large: largeRatio, medium: mediumRatio, small: smallRatio, total });
  });

  console.log('各代币的大户/中户/小户比例（方案B: >$500大户, >$50中户）:');
  console.log('');
  ratios.sort((a, b) => b.large - a.large).forEach(r => {
    const q = { high_quality: '高', mid_quality: '中', low_quality: '低' }[r.quality];
    console.log(`${r.token} [${q}质量]: 大户${r.large.toFixed(3)}, 中户${r.medium.toFixed(3)}, 小户${r.small.toFixed(3)} (总${r.total}人)`);
  });

  console.log('');
  console.log('大户比例统计:');
  const largeVals = ratios.map(r => r.large);
  console.log('  最小:', Math.min(...largeVals).toFixed(3));
  console.log('  最大:', Math.max(...largeVals).toFixed(3));
  const mean = largeVals.reduce((a,b) => a+b, 0) / largeVals.length;
  console.log('  平均:', mean.toFixed(3));
  const variance = largeVals.reduce((a,b) => a + Math.pow(b - mean, 2), 0) / largeVals.length;
  console.log('  方差:', variance.toFixed(6));
  console.log('  标准差:', Math.sqrt(variance).toFixed(3));
}

debug().catch(console.error);
