require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const { GMGNPortfolioAPI } = require('../src/core/gmgn-api/portfolio-api');
const { GMGNTokenAPI } = require('../src/core/gmgn-api/token-api');
const fs = require('fs');
const path = require('path');

const WALLET = 'CCCCQCrL6zVjnDeucDzcxJgxAs5ahNmrhw1CDexPhqrd';
const CHAIN = 'sol';
const NEW_TOKEN_THRESHOLD_HOURS = 24;
const PAGE_LIMIT = 50;
const MAX_PAGES = 2000;
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 300;
const SECURITY_TOP_N = 30;
const TIME_WINDOW_DAYS = 30; // 限制最近30天数据
const TIME_WINDOW_SEC = TIME_WINDOW_DAYS * 86400;
const CACHE_FILE = path.join(__dirname, '.wallet-analysis-cache.json');

const QUOTE_TOKENS = new Set([
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
]);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const fmtSec = (s) => s == null ? '?' : s < 60 ? s.toFixed(0) + 's' : s < 3600 ? (s / 60).toFixed(1) + 'min' : s < 86400 ? (s / 3600).toFixed(1) + 'h' : (s / 86400).toFixed(1) + 'd';
const fmtUSD = (v) => { const n = Number(v) || 0; return n >= 0 ? '+$' + n.toFixed(0) : '-$' + Math.abs(n).toFixed(0); };
const fmtPct = (v) => (v * 100).toFixed(1) + '%';
const pct = (n, d) => d > 0 ? (n / d * 100).toFixed(1) + '%' : 'N/A';

// ============ Phase 2: Fetch ALL Trading Activity ============

async function fetchAllActivities(portfolioApi, wallet) {
  const cutoff = Math.floor(Date.now() / 1000) - TIME_WINDOW_SEC;
  let all = [], cursor, pc = 0;
  console.error('Fetching activities (last ' + TIME_WINDOW_DAYS + ' days)...');
  while (true) {
    const extra = { limit: PAGE_LIMIT };
    if (cursor) extra.cursor = cursor;
    let result = null;
    for (let r = 0; r < 3; r++) {
      try {
        result = await portfolioApi.getWalletActivity(CHAIN, wallet, extra);
        break;
      } catch (e) {
        console.error('  retry ' + (r + 1) + ': ' + e.message.substring(0, 80));
        await sleep(2000 * (r + 1));
      }
    }
    if (!result || !result.activities || result.activities.length === 0) break;
    // 只保留时间窗口内的活动
    const filtered = result.activities.filter(a => a.timestamp >= cutoff);
    all = all.concat(filtered);
    // 如果最后一条已经超出窗口，停止分页
    if (result.activities[result.activities.length - 1].timestamp < cutoff) break;
    cursor = result.next;
    if (++pc > MAX_PAGES) {
      console.error('  hit max pages limit');
      break;
    }
    if (pc % 10 === 0) console.error('  page ' + pc + ', fetched ' + all.length + ' activities');
    await sleep(500);
  }
  console.error('  total: ' + all.length + ' activities in ' + pc + ' pages');
  return all;
}

// ============ Phase 3: Build Token Map ============

