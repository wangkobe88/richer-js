/**
 * Step 1: 获取钱包近期交易记录
 * 通过 GMGN API 分页获取，构建交易对，保存到本地 JSON
 *
 * 用法: node scripts/wallet-copy-trading/01-fetch-wallet-trades.js
 */

const fs = require('fs');
const path = require('path');
const { init, getPortfolioApi, getTokenApi, WALLET_ADDRESS, CHAIN, DATA_DIR } = require('./config');

const OUTPUT_FILE = path.join(DATA_DIR, 'wallet-trades.json');
const CACHE_HOURS = 2;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 获取钱包近24小时交易记录
 * 按时间倒序分页，遇到超过24小时的记录就停止
 */
async function fetchRecentActivities(portfolioApi) {
  const cutoff = Math.floor(Date.now() / 1000) - 24 * 3600;
  const allActivities = [];
  let cursor = undefined;
  let page = 0;
  let stoppedEarly = false;

  console.log(`\n[1/3] 获取钱包近24小时交易 (cutoff: ${new Date(cutoff * 1000).toISOString()})...`);

  while (true) {
    page++;
    const data = await portfolioApi.getWalletActivity(CHAIN, WALLET_ADDRESS, {
      limit: 50,
      ...(cursor ? { cursor } : {}),
    });

    const activities = data?.activities || data?.list || [];
    if (activities.length === 0) break;

    // 过滤出24小时内的，遇到太旧的停止翻页
    for (const act of activities) {
      const ts = act.timestamp || 0;
      if (ts < cutoff) {
        stoppedEarly = true;
        break;
      }
      allActivities.push(act);
    }

    console.log(`  页 ${page}: 获取 ${activities.length} 条, 有效(24h内) ${allActivities.length} 条`);

    if (stoppedEarly) break;

    const nextCursor = data?.next || data?.cursor;
    if (!nextCursor) break;
    cursor = nextCursor;

    await sleep(800);
  }

  return allActivities;
}

/**
 * 解析交易活动为统一格式
 */
function parseActivities(rawActivities) {
  return rawActivities
    .map(act => {
      const action = (act.event_type || act.action || act.type || '').toLowerCase();
      // 只保留买入和卖出
      if (action !== 'buy' && action !== 'sell') return null;

      // GMGN API 格式: token 是嵌套对象, cost_usd 为美元金额, quote_amount 为 SOL 数量
      const tokenObj = act.token || {};
      const quoteAmount = parseFloat(act.quote_amount || 0);
      const costUsd = parseFloat(act.cost_usd || 0);

      return {
        token_address: tokenObj.address || act.token_address || '',
        symbol: tokenObj.symbol || act.symbol || '',
        action,
        timestamp: act.timestamp || 0,
        amount_sol: quoteAmount,
        amount_usd: costUsd || parseFloat(act.buy_cost_usd || 0),
        price_usd: parseFloat(act.price_usd || 0),
        token_amount: parseFloat(act.token_amount || 0),
        transaction_hash: act.tx_hash || act.transaction_hash || '',
        launchpad: act.launchpad_platform || act.launchpad || '',
        is_open_or_close: act.is_open_or_close || 0,
      };
    })
    .filter(Boolean);
}

/**
 * 按代币分组，构建交易对（首次买入 -> 最终卖出）
 */
function buildTradePairs(trades) {
  // 按时间排序
  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  // 按 token 分组
  const tokenGroups = {};
  for (const t of sorted) {
    const key = t.token_address;
    if (!tokenGroups[key]) tokenGroups[key] = [];
    tokenGroups[key].push(t);
  }

  const pairs = [];

  for (const [tokenAddr, tokenTrades] of Object.entries(tokenGroups)) {
    const buys = tokenTrades.filter(t => t.action === 'buy');
    const sells = tokenTrades.filter(t => t.action === 'sell');

    if (buys.length === 0) continue;

    const firstBuy = buys[0];
    const lastSell = sells.length > 0 ? sells[sells.length - 1] : null;

    const totalBuyUsd = buys.reduce((s, b) => s + b.amount_usd, 0);
    const totalSellUsd = sells.reduce((s, sl) => s + sl.amount_usd, 0);

    const pair = {
      token_address: tokenAddr,
      symbol: firstBuy.symbol,
      buy_time: firstBuy.timestamp,
      buy_price_usd: firstBuy.price_usd,
      buy_amount_usd: Math.round(totalBuyUsd * 100) / 100,
      buy_count: buys.length,
      sell_time: lastSell ? lastSell.timestamp : null,
      sell_price_usd: lastSell ? lastSell.price_usd : null,
      sell_amount_usd: lastSell ? Math.round(totalSellUsd * 100) / 100 : null,
      sell_count: sells.length,
      status: lastSell ? 'closed' : 'holding',
    };

    // 计算 ROI
    if (pair.sell_amount_usd && pair.buy_amount_usd > 0) {
      pair.roi_percent = Math.round(((pair.sell_amount_usd / pair.buy_amount_usd) - 1) * 10000) / 100;
    } else {
      pair.roi_percent = null;
    }

    // 持仓时长
    if (pair.sell_time && pair.buy_time) {
      pair.hold_duration_seconds = pair.sell_time - pair.buy_time;
    } else {
      pair.hold_duration_seconds = null;
    }

    pairs.push(pair);
  }

  // 按买入时间排序
  pairs.sort((a, b) => a.buy_time - b.buy_time);
  return pairs;
}

