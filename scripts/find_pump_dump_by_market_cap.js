/**
 * 查找拉砸代币：低质量+高市值(>10K)+快拉快砸
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
        isBuy: isBuy
      });
    }
  });

  return pricePoints;
}

// 分析价格波动
function analyzePricePattern(pricePoints, totalSupply) {
  if (pricePoints.length < 3) {
    return { maxRise: 0, maxDrop: 0, peakTime: null, peakMarketCap: 0 };
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
  }

  const maxRise = initialPrice > 0 ? ((maxPrice - initialPrice) / initialPrice) * 100 : 0;
  const maxDrop = maxPrice > 0 ? ((maxPrice - minPriceAfterPeak) / maxPrice) * 100 : 0;
  const peakTime = maxPriceTime;

  // 计算最高市值
  const peakMarketCap = maxPrice * totalSupply;

  return {
    maxRise,
    maxDrop,
    peakTime,
    peakMarketCap,
    peakPrice: maxPrice,
    isFastPump: peakTime < 60 && maxRise > 50,  // 60秒内涨幅>50%
    isFastDump: maxDrop > 50  // 回落>50%
  };
}

async function findPumpDumpTokens() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║              查找拉砸代币：低质量+高市值(>10K)+快拉快砸                      ║');
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
    const profitPercent = totalBuy > 0 ? (profit / totalBuy) * 100 : 0;

    tokenProfits.set(addr, {
      profitPercent,
      symbol: buyTrades[0].token_symbol,
      chain: buyTrades[0].chain || 'bsc'
    });
  }

  console.log(`【开始分析 ${tokens.length} 个代币，查找"低质量+市值>10K"】\n`);

  const candidates = [];
  let analyzed = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const profit = tokenProfits.get(token.token_address);

    if (!profit) continue;

    const category = token.human_judges?.category;

    // 只关注低质量代币
    if (category !== 'low_quality' && category !== 'fake_pump') {
      continue;
    }

    analyzed++;

    console.log(`${analyzed}. ${profit.symbol} (${category})`);

    try {
      const data = await callEarlyTradesAPI(token.token_address, profit.chain, 3);
      const tokenInfo = data.tokenInfo?.token;

      if (!tokenInfo) {
        console.log(`   ⚠️  无代币信息\n`);
        continue;
      }

      const totalSupply = parseFloat(tokenInfo.total || 0);
      const currentFd = parseFloat(tokenInfo.fdv || tokenInfo.market_cap || 0);
      const holders = parseInt(tokenInfo.holders || 0);

      console.log(`   总供应量: ${totalSupply.toFixed(0)}, 当前市值: $${(currentFd / 1000).toFixed(1)}k, 持有人: ${holders}`);

      if (totalSupply === 0) {
        console.log(`   ⚠️  无总供应量数据\n`);
        continue;
      }

      const earlyTrades = data.earlyTrades || [];
      const launchAt = tokenInfo.launch_at || data.debug?.launchAt;

      if (earlyTrades.length > 0) {
        const pricePoints = estimatePriceSeries(earlyTrades, token.token_address, launchAt);
        const pricePattern = analyzePricePattern(pricePoints, totalSupply);

        const peakMarketCap = pricePattern.peakMarketCap;
        console.log(`   最高市值: $${(peakMarketCap / 1000).toFixed(1)}k (峰值价格: $${pricePattern.peakPrice.toFixed(6)})`);

        // 检查最高市值是否>10K
        if (peakMarketCap > 10000) {
          candidates.push({
            symbol: profit.symbol,
            address: token.token_address,
            profitPercent: profit.profitPercent,
            category: category,
            peakMarketCap: peakMarketCap,
            currentMarketCap: currentFd,
            holders: holders,
            pricePattern: pricePattern
          });

          const riseLabel = `+${pricePattern.maxRise.toFixed(0)}%`;
          const dropLabel = `-${pricePattern.maxDrop.toFixed(0)}%`;
          const peakLabel = pricePattern.peakTime ? `${pricePattern.peakTime.toFixed(0)}s` : 'N/A';

          console.log(`   ✅ 候选拉砸！最高市值>$10K`);
          console.log(`   价格波动: ${riseLabel}/${dropLabel}, 峰值: ${peakLabel}`);
          console.log(`   快拉: ${pricePattern.isFastPump ? '是' : '否'}, 快砸: ${pricePattern.isFastDump ? '是' : '否'}`);
        } else {
          console.log(`   最高市值不足$10K`);
        }
      } else {
        console.log(`   无早期交易数据`);
      }

      console.log(``);

    } catch (error) {
      console.error(`   ❌ 失败: ${error.message}\n`);
    }

    // 避免API限速
    await new Promise(r => setTimeout(r, 1500));
  }

  // 总结
  console.log('\n\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                          统计总结                                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log(`找到 ${candidates.length} 个"低质量+市值>10K"的代币\n`);

  if (candidates.length > 0) {
    console.log('【候选拉砸代币列表】\n');

    candidates.forEach((c, i) => {
      const profitLabel = c.profitPercent > 0 ? `+${c.profitPercent.toFixed(1)}%` : `${c.profitPercent.toFixed(1)}%`;
      const capLabel = `$${(c.peakMarketCap / 1000).toFixed(0)}k`;

      let pumpDumpLabel = '';
      if (c.pricePattern.isFastPump && c.pricePattern.isFastDump) {
        pumpDumpLabel = '🎭 确认拉砸（快拉快砸）';
      } else if (c.pricePattern.isFastDump) {
        pumpDumpLabel = '⚠️  快砸（可能拉砸）';
      } else if (c.pricePattern.isFastPump) {
        pumpDumpLabel = '🔍 快拉（需观察）';
      } else {
        pumpDumpLabel = '❓ 待确认';
      }

      console.log(`${(i + 1).toString().padStart(2)}. ${c.symbol.padEnd(12)} 收益:${profitLabel.padStart(7)}  最高市值:${capLabel.padStart(6)}  ${pumpDumpLabel}`);
      console.log(`    波动: +${c.pricePattern.maxRise.toFixed(0)}%/-${c.pricePattern.maxDrop.toFixed(0)}%, 峰值: ${c.pricePattern.peakTime?.toFixed(0) || 'N/A'}s`);
    });

    // 统计
    console.log('\n');
    console.log('【拉砸类型统计】\n');

    const confirmedPump = candidates.filter(c => c.pricePattern.isFastPump && c.pricePattern.isFastDump);
    const fastDump = candidates.filter(c => !c.pricePattern.isFastPump && c.pricePattern.isFastDump);
    const fastPump = candidates.filter(c => c.pricePattern.isFastPump && !c.pricePattern.isFastDump);
    const unknown = candidates.filter(c => !c.pricePattern.isFastPump && !c.pricePattern.isFastDump);

    console.log(`🎭 确认拉砸（快拉快砸）: ${confirmedPump.length}个`);
    confirmedPump.forEach(c => console.log(`   - ${c.symbol}: 最高市值$${(c.peakMarketCap/1000).toFixed(0)}k, +${c.pricePattern.maxRise.toFixed(0)}%/-${c.pricePattern.maxDrop.toFixed(0)}%`));

    console.log(`\n⚠️  快砸（可能拉砸）: ${fastDump.length}个`);
    fastDump.forEach(c => console.log(`   - ${c.symbol}: 最高市值$${(c.peakMarketCap/1000).toFixed(0)}k, -${c.pricePattern.maxDrop.toFixed(0)}%`));

    console.log(`\n🔍 快拉（需观察）: ${fastPump.length}个`);
    fastPump.forEach(c => console.log(`   - ${c.symbol}: 最高市值$${(c.peakMarketCap/1000).toFixed(0)}k, +${c.pricePattern.maxRise.toFixed(0)}%`));

    if (unknown.length > 0) {
      console.log(`\n❓ 待确认: ${unknown.length}个`);
      unknown.forEach(c => console.log(`   - ${c.symbol}: 最高市值$${(c.peakMarketCap/1000).toFixed(0)}k`));
    }
  } else {
    console.log('❌ 未找到"低质量+市值>10K"的代币');
    console.log('\n可能需要：');
    console.log('1. 分析更多实验数据');
    console.log('2. 调整市值阈值');
    console.log('3. 检查人工标注是否准确');
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
}

findPumpDumpTokens().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
