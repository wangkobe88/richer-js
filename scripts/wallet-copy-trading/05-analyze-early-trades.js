/**
 * Step 5: 分析钱包买入时刻的早期交易者数据
 * 通过 AVE API 获取代币创建后的链上交易，分析钱包买入前的交易模式
 *
 * 用法: node scripts/wallet-copy-trading/05-analyze-early-trades.js
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { WALLET_ADDRESS, DATA_DIR, getSupabase } = require('./config');

require('dotenv').config({ path: path.resolve(__dirname, '../../config/.env') });
const { AveTxAPI } = require('../../src/core/ave-api/tx-api');

const EXP_ID = '609c9d93-c37f-4bd8-90e4-c300971f4711';
const WALLET_TRADES_FILE = path.join(DATA_DIR, 'wallet-trades.json');
const OUTPUT_FILE = path.join(DATA_DIR, 'early-trades-analysis.json');

const txApi = new AveTxAPI('https://prod.ave-api.com', 30000, process.env.AVE_API_KEY);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchEarlyTrades(pairAddress, tokenCreateTime, walletBuyTime) {
  const pairId = `${pairAddress}-solana`;
  // 从创建前5秒到钱包买入后10秒
  const fromTime = tokenCreateTime - 5;
  const toTime = walletBuyTime + 10;
  const allTrades = [];
  let lastTime = fromTime;

  for (let i = 0; i < 5; i++) {
    try {
      const trades = await txApi.getSwapTransactions(pairId, 300, lastTime, toTime, 'asc');
      if (!trades || trades.length === 0) break;

      // 去重
      const seen = new Set(allTrades.map(t => t.tx_id));
      const newTrades = trades.filter(t => !seen.has(t.tx_id));
      if (newTrades.length === 0) break;
      allTrades.push(...newTrades);

      lastTime = newTrades[newTrades.length - 1].time + 1;
      if (trades.length < 300) break;
    } catch (err) {
      console.warn(`    AVE API 调用失败: ${err.message}`);
      break;
    }
    await sleep(500);
  }

  return allTrades.sort((a, b) => a.time - b.time);
}

function classifyTrade(trade, tokenAddress) {
  const toToken = (trade.to_token || '').toLowerCase();
  const fromToken = (trade.from_token || '').toLowerCase();
  const tokenAddr = tokenAddress.toLowerCase();

  if (toToken.includes(tokenAddr.slice(0, 20))) return 'buy';
  if (fromToken.includes(tokenAddr.slice(0, 20))) return 'sell';
  // 兜底：用 USD 判断
  if (trade.from_usd > 0 && trade.to_usd > 0) return 'swap';
  return 'unknown';
}

async function main() {
  console.log('=== 分析钱包买入时刻的早期交易数据 ===\n');

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  const walletData = JSON.parse(fs.readFileSync(WALLET_TRADES_FILE, 'utf-8'));

  // 实验时间范围
  const { data: exp } = await supabase.from('experiments').select('created_at, updated_at').eq('id', EXP_ID).single();
  const expStart = Math.floor(new Date(exp.created_at).getTime() / 1000);
  const expEnd = Math.floor(new Date(exp.updated_at).getTime() / 1000);
  const walletPairs = walletData.pairs.filter(p => p.buy_time >= expStart && p.buy_time <= expEnd);

  // 获取代币的 pairAddress 和创建时间
  const tokenAddrs = walletPairs.map(p => p.token_address);
  const tokenInfoMap = {};

  for (let i = 0; i < tokenAddrs.length; i += 50) {
    const batch = tokenAddrs.slice(i, i + 50);
    const { data } = await supabase.from('experiment_tokens')
      .select('token_address, raw_api_data, discovered_at')
      .eq('experiment_id', EXP_ID)
      .in('token_address', batch);
    if (data) data.forEach(t => { tokenInfoMap[t.token_address] = t; });
  }

  // 从信号 metadata 补充 tokenCreateTime
  const allSignals = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase.from('strategy_signals')
      .select('token_address, metadata')
      .eq('experiment_id', EXP_ID)
      .eq('signal_type', 'BUY')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allSignals.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  const tokenCreateTimeMap = {};
  for (const s of allSignals) {
    const ct = s.metadata?.tokenCreateTime;
    if (ct && !tokenCreateTimeMap[s.token_address]) {
      tokenCreateTimeMap[s.token_address] = typeof ct === 'number' ? (ct > 1e12 ? ct / 1000 : ct) : Math.floor(new Date(ct).getTime() / 1000);
    }
  }

  console.log(`钱包交易对: ${walletPairs.length}`);
  console.log(`匹配代币信息: ${Object.keys(tokenInfoMap).length}`);

  // 分析每个代币
  const results = [];
  const sampleSize = Math.min(walletPairs.length, 30); // 先分析30个
  const sorted = [...walletPairs].sort((a, b) => a.buy_time - b.buy_time);

  for (let i = 0; i < sorted.length; i++) {
    const wp = sorted[i];
    const tokenInfo = tokenInfoMap[wp.token_address];
    const tokenCreateTime = tokenCreateTimeMap[wp.token_address];

    if (!tokenInfo?.raw_api_data?.pairAddress) {
      console.log(`  [${i + 1}/${sorted.length}] ${wp.symbol} - 无 pairAddress，跳过`);
      continue;
    }

    const pairAddress = tokenInfo.raw_api_data.pairAddress;
    const createTime = tokenCreateTime || Math.floor(new Date(tokenInfo.discovered_at).getTime() / 1000);
    const ageAtBuy = wp.buy_time - createTime;

    console.log(`\n[${i + 1}/${sorted.length}] ${wp.symbol} | age=${ageAtBuy}s | pair=${pairAddress.slice(0, 12)}...`);

    const trades = await fetchEarlyTrades(pairAddress, createTime, wp.buy_time);
    console.log(`  获取到 ${trades.length} 笔交易 (创建前5s ~ 买入后10s)`);

    // 按时间分桶：钱包买入前 vs 后
    const beforeBuy = trades.filter(t => t.time <= wp.buy_time);
    const afterBuy = trades.filter(t => t.time > wp.buy_time);

    // 买入/卖出分类
    const beforeBuys = beforeBuy.filter(t => classifyTrade(t, wp.token_address) === 'buy');
    const beforeSells = beforeBuy.filter(t => classifyTrade(t, wp.token_address) === 'sell');

    // 金额统计
    const beforeBuyVolume = beforeBuys.reduce((s, t) => s + (t.from_usd || 0), 0);
    const beforeSellVolume = beforeSells.reduce((s, t) => s + (t.from_usd || 0), 0);

    // 唯一钱包
    const uniqueWallets = new Set(beforeBuy.map(t => t.wallet_address || t.from_address));
    const uniqueBuyWallets = new Set(beforeBuys.map(t => t.wallet_address || t.from_address));

    // 价格变化（用第一笔和最后一笔的 to_token_price_usd）
    let priceChange = null;
    if (beforeBuy.length >= 2) {
      const firstPrice = beforeBuys[0]?.to_token_price_usd || 0;
      const lastPrice = beforeBuys[beforeBuys.length - 1]?.to_token_price_usd || 0;
      if (firstPrice > 0) priceChange = ((lastPrice - firstPrice) / firstPrice) * 100;
    }

    // 每5秒的交易量分布
    const bucketSize = 5;
    const timeBuckets = {};
    for (const t of beforeBuy) {
      const bucket = Math.floor((t.time - createTime) / bucketSize);
      const key = `${bucket * bucketSize}-${(bucket + 1) * bucketSize}s`;
      if (!timeBuckets[key]) timeBuckets[key] = { buys: 0, sells: 0, buyVol: 0, sellVol: 0 };
      const side = classifyTrade(t, wp.token_address);
      if (side === 'buy') { timeBuckets[key].buys++; timeBuckets[key].buyVol += t.from_usd || 0; }
      else if (side === 'sell') { timeBuckets[key].sells++; timeBuckets[key].sellVol += t.from_usd || 0; }
    }

    // 前5秒统计
    const first5s = beforeBuy.filter(t => (t.time - createTime) <= 5);
    const first5sBuys = first5s.filter(t => classifyTrade(t, wp.token_address) === 'buy');
    const first5sSells = first5s.filter(t => classifyTrade(t, wp.token_address) === 'sell');

    const analysis = {
      symbol: wp.symbol,
      token_address: wp.token_address,
      wallet_buy_time: wp.buy_time,
      token_create_time: createTime,
      age_at_buy: ageAtBuy,
      wallet_roi: wp.roi_percent,
      total_trades: trades.length,
      trades_before_buy: beforeBuy.length,
      trades_after_buy: afterBuy.length,
      buys_before_buy: beforeBuys.length,
      sells_before_buy: beforeSells.length,
      buy_volume_usd: Math.round(beforeBuyVolume * 100) / 100,
      sell_volume_usd: Math.round(beforeSellVolume * 100) / 100,
      unique_wallets: uniqueWallets.size,
      unique_buy_wallets: uniqueBuyWallets.size,
      price_change_before_buy: priceChange ? Math.round(priceChange * 100) / 100 : null,
      // 前5秒关键指标
      first_5s_trades: first5s.length,
      first_5s_buys: first5sBuys.length,
      first_5s_sells: first5sSells.length,
      first_5s_buy_volume: Math.round(first5sBuys.reduce((s, t) => s + (t.from_usd || 0), 0) * 100) / 100,
      // 买卖比
      buy_sell_ratio: beforeSells.length > 0 ? beforeBuys.length / beforeSells.length : null,
      buy_volume_ratio: beforeSellVolume > 0 ? beforeBuyVolume / beforeSellVolume : null,
    };

    results.push(analysis);

    console.log(`  买入前: ${beforeBuy.length} 笔 (${beforeBuys.length}买/${beforeSells.length}卖) | 买入额 $${analysis.buy_volume_usd}`);
    console.log(`  前5秒: ${first5s.length} 笔 (${first5sBuys.length}买/${first5sSells.length}卖) | 买入额 $${analysis.first_5s_buy_volume}`);
    console.log(`  买卖比: ${analysis.buy_sell_ratio || '∞'} | 价格变化: ${analysis.price_change_before_buy || 'N/A'}%`);

    await sleep(800);
  }

  // 汇总统计
  console.log('\n\n========== 汇总统计 ==========');
  console.log(`分析代币数: ${results.length}`);

  const median = arr => { if (!arr.length) return 'N/A'; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const avg = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 'N/A';

  const buyVolumes = results.map(r => r.buy_volume_usd).filter(v => v > 0);
  const first5sBuys = results.map(r => r.first_5s_buys).filter(v => v > 0);
  const buySellRatios = results.map(r => r.buy_sell_ratio).filter(v => v != null);
  const priceChanges = results.map(r => r.price_change_before_buy).filter(v => v != null);

  console.log('\n--- 钱包买入前的链上状态 ---');
  console.log(`  买入笔数中位数: ${median(results.map(r => r.buys_before_buy))}`);
  console.log(`  卖出笔数中位数: ${median(results.map(r => r.sells_before_buy))}`);
  console.log(`  买入额中位数: $${median(buyVolumes)}`);
  console.log(`  买卖比中位数: ${median(buySellRatios)}`);
  console.log(`  买入前价格变化中位数: ${median(priceChanges)}%`);
  console.log(`  唯一买家钱包中位数: ${median(results.map(r => r.unique_buy_wallets))}`);

  console.log('\n--- 前5秒关键指标 ---');
  console.log(`  前5秒买入笔数中位数: ${median(first5sBuys)}`);
  console.log(`  前5秒有买入交易的代币: ${results.filter(r => r.first_5s_buys > 0).length}/${results.length}`);
  console.log(`  前5秒买入额中位数: $${median(results.filter(r => r.first_5s_buy_volume > 0).map(r => r.first_5s_buy_volume))}`);

  // 盈利 vs 亏损对比
  const wins = results.filter(r => r.wallet_roi > 0);
  const losses = results.filter(r => r.wallet_roi <= 0);

  console.log('\n--- 盈利 vs 亏损的早期交易差异 ---');
  console.log(`  盈利: ${wins.length} 笔, 亏损: ${losses.length} 笔`);

  if (wins.length > 0 && losses.length > 0) {
    const winBuyVol = median(wins.map(r => r.buy_volume_usd));
    const lossBuyVol = median(losses.map(r => r.buy_volume_usd));
    const winRatio = median(wins.map(r => r.buy_sell_ratio).filter(v => v != null));
    const lossRatio = median(losses.map(r => r.buy_sell_ratio).filter(v => v != null));
    const win5sBuys = median(wins.map(r => r.first_5s_buys));
    const loss5sBuys = median(losses.map(r => r.first_5s_buys));
    const winPriceChange = median(wins.map(r => r.price_change_before_buy).filter(v => v != null));
    const lossPriceChange = median(losses.map(r => r.price_change_before_buy).filter(v => v != null));

    console.log(`  | 指标 | 盈利 | 亏损 |`);
    console.log(`  | 买入额中位数 | $${winBuyVol} | $${lossBuyVol} |`);
    console.log(`  | 买卖比中位数 | ${winRatio} | ${lossRatio} |`);
    console.log(`  | 前5秒买入笔数 | ${win5sBuys} | ${loss5sBuys} |`);
    console.log(`  | 买入前价格变化 | ${winPriceChange}% | ${lossPriceChange}% |`);
  }

  // 保存结果
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ analyzed_at: new Date().toISOString(), results }, null, 2));
  console.log(`\n结果已保存到 ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('执行失败:', err);
  process.exit(1);
});