function buildTokenMap(activities) {
  const trades = activities.filter(a =>
    (a.event_type === 'buy' || a.event_type === 'sell') &&
    a.token && a.token.address &&
    !QUOTE_TOKENS.has(a.token.address)
  );

  const tokenMap = {};
  for (const act of trades) {
    const addr = act.token.address;
    if (!tokenMap[addr]) {
      tokenMap[addr] = {
        address: addr,
        symbol: act.token.symbol || '?',
        firstTradeTime: act.timestamp,
        lastTradeTime: act.timestamp,
        firstTradeType: act.event_type,
        launchpad: act.launchpad || '',
        totalBoughtCost: 0,
        totalSoldIncome: 0,
        totalBuyCostFromSell: 0,
        buys: 0,
        sells: 0,
        firstBuyPrice: null,
        lastSellPrice: null,
        totalSupply: act.token.total_supply || null,
        buyAmounts: [],
        sellAmounts: [],
        timestamps: [],
      };
    }
    const t = tokenMap[addr];
    if (act.timestamp < t.firstTradeTime) {
      t.firstTradeTime = act.timestamp;
      t.firstTradeType = act.event_type;
    }
    if (act.timestamp > t.lastTradeTime) t.lastTradeTime = act.timestamp;
    if (act.launchpad && !t.launchpad) t.launchpad = act.launchpad;
    t.timestamps.push({ time: act.timestamp, type: act.event_type });

    if (act.event_type === 'buy') {
      t.buys++;
      const cost = parseFloat(act.cost_usd || 0);
      t.totalBoughtCost += cost;
      t.buyAmounts.push(cost);
      if (!t.firstBuyPrice) t.firstBuyPrice = parseFloat(act.price_usd || 0);
    } else if (act.event_type === 'sell') {
      t.sells++;
      const cost = parseFloat(act.cost_usd || 0);
      t.totalSoldIncome += cost;
      t.sellAmounts.push(cost);
      t.lastSellPrice = parseFloat(act.price_usd || 0);
      if (act.buy_cost_usd != null) t.totalBuyCostFromSell += parseFloat(act.buy_cost_usd);
    }
  }

  const tokens = Object.values(tokenMap);
  for (const t of tokens) {
    t.realizedProfit = t.sells > 0 && t.totalBuyCostFromSell > 0
      ? t.totalSoldIncome - t.totalBuyCostFromSell
      : (t.sells > 0 ? t.totalSoldIncome - t.totalBoughtCost : 0);
    t.roi = t.totalBoughtCost > 0 ? t.realizedProfit / t.totalBoughtCost : 0;
    t.holdingTimeSec = t.sells > 0 ? t.lastTradeTime - t.firstTradeTime : null;
    t.avgBuySize = t.buys > 0 ? t.totalBoughtCost / t.buys : 0;
    if (t.firstBuyPrice && t.totalSupply) {
      t.estimatedBuyMcap = t.firstBuyPrice * parseFloat(t.totalSupply);
    }
  }

  return { tokens, trades };
}

// ============ Phase 4: Fetch Token Metadata ============

async function fetchCreationTimes(tokenApi, addrs) {
  const creationTimes = {};
  console.error('Fetching creation times for ' + addrs.length + ' tokens...');
  for (let i = 0; i < addrs.length; i += BATCH_SIZE) {
    await Promise.all(addrs.slice(i, i + BATCH_SIZE).map(async (a) => {
      try {
        const info = await tokenApi.getTokenInfo(CHAIN, a);
        if (info && info.creation_timestamp) {
          const ct = info.creation_timestamp > 1e12 ? Math.floor(info.creation_timestamp / 1000) : info.creation_timestamp;
          creationTimes[a] = {
            ct,
            marketCap: info.market_cap || info.fdv || null,
            holders: info.holders || info.holder_count || null,
          };
        }
      } catch (e) { /* skip */ }
    }));
    await sleep(BATCH_DELAY_MS);
    const p = Math.min(i + BATCH_SIZE, addrs.length);
    if (p % 30 < BATCH_SIZE || p >= addrs.length) console.error('  creation time: ' + p + '/' + addrs.length);
  }
  return creationTimes;
}

async function fetchTokenSecurity(tokenApi, addrs) {
  const security = {};
  console.error('Fetching security for top ' + addrs.length + ' tokens...');
  for (let i = 0; i < addrs.length; i += 2) {
    await Promise.all(addrs.slice(i, i + 2).map(async (a) => {
      try {
        const sec = await tokenApi.getTokenSecurity(CHAIN, a);
        if (sec) security[a] = sec;
      } catch (e) { /* skip */ }
    }));
    await sleep(800);
  }
  return security;
}

// ============ Phase 5: Classify & Enrich ============

function classifyTokens(tokens, creationTimes) {
  for (const t of tokens) {
    const info = creationTimes[t.address];
    if (info) {
      t.tokenCreatedAt = info.ct;
      t.gapSec = t.firstTradeTime - info.ct;
      t.hoursAfterCreation = t.gapSec / 3600;
      t.isNewToken = t.gapSec >= 0 && t.gapSec <= NEW_TOKEN_THRESHOLD_HOURS * 3600;
      if (!t.estimatedBuyMcap && info.marketCap) {
        t.estimatedBuyMcap = info.marketCap;
      }
    } else {
      t.tokenCreatedAt = null;
      t.gapSec = null;
      t.hoursAfterCreation = null;
      t.isNewToken = false;
    }
  }
}

// ============ Phase 6: Analysis ============

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * p)];
}

