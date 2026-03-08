/**
 * 拉砸（Pump & Dump）识别算法
 *
 * 拉砸特征定义：
 * 1. 交易高度集中（大量同时交易）
 * 2. 价格快速冲高后快速回落
 * 3. 早期大量买入后短期内大量卖出
 * 4. 生命周期短
 */

const http = require('http');
const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

// 调用早期交易API
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

// 分析同时交易特征
function analyzeSimultaneousTrades(trades, threshold = 1) {
  if (!trades || trades.length === 0) {
    return { totalTrades: 0, maxGroupSize: 0, concentrationScore: 0 };
  }

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

  const maxGroupSize = Math.max(...simultaneousGroups.map(g => g.length), 0);

  // 计算交易集中度分数（0-100）
  // 基于最大组占总交易的比例
  const concentrationScore = trades.length > 0
    ? (maxGroupSize / trades.length) * 100
    : 0;

  return {
    totalTrades: trades.length,
    maxGroupSize,
    concentrationScore,
    simultaneousGroupsCount: simultaneousGroups.length
  };
}

// 分析买卖转换特征
function analyzeBuySellPattern(trades, tokenAddress) {
  if (!trades || trades.length === 0) {
    return { buyCount: 0, sellCount: 0, buyToSellInterval: null, buySellRatio: 0 };
  }

  const buys = [];
  const sells = [];

  trades.forEach(t => {
    // AVE API: to_token 是目标代币地址时为买入
    const isBuy = t.to_token?.toLowerCase() === tokenAddress.toLowerCase();
    if (isBuy) {
      buys.push(t);
    } else {
      sells.push(t);
    }
  });

  // 计算第一笔买入到第一笔卖出的时间间隔
  let buyToSellInterval = null;
  if (buys.length > 0 && sells.length > 0) {
    const firstBuyTime = buys[0].time;
    const firstSellTime = sells[0].time;
    buyToSellInterval = firstSellTime - firstBuyTime;
  }

  const total = buys.length + sells.length;
  return {
    buyCount: buys.length,
    sellCount: sells.length,
    buyToSellInterval,
    buySellRatio: total > 0 ? buys.length / total : 0
  };
}

// 分析价格波动特征
function analyzePriceVolatility(trades, tokenAddress) {
  if (!trades || trades.length < 2) {
    return { maxRise: 0, maxDrop: 0, volatilityScore: 0 };
  }

  // 这里我们使用交易量作为价格代理，因为我们没有实时价格数据
  // 在真实场景中应该使用实际价格

  const volumes = trades.map(t => t.amount_usd || 0);
  const maxVolume = Math.max(...volumes);
  const minVolume = Math.min(...volumes);
  const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;

  // 计算波动率（标准差/均值）
  const variance = volumes.reduce((sum, v) => sum + Math.pow(v - avgVolume, 2), 0) / volumes.length;
  const stdDev = Math.sqrt(variance);
  const volatilityScore = avgVolume > 0 ? (stdDev / avgVolume) * 100 : 0;

  return {
    maxVolume,
    minVolume,
    avgVolume,
    volatilityScore
  };
}

