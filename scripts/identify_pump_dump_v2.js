/**
 * 拉砸（Pump & Dump）识别算法 v2
 *
 * 核心特征：价格在极短时间内大幅波动（快速拉起后快速砸盘）
 *
 * 检测指标：
 * 1. 价格波动幅度：最高价 vs 最低价的差距
 * 2. 价格变化速度：达到峰值的时间
 * 3. 价格回落速度：从峰值回落的速度
 * 4. 交易集中度：同时交易数量
 * 5. 持续性：价格是否能维持
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

// 从交易中估算价格序列
function estimatePriceSeries(trades, tokenAddress, launchAt) {
  if (!trades || trades.length === 0) {
    return [];
  }

  const pricePoints = [];

  trades.forEach(t => {
    // 使用 to_token_price_usd 作为买入价格，from_token_price_usd 作为卖出价格
    let price = null;
    const isBuy = t.to_token?.toLowerCase() === tokenAddress.toLowerCase();

    if (isBuy && t.to_token_price_usd) {
      price = parseFloat(t.to_token_price_usd);
    } else if (!isBuy && t.from_token_price_usd) {
      price = parseFloat(t.from_token_price_usd);
    }

    if (price && price > 0) {
      pricePoints.push({
        time: t.time - launchAt,
        price: price,
        isBuy: isBuy,
        volume: t.from_usd || t.to_usd || 0
      });
    }
  });

  return pricePoints;
}

// 分析价格波动模式（核心算法）
function analyzePricePattern(pricePoints) {
  if (pricePoints.length < 3) {
    return {
      maxRise: 0,
      maxDrop: 0,
      volatilityScore: 0,
      peakTime: null,
      dropSpeed: 0,
      pumpDumpPattern: false
    };
  }

  // 按时间排序
  pricePoints.sort((a, b) => a.time - b.time);

  // 找到初始价格（前10%的平均价格）
  const initialCount = Math.max(3, Math.floor(pricePoints.length * 0.1));
  const initialPrices = pricePoints.slice(0, initialCount).map(p => p.price);
  const initialPrice = initialPrices.reduce((sum, p) => sum + p, 0) / initialPrices.length;

  // 找到最高价格及其时间
  let maxPrice = initialPrice;
  let maxPriceTime = pricePoints[0].time;

  pricePoints.forEach(p => {
    if (p.price > maxPrice) {
      maxPrice = p.price;
      maxPriceTime = p.time;
    }
  });

  // 找到最低价格（峰值后）
  let minPriceAfterPeak = maxPrice;
  const afterPeak = pricePoints.filter(p => p.time > maxPriceTime);
  if (afterPeak.length > 0) {
    minPriceAfterPeak = Math.min(...afterPeak.map(p => p.price));
  } else {
    minPriceAfterPeak = pricePoints[pricePoints.length - 1].price;
  }

  // 最终价格
  const finalPrice = pricePoints[pricePoints.length - 1].price;

  // 计算涨跌幅
  const maxRise = initialPrice > 0 ? ((maxPrice - initialPrice) / initialPrice) * 100 : 0;
  const maxDrop = maxPrice > 0 ? ((maxPrice - minPriceAfterPeak) / maxPrice) * 100 : 0;
  const finalChange = initialPrice > 0 ? ((finalPrice - initialPrice) / initialPrice) * 100 : 0;

  // 计算达到峰值的时间
  const peakTime = maxPriceTime;

  // 计算回落速度（峰值后每秒平均下跌百分比）
  const dropDuration = pricePoints[pricePoints.length - 1].time - maxPriceTime;
  const dropSpeed = dropDuration > 0 ? (maxDrop / dropDuration) : 0;

  // 判断是否为拉砸模式
  // 条件1：快速上涨（30秒内涨幅>50%）
  // 条件2：快速回落（60秒内跌幅>30%）
  // 条件3：最终价格低于或接近初始价格
  const isPumpDump =
    peakTime < 30 && maxRise > 50 &&  // 快速拉升
    maxDrop > 30 && finalChange < 20;  // 快速回落且最终没有显著涨幅

  // 波动率评分
  const volatilityScore = Math.abs(maxRise) + Math.abs(maxDrop);

  return {
    initialPrice,
    maxPrice,
    minPriceAfterPeak,
    finalPrice,
    maxRise,
    maxDrop,
    finalChange,
    peakTime,
    dropSpeed,
    volatilityScore,
    pumpDumpPattern: isPumpDump
  };
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
  const concentrationScore = trades.length > 0
    ? (maxGroupSize / trades.length) * 100
    : 0;

  return {
    totalTrades: trades.length,
    maxGroupSize,
    concentrationScore
  };
}

// 分析买卖模式
function analyzeBuySellPattern(trades, tokenAddress) {
  if (!trades || trades.length === 0) {
    return { buyCount: 0, sellCount: 0, buyToSellInterval: null, buySellRatio: 0 };
  }

  const buys = [];
  const sells = [];

  trades.forEach(t => {
    const isBuy = t.to_token?.toLowerCase() === tokenAddress.toLowerCase();
    if (isBuy) {
      buys.push(t);
    } else {
      sells.push(t);
    }
  });

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

// 拉砸评分算法 v2
function calculatePumpDumpScoreV2(pricePattern, simultaneous, buySell) {
  const scores = {
    pricePattern: 0,      // 价格模式评分（权重：50%）
    simultaneousTrades: 0, // 同时交易评分（权重：30%）
    sellPressure: 0,       // 卖压评分（权重：20%）
    total: 0
  };

  // 1. 价格模式评分（权重：50%）
  if (pricePattern.pumpDumpPattern) {
    // 明显的拉砸模式
    scores.pricePattern = 100;
  } else if (pricePattern.maxRise > 50 && pricePattern.maxDrop > 30) {
    // 有大幅波动，但可能不完全符合拉砸
    scores.pricePattern = 70;
  } else if (pricePattern.maxRise > 30 && pricePattern.maxDrop > 20) {
    // 中等波动
    scores.pricePattern = 40;
  } else if (pricePattern.volatilityScore > 100) {
    // 高波动率
    scores.pricePattern = 30;
  } else {
    scores.pricePattern = 0;
  }

  // 快速拉起和快速回落加分
  if (pricePattern.peakTime < 20 && pricePattern.maxRise > 30) {
    scores.pricePattern = Math.min(100, scores.pricePattern + 10);
  }
  if (pricePattern.dropSpeed > 1) {
    scores.pricePattern = Math.min(100, scores.pricePattern + 10);
  }

  // 2. 同时交易评分（权重：30%）
  if (simultaneous.maxGroupSize > 100) {
    scores.simultaneousTrades = 100;
  } else if (simultaneous.maxGroupSize > 50) {
    scores.simultaneousTrades = 60;
  } else if (simultaneous.maxGroupSize > 30) {
    scores.simultaneousTrades = 30;
  } else {
    scores.simultaneousTrades = 0;
  }

  // 集中度加分
  if (simultaneous.concentrationScore > 50) {
    scores.simultaneousTrades = Math.min(100, scores.simultaneousTrades + 20);
  }

  // 3. 卖压评分（权重：20%）
  // 早期大量卖出是拉砸的重要信号
  const sellRatio = buySell.sellCount / (buySell.buyCount + buySell.sellCount);
  if (sellRatio > 0.6 && buySell.buyCount > 10) {
    scores.sellPressure = 100; // 卖出比例过高
  } else if (sellRatio > 0.5 && buySell.buyCount > 10) {
    scores.sellPressure = 60;
  } else if (sellRatio > 0.4 && buySell.buyCount > 10) {
    scores.sellPressure = 30;
  } else {
    scores.sellPressure = 0;
  }

  // 计算总分（加权平均）
  scores.total = (
    scores.pricePattern * 0.5 +
    scores.simultaneousTrades * 0.3 +
    scores.sellPressure * 0.2
  );

  return scores;
}

// 分类
function classifyPumpDump(scores, pricePattern) {
  // 如果价格模式明确是拉砸，即使总分不高也要标记
  if (pricePattern.pumpDumpPattern) {
    return {
      isPumpDump: true,
      confidence: 'high',
      label: '🎭 拉砸（快速拉起后快速砸盘）'
    };
  }

  if (scores.total >= 70) {
    return {
      isPumpDump: true,
      confidence: 'high',
      label: '🎭 高度疑似拉砸'
    };
  } else if (scores.total >= 50) {
    return {
      isPumpDump: true,
      confidence: 'medium',
      label: '⚠️  中度疑似拉砸'
    };
  } else if (scores.total >= 30) {
    return {
      isPumpDump: false,
      confidence: 'low',
      label: '🔍 需要观察'
    };
  } else {
    return {
      isPumpDump: false,
      confidence: 'none',
      label: '✅ 正常代币'
    };
  }
}

async function identifyPumpDumpTokensV2() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║              拉砸（Pump & Dump）识别算法 v2 - 价格模式分析                    ║');
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
  let analyzed = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const profit = tokenProfits.get(token.token_address);

    if (!profit) continue;

    analyzed++;

    console.log(`${analyzed}. ${profit.symbol} (${profit.profitPercent.toFixed(1)}%)`);

    try {
      const data = await callEarlyTradesAPI(token.token_address, profit.chain, 3);
      const earlyTrades = data.earlyTrades || [];
      const launchAt = data.tokenInfo?.token?.launch_at || data.debug?.launchAt;

      if (earlyTrades.length === 0) {
        console.log(`   ⚠️  无早期交易数据\n`);
        continue;
      }

      // 分析价格序列
      const pricePoints = estimatePriceSeries(earlyTrades, token.token_address, launchAt);

      if (pricePoints.length < 3) {
        console.log(`   ⚠️  价格点不足\n`);
        continue;
      }

      // 价格模式分析
      const pricePattern = analyzePricePattern(pricePoints);

      // 同时交易分析
      const simultaneous = analyzeSimultaneousTrades(earlyTrades);

      // 买卖模式分析
      const buySell = analyzeBuySellPattern(earlyTrades, token.token_address);

      // 计算拉砸评分
      const scores = calculatePumpDumpScoreV2(pricePattern, simultaneous, buySell);

      // 分类
      const classification = classifyPumpDump(scores, pricePattern);

      const result = {
        symbol: profit.symbol,
        address: token.token_address,
        profitPercent: profit.profitPercent,
        pricePattern,
        simultaneous,
        buySell,
        scores,
        classification,
        humanJudge: token.human_judges?.category || 'unknown'
      };

      results.push(result);

      // 输出分析结果
      console.log(`   价格模式: 初始$${(pricePattern.initialPrice * 1000000).toFixed(4)} → 最高$${(pricePattern.maxPrice * 1000000).toFixed(4)} (+${pricePattern.maxRise.toFixed(1)}%) → 最终$${(pricePattern.finalPrice * 1000000).toFixed(4)} (${pricePattern.finalChange.toFixed(1)}%)`);
      console.log(`   峰值时间: +${pricePattern.peakTime.toFixed(1)}s, 峰后回落: ${pricePattern.maxDrop.toFixed(1)}%, 回落速度: ${pricePattern.dropSpeed.toFixed(2)}%/s`);
      console.log(`   同时交易: ${simultaneous.maxGroupSize}笔 (集中度: ${simultaneous.concentrationScore.toFixed(1)}%)`);
      console.log(`   买卖比例: ${buySell.buyCount}/${buySell.sellCount} (${(buySell.buySellRatio * 100).toFixed(0)}%买入)`);
      console.log(`   评分: 价格模式(${scores.pricePattern.toFixed(0)}) + 同时交易(${scores.simultaneousTrades.toFixed(0)}) + 卖压(${scores.sellPressure.toFixed(0)})`);
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

  const pumpDump = results.filter(r => r.classification.isPumpDump);
  const normal = results.filter(r => !r.classification.isPumpDump);

  console.log(`识别为拉砸: ${pumpDump.length}个`);
  console.log(`正常代币: ${normal.length}个`);
  console.log(`总计分析: ${results.length}个\n`);

  // 按分类展示
  console.log('【识别为拉砸】\n');
  pumpDump.forEach(r => {
    const profitLabel = r.profitPercent > 0 ? `+${r.profitPercent.toFixed(1)}%` : `${r.profitPercent.toFixed(1)}%`;
    const riskLabel = r.pricePattern.pumpDumpPattern ? '⚡确认拉砸' : `⚠️疑似`;
    console.log(`  ${r.symbol.padEnd(12)} 收益:${profitLabel.padStart(8)}  评分:${r.scores.total.toFixed(1).padStart(6)}  峰值:${r.pricePattern.peakTime.toFixed(0)}s  涨跌:+${r.pricePattern.maxRise.toFixed(0)}%/-${r.pricePattern.maxDrop.toFixed(0)}%  ${riskLabel}`);
  });

  console.log('\n【正常代币】\n');
  normal.forEach(r => {
    const profitLabel = r.profitPercent > 0 ? `+${r.profitPercent.toFixed(1)}%` : `${r.profitPercent.toFixed(1)}%`;
    console.log(`  ${r.symbol.padEnd(12)} 收益:${profitLabel.padStart(8)}  评分:${r.scores.total.toFixed(1).padStart(6)}  峰值:${r.pricePattern.peakTime.toFixed(0)}s  涨跌:+${r.pricePattern.maxRise.toFixed(0)}%/-${r.pricePattern.maxDrop.toFixed(0)}%`);
  });

  // 验证与人工标注的对比
  console.log('\n\n');
  console.log('【关键发现】\n');

  // 找出有收益但被识别为拉砸的代币（危险的代币）
  const profitablePumpDump = pumpDump.filter(r => r.profitPercent > 10);
  if (profitablePumpDump.length > 0) {
    console.log(`⚠️  有收益但识别为拉砸的代币（危险！不推荐购买）: ${profitablePumpDump.length}个`);
    profitablePumpDump.forEach(r => {
      console.log(`    ${r.symbol}: 收益+${r.profitPercent.toFixed(1)}%, 但在+${r.pricePattern.peakTime.toFixed(0)}s达到峰值后回落${r.pricePattern.maxDrop.toFixed(0)}%`);
    });
  }

  // 找出真正的高质量代币（高收益且非拉砸）
  const highQualityNormal = normal.filter(r => r.profitPercent > 50);
  if (highQualityNormal.length > 0) {
    console.log(`\n✅ 真正的高质量代币（高收益且非拉砸）: ${highQualityNormal.length}个`);
    highQualityNormal.forEach(r => {
      console.log(`    ${r.symbol}: 收益+${r.profitPercent.toFixed(1)}%, 价格上涨+${r.pricePattern.maxRise.toFixed(0)}%且维持稳定`);
    });
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
}

identifyPumpDumpTokensV2().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