function analyze(tokens, trades, stats30d, stats7d, holdings) {
  const sorted = [...tokens].sort((a, b) => b.realizedProfit - a.realizedProfit);
  const withSells = tokens.filter(t => t.sells > 0);
  const winners = withSells.filter(t => t.realizedProfit > 0);
  const losers = withSells.filter(t => t.realizedProfit < 0);

  // PnL stats
  const pnlValues = withSells.map(t => t.realizedProfit);
  const totalRealizedPnL = tokens.reduce((s, t) => s + t.realizedProfit, 0);
  const winRate = withSells.length > 0 ? winners.length / withSells.length : 0;
  const avgWin = winners.length > 0 ? winners.reduce((s, t) => s + t.realizedProfit, 0) / winners.length : 0;
  const avgLoss = losers.length > 0 ? losers.reduce((s, t) => s + t.realizedProfit, 0) / losers.length : 0;
  const totalBuyCost = tokens.reduce((s, t) => s + t.totalBoughtCost, 0);

  // New vs Old
  const newTokens = tokens.filter(t => t.isNewToken);
  const oldTokens = tokens.filter(t => !t.isNewToken);
  const newProfit = newTokens.reduce((s, t) => s + t.realizedProfit, 0);
  const oldProfit = oldTokens.reduce((s, t) => s + t.realizedProfit, 0);
  const newBuyCost = newTokens.reduce((s, t) => s + t.totalBoughtCost, 0);
  const oldBuyCost = oldTokens.reduce((s, t) => s + t.totalBoughtCost, 0);

  // Entry speed distribution for new tokens
  const newWithGap = newTokens.filter(t => t.gapSec != null && t.gapSec >= 0);
  const secBins = [
    [0, 30], [30, 60], [60, 120], [120, 300], [300, 600],
    [600, 1800], [1800, 3600], [3600, 7200], [7200, 86400],
  ];
  const gapDist = [];
  let cumGap = 0;
  for (const [lo, hi] of secBins) {
    const inBin = newWithGap.filter(t => t.gapSec >= lo && t.gapSec < hi);
    cumGap += inBin.length;
    gapDist.push({
      lo, hi, count: inBin.length, cum: cumGap,
      profit: inBin.reduce((s, t) => s + t.realizedProfit, 0),
      cost: inBin.reduce((s, t) => s + t.totalBoughtCost, 0),
    });
  }

  // Holding time distribution
  const withHoldingTime = withSells.filter(t => t.holdingTimeSec != null);
  const holdBins = [
    [0, 60], [60, 300], [300, 1800], [1800, 7200],
    [7200, 28800], [28800, 86400], [86400, 604800], [604800, Infinity],
  ];
  const holdDist = holdBins.map(([lo, hi]) => {
    const inBin = withHoldingTime.filter(t => t.holdingTimeSec >= lo && (hi === Infinity || t.holdingTimeSec < hi));
    return {
      lo, hi, count: inBin.length,
      profit: inBin.reduce((s, t) => s + t.realizedProfit, 0),
      avgROI: inBin.length > 0 ? inBin.reduce((s, t) => s + t.roi, 0) / inBin.length : 0,
    };
  }).filter(d => d.count > 0);

  // Buy size distribution
  const allBuyAmounts = trades.filter(a => a.event_type === 'buy').map(a => parseFloat(a.cost_usd || 0));
  const buySizeBins = [
    [0, 10], [10, 50], [50, 100], [100, 500], [500, 1000], [1000, 5000], [5000, Infinity],
  ];
  // Per-token avg buy size -> PnL correlation
  const tokenBuySize = tokens.map(t => ({ avgBuy: t.avgBuySize, pnl: t.realizedProfit, roi: t.roi }));
  const buySizeDist = buySizeBins.map(([lo, hi]) => {
    const inBin = tokenBuySize.filter(t => t.avgBuy >= lo && (hi === Infinity || t.avgBuy < hi));
    return {
      lo, hi, count: inBin.length,
      pnl: inBin.reduce((s, t) => s + t.pnl, 0),
      avgROI: inBin.length > 0 ? inBin.reduce((s, t) => s + t.roi, 0) / inBin.length : 0,
    };
  }).filter(d => d.count > 0);

  // Time-of-day pattern (UTC)
  const hourBuckets = new Array(24).fill(0);
  const hourPnL = new Array(24).fill(0);
  for (const t of tokens) {
    const h = new Date(t.firstTradeTime * 1000).getUTCHours();
    hourBuckets[h]++;
    hourPnL[h] += t.realizedProfit;
  }

  // Day-of-week pattern
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayBuckets = new Array(7).fill(0);
  const dayPnL = new Array(7).fill(0);
  for (const t of tokens) {
    const d = new Date(t.firstTradeTime * 1000).getUTCDay();
    dayBuckets[d]++;
    dayPnL[d] += t.realizedProfit;
  }

  // Market cap distribution
  const withMcap = tokens.filter(t => t.estimatedBuyMcap != null);
  const mcapBins = [
    [0, 10000], [10000, 50000], [50000, 200000], [200000, 1000000],
    [1000000, 5000000], [5000000, Infinity],
  ];
  const mcapDist = mcapBins.map(([lo, hi]) => {
    const inBin = withMcap.filter(t => t.estimatedBuyMcap >= lo && (hi === Infinity || t.estimatedBuyMcap < hi));
    return {
      lo, hi, count: inBin.length,
      pnl: inBin.reduce((s, t) => s + t.realizedProfit, 0),
      avgROI: inBin.length > 0 ? inBin.reduce((s, t) => s + t.roi, 0) / inBin.length : 0,
    };
  }).filter(d => d.count > 0);

  // Launchpad breakdown
  const launchpadMap = {};
  for (const t of tokens) {
    const lp = t.launchpad || 'unknown';
    if (!launchpadMap[lp]) launchpadMap[lp] = { count: 0, pnl: 0, cost: 0 };
    launchpadMap[lp].count++;
    launchpadMap[lp].pnl += t.realizedProfit;
    launchpadMap[lp].cost += t.totalBoughtCost;
  }

  // Time range
  const allTimes = trades.map(a => a.timestamp);
  const minTime = allTimes.length > 0 ? Math.min(...allTimes) : 0;
  const maxTime = allTimes.length > 0 ? Math.max(...allTimes) : 0;

  return {
    sorted, withSells, winners, losers,
    pnlValues, totalRealizedPnL, winRate, avgWin, avgLoss, totalBuyCost,
    newTokens, oldTokens, newProfit, oldProfit, newBuyCost, oldBuyCost,
    newWithGap, gapDist,
    withHoldingTime, holdDist,
    buySizeDist,
    hourBuckets, hourPnL, dayBuckets, dayPnL, dayNames,
    mcapDist, launchpadMap,
    tradeCount: trades.length,
    buyCount: trades.filter(a => a.event_type === 'buy').length,
    sellCount: trades.filter(a => a.event_type === 'sell').length,
    uniqueTokens: tokens.length,
    minTime, maxTime,
    stats30d, stats7d, holdings,
  };
}

