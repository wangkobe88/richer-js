/**
 * 对比分析"同时发生的交易"特征
 * 拉砸 vs 好票
 */

const http = require('http');

// 辅助函数：调用API
function callEarlyTradesAPI(tokenAddress, chain, timeWindowMinutes = 3) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      tokenAddress,
      chain,
      timeWindowMinutes,
      limit: 300
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
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.success) {
            resolve(result.data);
          } else {
            reject(new Error(result.error || 'API调用失败'));
          }
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// 分析同时发生的交易
function analyzeSimultaneousTrades(trades, launchAt) {
  // 定义"同时"的时间阈值（秒）
  const threshold = 1; // 1秒内视为同时

  // 计算所有交易的时间间隔
  const intervals = [];
  for (let i = 1; i < trades.length; i++) {
    const interval = trades[i].time - trades[i-1].time;
    intervals.push({
      interval,
      index: i,
      time1: trades[i-1].time,
      time2: trades[i].time
    });
  }

  // 找出同时发生的交易组
  const simultaneousGroups = [];
  let currentGroup = [0];

  for (let i = 1; i < trades.length; i++) {
    const interval = trades[i].time - trades[i-1].time;
    if (interval <= threshold) {
      currentGroup.push(i);
    } else {
      if (currentGroup.length > 0) {
        simultaneousGroups.push([...currentGroup]);
      }
      currentGroup = [i];
    }
  }

  if (currentGroup.length > 0) {
    simultaneousGroups.push([...currentGroup]);
  }

  // 统计
  const maxGroupSize = Math.max(...simultaneousGroups.map(g => g.length), 0);
  const totalSimultaneous = simultaneousGroups.reduce((sum, g) => sum + (g.length > 1 ? g.length : 0), 0);
  const avgGroupSize = simultaneousGroups.length > 0
    ? simultaneousGroups.reduce((sum, g) => sum + g.length, 0) / simultaneousGroups.length
    : 0;

  return {
    totalTrades: trades.length,
    simultaneousGroups,
    maxGroupSize,
    totalSimultaneous,
    avgGroupSize,
    intervals
  };
}

