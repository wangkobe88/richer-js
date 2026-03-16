/**
 * 评估"大户消失因子"在实验中的效果
 * 预警条件：30秒（10个区块）内无$300+大额买入
 */

const http = require('http');

// API配置
const API_BASE = 'http://localhost:3010/api';
const EXPERIMENT_ID = '208d2f9b-d83c-42b4-8705-48c0480c02a8';

// 工具函数
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/**
 * 计算大户消失因子
 * @param {Array} trades - 交易列表
 * @param {string} signalTime - 信号创建时间
 * @param {number} threshold - 大额买入阈值（USD）
 * @param {number} maxBlocks - 最大区块数（BSC约3秒/区块）
 */
function calculateWhaleAbsence(trades, signalTime, threshold = 300, maxSeconds = 30) {
  const signalTimestamp = new Date(signalTime).getTime() / 1000;

  // 找出信号创建时间之前的最后大额买入
  const largeBuys = trades.filter(t =>
    t.to_token_symbol !== 'USDT' &&  // 买入代币（非卖出）
    t.to_usd >= threshold &&
    t.time < signalTimestamp
  ).sort((a, b) => b.time - a.time);

  if (largeBuys.length === 0) {
    return {
      hasWhaleBuy: false,
      blocksSinceLastLarge: null,
      secondsSinceLastLarge: null,
      warning: true,  // 从未有大额买入
      reason: '从未有大额买入'
    };
  }

  const lastLargeBuy = largeBuys[0];
  const secondsSince = signalTimestamp - lastLargeBuy.time;
  const blocksSince = Math.round(secondsSince / 3); // BSC约3秒/区块

  return {
    hasWhaleBuy: true,
    lastLargeBuyTime: lastLargeBuy.time,
    lastLargeBuyAmount: lastLargeBuy.to_usd,
    lastLargeBuyBlock: lastLargeBuy.block_number,
    blocksSinceLastLarge: blocksSince,
    secondsSinceLastLarge: secondsSince,
    warning: secondsSince > maxSeconds,
    reason: secondsSince > maxSeconds
      ? `${secondsSince.toFixed(0)}秒无大额买入`
      : `${secondsSince.toFixed(0)}秒前有大额买入`
  };
}

/**
 * 获取代币的早期交易数据
 */