// ============ Phase 7: Generate Report ============

function generateReport(tokens, trades, a) {
  const L = [];
  const p = (s) => L.push(s);
  const now = new Date();

  p('');
  p('# Solana Wallet Trading Analysis Report');
  p('');
  p('- Wallet: `' + WALLET + '`');
  p('- Chain: Solana');
  p('- Analysis Date: ' + now.toISOString().split('T')[0]);
  p('- Data Source: GMGN OpenAPI');
  p('- Period: Last ' + TIME_WINDOW_DAYS + ' days');
  p('');

  // Section 1: Overview
  p('## 1. Wallet Overview');
  p('');

  // GMGN stats
  if (a.stats30d) {
    const s = a.stats30d;
    if (s.common) {
      const tags = s.common.tags ? s.common.tags.join(', ') : 'N/A';
      p('- GMGN Tags: ' + tags);
      if (s.common.twitter_username) p('- Twitter: @' + s.common.twitter_username);
    }
    if (s.realized_profit != null) p('- 30d Realized Profit: ' + fmtUSD(s.realized_profit));
    if (s.winrate != null) p('- 30d Win Rate: ' + fmtPct(s.winrate));
  }

  if (a.stats7d) {
    const s = a.stats7d;
    if (s.realized_profit != null) p('- 7d Realized Profit: ' + fmtUSD(s.realized_profit));
    if (s.winrate != null) p('- 7d Win Rate: ' + fmtPct(s.winrate));
  }

  p('');
  p('| Metric | Value |');
  p('|---|---|');
  p('| Total Trades (buy/sell) | ' + a.tradeCount + ' (' + a.buyCount + '/' + a.sellCount + ') |');
  p('| Unique Tokens | ' + a.uniqueTokens + ' |');
  p('| Date Range | ' + (a.minTime > 0 ? new Date(a.minTime * 1000).toISOString().split('T')[0] + ' ~ ' + new Date(a.maxTime * 1000).toISOString().split('T')[0] : 'N/A') + ' |');
  p('| Total Realized PnL | ' + fmtUSD(a.totalRealizedPnL) + ' |');
  p('| Total Buy Cost | $' + a.totalBuyCost.toFixed(0) + ' |');
  p('| Win Rate (tokens w/ sells) | ' + pct(a.winners.length, a.withSells.length) + ' (' + a.winners.length + '/' + a.withSells.length + ') |');
  p('');

  // Section 2: PnL Distribution
  p('## 2. PnL Distribution');
  p('');
  if (a.pnlValues.length > 0) {
    const pvals = a.pnlValues.slice().sort((x, y) => x - y);
    p('| Stat | Value |');
    p('|---|---|');
    p('| Best Trade | ' + fmtUSD(pvals[pvals.length - 1]) + ' |');
    p('| Worst Trade | ' + fmtUSD(pvals[0]) + ' |');
    p('| Average Win | ' + fmtUSD(a.avgWin) + ' |');
    p('| Average Loss | ' + fmtUSD(a.avgLoss) + ' |');
    p('| P25 | ' + fmtUSD(percentile(pvals, 0.25)) + ' |');
    p('| Median | ' + fmtUSD(percentile(pvals, 0.5)) + ' |');
    p('| P75 | ' + fmtUSD(percentile(pvals, 0.75)) + ' |');
    p('');
  }

  // Section 3: New vs Old Tokens
  p('## 3. New vs Old Token Breakdown');
  p('');
  p('New token = first trade within ' + NEW_TOKEN_THRESHOLD_HOURS + 'h of creation');
  p('');
  p('| Category | Count | Buy Cost | Realized PnL | Avg ROI | Win Rate |');
  p('|---|---|---|---|---|---|');
  for (const [label, set, cost] of [['New', a.newTokens, a.newBuyCost], ['Old', a.oldTokens, a.oldBuyCost]]) {
    const ws = set.filter(t => t.sells > 0);
    const wins = ws.filter(t => t.realizedProfit > 0);
    const pnl = set.reduce((s, t) => s + t.realizedProfit, 0);
    const avgROI = set.length > 0 ? set.reduce((s, t) => s + t.roi, 0) / set.length : 0;
    p('| ' + label + ' | ' + set.length + ' | $' + cost.toFixed(0) + ' | ' + fmtUSD(pnl) + ' | ' + fmtPct(avgROI) + ' | ' + pct(wins.length, ws.length) + ' |');
  }
  p('');

  // Section 4: Entry Speed
  p('## 4. New Token Entry Speed (First Trade After Creation)');
  p('');
  if (a.newWithGap.length > 0) {
    const gaps = a.newWithGap.map(t => t.gapSec).sort((x, y) => x - y);
    p('- Fastest: ' + fmtSec(gaps[0]));
    p('- Median: ' + fmtSec(gaps[Math.floor(gaps.length / 2)]));
    p('- Average: ' + fmtSec(gaps.reduce((s, v) => s + v, 0) / gaps.length));
    p('- Slowest: ' + fmtSec(gaps[gaps.length - 1]));
    p('');
    p('| Time After Creation | Tokens | Cumulative | PnL (USD) | Avg ROI |');
    p('|---|---|---|---|---|');
    for (const d of a.gapDist) {
      if (d.count === 0) continue;
      const label = d.hi <= 60 ? d.lo + '~' + d.hi + 's'
        : d.hi <= 3600 ? (d.lo / 60).toFixed(0) + '~' + (d.hi / 60).toFixed(0) + 'min'
        : d.hi <= 86400 ? (d.lo / 3600).toFixed(0) + '~' + (d.hi / 3600).toFixed(0) + 'h'
        : (d.lo / 3600).toFixed(0) + 'h+';
      const cumPct = pct(d.cum, a.newWithGap.length);
      const avgROI = d.cost > 0 ? (d.profit / d.cost * 100).toFixed(1) + '%' : 'N/A';
      p('| ' + label + ' | ' + d.count + ' | ' + cumPct + ' | ' + d.profit.toFixed(0) + ' | ' + avgROI + ' |');
    }
  } else {
    p('No new token data available.');
  }
  p('');

  // Section 5: Holding Time
  p('## 5. Holding Time Analysis');
  p('');
  if (a.holdDist.length > 0) {
    p('| Duration | Tokens | PnL (USD) | Avg ROI |');
    p('|---|---|---|---|');
    for (const d of a.holdDist) {
      const label = d.hi === Infinity ? '>' + fmtSec(d.lo)
        : fmtSec(d.lo) + '~' + fmtSec(d.hi);
      p('| ' + label + ' | ' + d.count + ' | ' + d.profit.toFixed(0) + ' | ' + fmtPct(d.avgROI) + ' |');
    }
  } else {
    p('No holding time data available.');
  }
  p('');

  // Section 6: Buy Size Distribution
  p('## 6. Buy Size Distribution (Per-Token Average)');
  p('');
  if (a.buySizeDist.length > 0) {
    p('| Buy Size Range (USD) | Tokens | PnL (USD) | Avg ROI |');
    p('|---|---|---|---|');
    for (const d of a.buySizeDist) {
      const label = d.hi === Infinity ? '>$' + (d.lo / 1000).toFixed(0) + 'k'
        : '$' + d.lo + '~$' + (d.hi === Infinity ? '+' : d.hi);
      p('| ' + label + ' | ' + d.count + ' | ' + d.pnl.toFixed(0) + ' | ' + fmtPct(d.avgROI) + ' |');
    }
  }
  p('');

  // Section 7: Time Patterns
  p('## 7. Trading Time Patterns (UTC)');
  p('');
  p('### Hourly Distribution');
  p('');
  p('| Hour | Tokens | PnL | Hour | Tokens | PnL |');
  p('|---|---|---|---|---|---|');
  for (let i = 0; i < 12; i++) {
    const h1 = i, h2 = i + 12;
    const c1 = a.hourBuckets[h1], p1 = a.hourPnL[h1];
    const c2 = a.hourBuckets[h2], p2 = a.hourPnL[h2];
    p('| ' + h1 + ':00 | ' + c1 + ' | ' + p1.toFixed(0) + ' | ' + h2 + ':00 | ' + c2 + ' | ' + p2.toFixed(0) + ' |');
  }
  p('');

  p('### Day-of-Week Distribution');
  p('');
  p('| Day | Tokens | PnL |');
  p('|---|---|---|');
  for (let i = 0; i < 7; i++) {
    p('| ' + a.dayNames[i] + ' | ' + a.dayBuckets[i] + ' | ' + a.dayPnL[i].toFixed(0) + ' |');
  }
  p('');

  // Section 8: Market Cap
  p('## 8. Market Cap at Entry');
  p('');
  if (a.mcapDist.length > 0) {
    p('| Market Cap Range | Tokens | PnL (USD) | Avg ROI |');
    p('|---|---|---|---|');
    for (const d of a.mcapDist) {
      const label = d.hi === Infinity ? '>$' + (d.lo / 1000000).toFixed(0) + 'M'
        : '$' + (d.lo / 1000).toFixed(0) + 'k~$' + (d.hi / 1000000).toFixed(1) + 'M';
      p('| ' + label + ' | ' + d.count + ' | ' + d.pnl.toFixed(0) + ' | ' + fmtPct(d.avgROI) + ' |');
    }
  } else {
    p('No market cap data available.');
  }
  p('');

  // Section 9: Launchpad
  p('## 9. Launchpad Breakdown');
  p('');
  if (Object.keys(a.launchpadMap).length > 0) {
    p('| Launchpad | Tokens | Buy Cost | PnL (USD) |');
    p('|---|---|---|---|');
    const lpEntries = Object.entries(a.launchpadMap).sort((a, b) => b[1].count - a[1].count);
    for (const [lp, d] of lpEntries) {
      p('| ' + lp + ' | ' + d.count + ' | $' + d.cost.toFixed(0) + ' | ' + d.pnl.toFixed(0) + ' |');
    }
  }
  p('');

  // Section 10: Top Profit / Loss
  p('## 10. Top 10 Profitable Tokens');
  p('');
  p('| # | Symbol | PnL | Buy Cost | ROI | Entry Speed | Hold Time | Launchpad |');
  p('|---|---|---|---|---|---|---|---|');
  for (let i = 0; i < Math.min(10, a.sorted.length); i++) {
    const t = a.sorted[i];
    const gap = t.gapSec != null ? fmtSec(t.gapSec) : '?';
    const hold = t.holdingTimeSec != null ? fmtSec(t.holdingTimeSec) : 'holding';
    p('| ' + (i + 1) + ' | ' + t.symbol + ' | ' + fmtUSD(t.realizedProfit) + ' | $' + t.totalBoughtCost.toFixed(0) + ' | ' + fmtPct(t.roi) + ' | ' + gap + ' | ' + hold + ' | ' + t.launchpad + ' |');
  }
  p('');

  p('## 11. Top 10 Losing Tokens');
  p('');
  p('| # | Symbol | PnL | Buy Cost | ROI | Entry Speed | Hold Time | Launchpad |');
  p('|---|---|---|---|---|---|---|---|');
  const losers = [...a.sorted].reverse();
  for (let i = 0; i < Math.min(10, losers.length); i++) {
    const t = losers[i];
    const gap = t.gapSec != null ? fmtSec(t.gapSec) : '?';
    const hold = t.holdingTimeSec != null ? fmtSec(t.holdingTimeSec) : 'holding';
    p('| ' + (i + 1) + ' | ' + t.symbol + ' | ' + fmtUSD(t.realizedProfit) + ' | $' + t.totalBoughtCost.toFixed(0) + ' | ' + fmtPct(t.roi) + ' | ' + gap + ' | ' + hold + ' | ' + t.launchpad + ' |');
  }
  p('');

  // Section 12: Current Holdings
  p('## 12. Current Holdings');
  p('');
  if (a.holdings && a.holdings.holdings && a.holdings.holdings.length > 0) {
    p('| Symbol | Value (USD) | Unrealized PnL | Cost Basis |');
    p('|---|---|---|---|');
    for (const h of a.holdings.holdings.slice(0, 20)) {
      const sym = h.token && h.token.symbol ? h.token.symbol : '?';
      const val = parseFloat(h.usd_value || h.value || 0);
      const upnl = parseFloat(h.unrealized_profit || 0);
      const cost = parseFloat(h.history_bought_cost || 0);
      p('| ' + sym + ' | $' + val.toFixed(2) + ' | ' + fmtUSD(upnl) + ' | $' + cost.toFixed(2) + ' |');
    }
    if (a.holdings.holdings.length > 20) p('\n... and ' + (a.holdings.holdings.length - 20) + ' more');
  } else {
    p('No current holdings data available.');
  }
  p('');

  // Section 13: Behavioral Summary
  p('## 13. Trading Style Summary');
  p('');

  const newPct = a.uniqueTokens > 0 ? (a.newTokens.length / a.uniqueTokens * 100).toFixed(0) : 0;
  const newWinPct = a.newTokens.filter(t => t.sells > 0 && t.realizedProfit > 0).length;
  const oldWinPct = a.oldTokens.filter(t => t.sells > 0 && t.realizedProfit > 0).length;
  const newWS = a.newTokens.filter(t => t.sells > 0);
  const oldWS = a.oldTokens.filter(t => t.sells > 0);

  p('- **New token ratio**: ' + newPct + '% of tokens are new (created <24h)');
  if (newWS.length > 0) p('- **New token win rate**: ' + pct(newWinPct, newWS.length));
  if (oldWS.length > 0) p('- **Old token win rate**: ' + pct(oldWinPct, oldWS.length));
  p('- **Profit source**: New=' + fmtUSD(a.newProfit) + ', Old=' + fmtUSD(a.oldProfit));

  if (a.newWithGap.length > 0) {
    const medianGap = a.newWithGap.map(t => t.gapSec).sort((x, y) => x - y)[Math.floor(a.newWithGap.length / 2)];
    p('- **Typical entry speed**: ' + fmtSec(medianGap) + ' after token creation');
  }

  if (a.withHoldingTime.length > 0) {
    const medianHold = a.withHoldingTime.map(t => t.holdingTimeSec).sort((x, y) => x - y)[Math.floor(a.withHoldingTime.length / 2)];
    p('- **Median holding time**: ' + fmtSec(medianHold));
  }

  const avgBuy = a.buyCount > 0 ? a.totalBuyCost / a.buyCount : 0;
  p('- **Average buy size**: $' + avgBuy.toFixed(0));

  // Best hour
  const bestHourIdx = a.hourPnL.indexOf(Math.max(...a.hourPnL));
  const worstHourIdx = a.hourPnL.indexOf(Math.min(...a.hourPnL));
  p('- **Best trading hour (UTC)**: ' + bestHourIdx + ':00 (PnL: ' + a.hourPnL[bestHourIdx].toFixed(0) + ')');
  p('- **Worst trading hour (UTC)**: ' + worstHourIdx + ':00 (PnL: ' + a.hourPnL[worstHourIdx].toFixed(0) + ')');

  p('');

  return L.join('\n');
}