/**
 * 获取钱包统计
 */
async function fetchWalletStats(portfolioApi) {
  console.log(`\n[2/3] 获取钱包统计...`);

  try {
    const stats = await portfolioApi.getWalletStats(CHAIN, [WALLET_ADDRESS], '30d');
    return stats;
  } catch (err) {
    console.warn('  统计获取失败:', err.message);
    return null;
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('=== 获取钱包近期交易 ===');
  console.log('钱包:', WALLET_ADDRESS);
  console.log('链:', CHAIN);

  await init();
  const portfolioApi = getPortfolioApi();

  // 检查缓存
  if (fs.existsSync(OUTPUT_FILE)) {
    const stat = fs.statSync(OUTPUT_FILE);
    const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
    if (ageHours < CACHE_HOURS) {
      console.log(`\n缓存有效 (${ageHours.toFixed(1)}h < ${CACHE_HOURS}h)，使用缓存数据`);
      const cached = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
      console.log(`  交易数: ${cached.trades.length}, 交易对: ${cached.pairs.length}`);
      return cached;
    }
    console.log(`\n缓存过期 (${ageHours.toFixed(1)}h)，重新获取`);
  }

  // 获取统计
  const stats = await fetchWalletStats(portfolioApi);
  if (stats) {
    const s = Array.isArray(stats) ? stats[0] : stats;
    console.log(`  近30天胜率: ${((s?.winrate || s?.win_rate || 0) * 100).toFixed(1)}%`);
    console.log(`  已实现盈亏: $${s?.realized_profit || s?.total_profit || 'N/A'}`);
  }

  // 获取近24小时交易
  const rawActivities = await fetchRecentActivities(portfolioApi);
  console.log(`\n  原始活动总数: ${rawActivities.length}`);

  // 解析
  const trades = parseActivities(rawActivities);
  const buys = trades.filter(t => t.action === 'buy');
  const sells = trades.filter(t => t.action === 'sell');
  console.log(`  解析后: ${buys.length} 笔买入, ${sells.length} 笔卖出`);

  // 构建交易对
  const pairs = buildTradePairs(trades);
  const closed = pairs.filter(p => p.status === 'closed');
  const holding = pairs.filter(p => p.status === 'holding');
  const wins = closed.filter(p => p.roi_percent > 0);
  const losses = closed.filter(p => p.roi_percent <= 0);
  console.log(`  交易对: ${closed.length} 已平仓, ${holding.length} 持仓中`);
  console.log(`  胜率: ${closed.length > 0 ? ((wins.length / closed.length) * 100).toFixed(1) : 'N/A'}%`);

  // 保存
  const result = {
    wallet: WALLET_ADDRESS,
    chain: CHAIN,
    fetched_at: new Date().toISOString(),
    stats: stats || {},
    trades,
    pairs,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
  console.log(`\n[3/3] 数据已保存到 ${OUTPUT_FILE}`);

  // 概览
  console.log('\n=== 交易概览 ===');
  if (closed.length > 0) {
    const rois = closed.map(p => p.roi_percent).filter(r => r !== null);
    const durations = closed.map(p => p.hold_duration_seconds).filter(d => d !== null);
    const amounts = buys.map(b => b.amount_usd).filter(a => a > 0);

    console.log(`  已平仓: ${closed.length} 笔`);
    console.log(`  胜: ${wins.length}, 负: ${losses.length}`);
    console.log(`  ROI 中位数: ${median(rois).toFixed(1)}%`);
    console.log(`  持仓时长中位数: ${formatDuration(median(durations))}`);
    console.log(`  单笔买入金额中位数: $${median(amounts).toFixed(2)}`);
    console.log(`  总买入金额: $${amounts.reduce((s, a) => s + a, 0).toFixed(2)}`);
  }

  return result;
}

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds.toFixed(0)}秒`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}分钟`;
  return `${(seconds / 3600).toFixed(1)}小时`;
}

main().catch(err => {
  console.error('执行失败:', err);
  process.exit(1);
});
