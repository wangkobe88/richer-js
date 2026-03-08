/**
 * 拉砸（Pump & Dump）识别算法 v3
 *
 * 核心特征：
 * 1. 价格快速拉起后快速砸盘（暴涨暴跌）
 * 2. 低质量 + 高市值（被人为拉起来的）
 * 3. 大量同时交易（刷单）
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

// 分析价格波动模式
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

  pricePoints.sort((a, b) => a.time - b.time);

  const initialCount = Math.max(3, Math.floor(pricePoints.length * 0.1));
  const initialPrices = pricePoints.slice(0, initialCount).map(p => p.price);
  const initialPrice = initialPrices.reduce((sum, p) => sum + p, 0) / initialPrices.length;

  let maxPrice = initialPrice;
  let maxPriceTime = pricePoints[0].time;

  pricePoints.forEach(p => {
    if (p.price > maxPrice) {
      maxPrice = p.price;
      maxPriceTime = p.time;
    }
  });

  let minPriceAfterPeak = maxPrice;
  const afterPeak = pricePoints.filter(p => p.time > maxPriceTime);
  if (afterPeak.length > 0) {
    minPriceAfterPeak = Math.min(...afterPeak.map(p => p.price));
  } else {
    minPriceAfterPeak = pricePoints[pricePoints.length - 1].price;
  }

  const finalPrice = pricePoints[pricePoints.length - 1].price;

  const maxRise = initialPrice > 0 ? ((maxPrice - initialPrice) / initialPrice) * 100 : 0;
  const maxDrop = maxPrice > 0 ? ((maxPrice - minPriceAfterPeak) / maxPrice) * 100 : 0;
  const finalChange = initialPrice > 0 ? ((finalPrice - initialPrice) / initialPrice) * 100 : 0;

  const peakTime = maxPriceTime;
  const dropDuration = pricePoints[pricePoints.length - 1].time - maxPriceTime;
  const dropSpeed = dropDuration > 0 ? (maxDrop / dropDuration) : 0;

  const isPumpDump =
    peakTime < 30 && maxRise > 50 &&
    maxDrop > 30 && finalChange < 20;

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

// 分析市值异常（新增）
function analyzeMarketCapAnomaly(tokenInfo, humanJudge) {
  if (!tokenInfo) {
    return { isAnomaly: false, score: 0, reason: '无数据' };
  }

  const fdv = parseFloat(tokenInfo.fdv || tokenInfo.market_cap || 0);
  const holders = parseInt(tokenInfo.holders || 0);

  // 判断是否为"低质量+高市值"
  const isLowQuality = humanJudge === 'low_quality';
  const isHighMarketCap = fdv > 50000; // FDV > $50k

  // 计算异常分数
  let score = 0;
  let reasons = [];

  if (isLowQuality && isHighMarketCap) {
    score += 100; // 这是典型的拉砸特征！
    reasons.push('低质量+高市值');
  } else if (isLowQuality && fdv > 20000) {
    score += 60;
    reasons.push('低质量+中等市值');
  } else if (humanJudge === 'fake_pump') {
    score += 100;
    reasons.push('人工标注为流水盘');
  }

  // 持有人数异常
  if (holders > 1000 && isLowQuality) {
    score += 30;
    reasons.push('持有人数异常多');
  }

  return {
    isAnomaly: score >= 70,
    score,
    reason: reasons.join(', ') || '正常',
    fdv,
    holders
  };
}

// 拉砸评分算法 v3
function calculatePumpDumpScoreV3(pricePattern, simultaneous, buySell, marketCapAnomaly, humanJudge) {
  const scores = {
    pricePattern: 0,      // 价格模式评分（权重：35%）
    marketCapMismatch: 0, // 市值不匹配评分（权重：30%）
    simultaneousTrades: 0, // 同时交易评分（权重：20%）
    sellPressure: 0,       // 卖压评分（权重：15%）
    total: 0
  };

  // 1. 价格模式评分（权重：35%）
  if (pricePattern.pumpDumpPattern) {
    scores.pricePattern = 100;
  } else if (pricePattern.maxRise > 50 && pricePattern.maxDrop > 30) {
    scores.pricePattern = 70;
  } else if (pricePattern.maxRise > 30 && pricePattern.maxDrop > 20) {
    scores.pricePattern = 40;
  } else if (pricePattern.volatilityScore > 100) {
    scores.pricePattern = 30;
  } else {
    scores.pricePattern = 0;
  }

  if (pricePattern.peakTime < 20 && pricePattern.maxRise > 30) {
    scores.pricePattern = Math.min(100, scores.pricePattern + 10);
  }
  if (pricePattern.dropSpeed > 1) {
    scores.pricePattern = Math.min(100, scores.pricePattern + 10);
  }

  // 2. 市值不匹配评分（权重：30%）- 新增！
  scores.marketCapMismatch = marketCapAnomaly.score;

  // 3. 同时交易评分（权重：20%）
  if (simultaneous.maxGroupSize > 100) {
    scores.simultaneousTrades = 100;
  } else if (simultaneous.maxGroupSize > 50) {
    scores.simultaneousTrades = 60;
  } else if (simultaneous.maxGroupSize > 30) {
    scores.simultaneousTrades = 30;
  } else {
    scores.simultaneousTrades = 0;
  }

  if (simultaneous.concentrationScore > 50) {
    scores.simultaneousTrades = Math.min(100, scores.simultaneousTrades + 20);
  }

  // 4. 卖压评分（权重：15%）
  const sellRatio = buySell.sellCount / (buySell.buyCount + buySell.sellCount);
  if (sellRatio > 0.6 && buySell.buyCount > 10) {
    scores.sellPressure = 100;
  } else if (sellRatio > 0.5 && buySell.buyCount > 10) {
    scores.sellPressure = 60;
  } else if (sellRatio > 0.4 && buySell.buyCount > 10) {
    scores.sellPressure = 30;
  } else {
    scores.sellPressure = 0;
  }

  // 计算总分（加权平均）
  scores.total = (
    scores.pricePattern * 0.35 +
    scores.marketCapMismatch * 0.30 +
    scores.simultaneousTrades * 0.20 +
    scores.sellPressure * 0.15
  );

  return scores;
}

// 分类
function classifyPumpDump(scores, pricePattern, marketCapAnomaly) {
  // 如果市值异常且价格模式异常，直接判定为拉砸
  if (marketCapAnomaly.isAnomaly && pricePattern.pumpDumpPattern) {
    return {
      isPumpDump: true,
      confidence: 'high',
      label: '🎭 拉砸（低质量+高市值+暴涨暴跌）'
    };
  }

  // 如果市值异常（低质量+高市值），即使价格模式不明显也高度可疑
  if (marketCapAnomaly.isAnomaly && scores.total >= 50) {
    return {
      isPumpDump: true,
      confidence: 'high',
      label: '🎭 拉砸（低质量+高市值）'
    };
  }

  // 价格模式明确是拉砸
  if (pricePattern.pumpDumpPattern) {
    return {
      isPumpDump: true,
      confidence: 'high',
      label: '⚡ 拉砸（快速拉起后快速砸盘）'
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

async function identifyPumpDumpTokensV3() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║          拉砸识别算法 v3 - 加入"低质量+高市值"特征分析                       ║');
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
    console.log(`   人工标注: ${token.human_judges?.category || '未知'}`);

    try {
      const data = await callEarlyTradesAPI(token.token_address, profit.chain, 3);
      const earlyTrades = data.earlyTrades || [];
      const launchAt = data.tokenInfo?.token?.launch_at || data.debug?.launchAt;
      const tokenInfo = data.tokenInfo?.token;

      if (earlyTrades.length === 0) {
        console.log(`   ⚠️  无早期交易数据\n`);
        continue;
      }

      // 价格序列分析
      const pricePoints = estimatePriceSeries(earlyTrades, token.token_address, launchAt);

      if (pricePoints.length < 3) {
        console.log(`   ⚠️  价格点不足\n`);
        continue;
      }

      const pricePattern = analyzePricePattern(pricePoints);
      const simultaneous = analyzeSimultaneousTrades(earlyTrades);
      const buySell = analyzeBuySellPattern(earlyTrades, token.token_address);
      const marketCapAnomaly = analyzeMarketCapAnomaly(tokenInfo, token.human_judges?.category);

      // 计算拉砸评分
      const scores = calculatePumpDumpScoreV3(
        pricePattern,
        simultaneous,
        buySell,
        marketCapAnomaly,
        token.human_judges?.category
      );

      // 分类
      const classification = classifyPumpDump(scores, pricePattern, marketCapAnomaly);

      const result = {
        symbol: profit.symbol,
        address: token.token_address,
        profitPercent: profit.profitPercent,
        pricePattern,
        simultaneous,
        buySell,
        marketCapAnomaly,
        scores,
        classification,
        humanJudge: token.human_judges?.category || 'unknown',
        fdv: marketCapAnomaly.fdv,
        holders: marketCapAnomaly.holders
      };

      results.push(result);

      // 输出分析结果
      const fdvStr = marketCapAnomaly.fdv > 0 ? `$${(marketCapAnomaly.fdv / 1000).toFixed(1)}k` : 'N/A';
      console.log(`   市值: ${fdvStr}, 持有人: ${marketCapAnomaly.holders}`);
      if (marketCapAnomaly.isAnomaly) {
        console.log(`   ⚠️  市值异常: ${marketCapAnomaly.reason} (评分: ${marketCapAnomaly.score})`);
      }

      console.log(`   价格: 初始$${(pricePattern.initialPrice * 1000000).toFixed(4)} → 最高$${(pricePattern.maxPrice * 1000000).toFixed(4)} (+${pricePattern.maxRise.toFixed(1)}%) → 最终$${(pricePattern.finalPrice * 1000000).toFixed(4)} (${pricePattern.finalChange.toFixed(1)}%)`);
      console.log(`   峰值: +${pricePattern.peakTime.toFixed(1)}s, 回落: ${pricePattern.maxDrop.toFixed(1)}%, 速度: ${pricePattern.dropSpeed.toFixed(2)}%/s`);
      console.log(`   交易: ${simultaneous.maxGroupSize}笔同时, 买卖${buySell.buyCount}/${buySell.sellCount}`);

      console.log(`   评分: 价格(${scores.pricePattern.toFixed(0)}) + 市值异常(${scores.marketCapMismatch.toFixed(0)}) + 同时交易(${scores.simultaneousTrades.toFixed(0)}) + 卖压(${scores.sellPressure.toFixed(0)})`);
      console.log(`   总分: ${scores.total.toFixed(1)}/100`);
      console.log(`   分类: ${classification.label}\n`);

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
    const fdvLabel = r.fdv > 0 ? `$${(r.fdv / 1000).toFixed(0)}k` : 'N/A';
    const judgeLabel = r.humanJudge !== 'unknown' ? ` [${r.humanJudge}]` : '';
    console.log(`  ${r.symbol.padEnd(12)} 收益:${profitLabel.padStart(7)}  市值:${fdvLabel.padStart(6)}  评分:${r.scores.total.toFixed(0).padStart(5)}  ${r.classification.label}${judgeLabel}`);
  });

  console.log('\n【正常代币】\n');
  normal.forEach(r => {
    const profitLabel = r.profitPercent > 0 ? `+${r.profitPercent.toFixed(1)}%` : `${r.profitPercent.toFixed(1)}%`;
    const fdvLabel = r.fdv > 0 ? `$${(r.fdv / 1000).toFixed(0)}k` : 'N/A';
    const judgeLabel = r.humanJudge !== 'unknown' ? ` [${r.humanJudge}]` : '';
    console.log(`  ${r.symbol.padEnd(12)} 收益:${profitLabel.padStart(7)}  市值:${fdvLabel.padStart(6)}  评分:${r.scores.total.toFixed(0).padStart(5)}  ${r.classification.label}${judgeLabel}`);
  });

  // 关键发现
  console.log('\n\n');
  console.log('【关键发现】\n');

  // 低质量+高市值被识别为拉砸的
  const lowQualityHighCapPump = pumpDump.filter(r =>
    r.humanJudge === 'low_quality' && r.fdv > 50000
  );
  if (lowQualityHighCapPump.length > 0) {
    console.log(`🎯 "低质量+高市值"被识别为拉砸: ${lowQualityHighCapPump.length}个`);
    lowQualityHighCapPump.forEach(r => {
      console.log(`   ${r.symbol}: FDV $${(r.fdv / 1000).toFixed(0)}k, 收益${r.profitPercent.toFixed(1)}%, 暴跌${r.pricePattern.maxDrop.toFixed(0)}%`);
    });
  }

  // 有收益但危险的拉砸
  const profitablePumpDump = pumpDump.filter(r => r.profitPercent > 10);
  if (profitablePumpDump.length > 0) {
    console.log(`\n⚠️  有收益但危险的拉砸代币: ${profitablePumpDump.length}个`);
    profitablePumpDump.forEach(r => {
      console.log(`   ${r.symbol}: 收益+${r.profitPercent.toFixed(1)}%, 但${r.classification.label}`);
    });
  }

  // 真正高质量
  const highQualityNormal = normal.filter(r => r.profitPercent > 50);
  if (highQualityNormal.length > 0) {
    console.log(`\n✅ 真正高质量代币: ${highQualityNormal.length}个`);
    highQualityNormal.forEach(r => {
      console.log(`   ${r.symbol}: 收益+${r.profitPercent.toFixed(1)}%, FDV $${(r.fdv / 1000).toFixed(0)}k`);
    });
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
}

identifyPumpDumpTokensV3().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
