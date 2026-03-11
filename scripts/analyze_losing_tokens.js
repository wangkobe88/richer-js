const http = require('http');

// 获取交易数据
function getTrades() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3010,
      path: '/api/experiment/25493408-98b3-4342-a1ac-036ba49f97ee/trades?limit=10000',
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end();
  });
}

// 获取信号数据
function getSignals() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3010,
      path: '/api/experiment/25493408-98b3-4342-a1ac-036ba49f97ee/signals?limit=10000',
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const [tradesData, signalsData] = await Promise.all([getTrades(), getSignals()]);

  // 按代币统计盈亏
  const tokenPnL = {};
  tradesData.trades.forEach(t => {
    if (t.trade_status !== 'success') return;
    const addr = t.token_address;
    if (!tokenPnL[addr]) {
      tokenPnL[addr] = { symbol: t.token_symbol, address: addr, totalSpent: 0, totalReceived: 0 };
    }
    if (t.direction === 'buy') {
      tokenPnL[addr].totalSpent += parseFloat(t.input_amount || 0);
    } else if (t.direction === 'sell') {
      tokenPnL[addr].totalReceived += parseFloat(t.output_amount || 0);
    }
  });

  // 计算收益率
  const results = Object.values(tokenPnL).map(t => ({
    ...t,
    returnRate: t.totalSpent > 0 ? ((t.totalReceived - t.totalSpent) / t.totalSpent * 100) : 0
  }));
  results.sort((a, b) => a.returnRate - b.returnRate);

  // 亏损最多的10个代币
  const worstTokens = results.slice(0, 10);

  console.log('=== 亏损最多代币的钱包簇因子分析 ===\n');
  console.log('规则: walletClusterSecondToFirstRatio > 0.3 AND walletClusterMegaRatio < 0.4\n');

  worstTokens.forEach(token => {
    // 找到该代币的买入信号
    const buySignals = signalsData.signals.filter(s =>
      s.action === 'buy' &&
      s.executed === true &&
      s.token_address === token.address
    );

    if (buySignals.length > 0) {
      const sig = buySignals[0];
      const f = sig.metadata?.preBuyCheckFactors || {};
      const secondToFirst = f.walletClusterSecondToFirstRatio;
      const megaRatio = f.walletClusterMegaRatio;

      const passSecondToFirst = secondToFirst !== undefined && secondToFirst > 0.3;
      const passMegaRatio = megaRatio !== undefined && megaRatio < 0.4;
      const wouldReject = !passSecondToFirst || !passMegaRatio;

      console.log(`${token.symbol} (收益率: ${token.returnRate.toFixed(2)}%)`);
      console.log(`  secondToFirstRatio: ${secondToFirst !== undefined ? secondToFirst.toFixed(3) : 'N/A'} ${passSecondToFirst ? '✅' : '❌'}`);
      console.log(`  megaRatio: ${megaRatio !== undefined ? megaRatio.toFixed(3) : 'N/A'} ${passMegaRatio ? '✅' : '❌'}`);
      console.log(`  新规则结果: ${wouldReject ? '✅ 会拒绝' : '❌ 会通过'}\n`);
    }
  });
}

main().catch(console.error);
