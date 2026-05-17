/**
 * Pump011 深度因子分析 — 聚焦有区分度的因子
 * 1. gmgnHolderCount（强区分度）
 * 2. gmgnTop10HolderRate
 * 3. earlyTradesDrawdownFromHighest
 * 4. earlyTradesVolume（底部过滤）
 * 5. earlyTradesFinalLiquidity（底部过滤）
 * 6. 组合筛选优化
 */

const { dbManager } = require('../src/services/dbManager');

const EXPERIMENT_ID = '799470d1-fb59-4280-ac96-38a1893b6d0e';

async function main() {
  const supabase = dbManager.getClient();

  // 获取所有 BUY 信号
  const allSignals = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('strategy_signals')
      .select('id, token_address, token_symbol, metadata, created_at')
      .eq('experiment_id', EXPERIMENT_ID)
      .eq('signal_type', 'BUY')
      .range(offset, offset + 499);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    allSignals.push(...data);
    offset += 500;
    if (data.length < 500) break;
  }

  // 获取所有交易
  const allTrades = [];
  offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('trades')
      .select('id, token_address, token_symbol, trade_direction, input_amount, output_amount, metadata, signal_id, created_at')
      .eq('experiment_id', EXPERIMENT_ID)
      .order('created_at', { ascending: true })
      .range(offset, offset + 499);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    allTrades.push(...data);
    offset += 500;
    if (data.length < 500) break;
  }

  // 配对计算收益
  const tradesByToken = {};
  for (const t of allTrades) {
    if (!tradesByToken[t.token_address]) tradesByToken[t.token_address] = { buys: [], sells: [] };
    if (t.trade_direction === 'buy') tradesByToken[t.token_address].buys.push(t);
    else tradesByToken[t.token_address].sells.push(t);
  }

  const tokens = [];
  for (const [addr, group] of Object.entries(tradesByToken)) {
    if (group.buys.length === 0 || group.sells.length === 0) continue;
    const buy = group.buys[0];
    const sell = group.sells[group.sells.length - 1];
    const pnl = sell.output_amount - buy.input_amount;
    const pnlPct = (pnl / buy.input_amount) * 100;

    const signal = allSignals.find(s => s.token_address === addr);
    let factors = {};
    if (signal && signal.metadata) {
      factors = {
        ...(signal.metadata.preBuyCheckFactors || {}),
        ...(signal.metadata.trendFactors || {})
      };
    }
    tokens.push({ addr, symbol: buy.token_symbol, pnl, pnlPct, factors });
  }

  console.log(`总代币: ${tokens.length}, 盈利: ${tokens.filter(t => t.pnl > 0).length}, 亏损: ${tokens.filter(t => t.pnl <= 0).length}\n`);

  // ========== 深度分析 1: gmgnHolderCount ==========
  console.log('==========================================');
  console.log('=== 1. gmgnHolderCount 深度分析 ===');
  console.log('==========================================\n');

  const withHolder = tokens.filter(t => t.factors.gmgnHolderCount !== undefined && t.factors.gmgnHolderCount !== null);
  // 逐值分析
  const holderGroups = {};
  for (const t of withHolder) {
    const v = t.factors.gmgnHolderCount;
    const key = v;
    if (!holderGroups[key]) holderGroups[key] = [];
    holderGroups[key].push(t);
  }

  for (const [val, items] of Object.entries(holderGroups).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const wr = (items.filter(t => t.pnl > 0).length / items.length * 100).toFixed(1);
    const avgPnl = (items.reduce((s, t) => s + t.pnlPct, 0) / items.length).toFixed(2);
    const totalPnl = items.reduce((s, t) => s + t.pnl, 0).toFixed(4);
    console.log(`  holderCount=${val} (n=${items.length}): 胜率=${wr}% 平均收益=${avgPnl}% 总PnL=${totalPnl} SOL`);
  }

  // 按范围分析
  console.log('\n  按范围:');
  const ranges = [
    { name: '1', min: 1, max: 1 },
    { name: '2', min: 2, max: 2 },
    { name: '3-5', min: 3, max: 5 },
    { name: '6-10', min: 6, max: 10 },
    { name: '11+', min: 11, max: 999999 }
  ];
  for (const r of ranges) {
    const items = withHolder.filter(t => Number(t.factors.gmgnHolderCount) >= r.min && Number(t.factors.gmgnHolderCount) <= r.max);
    if (items.length === 0) continue;
    const wr = (items.filter(t => t.pnl > 0).length / items.length * 100).toFixed(1);
    const avgPnl = (items.reduce((s, t) => s + t.pnlPct, 0) / items.length).toFixed(2);
    const totalPnl = items.reduce((s, t) => s + t.pnl, 0).toFixed(4);
    console.log(`  ${r.name} (n=${items.length}): 胜率=${wr}% 平均收益=${avgPnl}% 总PnL=${totalPnl} SOL`);
  }

  // ========== 深度分析 2: earlyTradesDrawdownFromHighest ==========
  console.log('\n\n==========================================');
  console.log('=== 2. earlyTradesDrawdownFromHighest 深度分析 ===');
  console.log('==========================================\n');

  const withDD = tokens.filter(t => t.factors.earlyTradesDrawdownFromHighest !== undefined);
  const ddValues = withDD.map(t => ({ ...t, dd: parseFloat(t.factors.earlyTradesDrawdownFromHighest) })).filter(t => !isNaN(t.dd));

  const ddRanges = [
    { name: '>=0 (无回撤)', min: 0, max: 100 },
    { name: '0~-5', min: -5, max: 0 },
    { name: '-5~-10', min: -10, max: -5 },
    { name: '-10~-20', min: -20, max: -10 },
    { name: '-20~-50', min: -50, max: -20 },
    { name: '<-50', min: -100, max: -50 },
  ];
  for (const r of ddRanges) {
    const items = ddValues.filter(t => t.dd >= r.min && t.dd < r.max);
    if (items.length === 0) continue;
    const wr = (items.filter(t => t.pnl > 0).length / items.length * 100).toFixed(1);
    const avgPnl = (items.reduce((s, t) => s + t.pnlPct, 0) / items.length).toFixed(2);
    const totalPnl = items.reduce((s, t) => s + t.pnl, 0).toFixed(4);
    console.log(`  ${r.name} (n=${items.length}): 胜率=${wr}% 平均收益=${avgPnl}% 总PnL=${totalPnl} SOL`);
  }

  // ========== 深度分析 3: earlyTradesVolume 底部过滤 ==========
  console.log('\n\n==========================================');
  console.log('=== 3. earlyTradesVolume 底部过滤分析 ===');
  console.log('==========================================\n');

  const withVol = tokens.filter(t => t.factors.earlyTradesVolume !== undefined);
  const volValues = withVol.map(t => ({ ...t, vol: parseFloat(t.factors.earlyTradesVolume) })).filter(t => !isNaN(t.vol)).sort((a, b) => a.vol - b.vol);

  const volThresholds = [20, 50, 80, 100, 150, 200, 300];
  for (const th of volThresholds) {
    const below = volValues.filter(t => t.vol <= th);
    const above = volValues.filter(t => t.vol > th);
    if (below.length === 0 || above.length === 0) continue;
    const bWR = (below.filter(t => t.pnl > 0).length / below.length * 100).toFixed(1);
    const bAvg = (below.reduce((s, t) => s + t.pnlPct, 0) / below.length).toFixed(2);
    const aWR = (above.filter(t => t.pnl > 0).length / above.length * 100).toFixed(1);
    const aAvg = (above.reduce((s, t) => s + t.pnlPct, 0) / above.length).toFixed(2);
    console.log(`  阈值=${th}: 以下 n=${below.length} WR=${bWR}% Avg=${bAvg}% | 以上 n=${above.length} WR=${aWR}% Avg=${aAvg}%`);
  }

  // ========== 深度分析 4: earlyTradesFinalLiquidity 底部过滤 ==========
  console.log('\n\n==========================================');
  console.log('=== 4. earlyTradesFinalLiquidity 底部过滤分析 ===');
  console.log('==========================================\n');

  const withLiq = tokens.filter(t => t.factors.earlyTradesFinalLiquidity !== undefined);
  const liqValues = withLiq.map(t => ({ ...t, liq: parseFloat(t.factors.earlyTradesFinalLiquidity) })).filter(t => !isNaN(t.liq)).sort((a, b) => a.liq - b.liq);

  const liqThresholds = [5, 10, 20, 30, 50, 100, 200];
  for (const th of liqThresholds) {
    const below = liqValues.filter(t => t.liq <= th);
    const above = liqValues.filter(t => t.liq > th);
    if (below.length === 0 || above.length === 0) continue;
    const bWR = (below.filter(t => t.pnl > 0).length / below.length * 100).toFixed(1);
    const bAvg = (below.reduce((s, t) => s + t.pnlPct, 0) / below.length).toFixed(2);
    const aWR = (above.filter(t => t.pnl > 0).length / above.length * 100).toFixed(1);
    const aAvg = (above.reduce((s, t) => s + t.pnlPct, 0) / above.length).toFixed(2);
    console.log(`  阈值=${th}: 以下 n=${below.length} WR=${bWR}% Avg=${bAvg}% | 以上 n=${above.length} WR=${aWR}% Avg=${aAvg}%`);
  }

  // ========== 深度分析 5: 组合筛选优化 ==========
  console.log('\n\n==========================================');
  console.log('=== 5. 组合筛选优化 ===');
  console.log('==========================================\n');

  function evaluate(name, filter) {
    const filtered = tokens.filter(filter);
    if (filtered.length === 0) return;
    const totalPnl = filtered.reduce((s, t) => s + t.pnl, 0);
    const winRate = (filtered.filter(t => t.pnl > 0).length / filtered.length * 100).toFixed(1);
    const avgPnl = (filtered.reduce((s, t) => s + t.pnlPct, 0) / filtered.length).toFixed(2);
    const wins = filtered.filter(t => t.pnl > 0).length;
    console.log(`${name}`);
    console.log(`  n=${filtered.length}/${tokens.length} 胜率=${winRate}% 总PnL=${totalPnl.toFixed(4)} SOL 平均=${avgPnl}% 精确率=${wins}/${filtered.length}`);
  }

  // 基于 gmgnHolderCount 的筛选
  evaluate('gmgnHolderCount >= 3', t => Number(t.factors.gmgnHolderCount) >= 3);
  evaluate('gmgnHolderCount >= 2', t => Number(t.factors.gmgnHolderCount) >= 2);

  // 基于 earlyTradesDrawdownFromHighest 的筛选
  evaluate('earlyTradesDrawdownFromHighest > -5', t => parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5);
  evaluate('earlyTradesDrawdownFromHighest > -1', t => parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -1);
  evaluate('earlyTradesDrawdownFromHighest >= 0', t => parseFloat(t.factors.earlyTradesDrawdownFromHighest) >= 0);

  // 组合1: gmgnHolderCount + drawdown
  evaluate('gmgnHolderCount>=3 AND drawdown>-5', t => Number(t.factors.gmgnHolderCount) >= 3 && parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5);
  evaluate('gmgnHolderCount>=3 AND drawdown>-10', t => Number(t.factors.gmgnHolderCount) >= 3 && parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -10);
  evaluate('gmgnHolderCount>=2 AND drawdown>-5', t => Number(t.factors.gmgnHolderCount) >= 2 && parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5);

  // 组合2: volume + drawdown + holderCount
  evaluate('volume>50 AND drawdown>-5', t => parseFloat(t.factors.earlyTradesVolume) > 50 && parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5);
  evaluate('volume>50 AND drawdown>-10', t => parseFloat(t.factors.earlyTradesVolume) > 50 && parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -10);
  evaluate('volume>80 AND drawdown>-5', t => parseFloat(t.factors.earlyTradesVolume) > 80 && parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5);

  // 组合3: liquidity + drawdown
  evaluate('liquidity>30 AND drawdown>-5', t => parseFloat(t.factors.earlyTradesFinalLiquidity) > 30 && parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5);
  evaluate('liquidity>50 AND drawdown>-5', t => parseFloat(t.factors.earlyTradesFinalLiquidity) > 50 && parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5);
  evaluate('liquidity>30 AND drawdown>-10', t => parseFloat(t.factors.earlyTradesFinalLiquidity) > 30 && parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -10);

  // 组合4: 三因子
  evaluate('holderCount>=3 AND drawdown>-5 AND volume>50', t =>
    Number(t.factors.gmgnHolderCount) >= 3 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5 &&
    parseFloat(t.factors.earlyTradesVolume) > 50
  );
  evaluate('holderCount>=3 AND drawdown>-5 AND liquidity>30', t =>
    Number(t.factors.gmgnHolderCount) >= 3 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5 &&
    parseFloat(t.factors.earlyTradesFinalLiquidity) > 30
  );
  evaluate('holderCount>=3 AND drawdown>-10 AND volume>50', t =>
    Number(t.factors.gmgnHolderCount) >= 3 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -10 &&
    parseFloat(t.factors.earlyTradesVolume) > 50
  );
  evaluate('holderCount>=3 AND drawdown>-10 AND liquidity>30', t =>
    Number(t.factors.gmgnHolderCount) >= 3 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -10 &&
    parseFloat(t.factors.earlyTradesFinalLiquidity) > 30
  );

  // 组合5: 加入 countPerMin
  evaluate('holderCount>=3 AND drawdown>-5 AND countPerMin<100', t =>
    Number(t.factors.gmgnHolderCount) >= 3 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -5 &&
    parseFloat(t.factors.earlyTradesCountPerMin) < 100
  );
  evaluate('holderCount>=3 AND drawdown>-10 AND countPerMin<100', t =>
    Number(t.factors.gmgnHolderCount) >= 3 &&
    parseFloat(t.factors.earlyTradesDrawdownFromHighest) > -10 &&
    parseFloat(t.factors.earlyTradesCountPerMin) < 100
  );

  // 组合6: holderCount + top10HolderRate
  evaluate('holderCount>=3 AND gmgnTop10HolderRate>0.0002', t =>
    Number(t.factors.gmgnHolderCount) >= 3 &&
    parseFloat(t.factors.gmgnTop10HolderRate) > 0.0002
  );
  evaluate('holderCount>=2 AND gmgnTop10HolderRate>0', t =>
    Number(t.factors.gmgnHolderCount) >= 2 &&
    parseFloat(t.factors.gmgnTop10HolderRate) > 0
  );

  // ========== 6. gmgnTop10HolderRate 分析 ==========
  console.log('\n\n==========================================');
  console.log('=== 6. gmgnTop10HolderRate 深度分析 ===');
  console.log('==========================================\n');

  const withTop10 = tokens.filter(t => t.factors.gmgnTop10HolderRate !== undefined);
  const top10Values = withTop10.map(t => ({ ...t, top10: parseFloat(t.factors.gmgnTop10HolderRate) })).filter(t => !isNaN(t.top10)).sort((a, b) => a.top10 - b.top10);

  // 检查值的分布
  const zeroCount = top10Values.filter(t => t.top10 === 0).length;
  const nonZeroCount = top10Values.filter(t => t.top10 > 0).length;
  console.log(`  值=0: ${zeroCount} 个, 值>0: ${nonZeroCount} 个`);

  if (nonZeroCount > 10) {
    const nonZero = top10Values.filter(t => t.top10 > 0);
    const nzWR = (nonZero.filter(t => t.pnl > 0).length / nonZero.length * 100).toFixed(1);
    const nzAvg = (nonZero.reduce((s, t) => s + t.pnlPct, 0) / nonZero.length).toFixed(2);
    const z = top10Values.filter(t => t.top10 === 0);
    const zWR = (z.filter(t => t.pnl > 0).length / z.length * 100).toFixed(1);
    const zAvg = (z.reduce((s, t) => s + t.pnlPct, 0) / z.length).toFixed(2);
    console.log(`  top10=0: n=${z.length} WR=${zWR}% Avg=${zAvg}%`);
    console.log(`  top10>0: n=${nonZero.length} WR=${nzWR}% Avg=${nzAvg}%`);
  }

  // ========== 7. socialLinkCount ==========
  console.log('\n\n==========================================');
  console.log('=== 7. 社交链接分析 ===');
  console.log('==========================================\n');

  evaluate('socialLinkCount=0 (无社交链接)', t => Number(t.factors.socialLinkCount) === 0);
  evaluate('socialLinkCount>=1 (有社交链接)', t => Number(t.factors.socialLinkCount) >= 1);
  evaluate('socialLinkCount>=2', t => Number(t.factors.socialLinkCount) >= 2);

  // ========== 8. 负相关因子：谁在亏钱 ==========
  console.log('\n\n==========================================');
  console.log('=== 8. 亏损特征分析 ===');
  console.log('==========================================\n');

  const losers = tokens.filter(t => t.pnl <= 0);
  const winners = tokens.filter(t => t.pnl > 0);

  const compareFactors = ['earlyTradesCountPerMin', 'earlyTradesUniqueWallets', 'earlyTradesDrawdownFromHighest',
    'earlyTradesVolume', 'earlyTradesFinalLiquidity', 'gmgnHolderCount', 'gmgnTop10HolderRate',
    'walletTop3VolumeRatio', 'walletDiversityIndex', 'oneShotBuyerRatio', 'maxBlockBuyRatio',
    'earlyTradesTop1BuyRatio', 'earlyTradesTop3BuyRatio'];

  console.log('因子       | 盈利组均值 | 亏损组均值 | 差值');
  console.log('-----------|-----------|-----------|------');
  for (const f of compareFactors) {
    const wVals = winners.map(t => parseFloat(t.factors[f])).filter(v => !isNaN(v));
    const lVals = losers.map(t => parseFloat(t.factors[f])).filter(v => !isNaN(v));
    if (wVals.length < 10 || lVals.length < 10) continue;
    const wAvg = wVals.reduce((s, v) => s + v, 0) / wVals.length;
    const lAvg = lVals.reduce((s, v) => s + v, 0) / lVals.length;
    const diff = wAvg - lAvg;
    console.log(`${f.padEnd(40)} | ${wAvg.toFixed(4).padStart(10)} | ${lAvg.toFixed(4).padStart(10)} | ${diff >= 0 ? '+' : ''}${diff.toFixed(4)}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