async function compareSimultaneousTrades() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                对比分析："同时发生的交易"特征                              ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 拉砸代币
  const pumpDumpTokens = [
    { address: '0x67e4c7e7b6b0a3431dd9fed80df2c56ecdfb4444', name: 'FREEDOM', expected: '拉砸' },
    { address: '0xfc295e1d2b4202baf68a07ffd1cde7bbe7d34444', name: 'AND', expected: '拉砸' },
    { address: '0x30a8dc7efe946872277afb5da71aed4010f54444', name: '鲸狗', expected: '拉砸' }
  ];

  // 好票
  const goodTokens = [
    { address: '0x616ddfe8a24f95984f35de866e1570550b1a4444', name: '巨鲸', expected: '好票' },
    { address: '0xddfcf4aa4e9bb93e5713545b581862e97d384444', name: '鲸落', expected: '好票' }
  ];

  const results = [];

  // 分析拉砸代币
  console.log('【拉盘砸盘代币】\n');

  for (const token of pumpDumpTokens) {
    console.log(`\n${token.name} (${token.address.substring(0, 10)}...)\n`);

    try {
      const data = await callEarlyTradesAPI(token.address, 'bsc', 3);
      const trades = data.earlyTrades || [];
      const launchAt = data.debug?.launchAt || data.tokenInfo?.token?.launch_at;

      const analysis = analyzeSimultaneousTrades(trades, launchAt);

      results.push({
        ...token,
        ...analysis
      });

      console.log(`   总交易数: ${analysis.totalTrades}`);
      console.log(`   同时发生组数: ${analysis.simultaneousGroups.length}`);
      console.log(`   最大组规模: ${analysis.maxGroupSize}笔`);
      console.log(`   平均组规模: ${analysis.avgGroupSize.toFixed(1)}笔`);
      console.log(`   同时发生交易总数: ${analysis.totalSimultaneous}笔`);

      // 显示最大的同时发生组
      if (analysis.simultaneousGroups.length > 0) {
        const maxGroup = analysis.simultaneousGroups.reduce((max, g) =>
          g.length > max.length ? g : max
        );

        console.log(`   最大同时发生组详情:`);
        console.log(`     规模: ${maxGroup.length}笔交易`);
        console.log(`     时间范围: +${(trades[maxGroup[0]].time - launchAt).toFixed(1)}s - +${(trades[maxGroup[maxGroup.length-1]].time - launchAt).toFixed(1)}s`);

        // 显示该组内的时间间隔分布
        const groupIntervals = [];
        for (let i = 1; i < maxGroup.length; i++) {
          const idx = maxGroup[i];
          const prevIdx = maxGroup[i-1];
          groupIntervals.push(trades[idx].time - trades[prevIdx].time);
        }

        console.log(`     时间间隔分布: ${groupIntervals.map(i => i.toFixed(2)).join('s, ')}s`);
      }

    } catch (error) {
      console.error(`   ❌ 失败: ${error.message}`);
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  // 分析好票
  console.log('\n\n');
  console.log('【好票对比】\n');

  for (const token of goodTokens) {
    console.log(`\n${token.name} (${token.address.substring(0, 10)}...)\n`);

    try {
      const data = await callEarlyTradesAPI(token.address, 'bsc', 3);
      const trades = data.earlyTrades || [];
      const launchAt = data.debug?.launchAt || data.tokenInfo?.token?.launch_at;

      const analysis = analyzeSimultaneousTrades(trades, launchAt);

      results.push({
        ...token,
        ...analysis
      });

      console.log(`   总交易数: ${analysis.totalTrades}`);
      console.log(`   同时发生组数: ${analysis.simultaneousGroups.length}`);
      console.log(`   最大组规模: ${analysis.maxGroupSize}笔`);
      console.log(`   平均组规模: ${analysis.avgGroupSize.toFixed(1)}笔`);
      console.log(`   同时发生交易总数: ${analysis.totalSimultaneous}笔`);

      // 显示最大的同时发生组
      if (analysis.simultaneousGroups.length > 0) {
        const maxGroup = analysis.simultaneousGroups.reduce((max, g) =>
          g.length > max.length ? g : max
        );

        console.log(`   最大同时发生组详情:`);
        console.log(`     规模: ${maxGroup.length}笔交易`);
        console.log(`     时间范围: +${(trades[maxGroup[0]].time - launchAt).toFixed(1)}s - +${(trades[maxGroup[maxGroup.length-1]].time - launchAt).toFixed(1)}s`);

        const groupIntervals = [];
        for (let i = 1; i < maxGroup.length; i++) {
          const idx = maxGroup[i];
          const prevIdx = maxGroup[i-1];
          groupIntervals.push(trades[idx].time - trades[prevIdx].time);
        }

        console.log(`     时间间隔分布: ${groupIntervals.map(i => i.toFixed(2)).join('s, ')}s`);
      }

    } catch (error) {
      console.error(`   ❌ 失败: ${error.message}`);
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  // 对比总结
  console.log('\n\n');
  console.log('【对比总结】\n');

  const pumpResults = results.filter(r => r.expected === '拉砸');
  const goodResults = results.filter(r => r.expected === '好票');

  console.log('代币              预期    总交易  最大组  同时组数  同时总数  平均组规模');
  console.log('─'.repeat(80));

  results.forEach(r => {
    console.log(`${r.name.padEnd(16)} ${r.expected.padStart(6)} ${r.totalTrades.toString().padStart(6)} ${r.maxGroupSize.toString().padStart(6)} ${r.simultaneousGroups.length.toString().padStart(8)} ${r.totalSimultaneous.toString().padStart(8)} ${r.avgGroupSize.toFixed(1).padStart(9)}`);
  });

  console.log('\n');
  console.log('平均值对比:\n');

  if (pumpResults.length > 0) {
    const avgMaxPump = pumpResults.reduce((sum, r) => sum + r.maxGroupSize, 0) / pumpResults.length;
    const avgTotalPump = pumpResults.reduce((sum, r) => sum + r.totalSimultaneous, 0) / pumpResults.length;
    const avgSizePump = pumpResults.reduce((sum, r) => sum + r.avgGroupSize, 0) / pumpResults.length;

    console.log(`拉砸代币平均:`);
    console.log(`   最大组规模: ${avgMaxPump.toFixed(1)}笔`);
    console.log(`   同时交易总数: ${avgTotalPump.toFixed(1)}笔`);
    console.log(`   平均组规模: ${avgSizePump.toFixed(1)}笔`);
  }

  console.log('');

  if (goodResults.length > 0) {
    const avgMaxGood = goodResults.reduce((sum, r) => sum + r.maxGroupSize, 0) / goodResults.length;
    const avgTotalGood = goodResults.reduce((sum, r) => sum + r.totalSimultaneous, 0) / goodResults.length;
    const avgSizeGood = goodResults.reduce((sum, r) => sum + r.avgGroupSize, 0) / goodResults.length;

    console.log(`好票平均:`);
    console.log(`   最大组规模: ${avgMaxGood.toFixed(1)}笔`);
    console.log(`   同时交易总数: ${avgTotalGood.toFixed(1)}笔`);
    console.log(`   平均组规模: ${avgSizeGood.toFixed(1)}笔`);
  }

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

compareSimultaneousTrades().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