async function getTokenEarlyTrades(tokenAddress, chain = 'bsc') {
  const timeWindow = 30 * 60; // 30分钟
  const url = `${API_BASE}/token-early-trades`;

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      tokenAddress,
      chain,
      timeWindow
    });

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': postData.length
      }
    };

    const req = http.request(`${API_BASE}/token-early-trades`, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * 主分析函数
 */
async function analyzeWhaleAbsenceFactor() {
  console.log('开始分析大户消失因子...\n');

  // 1. 获取所有执行的买入信号
  console.log('1. 获取买入信号...');
  const signalsData = await httpGet(
    `${API_BASE}/experiment/${EXPERIMENT_ID}/signals?limit=2000`
  );

  const signals = signalsData.signals || signalsData;
  const buySignals = signals.filter(s =>
    s.signal_type === 'BUY' && s.executed === true
  );

  console.log(`   找到 ${buySignals.length} 个执行的买入信号\n`);

  // 2. 获取代币收益数据（区分好票/坏票）
  console.log('2. 获取代币收益数据...');
  const tokensData = await httpGet(
    `${API_BASE}/experiment/${EXPERIMENT_ID}/tokens`
  );

  // 构建代币收益映射
  const tokenReturns = {};
  const tokens = tokensData.tokens || tokensData || [];

  tokens.forEach(token => {
    if (!token || !token.token_address) return;

    const analysis = token.analysis_results || token.analysisResults || {};
    const maxChange = analysis.max_change_percent || 0;
    tokenReturns[token.token_address] = {
      symbol: token.token_symbol,
      maxChange: maxChange,
      is_good_token: maxChange >= 100  // 涨幅100%以上为好票
    };
  });

  console.log(`   找到 ${Object.keys(tokenReturns).length} 个代币的收益数据\n`);

  // 3. 分析每个信号
  console.log('3. 分析每个信号的大户消失因子...\n');

  const results = [];
  let processed = 0;

  for (const signal of buySignals) {
    const tokenAddress = signal.token_address;
    const signalTime = signal.created_at;
    const tokenInfo = tokenReturns[tokenAddress];

    // 获取交易数据
    let trades = [];
    try {
      const tradesData = await getTokenEarlyTrades(tokenAddress, signal.chain);
      // 数据在 data.earlyTrades 路径
      trades = tradesData.data?.earlyTrades || [];

      // 确保trades是数组
      if (!Array.isArray(trades)) {
        console.error(`   ${signal.token_symbol}: trades不是数组, type=${typeof trades}, keys=${Object.keys(trades).join(',')}`);
        continue;
      }
    } catch (e) {
      console.error(`   获取 ${signal.token_symbol} 交易数据失败: ${e.message}`);
      continue;
    }

    // 计算大户消失因子
    const whaleAbsence = calculateWhaleAbsence(trades, signalTime);

    results.push({
      signal_id: signal.id,
      token_symbol: signal.token_symbol,
      token_address: tokenAddress,
      signal_time: signalTime,
      max_change: tokenInfo?.maxChange || 0,
      is_good_token: tokenInfo?.is_good_token || false,
      whale_absence: whaleAbsence,
      would_block: whaleAbsence.warning  // 是否会被预警因子阻挡
    });

    processed++;
    if (processed % 10 === 0) {
      console.log(`   已处理 ${processed}/${buySignals.length}...`);
    }
  }

  console.log(`\n   处理完成: ${processed} 个信号\n`);

  // 4. 统计结果
  console.log('【分析结果】\n');

  const goodTokens = results.filter(r => r.is_good_token);
  const badTokens = results.filter(r => !r.is_good_token);

  const goodBlocked = goodTokens.filter(r => r.would_block);
  const goodPassed = goodTokens.filter(r => !r.would_block);
  const badBlocked = badTokens.filter(r => r.would_block);
  const badPassed = badTokens.filter(r => !r.would_block);

  console.log(`好票（涨幅>=100%）: ${goodTokens.length}`);
  console.log(`  被预警阻挡: ${goodBlocked.length} (${goodTokens.length > 0 ? (goodBlocked.length/goodTokens.length*100).toFixed(1) : 0}%) - 误伤`);
  console.log(`  通过预警: ${goodPassed.length} (${goodTokens.length > 0 ? (goodPassed.length/goodTokens.length*100).toFixed(1) : 0}%)\n`);

  console.log(`坏票（涨幅<100%）: ${badTokens.length}`);
  console.log(`  被预警阻挡: ${badBlocked.length} (${badTokens.length > 0 ? (badBlocked.length/badTokens.length*100).toFixed(1) : 0}%) - 成功阻挡`);
  console.log(`  通过预警: ${badPassed.length} (${badTokens.length > 0 ? (badPassed.length/badTokens.length*100).toFixed(1) : 0}%)\n`);

  // 计算综合指标
  const totalBlocked = goodBlocked.length + badBlocked.length;
  const totalPassed = goodPassed.length + badPassed.length;
  const blockAccuracy = totalBlocked > 0 ? badBlocked.length / totalBlocked : 0;
  const falsePositiveRate = goodTokens.length > 0 ? goodBlocked.length / goodTokens.length : 0;

  console.log(`【综合指标】`);
  console.log(`  总阻挡数: ${totalBlocked}`);
  console.log(`  阻挡准确率: ${(blockAccuracy * 100).toFixed(1)}% (被阻挡中坏票占比)`);
  console.log(`  误伤率: ${(falsePositiveRate * 100).toFixed(1)}% (好票被阻挡比例)\n`);

  // 5. 列出被阻挡的好票（误伤案例）
  if (goodBlocked.length > 0) {
    console.log(`【误伤的好票详情】（涨幅>=100%但被预警阻挡）\n`);
    console.log('  代币名称              涨幅     阻挡原因');
    console.log('  ' + '─'.repeat(60));

    goodBlocked.sort((a, b) => b.max_change - a.max_change).forEach(r => {
      const reason = r.whale_absence.reason || '';
      console.log(`  ${r.token_symbol.padEnd(20)} +${r.max_change.toFixed(1).padStart(6)}%  ${reason}`);
    });
    console.log('');
  }

  // 6. 列出成功阻挡的坏票
  if (badBlocked.length > 0) {
    console.log(`【成功阻挡的坏票详情】（涨幅<100%且被预警阻挡）\n`);
    console.log('  代币名称              涨幅     阻挡原因');
    console.log('  ' + '─'.repeat(60));

    badBlocked.sort((a, b) => a.max_change - b.max_change).forEach(r => {
      const reason = r.whale_absence.reason || '';
      console.log(`  ${r.token_symbol.padEnd(20)} +${r.max_change.toFixed(1).padStart(6)}%  ${reason}`);
    });
    console.log('');
  }

  // 7. 列出漏掉的坏票（本应阻挡但没阻挡）
  if (badPassed.length > 0) {
    console.log(`【漏掉的坏票详情】（涨幅<100%但通过预警）\n`);
    console.log('  代币名称              涨幅     最后大额买入情况');
    console.log('  ' + '─'.repeat(60));

    badPassed.sort((a, b) => a.max_change - b.max_change).forEach(r => {
      const wa = r.whale_absence;
      const info = wa.hasWhaleBuy
        ? `${wa.secondsSinceLastLarge.toFixed(0)}秒前 \$${wa.lastLargeBuyAmount.toFixed(0)}`
        : '无大额买入记录';
      console.log(`  ${r.token_symbol.padEnd(20)} +${r.max_change.toFixed(1).padStart(6)}%  ${info}`);
    });
    console.log('');
  }

  return {
    total: results.length,
    goodTokens: goodTokens.length,
    badTokens: badTokens.length,
    goodBlocked: goodBlocked.length,
    badBlocked: badBlocked.length,
    blockAccuracy,
    falsePositiveRate,
    results
  };
}

// 运行分析
analyzeWhaleAbsenceFactor()
  .then(result => {
    console.log('分析完成!');
  })
  .catch(err => {
    console.error('分析失败:', err);
  });
