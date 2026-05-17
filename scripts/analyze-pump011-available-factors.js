/**
 * Pump011 因子分析 — 只用时间点可获取的因子
 * 排除 gmgn 实时数据，聚焦 earlyTrades + walletCluster + trend 因子
 */

const { dbManager } = require('../src/services/dbManager');
const EXPERIMENT_ID = '799470d1-fb59-4280-ac96-38a1893b6d0e';

async function main() {
  const supabase = dbManager.getClient();

  // 获取信号和交易
  const allSignals = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase.from('strategy_signals').select('id, token_address, token_symbol, metadata')
      .eq('experiment_id', EXPERIMENT_ID).eq('signal_type', 'BUY').range(offset, offset + 499);
    if (!data || data.length === 0) break;
    allSignals.push(...data); offset += 500; if (data.length < 500) break;
  }

  const allTrades = [];
  offset = 0;
  while (true) {
    const { data } = await supabase.from('trades')
      .select('token_address, token_symbol, trade_direction, input_amount, output_amount')
      .eq('experiment_id', EXPERIMENT_ID).order('created_at', { ascending: true }).range(offset, offset + 499);
    if (!data || data.length === 0) break;
    allTrades.push(...data); offset += 500; if (data.length < 500) break;
  }

  // 配对
  const byToken = {};
  for (const t of allTrades) {
    if (!byToken[t.token_address]) byToken[t.token_address] = { buys: [], sells: [] };
    if (t.trade_direction === 'buy') byToken[t.token_address].buys.push(t);
    else byToken[t.token_address].sells.push(t);
  }

  const tokens = [];
  for (const [addr, g] of Object.entries(byToken)) {
    if (g.buys.length === 0 || g.sells.length === 0) continue;
    const buy = g.buys[0], sell = g.sells[g.sells.length - 1];
    const pnl = sell.output_amount - buy.input_amount;
    const pnlPct = (pnl / buy.input_amount) * 100;
    const sig = allSignals.find(s => s.token_address === addr);
    const factors = sig?.metadata ? { ...(sig.metadata.preBuyCheckFactors || {}), ...(sig.metadata.trendFactors || {}) } : {};
    tokens.push({ addr, symbol: buy.token_symbol, pnl, pnlPct, factors });
  }

  const wins = tokens.filter(t => t.pnl > 0).length;
  console.log(`总代币: ${tokens.length}, 盈利: ${wins}, 亏损: ${tokens.length - wins}`);
  console.log(`总 PnL: ${tokens.reduce((s, t) => s + t.pnl, 0).toFixed(4)} SOL\n`);

  // === 1. earlyTradesTotalCount（早期交易总数，等价于参与者数的代理）===
  console.log('====================================================');
  console.log('=== 1. earlyTradesTotalCount（早期交易总数）===');
  console.log('====================================================\n');

  const withTC = tokens.map(t => ({ ...t, tc: parseFloat(t.factors.earlyTradesTotalCount) })).filter(t => !isNaN(t.tc));
  withTC.sort((a, b) => a.tc - b.tc);

  // 逐值
  const tcGroups = {};
  for (const t of withTC) {
    const key = t.tc;
    if (!tcGroups[key]) tcGroups[key] = [];
    tcGroups[key].push(t);
  }

  // 按范围分析
  const tcRanges = [
    { name: '3-10', min: 3, max: 10 },
    { name: '11-17', min: 11, max: 17 },
    { name: '18-25', min: 18, max: 25 },
    { name: '26-40', min: 26, max: 40 },
    { name: '41-60', min: 41, max: 60 },
    { name: '61-100', min: 61, max: 100 },
    { name: '101-200', min: 101, max: 200 },
    { name: '201+', min: 201, max: 999999 },
  ];
  for (const r of tcRanges) {
    const items = withTC.filter(t => t.tc >= r.min && t.tc <= r.max);
    if (items.length === 0) continue;
    const wr = (items.filter(t => t.pnl > 0).length / items.length * 100).toFixed(1);
    const avgPnl = (items.reduce((s, t) => s + t.pnlPct, 0) / items.length).toFixed(2);
    const totalPnl = items.reduce((s, t) => s + t.pnl, 0).toFixed(4);
    console.log(`  ${r.name.padEnd(12)} (n=${items.length}): 胜率=${wr.padStart(5)}% 平均=${avgPnl.padStart(7)}% 总PnL=${totalPnl} SOL`);
  }

  // 精细阈值
  console.log('\n  阈值搜索:');
  const tcThresholds = [10, 15, 17, 20, 25, 30, 40, 50, 60, 80, 100];
  for (const th of tcThresholds) {
    const below = withTC.filter(t => t.tc < th);
    const above = withTC.filter(t => t.tc >= th);
    if (below.length === 0 || above.length === 0) continue;
    const bWR = (below.filter(t => t.pnl > 0).length / below.length * 100).toFixed(1);
    const bAvg = (below.reduce((s, t) => s + t.pnlPct, 0) / below.length).toFixed(2);
    const aWR = (above.filter(t => t.pnl > 0).length / above.length * 100).toFixed(1);
    const aAvg = (above.reduce((s, t) => s + t.pnlPct, 0) / above.length).toFixed(2);
    console.log(`    <${th}: n=${below.length} WR=${bWR}% Avg=${bAvg}% | >=${th}: n=${above.length} WR=${aWR}% Avg=${aAvg}%`);
  }

  // === 2. earlyTradesUniqueWallets（独立钱包数）===
  console.log('\n\n====================================================');
  console.log('=== 2. earlyTradesUniqueWallets（独立钱包数）===');
  console.log('====================================================\n');

  const withUW = tokens.map(t => ({ ...t, uw: parseFloat(t.factors.earlyTradesUniqueWallets) })).filter(t => !isNaN(t.uw));
  withUW.sort((a, b) => a.uw - b.uw);

  const uwRanges = [
    { name: '1-2', min: 1, max: 2 },
    { name: '3-4', min: 3, max: 4 },
    { name: '5-7', min: 5, max: 7 },
    { name: '8-13', min: 8, max: 13 },
    { name: '14-25', min: 14, max: 25 },
    { name: '26-50', min: 26, max: 50 },
    { name: '51+', min: 51, max: 999999 },
  ];
  for (const r of uwRanges) {
    const items = withUW.filter(t => t.uw >= r.min && t.uw <= r.max);
    if (items.length === 0) continue;
    const wr = (items.filter(t => t.pnl > 0).length / items.length * 100).toFixed(1);
    const avgPnl = (items.reduce((s, t) => s + t.pnlPct, 0) / items.length).toFixed(2);
    const totalPnl = items.reduce((s, t) => s + t.pnl, 0).toFixed(4);
    console.log(`  ${r.name.padEnd(12)} (n=${items.length}): 胜率=${wr.padStart(5)}% 平均=${avgPnl.padStart(7)}% 总PnL=${totalPnl} SOL`);
  }

  console.log('\n  阈值搜索:');
  const uwThresholds = [2, 3, 4, 5, 6, 8, 10, 13, 15, 20, 30, 50];
  for (const th of uwThresholds) {
    const below = withUW.filter(t => t.uw < th);
    const above = withUW.filter(t => t.uw >= th);
    if (below.length === 0 || above.length === 0) continue;
    const bWR = (below.filter(t => t.pnl > 0).length / below.length * 100).toFixed(1);
    const bAvg = (below.reduce((s, t) => s + t.pnlPct, 0) / below.length).toFixed(2);
    const aWR = (above.filter(t => t.pnl > 0).length / above.length * 100).toFixed(1);
    const aAvg = (above.reduce((s, t) => s + t.pnlPct, 0) / above.length).toFixed(2);
    console.log(`    <${th}: n=${below.length} WR=${bWR}% Avg=${bAvg}% | >=${th}: n=${above.length} WR=${aWR}% Avg=${aAvg}%`);
  }

  // === 3. 重新组合分析（不用 gmgn 实时因子）===
  console.log('\n\n====================================================');
  console.log('=== 3. 组合筛选（仅时间点可获取因子）===');
  console.log('====================================================\n');

  function ev(name, filter) {
    const f = tokens.filter(filter);
    if (f.length === 0) return;
    const tp = f.reduce((s, t) => s + t.pnl, 0);
    const wr = (f.filter(t => t.pnl > 0).length / f.length * 100).toFixed(1);
    const ap = (f.reduce((s, t) => s + t.pnlPct, 0) / f.length).toFixed(2);
    const w = f.filter(t => t.pnl > 0).length;
    console.log(`${name}`);
    console.log(`  n=${f.length}/${tokens.length} WR=${wr}% 总PnL=${tp.toFixed(4)} SOL 平均=${ap}% 精确率=${w}/${f.length}\n`);
  }

  // 基线
  ev('【基线】无筛选', () => true);

  // 单因子
  ev('totalCount >= 18', t => parseFloat(t.factors.earlyTradesTotalCount) >= 18);
  ev('totalCount >= 25', t => parseFloat(t.factors.earlyTradesTotalCount) >= 25);
  ev('uniqueWallets >= 5', t => parseFloat(t.factors.earlyTradesUniqueWallets) >= 5);
  ev('uniqueWallets >= 4', t => parseFloat(t.factors.earlyTradesUniqueWallets) >= 4);
  ev('uniqueWallets >= 3', t => parseFloat(t.factors.earlyTradesUniqueWallets) >= 3);

  // 双因子
  ev('totalCount>=18 AND drawdown>-5', t =>
    parseFloat(t.factors.earlyTradesTotalCount) >= 18 && parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5);
  ev('totalCount>=18 AND drawdown>-10', t =>
    parseFloat(t.factors.earlyTradesTotalCount) >= 18 && parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -10);
  ev('uniqueWallets>=5 AND drawdown>-5', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 5 && parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5);
  ev('uniqueWallets>=4 AND drawdown>-5', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 4 && parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5);
  ev('uniqueWallets>=3 AND drawdown>-5', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 3 && parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5);
  ev('totalCount>=18 AND volume>80', t =>
    parseFloat(t.factors.earlyTradesTotalCount) >= 18 && parseFloat(t.factors.earlyTradesVolume) > 80);
  ev('uniqueWallets>=5 AND volume>80', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 5 && parseFloat(t.factors.earlyTradesVolume) > 80);

  // 三因子
  ev('totalCount>=18 AND drawdown>-5 AND countPerMin<100', t =>
    parseFloat(t.factors.earlyTradesTotalCount) >= 18 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5 &&
    parseFloat(t.factors.earlyTradesCountPerMin) < 100);
  ev('uniqueWallets>=5 AND drawdown>-5 AND countPerMin<100', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 5 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5 &&
    parseFloat(t.factors.earlyTradesCountPerMin) < 100);
  ev('uniqueWallets>=4 AND drawdown>-5 AND countPerMin<100', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 4 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5 &&
    parseFloat(t.factors.earlyTradesCountPerMin) < 100);
  ev('uniqueWallets>=3 AND drawdown>-5 AND countPerMin<100', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 3 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5 &&
    parseFloat(t.factors.earlyTradesCountPerMin) < 100);
  ev('totalCount>=18 AND drawdown>-5 AND volume>50', t =>
    parseFloat(t.factors.earlyTradesTotalCount) >= 18 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5 &&
    parseFloat(t.factors.earlyTradesVolume) > 50);
  ev('uniqueWallets>=5 AND drawdown>-5 AND volume>50', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 5 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5 &&
    parseFloat(t.factors.earlyTradesVolume) > 50);
  ev('uniqueWallets>=4 AND drawdown>-5 AND volume>50', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 4 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5 &&
    parseFloat(t.factors.earlyTradesVolume) > 50);
  ev('uniqueWallets>=3 AND drawdown>-5 AND volume>50', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 3 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5 &&
    parseFloat(t.factors.earlyTradesVolume) > 50);

  // 四因子
  ev('uniqueWallets>=4 AND drawdown>-5 AND volume>50 AND countPerMin<100', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 4 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5 &&
    parseFloat(t.factors.earlyTradesVolume) > 50 &&
    parseFloat(t.factors.earlyTradesCountPerMin) < 100);
  ev('uniqueWallets>=3 AND drawdown>-5 AND volume>50 AND countPerMin<100', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 3 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5 &&
    parseFloat(t.factors.earlyTradesVolume) > 50 &&
    parseFloat(t.factors.earlyTradesCountPerMin) < 100);
  ev('totalCount>=18 AND drawdown>-5 AND volume>50 AND countPerMin<100', t =>
    parseFloat(t.factors.earlyTradesTotalCount) >= 18 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5 &&
    parseFloat(t.factors.earlyTradesVolume) > 50 &&
    parseFloat(t.factors.earlyTradesCountPerMin) < 100);

  // 加入 walletDiversityIndex
  ev('uniqueWallets>=4 AND drawdown>-5 AND diversity>0.15', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 4 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5 &&
    parseFloat(t.factors.walletDiversityIndex) > 0.15);
  ev('uniqueWallets>=4 AND drawdown>-5 AND walletTop3VolumeRatio<60', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 4 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5 &&
    parseFloat(t.factors.walletTop3VolumeRatio) < 60);

  // 加入 drawdownFromHighest (trend)
  ev('uniqueWallets>=4 AND drawdown>-5 AND trendDrawdown>-10', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 4 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5 &&
    parseFloat(t.factors.drawdownFromHighest) > -10);

  // 加入 liquidity
  ev('uniqueWallets>=4 AND drawdown>-5 AND liquidity>50', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 4 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5 &&
    parseFloat(t.factors.earlyTradesFinalLiquidity) > 50);
  ev('uniqueWallets>=4 AND drawdown>-5 AND liquidity>30', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 4 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5 &&
    parseFloat(t.factors.earlyTradesFinalLiquidity) > 30);

  // === 4. uniqueWallets + totalCount 相关性 ===
  console.log('\n\n====================================================');
  console.log('=== 4. uniqueWallets vs totalCount 对比 ===');
  console.log('====================================================\n');

  // 哪个是更好的 holderCount 代理？
  ev('uniqueWallets>=3 AND totalCount>=18', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 3 && parseFloat(t.factors.earlyTradesTotalCount) >= 18);
  ev('uniqueWallets>=4 AND totalCount>=18', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 4 && parseFloat(t.factors.earlyTradesTotalCount) >= 18);
  ev('uniqueWallets>=5 AND totalCount>=18', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 5 && parseFloat(t.factors.earlyTradesTotalCount) >= 18);
  ev('uniqueWallets>=3 AND totalCount>=25', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 3 && parseFloat(t.factors.earlyTradesTotalCount) >= 25);
  ev('uniqueWallets>=4 AND totalCount>=25', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 4 && parseFloat(t.factors.earlyTradesTotalCount) >= 25);
  ev('uniqueWallets>=5 AND totalCount>=25', t =>
    parseFloat(t.factors.earlyTradesUniqueWallets) >= 5 && parseFloat(t.factors.earlyTradesTotalCount) >= 25);

  // === 5. 所有可用因子的盈亏组对比 ===
  console.log('\n\n====================================================');
  console.log('=== 5. 盈亏组因子对比（仅时间点可获取因子）===');
  console.log('====================================================\n');

  const w = tokens.filter(t => t.pnl > 0);
  const l = tokens.filter(t => t.pnl <= 0);

  const factors = [
    'earlyTradesTotalCount', 'earlyTradesUniqueWallets', 'earlyTradesCountPerMin',
    'earlyTradesVolumePerMin', 'earlyTradesHighValuePerMin', 'earlyTradesVolume',
    'earlyTradesFinalLiquidity', 'earlyTradesDrawdownFromHighest',
    'walletTop3VolumeRatio', 'walletTop1VolumeRatio', 'walletTop3TradeRatio',
    'walletTop1TradeRatio', 'walletDiversityIndex', 'oneShotBuyerRatio',
    'maxBlockBuyRatio', 'drawdownFromHighest', 'trendRiseRatio', 'trendDataPoints'
  ];

  console.log('因子'.padEnd(42) + '| 盈利组均值  | 亏损组均值  | 差值');
  console.log('-'.repeat(80));
  for (const f of factors) {
    const wv = w.map(t => parseFloat(t.factors[f])).filter(v => !isNaN(v));
    const lv = l.map(t => parseFloat(t.factors[f])).filter(v => !isNaN(v));
    if (wv.length < 10 || lv.length < 10) continue;
    const wa = wv.reduce((s, v) => s + v, 0) / wv.length;
    const la = lv.reduce((s, v) => s + v, 0) / lv.length;
    const d = wa - la;
    console.log(`${f.padEnd(42)}| ${wa.toFixed(4).padStart(11)} | ${la.toFixed(4).padStart(11)} | ${d >= 0 ? '+' : ''}${d.toFixed(4)}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