// 拉砸评分算法
function calculatePumpDumpScore(analysis) {
  const scores = {
    simultaneousTrades: 0,
    buySellPattern: 0,
    volatility: 0,
    total: 0
  };

  // 1. 同时交易评分（权重：40%）
  // maxGroupSize > 100: 高度可疑
  // maxGroupSize 50-100: 中度可疑
  // maxGroupSize < 50: 正常
  if (analysis.simultaneous.maxGroupSize > 100) {
    scores.simultaneousTrades = 100;
  } else if (analysis.simultaneous.maxGroupSize > 50) {
    scores.simultaneousTrades = 60;
  } else if (analysis.simultaneous.maxGroupSize > 30) {
    scores.simultaneousTrades = 30;
  } else {
    scores.simultaneousTrades = 0;
  }

  // 集中度加分
  if (analysis.simultaneous.concentrationScore > 50) {
    scores.simultaneousTrades = Math.min(100, scores.simultaneousTrades + 20);
  }

  // 2. 买卖模式评分（权重：30%）
  // 快速出现卖出（<60秒）: 可疑
  if (analysis.buySell.buyToSellInterval !== null) {
    if (analysis.buySell.buyToSellInterval < 30) {
      scores.buySellPattern = 100; // 极度可疑
    } else if (analysis.buySell.buyToSellInterval < 60) {
      scores.buySellPattern = 70; // 高度可疑
    } else if (analysis.buySell.buyToSellInterval < 120) {
      scores.buySellPattern = 40; // 中度可疑
    } else {
      scores.buySellPattern = 0; // 正常
    }
  }

  // 卖出比例高: 可疑
  if (analysis.buySell.buySellRatio < 0.5 && analysis.buySell.sellCount > 10) {
    scores.buySellPattern = Math.min(100, scores.buySellPattern + 30);
  }

  // 3. 波动率评分（权重：30%）
  if (analysis.volatility.volatilityScore > 200) {
    scores.volatility = 100;
  } else if (analysis.volatility.volatilityScore > 150) {
    scores.volatility = 70;
  } else if (analysis.volatility.volatilityScore > 100) {
    scores.volatility = 40;
  } else {
    scores.volatility = 0;
  }

  // 计算总分（加权平均）
  scores.total = (
    scores.simultaneousTrades * 0.4 +
    scores.buySellPattern * 0.3 +
    scores.volatility * 0.3
  );

  return scores;
}

// 判断是否为拉砸代币
function classifyPumpDump(scores) {
  if (scores.total >= 70) {
    return { isPumpDump: true, confidence: 'high', label: '🎭 高度疑似拉砸' };
  } else if (scores.total >= 50) {
    return { isPumpDump: true, confidence: 'medium', label: '⚠️  中度疑似拉砸' };
  } else if (scores.total >= 30) {
    return { isPumpDump: false, confidence: 'low', label: '🔍 需要观察' };
  } else {
    return { isPumpDump: false, confidence: 'none', label: '✅ 正常代币' };
  }
}

