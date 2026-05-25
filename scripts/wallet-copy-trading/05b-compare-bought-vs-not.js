/**
 * 对比钱包买入 vs 没买的代币，在早期交易数据上的差异
 *
 * 用法: node scripts/wallet-copy-trading/05b-compare-bought-vs-not.js
 */

const fs = require('fs');
const path = require('path');
const { AveTxAPI } = require('../../src/core/ave-api/tx-api');

require('dotenv').config({ path: path.resolve(__dirname, '../../config/.env') });

const DATA_DIR = path.resolve(__dirname, 'data');
const txApi = new AveTxAPI('https://prod.ave-api.com', 30000, process.env.AVE_API_KEY);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function classifyTrade(trade, tokenAddress) {
  const toToken = (trade.to_token || '').toLowerCase();
  const fromToken = (trade.from_token || '').toLowerCase();
  const tokenAddr = tokenAddress.toLowerCase();
  if (toToken.includes(tokenAddr.slice(0, 20))) return 'buy';
  if (fromToken.includes(tokenAddr.slice(0, 20))) return 'sell';
  return 'unknown';
}

async function fetchEarlyTrades(pairAddress, tokenCreateTime, targetAge) {
  const pairId = `${pairAddress}-solana`;
  const fromTime = tokenCreateTime - 2;
  const toTime = tokenCreateTime + targetAge;
  const allTrades = [];
  let lastTime = fromTime;

  for (let i = 0; i < 3; i++) {
    try {
      const trades = await txApi.getSwapTransactions(pairId, 300, lastTime, toTime, 'asc');
      if (!trades || trades.length === 0) break;
      const seen = new Set(allTrades.map(t => t.tx_id));
      const newTrades = trades.filter(t => !seen.has(t.tx_id));
      if (newTrades.length === 0) break;
      allTrades.push(...newTrades);
      lastTime = newTrades[newTrades.length - 1].time + 1;
      if (trades.length < 300) break;
    } catch (err) {
      break;
    }
    await sleep(300);
  }
  return allTrades.sort((a, b) => a.time - b.time);
}

function analyzeToken(trades, tokenCreateTime, tokenAddress, targetAge) {
  const withinWindow = trades.filter(t => t.time >= tokenCreateTime && t.time <= tokenCreateTime + targetAge);
  const buys = withinWindow.filter(t => classifyTrade(t, tokenAddress) === 'buy');
  const sells = withinWindow.filter(t => classifyTrade(t, tokenAddress) === 'sell');
  const buyVolume = buys.reduce((s, t) => s + (t.from_usd || 0), 0);
  const sellVolume = sells.reduce((s, t) => s + (t.from_usd || 0), 0);
  const uniqueBuyers = new Set(buys.map(t => t.wallet_address || t.from_address)).size;

  // 价格变化
  let priceChange = null;
  if (buys.length >= 2) {
    const prices = buys.map(t => t.to_token_price_usd).filter(p => p > 0);
    if (prices.length >= 2) {
      priceChange = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
    }
  }

  // 前5秒统计
  const first5s = withinWindow.filter(t => (t.time - tokenCreateTime) <= 5);
  const first5sBuys = first5s.filter(t => classifyTrade(t, tokenAddress) === 'buy');
  const first5sSells = first5s.filter(t => classifyTrade(t, tokenAddress) === 'sell');
  const first5sBuyVol = first5sBuys.reduce((s, t) => s + (t.from_usd || 0), 0);

  return {
    total_trades: withinWindow.length,
    buys: buys.length,
    sells: sells.length,
    buy_volume: Math.round(buyVolume),
    sell_volume: Math.round(sellVolume),
    buy_sell_ratio: sells.length > 0 ? buys.length / sells.length : (buys.length > 0 ? Infinity : 0),
    buy_volume_ratio: sellVolume > 0 ? buyVolume / sellVolume : (buyVolume > 0 ? Infinity : 0),
    unique_buyers: uniqueBuyers,
    price_change: priceChange != null ? Math.round(priceChange * 100) / 100 : null,
    first_5s_trades: first5s.length,
    first_5s_buys: first5sBuys.length,
    first_5s_sells: first5sSells.length,
    first_5s_buy_volume: Math.round(first5sBuyVol),
  };
}

