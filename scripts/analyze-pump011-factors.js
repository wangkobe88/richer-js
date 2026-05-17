/**
 * Pump011 预购买因子分析
 * 分析 preBuyCheckFactors 与交易收益的关系
 */

const { dbManager } = require('../src/services/dbManager');

const EXPERIMENT_ID = '799470d1-fb59-4280-ac96-38a1893b6d0e';

async function main() {
  const supabase = dbManager.getClient();

  // 1. 获取所有 BUY 信号（包含 preBuyCheckFactors）
  console.log('=== 获取 BUY 信号 ===');
  const allSignals = [];
  let offset = 0;
  const pageSize = 500;
  while (true) {
    const { data, error } = await supabase
      .from('strategy_signals')
      .select('id, token_address, token_symbol, metadata, created_at')
      .eq('experiment_id', EXPERIMENT_ID)
      .eq('signal_type', 'BUY')
      .range(offset, offset + pageSize - 1);
    if (error) { console.error('查询信号失败:', error); process.exit(1); }
    if (!data || data.length === 0) break;
    allSignals.push(...data);
    offset += pageSize;
    if (data.length < pageSize) break;
  }
  console.log(`BUY 信号总数: ${allSignals.length}`);

  // 2. 获取所有交易记录
  console.log('\n=== 获取交易记录 ===');
  const allTrades = [];
  offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('trades')
      .select('id, token_address, token_symbol, trade_direction, input_amount, output_amount, unit_price, metadata, signal_id, created_at')
      .eq('experiment_id', EXPERIMENT_ID)
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) { console.error('查询交易失败:', error); process.exit(1); }
    if (!data || data.length === 0) break;
    allTrades.push(...data);
    offset += pageSize;
    if (data.length < pageSize) break;
  }
  console.log(`交易总数: ${allTrades.length}`);

  // 3. 按 token 分组交易，计算每笔配对的收益
  const tradesByToken = {};
  for (const t of allTrades) {
    if (!tradesByToken[t.token_address]) tradesByToken[t.token_address] = { buys: [], sells: [] };
    if (t.trade_direction === 'buy') tradesByToken[t.token_address].buys.push(t);
    else tradesByToken[t.token_address].sells.push(t);
  }

  // 4. 构建 token -> 因子 + 收益 的映射
  const tokenResults = {};
  for (const [addr, group] of Object.entries(tradesByToken)) {
    if (group.buys.length === 0 || group.sells.length === 0) continue;

    const buy = group.buys[0];
    const sell = group.sells[group.sells.length - 1];

    // 计算收益
    const buyCost = buy.input_amount; // BNB 花费
    const sellReceived = sell.output_amount; // BNB 收回
    const pnl = sellReceived - buyCost;
    const pnlPct = (pnl / buyCost) * 100;

    // 获取因子（从 BUY 信号的 metadata）
    const signal = allSignals.find(s => s.token_address === addr);
    let factors = {};
    if (signal && signal.metadata) {
      factors = {
        ...(signal.metadata.preBuyCheckFactors || {}),
        ...(signal.metadata.trendFactors || {})
      };
    }

    tokenResults[addr] = {
      symbol: buy.token_symbol,
      pnl,
      pnlPct,
      factors,
      buyTime: buy.created_at,
      sellTime: sell.created_at
    };
  }

  const tokens = Object.values(tokenResults);
  const winTokens = tokens.filter(t => t.pnl > 0);
  const loseTokens = tokens.filter(t => t.pnl <= 0);
  console.log(`\n=== 交易概览 ===`);
  console.log(`有完整配对的代币: ${tokens.length}`);
  console.log(`盈利: ${winTokens.length} (${(winTokens.length / tokens.length * 100).toFixed(1)}%)`);
  console.log(`亏损: ${loseTokens.length} (${(loseTokens.length / tokens.length * 100).toFixed(1)}%)`);
  console.log(`总 PnL: ${tokens.reduce((s, t) => s + t.pnl, 0).toFixed(4)} SOL`);
  console.log(`平均收益: ${(tokens.reduce((s, t) => s + t.pnlPct, 0) / tokens.length).toFixed(2)}%`);

  // 5. 分析每个连续因子的区分度
  const continuousFactors = [
    'earlyTradesCountPerMin',
    'earlyTradesUniqueWallets',
    'earlyTradesDrawdownFromHighest',
    'earlyTradesVolumePerMin',
    'earlyTradesHighValuePerMin',
    'earlyTradesTotalCount',
    'earlyTradesVolume',
    'earlyTradesFinalLiquidity',
    'earlyTradesTop1BuyRatio',
    'earlyTradesTop3BuyRatio',
    'earlyTradesTop1NetHoldingRatio',
    'walletTop3VolumeRatio',
    'walletTop1VolumeRatio',
    'walletTop3TradeRatio',
    'walletTop1TradeRatio',
    'walletDiversityIndex',
    'oneShotBuyerRatio',
    'maxBlockBuyRatio',
    'drawdownFromHighest',
    'lastPairReturnRate',
    'buyRound',
    'gmgnTop10HolderRate',
    'gmgnLiquidity',
    'gmgnMarketCap',
    'gmgnSniperPercent',
    'gmgnBotPercent',
    'gmgnSmartMoneyPercent',
    'gmgnHolderCount',
    'trendRiseRatio',
    'trendDataPoints',
    'narrativeRating'
  ];

  console.log('\n========================================');
  console.log('=== 因子区分度分析 ===');
  console.log('========================================\n');

  for (const factorName of continuousFactors) {
    // 收集有该因子值的代币
    const withFactor = tokens.filter(t => t.factors[factorName] !== undefined && t.factors[factorName] !== null);
    if (withFactor.length < 20) {
      console.log(`--- ${factorName}: 只有 ${withFactor.length} 个有效值，跳过 ---`);
      continue;
    }

    const values = withFactor.map(t => ({
      value: parseFloat(t.factors[factorName]),
      pnl: t.pnl,
      pnlPct: t.pnlPct,
      win: t.pnl > 0
    })).filter(v => !isNaN(v.value));

    if (values.length < 20) continue;

    // 按 value 排序
    values.sort((a, b) => a.value - b.value);

    // 整体统计
    const allAvg = values.reduce((s, v) => s + v.pnlPct, 0) / values.length;
    const allWinRate = values.filter(v => v.win).length / values.length;

    // 按 4 分位分析
    const q1 = Math.floor(values.length * 0.25);
    const q2 = Math.floor(values.length * 0.5);
    const q3 = Math.floor(values.length * 0.75);

    const groups = [
      { name: 'Q1(低)', items: values.slice(0, q1) },
      { name: 'Q2', items: values.slice(q1, q2) },
      { name: 'Q3', items: values.slice(q2, q3) },
      { name: 'Q4(高)', items: values.slice(q3) }
    ];

    // 计算最佳分割点
    let bestThreshold = null;
    let bestDiff = 0;
    const uniqueValues = [...new Set(values.map(v => v.value))].sort((a, b) => a - b);

    // 尝试不同阈值，找到使高/低两组收益差最大的分割
    for (const threshold of uniqueValues) {
      const below = values.filter(v => v.value <= threshold);
      const above = values.filter(v => v.value > threshold);
      if (below.length < 10 || above.length < 10) continue;

      const belowAvg = below.reduce((s, v) => s + v.pnlPct, 0) / below.length;
      const aboveAvg = above.reduce((s, v) => s + v.pnlPct, 0) / above.length;
      const diff = Math.abs(aboveAvg - belowAvg);
      if (diff > bestDiff) {
        bestDiff = diff;
        bestThreshold = {
          value: threshold,
          belowCount: below.length,
          belowWinRate: (below.filter(v => v.win).length / below.length * 100).toFixed(1),
          belowAvgPnl: belowAvg.toFixed(2),
          aboveCount: above.length,
          aboveWinRate: (above.filter(v => v.win).length / above.length * 100).toFixed(1),
          aboveAvgPnl: aboveAvg.toFixed(2),
          direction: aboveAvg > belowAvg ? '越高越好' : '越低越好'
        };
      }
    }

    console.log(`\n--- ${factorName} (${values.length} 个有效值) ---`);
    console.log(`  全局: 胜率=${(allWinRate * 100).toFixed(1)}% 平均收益=${allAvg.toFixed(2)}%`);
    console.log(`  四分位:`);
    for (const g of groups) {
      if (g.items.length === 0) continue;
      const wr = (g.items.filter(v => v.win).length / g.items.length * 100).toFixed(1);
      const avgPnl = (g.items.reduce((s, v) => s + v.pnlPct, 0) / g.items.length).toFixed(2);
      const range = `[${g.items[0].value.toFixed(4)}, ${g.items[g.items.length - 1].value.toFixed(4)}]`;
      console.log(`    ${g.name} (n=${g.items.length}): 胜率=${wr}% 平均收益=${avgPnl}% 范围=${range}`);
    }
    if (bestThreshold) {
      console.log(`  最佳分割: ${bestThreshold.direction} 阈值=${bestThreshold.value}`);
      console.log(`    <=${bestThreshold.value} (n=${bestThreshold.belowCount}): 胜率=${bestThreshold.belowWinRate}% 收益=${bestThreshold.belowAvgPnl}%`);
      console.log(`    >${bestThreshold.value} (n=${bestThreshold.aboveCount}): 胜率=${bestThreshold.aboveWinRate}% 收益=${bestThreshold.aboveAvgPnl}%`);
      console.log(`    收益差: ${bestDiff.toFixed(2)}%`);
    }
  }

  // 6. 分析布尔/枚举因子
  console.log('\n\n========================================');
  console.log('=== 布尔/枚举因子分析 ===');
  console.log('========================================\n');

  const enumFactors = [
    'buyRound',
    'narrativeRating',
    'gmgnIsHoneypot',
    'gmgnIsOpenSource',
    'gmgnIsRenounced',
    'hasTwitter',
    'hasTelegram',
    'hasWebsite',
    'socialLinkCount'
  ];

  for (const factorName of enumFactors) {
    const withFactor = tokens.filter(t => t.factors[factorName] !== undefined && t.factors[factorName] !== null);
    if (withFactor.length < 10) continue;

    const groupMap = {};
    for (const t of withFactor) {
      const key = String(t.factors[factorName]);
      if (!groupMap[key]) groupMap[key] = [];
      groupMap[key].push(t);
    }

    console.log(`\n--- ${factorName} ---`);
    for (const [key, items] of Object.entries(groupMap).sort((a, b) => a[0].localeCompare(b[0]))) {
      const wr = (items.filter(t => t.pnl > 0).length / items.length * 100).toFixed(1);
      const avgPnl = (items.reduce((s, t) => s + t.pnlPct, 0) / items.length).toFixed(2);
      console.log(`  值=${key} (n=${items.length}): 胜率=${wr}% 平均收益=${avgPnl}%`);
    }
  }

  // 7. 综合分析：多因子组合筛选
  console.log('\n\n========================================');
  console.log('=== 多因子组合筛选分析 ===');
  console.log('========================================\n');

  // 基于单因子分析结果，尝试组合
  const combinations = [
    {
      name: '无筛选（基线）',
      filter: () => true
    },
    {
      name: 'earlyTradesCountPerMin < 100',
      filter: t => {
        const v = parseFloat(t.factors.earlyTradesCountPerMin);
        return !isNaN(v) && v < 100;
      }
    },
    {
      name: 'earlyTradesUniqueWallets < 50',
      filter: t => {
        const v = parseFloat(t.factors.earlyTradesUniqueWallets);
        return !isNaN(v) && v < 50;
      }
    },
    {
      name: 'earlyTradesDrawdownFromHighest > -10',
      filter: t => {
        const v = parseFloat(t.factors.earlyTradesDrawdownFromHighest);
        return !isNaN(v) && v > -10;
      }
    },
    {
      name: '交易数<100 AND 钱包数<50 AND 回撤>-10',
      filter: t => {
        const c = parseFloat(t.factors.earlyTradesCountPerMin);
        const w = parseFloat(t.factors.earlyTradesUniqueWallets);
        const d = parseFloat(t.factors.earlyTradesDrawdownFromHighest);
        return !isNaN(c) && c < 100 && !isNaN(w) && w < 50 && !isNaN(d) && d > -10;
      }
    },
    {
      name: 'walletDiversityIndex > 0.3',
      filter: t => {
        const v = parseFloat(t.factors.walletDiversityIndex);
        return !isNaN(v) && v > 0.3;
      }
    },
    {
      name: 'oneShotBuyerRatio > 20',
      filter: t => {
        const v = parseFloat(t.factors.oneShotBuyerRatio);
        return !isNaN(v) && v > 20;
      }
    },
    {
      name: 'walletTop3VolumeRatio < 40',
      filter: t => {
        const v = parseFloat(t.factors.walletTop3VolumeRatio);
        return !isNaN(v) && v < 40;
      }
    },
    {
      name: 'trendRiseRatio >= 0.5',
      filter: t => {
        const v = parseFloat(t.factors.trendRiseRatio);
        return !isNaN(v) && v >= 0.5;
      }
    },
    {
      name: 'trendRiseRatio >= 0.3',
      filter: t => {
        const v = parseFloat(t.factors.trendRiseRatio);
        return !isNaN(v) && v >= 0.3;
      }
    },
    {
      name: 'drawdownFromHighest > -5',
      filter: t => {
        const v = parseFloat(t.factors.drawdownFromHighest);
        return !isNaN(v) && v > -5;
      }
    },
    {
      name: 'lastPairReturnRate 80~120',
      filter: t => {
        const v = parseFloat(t.factors.lastPairReturnRate);
        return !isNaN(v) && v >= 80 && v <= 120;
      }
    },
    {
      name: 'lastPairReturnRate 60~150',
      filter: t => {
        const v = parseFloat(t.factors.lastPairReturnRate);
        return !isNaN(v) && v >= 60 && v <= 150;
      }
    },
    {
      name: '交易数<100 AND 回撤>-10 AND riseRatio>=0.3',
      filter: t => {
        const c = parseFloat(t.factors.earlyTradesCountPerMin);
        const d = parseFloat(t.factors.earlyTradesDrawdownFromHighest);
        const r = parseFloat(t.factors.trendRiseRatio);
        return !isNaN(c) && c < 100 && !isNaN(d) && d > -10 && !isNaN(r) && r >= 0.3;
      }
    },
    {
      name: '交易数<100 AND 钱包数<50 AND 回撤>-10 AND riseRatio>=0.3',
      filter: t => {
        const c = parseFloat(t.factors.earlyTradesCountPerMin);
        const w = parseFloat(t.factors.earlyTradesUniqueWallets);
        const d = parseFloat(t.factors.earlyTradesDrawdownFromHighest);
        const r = parseFloat(t.factors.trendRiseRatio);
        return !isNaN(c) && c < 100 && !isNaN(w) && w < 50 && !isNaN(d) && d > -10 && !isNaN(r) && r >= 0.3;
      }
    },
    {
      name: '交易数<100 AND 回撤>-10 AND riseRatio>=0.5',
      filter: t => {
        const c = parseFloat(t.factors.earlyTradesCountPerMin);
        const d = parseFloat(t.factors.earlyTradesDrawdownFromHighest);
        const r = parseFloat(t.factors.trendRiseRatio);
        return !isNaN(c) && c < 100 && !isNaN(d) && d > -10 && !isNaN(r) && r >= 0.5;
      }
    },
    {
      name: '钱包数<50 AND 回撤>-10 AND riseRatio>=0.3',
      filter: t => {
        const w = parseFloat(t.factors.earlyTradesUniqueWallets);
        const d = parseFloat(t.factors.earlyTradesDrawdownFromHighest);
        const r = parseFloat(t.factors.trendRiseRatio);
        return !isNaN(w) && w < 50 && !isNaN(d) && d > -10 && !isNaN(r) && r >= 0.3;
      }
    },
    {
      name: '交易数<100 AND 回撤>-10 AND riseRatio>=0.3 AND diversity>0.3',
      filter: t => {
        const c = parseFloat(t.factors.earlyTradesCountPerMin);
        const d = parseFloat(t.factors.earlyTradesDrawdownFromHighest);
        const r = parseFloat(t.factors.trendRiseRatio);
        const di = parseFloat(t.factors.walletDiversityIndex);
        return !isNaN(c) && c < 100 && !isNaN(d) && d > -10 && !isNaN(r) && r >= 0.3 && !isNaN(di) && di > 0.3;
      }
    }
  ];

  for (const combo of combinations) {
    const filtered = tokens.filter(combo.filter);
    if (filtered.length === 0) continue;

    const totalPnl = filtered.reduce((s, t) => s + t.pnl, 0);
    const winRate = (filtered.filter(t => t.pnl > 0).length / filtered.length * 100).toFixed(1);
    const avgPnlPct = (filtered.reduce((s, t) => s + t.pnlPct, 0) / filtered.length).toFixed(2);
    const filteredOut = tokens.length - filtered.length;
    const precision = filtered.filter(t => t.pnl > 0).length;
    const recall = precision / winTokens.length * 100;

    console.log(`${combo.name}`);
    console.log(`  代币数=${filtered.length}/${tokens.length} (过滤${filteredOut}个)`);
    console.log(`  胜率=${winRate}% 总PnL=${totalPnl.toFixed(4)} SOL 平均收益=${avgPnlPct}%`);
    console.log(`  精确率=${precision}/${filtered.length} 召回率=${recall.toFixed(1)}%`);
    console.log();
  }

  // 8. 最佳因子的精细阈值搜索
  console.log('\n========================================');
  console.log('=== 精细阈值搜索 ===');
  console.log('========================================\n');

  // 对 top 因子做更细粒度的阈值搜索
  const topFactors = ['earlyTradesCountPerMin', 'earlyTradesDrawdownFromHighest', 'trendRiseRatio', 'earlyTradesUniqueWallets', 'walletDiversityIndex', 'lastPairReturnRate'];

  for (const factorName of topFactors) {
    const withFactor = tokens.filter(t => t.factors[factorName] !== undefined && t.factors[factorName] !== null);
    if (withFactor.length < 20) continue;

    const values = withFactor.map(t => ({
      value: parseFloat(t.factors[factorName]),
      pnlPct: t.pnlPct,
      win: t.pnl > 0
    })).filter(v => !isNaN(v.value)).sort((a, b) => a.value - b.value);

    console.log(`\n--- ${factorName} 阈值搜索 ---`);

    // 尝试 10 个等分位阈值
    const percentiles = [10, 20, 30, 40, 50, 60, 70, 80, 90];
    for (const p of percentiles) {
      const idx = Math.floor(values.length * p / 100);
      if (idx <= 0 || idx >= values.length) continue;
      const threshold = values[idx].value;

      const below = values.slice(0, idx);
      const above = values.slice(idx);

      const belowWR = (below.filter(v => v.win).length / below.length * 100).toFixed(1);
      const belowAvg = (below.reduce((s, v) => s + v.pnlPct, 0) / below.length).toFixed(2);
      const aboveWR = (above.filter(v => v.win).length / above.length * 100).toFixed(1);
      const aboveAvg = (above.reduce((s, v) => s + v.pnlPct, 0) / above.length).toFixed(2);

      console.log(`  P${p} (${threshold.toFixed(4)}): 以下 n=${below.length} WR=${belowWR}% AvgPnL=${belowAvg}% | 以上 n=${above.length} WR=${aboveWR}% AvgPnL=${aboveAvg}%`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