// ============ Main ============

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (data.wallet === WALLET && data.timestamp > Date.now() / 1000 - 86400) {
        console.error('Loaded cached data from ' + new Date(data.timestamp * 1000).toISOString());
        return data;
      }
      console.error('Cache expired or wrong wallet, refetching...');
    }
  } catch (e) { console.error('Cache read error: ' + e.message); }
  return null;
}

function saveCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
    console.error('Cache saved to ' + CACHE_FILE);
  } catch (e) { console.error('Cache write error: ' + e.message); }
}

async function main() {
  // Try loading from cache first
  let cache = loadCache();
  let activities, stats30d, stats7d, holdings;

  if (cache) {
    activities = cache.activities;
    stats30d = cache.stats30d;
    stats7d = cache.stats7d;
    holdings = cache.holdings;
  } else {
    const portfolioApi = new GMGNPortfolioAPI({ apiKey: process.env.GMGN_API_KEY, timeout: 60000 });
    const tokenApi = new GMGNTokenAPI({ apiKey: process.env.GMGN_API_KEY, timeout: 60000 });
    await portfolioApi.init();
    await tokenApi.init();

    // Phase 1: Wallet metadata
    console.error('Fetching wallet stats...');
    try { stats30d = await portfolioApi.getWalletStats(CHAIN, [WALLET], '30d'); } catch (e) { console.error('  30d stats failed: ' + e.message.substring(0, 80)); }
    try { stats7d = await portfolioApi.getWalletStats(CHAIN, [WALLET], '7d'); } catch (e) { console.error('  7d stats failed: ' + e.message.substring(0, 80)); }

    console.error('Fetching holdings...');
    try { holdings = await portfolioApi.getWalletHoldings(CHAIN, WALLET); } catch (e) { console.error('  holdings failed: ' + e.message.substring(0, 80)); }

    // Phase 2: All activities
    activities = await fetchAllActivities(portfolioApi, WALLET);

    // Save to cache immediately after fetching
    saveCache({ wallet: WALLET, timestamp: Math.floor(Date.now() / 1000), activities, stats30d, stats7d, holdings });
  }

  console.error('Building token map...');
  const { tokens, trades } = buildTokenMap(activities);
  console.error('  unique tokens: ' + tokens.length + ', trades: ' + trades.length);

  // Phase 3: Creation times — only for top tokens by buy cost (to limit API calls)
  const CREATION_TIME_TOP_N = 500;
  const topByCost = [...tokens].sort((a, b) => b.totalBoughtCost - a.totalBoughtCost).slice(0, CREATION_TIME_TOP_N);
  const tokenApi = new GMGNTokenAPI({ apiKey: process.env.GMGN_API_KEY, timeout: 60000 });
  await tokenApi.init();
  const creationTimes = await fetchCreationTimes(tokenApi, topByCost.map(t => t.address));
  classifyTokens(tokens, creationTimes);

  // Phase 4: Security for top tokens
  const topByPnl = [...tokens].sort((a, b) => Math.abs(b.realizedProfit) - Math.abs(a.realizedProfit)).slice(0, SECURITY_TOP_N);
  const security = await fetchTokenSecurity(tokenApi, topByPnl.map(t => t.address));
  const secKeys = Object.keys(security);
  if (secKeys.length > 0) console.error('Security data obtained for ' + secKeys.length + ' tokens');

  // Phase 5: Analysis
  const a = analyze(tokens, trades, stats30d, stats7d, holdings);

  // Phase 6: Report
  const report = generateReport(tokens, trades, a);
  console.log(report);
}

main().catch(console.error);