async function main() {
  console.log('=== 对比：钱包买入 vs 没买的早期交易数据 ===\n');

  // 读取之前05的分析结果（钱包买入的）
  const boughtAnalysis = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'early-trades-analysis.json'), 'utf-8'));
  const notBoughtSample = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'not-bought-sample.json'), 'utf-8'));

  // 钱包买入中位数 age=5s，统一用 5 秒窗口对比
  const TARGET_AGE = 5;

  console.log(`统一对比窗口: 代币创建后 ${TARGET_AGE} 秒内的链上交易`);
  console.log(`钱包买入的: ${boughtAnalysis.results.length} 个 (已有数据)`);
  console.log(`钱包没买的: ${notBoughtSample.length} 个 (待查询)`);

  // 重新用统一窗口分析钱包买入的
  const boughtStats = [];
  for (const r of boughtAnalysis.results) {
    // 从已有数据提取（first_5s 字段就是这个窗口的数据）
    boughtStats.push({
      symbol: r.symbol,
      token_address: r.token_address,
      group: 'bought',
      wallet_roi: r.wallet_roi,
      total_trades: r.first_5s_trades,
      buys: r.first_5s_buys,
      sells: r.first_5s_sells,
      buy_volume: r.first_5s_buy_volume,
      buy_sell_ratio: r.first_5s_sells > 0 ? r.first_5s_buys / r.first_5s_sells : (r.first_5s_buys > 0 ? Infinity : 0),
      unique_buyers: null, // 没有，用 total 做近似
      price_change: null, // 前面的分析是整个买入前的，不是前5秒的
    });
  }

  // 查询钱包没买的代币
  const notBoughtStats = [];
  let apiErrors = 0;

  for (let i = 0; i < notBoughtSample.length; i++) {
    const t = notBoughtSample[i];
    console.log(`  [${i + 1}/${notBoughtSample.length}] ${t.symbol || t.token_address.slice(0, 12)}...`);

    const trades = await fetchEarlyTrades(t.pairAddress, t.tokenCreateTime, TARGET_AGE);

    if (trades.length === 0) {
      apiErrors++;
      if (apiErrors > 3 && trades.length === 0) {
        // 可能被限流了
      }
    }

    const analysis = analyzeToken(trades, t.tokenCreateTime, t.token_address, TARGET_AGE);
    notBoughtStats.push({
      symbol: t.symbol,
      token_address: t.token_address,
      group: 'not_bought',
      wallet_roi: null,
      ...analysis,
    });

    console.log(`    trades=${analysis.total_trades} buys=${analysis.buys} sells=${analysis.sells} buyVol=$${analysis.buy_volume} ratio=${analysis.buy_sell_ratio === Infinity ? '∞' : analysis.buy_sell_ratio.toFixed(1)}`);

    await sleep(600);
  }

  // 汇总对比
  const median = arr => { if (!arr.length) return 'N/A'; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const avg = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 'N/A';
  const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(Math.floor(s.length * p / 100), s.length - 1)]; };

  // 过滤掉 API 失败的
  const validBought = boughtStats.filter(r => r.total_trades > 0);
  const validNotBought = notBoughtStats.filter(r => r.total_trades > 0 || true); // 保留0的，这是关键对比

  console.log('\n\n==========================================');
  console.log('对比：前5秒链上交易数据');
  console.log('==========================================');
  console.log(`有效样本: 买入=${validBought.length}, 没买=${validNotBought.length}`);

  const fields = [
    ['total_trades', '总交易数'],
    ['buys', '买入笔数'],
    ['sells', '卖出笔数'],
    ['buy_volume', '买入额(USD)'],
    ['buy_sell_ratio', '买卖比'],
    ['first_5s_buys', '前5秒买入'],
  ];

  console.log('\n| 指标 | 钱包买入(中位数) | 钱包没买(中位数) | 差异 |');
  console.log('|---|---|---|---|');

  for (const [field, label] of fields) {
    const bVals = validBought.map(r => r[field]).filter(v => v != null && v !== Infinity && v !== 'N/A');
    const nVals = validNotBought.map(r => r[field]).filter(v => v != null && v !== Infinity && v !== 'N/A');

    const bMed = median(bVals);
    const nMed = median(nVals);

    let diff = '';
    if (typeof bMed === 'number' && typeof nMed === 'number' && nMed !== 0) {
      diff = ((bMed - nMed) / nMed * 100).toFixed(0) + '%';
    }

    console.log(`| ${label} | ${typeof bMed === 'number' ? bMed.toFixed(1) : bMed} | ${typeof nMed === 'number' ? nMed.toFixed(1) : nMed} | ${diff} |`);
  }

  // 买卖比分布对比
  console.log('\n--- 买卖比分布 ---');
  const bRatios = validBought.map(r => r.buy_sell_ratio).filter(v => v != null && v !== Infinity);
  const nRatios = validNotBought.map(r => r.buy_sell_ratio).filter(v => v != null && v !== Infinity);

  console.log(`  钱包买入: P25=${pct(bRatios, 25)?.toFixed(1)} 中位数=${median(bRatios)?.toFixed(1)} P75=${pct(bRatios, 75)?.toFixed(1)}`);
  console.log(`  钱包没买: P25=${pct(nRatios, 25)?.toFixed(1)} 中位数=${median(nRatios)?.toFixed(1)} P75=${pct(nRatios, 75)?.toFixed(1)}`);

  // 0 交易的比例
  const bZero = validBought.filter(r => r.total_trades === 0).length;
  const nZero = validNotBought.filter(r => r.total_trades === 0).length;
  console.log(`\n  0交易代币: 买入 ${bZero}/${validBought.length} (${(bZero/validBought.length*100).toFixed(0)}%), 没买 ${nZero}/${validNotBought.length} (${(nZero/validNotBought.length*100).toFixed(0)}%)`);

  // 买入额分布
  console.log('\n--- 前5秒买入额分布 ---');
  const bVols = validBought.map(r => r.buy_volume).filter(v => v > 0);
  const nVols = validNotBought.map(r => r.buy_volume).filter(v => v > 0);
  console.log(`  钱包买入: P25=$${pct(bVols, 25)?.toFixed(0)} 中位数=$${median(bVols)?.toFixed(0)} P75=$${pct(bVols, 75)?.toFixed(0)}`);
  console.log(`  钱包没买: P25=$${pct(nVols, 25)?.toFixed(0)} 中位数=$${median(nVols)?.toFixed(0)} P75=$${pct(nVols, 75)?.toFixed(0)}`);

  // 保存结果
  const result = {
    analyzed_at: new Date().toISOString(),
    target_age_seconds: TARGET_AGE,
    bought_sample_size: validBought.length,
    not_bought_sample_size: validNotBought.length,
    bought: boughtStats,
    not_bought: notBoughtStats,
  };
  fs.writeFileSync(path.join(DATA_DIR, 'compare-bought-vs-not.json'), JSON.stringify(result, null, 2));
  console.log(`\n结果已保存到 ${path.join(DATA_DIR, 'compare-bought-vs-not.json')}`);
}

main().catch(err => {
  console.error('执行失败:', err);
  process.exit(1);
});
