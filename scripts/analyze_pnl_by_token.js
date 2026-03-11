const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3010,
  path: '/api/experiment/25493408-98b3-4342-a1ac-036ba49f97ee/trades?limit=10000',
  method: 'GET'
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    const result = JSON.parse(data);

    if (!result.success) {
      console.log('API调用失败');
      return;
    }

    // 按代币统计盈亏
    const tokenPnL = {};

    result.trades.forEach(t => {
      if (t.trade_status !== 'success') return;

      const addr = t.token_address;
      if (!tokenPnL[addr]) {
        tokenPnL[addr] = {
          symbol: t.token_symbol,
          address: addr,
          totalSpent: 0,
          totalReceived: 0
        };
      }

      if (t.direction === 'buy') {
        tokenPnL[addr].totalSpent += parseFloat(t.input_amount || 0);
      } else if (t.direction === 'sell') {
        tokenPnL[addr].totalReceived += parseFloat(t.output_amount || 0);
      }
    });

    // 计算收益率
    const results = Object.values(tokenPnL).map(t => {
      const returnRate = t.totalSpent > 0
        ? ((t.totalReceived - t.totalSpent) / t.totalSpent * 100)
        : 0;
      return {
        ...t,
        returnRate
      };
    });

    // 按收益率排序
    results.sort((a, b) => a.returnRate - b.returnRate);

    console.log('=== 按收益率排序（最差的前20个）===\n');
    results.slice(0, 20).forEach(r => {
      const sign = r.returnRate >= 0 ? '+' : '';
      console.log(`${r.symbol}: ${sign}${r.returnRate.toFixed(2)}%`);
    });

    console.log('\n=== 最好的前10个 ===\n');
    results.slice(-10).reverse().forEach(r => {
      const sign = r.returnRate >= 0 ? '+' : '';
      console.log(`${r.symbol}: ${sign}${r.returnRate.toFixed(2)}%`);
    });
  });
});

req.on('error', (e) => {
  console.error(`请求失败: ${e.message}`);
});

req.end();
