/**
 * Pump011 增量因子分析
 * 在最佳基线条件上，逐个添加/替换因子，看增量价值
 */

const { dbManager } = require('../src/services/dbManager');
const EXPERIMENT_ID = '799470d1-fb59-4280-ac96-38a1893b6d0e';

async function main() {
  const supabase = dbManager.getClient();

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

  function ev(name, filter) {
    const f = tokens.filter(filter);
    if (f.length === 0) return { name, n: 0 };
    const tp = f.reduce((s, t) => s + t.pnl, 0);
    const wr = (f.filter(t => t.pnl > 0).length / f.length * 100);
    const ap = (f.reduce((s, t) => s + t.pnlPct, 0) / f.length);
    const w = f.filter(t => t.pnl > 0).length;
    return { name, n: f.length, wr, totalPnl: tp, avgPnl: ap, wins: w };
  }

  function printResult(r) {
    if (r.n === 0) return;
    console.log(`  ${r.name}`);
    console.log(`    n=${r.n} WR=${r.wr.toFixed(1)}% 总PnL=${r.totalPnl.toFixed(4)} SOL 平均=${r.avgPnl.toFixed(2)}% 精确率=${r.wins}/${r.n}`);
  }

  // 辅助函数：安全解析
  const f = (t, name) => { const v = parseFloat(t.factors[name]); return isNaN(v) ? null : v; };

  console.log(`总代币: ${tokens.length}\n`);

  // ===== 基线条件 =====
  const BASE = t => f(t, 'earlyTradesTotalCount') >= 18 && f(t, 'earlyTradesDrawdownFromHighest') > -5 && f(t, 'earlyTradesVolume') > 50 && f(t, 'earlyTradesCountPerMin') < 100;

  console.log('========================================');
  console.log('=== 基线条件 ===');
  console.log('========================================\n');
  printResult(ev('totalCount>=18 AND drawdown>-5 AND volume>50 AND countPerMin<100', BASE));

  // ===== 1. 在基线上逐个添加钱包集中度因子 =====
  console.log('\n========================================');
  console.log('=== 1. 钱包集中度因子增量测试 ===');
  console.log('========================================\n');

  // walletTop3VolumeRatio
  for (const th of [30, 40, 50, 60, 70, 80, 90]) {
    printResult(ev(`基线 AND walletTop3VolumeRatio<${th}`, t => BASE(t) && f(t, 'walletTop3VolumeRatio') < th));
  }
  console.log();
  for (const th of [50, 60, 70, 80, 90, 95, 100]) {
    printResult(ev(`基线 AND walletTop3VolumeRatio>${th}`, t => BASE(t) && f(t, 'walletTop3VolumeRatio') > th));
  }

  // walletTop1VolumeRatio
  console.log('\n  --- walletTop1VolumeRatio ---');
  for (const th of [20, 30, 40, 50, 60, 70]) {
    printResult(ev(`基线 AND walletTop1VolumeRatio<${th}`, t => BASE(t) && f(t, 'walletTop1VolumeRatio') < th));
  }

  // walletTop3TradeRatio
  console.log('\n  --- walletTop3TradeRatio ---');
  for (const th of [30, 40, 50, 60, 70, 80]) {
    printResult(ev(`基线 AND walletTop3TradeRatio<${th}`, t => BASE(t) && f(t, 'walletTop3TradeRatio') < th));
  }

  // walletTop1TradeRatio
  console.log('\n  --- walletTop1TradeRatio ---');
  for (const th of [20, 30, 40, 50, 60]) {
    printResult(ev(`基线 AND walletTop1TradeRatio<${th}`, t => BASE(t) && f(t, 'walletTop1TradeRatio') < th));
  }

  // walletDiversityIndex
  console.log('\n  --- walletDiversityIndex ---');
  for (const th of [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5]) {
    printResult(ev(`基线 AND walletDiversityIndex>${th}`, t => BASE(t) && f(t, 'walletDiversityIndex') > th));
  }

  // oneShotBuyerRatio
  console.log('\n  --- oneShotBuyerRatio ---');
  for (const th of [10, 20, 25, 30, 40, 50]) {
    printResult(ev(`基线 AND oneShotBuyerRatio>${th}`, t => BASE(t) && f(t, 'oneShotBuyerRatio') > th));
  }
  for (const th of [10, 20, 25, 30, 40, 50]) {
    printResult(ev(`基线 AND oneShotBuyerRatio<${th}`, t => BASE(t) && f(t, 'oneShotBuyerRatio') < th));
  }

  // maxBlockBuyRatio
  console.log('\n  --- maxBlockBuyRatio ---');
  for (const th of [0.01, 0.03, 0.05, 0.1, 0.15, 0.2, 0.3]) {
    printResult(ev(`基线 AND maxBlockBuyRatio<${th}`, t => BASE(t) && f(t, 'maxBlockBuyRatio') < th));
  }
  for (const th of [0.01, 0.03, 0.05, 0.1, 0.15, 0.2]) {
    printResult(ev(`基线 AND maxBlockBuyRatio>${th}`, t => BASE(t) && f(t, 'maxBlockBuyRatio') > th));
  }

  // ===== 2. 在基线上添加 trend 因子 =====
  console.log('\n\n========================================');
  console.log('=== 2. Trend 因子增量测试 ===');
  console.log('========================================\n');

  for (const th of [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9]) {
    printResult(ev(`基线 AND trendRiseRatio>=${th}`, t => BASE(t) && f(t, 'trendRiseRatio') >= th));
  }
  console.log();
  for (const th of [5, 6, 7, 8]) {
    printResult(ev(`基线 AND trendDataPoints>=${th}`, t => BASE(t) && f(t, 'trendDataPoints') >= th));
  }
  console.log();
  for (const th of [-20, -10, -5, -1, 0]) {
    printResult(ev(`基线 AND drawdownFromHighest>${th}`, t => BASE(t) && f(t, 'drawdownFromHighest') > th));
  }

  // ===== 3. 在基线上添加 earlyTrades 细节因子 =====
  console.log('\n\n========================================');
  console.log('=== 3. EarlyTrades 细节因子增量测试 ===');
  console.log('========================================\n');

  // uniqueWallets
  for (const th of [3, 4, 5, 6, 8, 10]) {
    printResult(ev(`基线 AND uniqueWallets>=${th}`, t => BASE(t) && f(t, 'earlyTradesUniqueWallets') >= th));
  }

  // volumePerMin
  console.log('\n  --- earlyTradesVolumePerMin ---');
  for (const th of [50, 100, 200, 300, 500, 1000, 2000, 5000]) {
    printResult(ev(`基线 AND volumePerMin>${th}`, t => BASE(t) && f(t, 'earlyTradesVolumePerMin') > th));
  }
  for (const th of [50, 100, 200, 500, 1000]) {
    printResult(ev(`基线 AND volumePerMin<${th}`, t => BASE(t) && f(t, 'earlyTradesVolumePerMin') < th));
  }

  // highValuePerMin
  console.log('\n  --- earlyTradesHighValuePerMin ---');
  for (const th of [0, 1, 2, 5, 10, 20]) {
    printResult(ev(`基线 AND highValuePerMin>${th}`, t => BASE(t) && f(t, 'earlyTradesHighValuePerMin') > th));
  }

  // finalLiquidity
  console.log('\n  --- earlyTradesFinalLiquidity ---');
  for (const th of [30, 50, 100, 200, 500, 1000]) {
    printResult(ev(`基线 AND finalLiquidity>${th}`, t => BASE(t) && f(t, 'earlyTradesFinalLiquidity') > th));
  }

  // ===== 4. 因子替换测试：去掉某个基线因子看影响 =====
  console.log('\n\n========================================');
  console.log('=== 4. 因子消融测试（去掉某个看影响）===');
  console.log('========================================\n');

  printResult(ev('基线（完整）', BASE));
  console.log();

  // 去掉 totalCount
  printResult(ev('去掉totalCount（只保留 drawdown>-5 AND volume>50 AND countPerMin<100）',
    t => f(t, 'earlyTradesDrawdownFromHighest') > -5 && f(t, 'earlyTradesVolume') > 50 && f(t, 'earlyTradesCountPerMin') < 100));
  // 去掉 drawdown
  printResult(ev('去掉drawdown（只保留 totalCount>=18 AND volume>50 AND countPerMin<100）',
    t => f(t, 'earlyTradesTotalCount') >= 18 && f(t, 'earlyTradesVolume') > 50 && f(t, 'earlyTradesCountPerMin') < 100));
  // 去掉 volume
  printResult(ev('去掉volume（只保留 totalCount>=18 AND drawdown>-5 AND countPerMin<100）',
    t => f(t, 'earlyTradesTotalCount') >= 18 && f(t, 'earlyTradesDrawdownFromHighest') > -5 && f(t, 'earlyTradesCountPerMin') < 100));
  // 去掉 countPerMin
  printResult(ev('去掉countPerMin（只保留 totalCount>=18 AND drawdown>-5 AND volume>50）',
    t => f(t, 'earlyTradesTotalCount') >= 18 && f(t, 'earlyTradesDrawdownFromHighest') > -5 && f(t, 'earlyTradesVolume') > 50));

  // ===== 5. 社交链接因子 =====
  console.log('\n\n========================================');
  console.log('=== 5. 社交链接因子增量测试 ===');
  console.log('========================================\n');

  printResult(ev('基线 AND socialLinkCount=0', t => BASE(t) && Number(t.factors.socialLinkCount) === 0));
  printResult(ev('基线 AND socialLinkCount>=1', t => BASE(t) && Number(t.factors.socialLinkCount) >= 1));
  printResult(ev('基线 AND hasTwitter=false', t => BASE(t) && t.factors.hasTwitter === false));
  printResult(ev('基线 AND hasTwitter=true', t => BASE(t) && t.factors.hasTwitter === true));

  // ===== 6. 最佳增量因子组合 =====
  console.log('\n\n========================================');
  console.log('=== 6. 最佳增量因子组合 ===');
  console.log('========================================\n');

  // 基于上面结果，尝试最有希望的增量组合
  printResult(ev('基线 AND uniqueWallets>=5', t => BASE(t) && f(t, 'earlyTradesUniqueWallets') >= 5));
  printResult(ev('基线 AND walletTop3VolumeRatio<80', t => BASE(t) && f(t, 'walletTop3VolumeRatio') < 80));
  printResult(ev('基线 AND walletTop1TradeRatio<60', t => BASE(t) && f(t, 'walletTop1TradeRatio') < 60));
  printResult(ev('基线 AND finalLiquidity>100', t => BASE(t) && f(t, 'earlyTradesFinalLiquidity') > 100));
  printResult(ev('基线 AND highValuePerMin>2', t => BASE(t) && f(t, 'earlyTradesHighValuePerMin') > 2));
  printResult(ev('基线 AND volumePerMin>200', t => BASE(t) && f(t, 'earlyTradesVolumePerMin') > 200));
  printResult(ev('基线 AND maxBlockBuyRatio>0.03', t => BASE(t) && f(t, 'maxBlockBuyRatio') > 0.03));

  // 双增量
  console.log('\n  --- 双增量 ---');
  printResult(ev('基线 AND uniqueWallets>=5 AND walletTop3VolumeRatio<80',
    t => BASE(t) && f(t, 'earlyTradesUniqueWallets') >= 5 && f(t, 'walletTop3VolumeRatio') < 80));
  printResult(ev('基线 AND uniqueWallets>=5 AND finalLiquidity>100',
    t => BASE(t) && f(t, 'earlyTradesUniqueWallets') >= 5 && f(t, 'earlyTradesFinalLiquidity') > 100));
  printResult(ev('基线 AND walletTop3VolumeRatio<80 AND finalLiquidity>100',
    t => BASE(t) && f(t, 'walletTop3VolumeRatio') < 80 && f(t, 'earlyTradesFinalLiquidity') > 100));
  printResult(ev('基线 AND uniqueWallets>=5 AND highValuePerMin>2',
    t => BASE(t) && f(t, 'earlyTradesUniqueWallets') >= 5 && f(t, 'earlyTradesHighValuePerMin') > 2));
  printResult(ev('基线 AND uniqueWallets>=5 AND volumePerMin>200',
    t => BASE(t) && f(t, 'earlyTradesUniqueWallets') >= 5 && f(t, 'earlyTradesVolumePerMin') > 200));

  // ===== 7. 完全替代方案 =====
  console.log('\n\n========================================');
  console.log('=== 7. 替代方案（不用 volume 和 countPerMin）===');
  console.log('========================================\n');

  printResult(ev('totalCount>=25 AND drawdown>-5 AND uniqueWallets>=5',
    t => f(t, 'earlyTradesTotalCount') >= 25 && f(t, 'earlyTradesDrawdownFromHighest') > -5 && f(t, 'earlyTradesUniqueWallets') >= 5));
  printResult(ev('totalCount>=25 AND drawdown>-5 AND walletTop3VolumeRatio<80',
    t => f(t, 'earlyTradesTotalCount') >= 25 && f(t, 'earlyTradesDrawdownFromHighest') > -5 && f(t, 'walletTop3VolumeRatio') < 80));
  printResult(ev('totalCount>=25 AND drawdown>-5 AND finalLiquidity>100',
    t => f(t, 'earlyTradesTotalCount') >= 25 && f(t, 'earlyTradesDrawdownFromHighest') > -5 && f(t, 'earlyTradesFinalLiquidity') > 100));
  printResult(ev('totalCount>=25 AND uniqueWallets>=5 AND walletTop3VolumeRatio<80',
    t => f(t, 'earlyTradesTotalCount') >= 25 && f(t, 'earlyTradesUniqueWallets') >= 5 && f(t, 'walletTop3VolumeRatio') < 80));
  printResult(ev('totalCount>=25 AND uniqueWallets>=5 AND drawdown>-5 AND walletTop3VolumeRatio<80',
    t => f(t, 'earlyTradesTotalCount') >= 25 && f(t, 'earlyTradesUniqueWallets') >= 5 && f(t, 'earlyTradesDrawdownFromHighest') > -5 && f(t, 'walletTop3VolumeRatio') < 80));
  printResult(ev('totalCount>=25 AND uniqueWallets>=5 AND drawdown>-5 AND finalLiquidity>100',
    t => f(t, 'earlyTradesTotalCount') >= 25 && f(t, 'earlyTradesUniqueWallets') >= 5 && f(t, 'earlyTradesDrawdownFromHighest') > -5 && f(t, 'earlyTradesFinalLiquidity') > 100));
  printResult(ev('totalCount>=18 AND uniqueWallets>=5 AND drawdown>-5 AND walletTop3VolumeRatio<80',
    t => f(t, 'earlyTradesTotalCount') >= 18 && f(t, 'earlyTradesUniqueWallets') >= 5 && f(t, 'earlyTradesDrawdownFromHighest') > -5 && f(t, 'walletTop3VolumeRatio') < 80));
  printResult(ev('totalCount>=18 AND uniqueWallets>=5 AND drawdown>-5 AND walletTop1TradeRatio<50',
    t => f(t, 'earlyTradesTotalCount') >= 18 && f(t, 'earlyTradesUniqueWallets') >= 5 && f(t, 'earlyTradesDrawdownFromHighest') > -5 && f(t, 'walletTop1TradeRatio') < 50));

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