async function identifyPumpDumpTokens() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    拉砸（Pump & Dump）识别算法                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取所有代币
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId);

  // 获取交易数据计算收益
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId);

  const tokenProfits = new Map();
  const tokenTradeGroups = new Map();

  trades.forEach(trade => {
    if (!tokenTradeGroups.has(trade.token_address)) {
      tokenTradeGroups.set(trade.token_address, []);
    }
    tokenTradeGroups.get(trade.token_address).push(trade);
  });

  for (const [addr, tokenTrades] of tokenTradeGroups) {
    tokenTrades.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const buyTrades = tokenTrades.filter(t => t.trade_direction === 'buy');
    const sellTrades = tokenTrades.filter(t => t.trade_direction === 'sell');

    if (buyTrades.length === 0) continue;

    let totalBuy = 0, totalSell = 0;
    buyTrades.forEach(t => totalBuy += t.input_amount || 0);
    sellTrades.forEach(t => totalSell += t.output_amount || 0);

    const profit = totalSell - totalBuy;
    const profitPercent = (profit / totalBuy) * 100;

    tokenProfits.set(addr, {
      profitPercent,
      symbol: buyTrades[0].token_symbol,
      chain: buyTrades[0].chain || 'bsc'
    });
  }

  console.log(`【开始分析 ${tokens.length} 个代币】\n`);

  const results = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const profit = tokenProfits.get(token.token_address);

    if (!profit) continue;

    console.log(`${i + 1}. ${profit.symbol} (${profit.profitPercent.toFixed(1)}%)`);

    try {
      const data = await callEarlyTradesAPI(token.token_address, profit.chain, 3);
      const earlyTrades = data.earlyTrades || [];

      if (earlyTrades.length === 0) {
        console.log(`   ⚠️  无早期交易数据\n`);
        continue;
      }

      // 分析各项特征
      const simultaneous = analyzeSimultaneousTrades(earlyTrades);
      const buySell = analyzeBuySellPattern(earlyTrades, token.token_address);
      const volatility = analyzePriceVolatility(earlyTrades, token.token_address);

      // 计算拉砸评分
      const scores = calculatePumpDumpScore({
        simultaneous,
        buySell,
        volatility
      });

      // 分类
      const classification = classifyPumpDump(scores);

      const result = {
        symbol: profit.symbol,
        address: token.token_address,
        profitPercent: profit.profitPercent,
        simultaneous,
        buySell,
        volatility,
        scores,
        classification,
        humanJudge: token.human_judges?.category || 'unknown'
      };

      results.push(result);

      // 输出分析结果
      console.log(`   同时交易: ${simultaneous.maxGroupSize}笔 (集中度: ${simultaneous.concentrationScore.toFixed(1)}%)`);
      console.log(`   买卖模式: 买入${buySell.buyCount}笔/卖出${buySell.sellCount}笔 (首卖间隔: ${buySell.buyToSellInterval ? buySell.buyToSellInterval.toFixed(1) + 's' : 'N/A'})`);
      console.log(`   波动率: ${volatility.volatilityScore.toFixed(1)}`);
      console.log(`   评分: 同时交易(${scores.simultaneousTrades.toFixed(0)}) + 买卖模式(${scores.buySellPattern.toFixed(0)}) + 波动率(${scores.volatility.toFixed(0)})`);
      console.log(`   总分: ${scores.total.toFixed(1)}/100`);
      console.log(`   分类: ${classification.label}`);
      console.log(`   人工标注: ${result.humanJudge}\n`);

    } catch (error) {
      console.error(`   ❌ 失败: ${error.message}\n`);
    }

    // 避免API限速
    await new Promise(r => setTimeout(r, 1500));
  }

  // 统计总结
  console.log('\n\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                          统计总结                                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const highConfidence = results.filter(r => r.classification.confidence === 'high');
  const mediumConfidence = results.filter(r => r.classification.confidence === 'medium');
  const normal = results.filter(r => !r.classification.isPumpDump);

  console.log(`高度疑似拉砸: ${highConfidence.length}个`);
  console.log(`中度疑似拉砸: ${mediumConfidence.length}个`);
  console.log(`正常代币: ${normal.length}个`);
  console.log(`总计: ${results.length}个\n`);

  // 按分类展示
  console.log('【高度疑似拉砸】\n');
  highConfidence.forEach(r => {
    console.log(`  ${r.symbol.padEnd(12)} 收益:${r.profitPercent.toFixed(1).padStart(7)}%  评分:${r.scores.total.toFixed(1).padStart(6)}  最大组:${r.simultaneous.maxGroupSize}笔  首卖:${r.buySell.buyToSellInterval?.toFixed(1) || 'N/A'}s`);
  });

  console.log('\n【中度疑似拉砸】\n');
  mediumConfidence.forEach(r => {
    console.log(`  ${r.symbol.padEnd(12)} 收益:${r.profitPercent.toFixed(1).padStart(7)}%  评分:${r.scores.total.toFixed(1).padStart(6)}  最大组:${r.simultaneous.maxGroupSize}笔  首卖:${r.buySell.buyToSellInterval?.toFixed(1) || 'N/A'}s`);
  });

  console.log('\n【正常代币】\n');
  normal.forEach(r => {
    console.log(`  ${r.symbol.padEnd(12)} 收益:${r.profitPercent.toFixed(1).padStart(7)}%  评分:${r.scores.total.toFixed(1).padStart(6)}  最大组:${r.simultaneous.maxGroupSize}笔  首卖:${r.buySell.buyToSellInterval?.toFixed(1) || 'N/A'}s`);
  });

  // 验证与人工标注的对比
  console.log('\n\n');
  console.log('【与人工标注对比】\n');

  const fakePumpResults = results.filter(r => r.humanJudge === 'fake_pump');
  const highQualityResults = results.filter(r => r.humanJudge === 'high_quality');

  console.log(`人工标注为"流水盘"(fake_pump)的代币: ${fakePumpResults.length}个`);
  fakePumpResults.forEach(r => {
    console.log(`  ${r.symbol.padEnd(12)} 算法判断: ${r.classification.label}  评分:${r.scores.total.toFixed(1)}`);
  });

  console.log(`\n人工标注为"高质量"(high_quality)的代币: ${highQualityResults.length}个`);
  highQualityResults.forEach(r => {
    console.log(`  ${r.symbol.padEnd(12)} 算法判断: ${r.classification.label}  评分:${r.scores.total.toFixed(1)}`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
}

identifyPumpDumpTokens().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
