/**
 * 钱包深度分析 — 结合钱包质量指标 + 早期交易行为
 * 基于 Pump012 (0d364d3f) 实验
 */

const { dbManager } = require('../src/services/dbManager');
const EXPERIMENT_ID = '0d364d3f-06ae-46ff-bf5b-fd51c90fe66d';

async function main() {
  const supabase = dbManager.getClient();

  // === 1. 加载钱包标签 + 质量指标 ===
  const wallets = [];
  let wOffset = 0;
  while (true) {
    const { data } = await supabase.from('wallets').select('*').eq('chain', 'solana').range(wOffset, wOffset + 999);
    if (!data || data.length === 0) break;
    wallets.push(...data); wOffset += 1000; if (data.length < 1000) break;
  }

  const walletInfo = {};
  for (const w of wallets) {
    const fullAddr = w.details?.wallet_address || w.address;
    if (!fullAddr) continue;
    walletInfo[fullAddr] = {
      category: w.category,
      tags: w.details?.common?.tags || [],
      winrate: w.winrate || 0,
      realizedProfit: parseFloat(w.realized_profit) || 0,
      realizedProfitPnl: parseFloat(w.details?.realized_profit_pnl) || 0,
      buyCount: w.buy_count || 0,
      sellCount: w.sell_count || 0,
      tokenCount: w.token_count || 0,
      avgHoldingPeriod: w.avg_holding_period || 0,
      fundAmount: parseFloat(w.details?.common?.fund_amount) || 0,
      createdTokenCount: w.details?.common?.created_token_count || 0,
      followersCount: w.details?.common?.followers_count || 0,
      walletCreatedAt: w.wallet_created_at,
      pnl2x5x: w.details?.pnl_stat?.pnl_2x_5x_num || 0,
      pnlGt5x: w.details?.pnl_stat?.pnl_gt_5x_num || 0,
      pnlLtN50: w.details?.pnl_stat?.pnl_lt_nd5_num || 0,
    };
  }
  console.log(`钱包标签库: ${wallets.length} 个，有效地址: ${Object.keys(walletInfo).length}`);

  // === 2. 获取交易配对 ===
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

  // === 3. 加载早期交易数据并分析钱包行为 ===
  console.log('加载早期交易数据...');
  const earlyTrades = [];
  let eOffset = 0;
  while (true) {
    const { data } = await supabase.from('early_participant_trades')
      .select('token_address, trades_data')
      .eq('experiment_id', EXPERIMENT_ID).range(eOffset, eOffset + 49);
    if (!data || data.length === 0) break;
    earlyTrades.push(...data); eOffset += 50; if (data.length < 50) break;
  }
  console.log(`early_participant_trades: ${earlyTrades.length} 条`);

  // === 4. 按代币聚合钱包行为 ===
  for (const t of tokens) {
    const etRecords = earlyTrades.filter(e => e.token_address === t.addr);
    if (etRecords.length === 0) continue;

    // 汇总该 token 的所有早期交易
    const allEarlyTrades = [];
    for (const et of etRecords) {
      if (Array.isArray(et.trades_data)) allEarlyTrades.push(...et.trades_data);
    }

    // 按钱包聚合
    const walletBehavior = {};
    for (const trade of allEarlyTrades) {
      const wa = trade.wallet_address;
      if (!wa) continue;
      if (!walletBehavior[wa]) walletBehavior[wa] = { buys: 0, sells: 0, buyUsd: 0, sellUsd: 0 };
      const isBuy = trade.from_token === 'So11111111111111111111111111111111111111112' || trade.from_token_symbol === 'SOL';
      if (isBuy) {
        walletBehavior[wa].buys++;
        walletBehavior[wa].buyUsd += trade.from_usd || 0;
      } else {
        walletBehavior[wa].sells++;
        walletBehavior[wa].sellUsd += trade.to_usd || 0;
      }
    }

    // 匹配钱包标签 + 计算
    const labeled = [];
    for (const [wa, behav] of Object.entries(walletBehavior)) {
      const info = walletInfo[wa];
      if (info) {
        labeled.push({
          ...behav,
          ...info,
          address: wa,
          netBuy: behav.buyUsd - behav.sellUsd,
          isOnlyBuy: behav.buys > 0 && behav.sells === 0,
          isFlipper: behav.buys > 0 && behav.sells > 0,
        });
      }
    }

    // 总体指标
    t.earlyWalletCount = Object.keys(walletBehavior).length;
    t.totalEarlyBuys = allEarlyTrades.filter(tr => tr.from_token === 'So11111111111111111111111111111111111111112' || tr.from_token_symbol === 'SOL').length;
    t.totalEarlySells = allEarlyTrades.length - t.totalEarlyBuys;

    // 钱包标签基础
    t.labeledCount = labeled.length;
    t.hasAxiom = labeled.some(w => w.category === 'axiom');
    t.hasPhoton = labeled.some(w => w.category === 'photon');
    t.hasFresh = labeled.some(w => w.category === 'fresh_wallet');
    t.hasGmgn = labeled.some(w => w.category === 'gmgn');
    t.hasTop = labeled.some(w => w.category === 'top_renamed');
    t.hasBotTool = labeled.some(w => ['axiom', 'photon', 'bullx'].includes(w.category));

    if (labeled.length > 0) {
      // === 钱包质量指标 ===
      t.avgWalletWinrate = labeled.reduce((s, w) => s + w.winrate, 0) / labeled.length;
      t.profitableWalletRatio = labeled.filter(w => w.realizedProfit > 0).length / labeled.length;
      t.avgWalletProfit = labeled.reduce((s, w) => s + w.realizedProfit, 0) / labeled.length;
      t.avgWalletBuyCount = labeled.reduce((s, w) => s + w.buyCount, 0) / labeled.length;
      t.avgWalletTokenCount = labeled.reduce((s, w) => s + w.tokenCount, 0) / labeled.length;
      t.avgWalletHoldingPeriod = labeled.reduce((s, w) => s + w.avgHoldingPeriod, 0) / labeled.length;
      t.maxWalletWinrate = Math.max(...labeled.map(w => w.winrate));
      t.walletsWithHighWR = labeled.filter(w => w.winrate >= 0.5).length;
      t.ratioHighWR = t.walletsWithHighWR / labeled.length;

      // 经验指标
      t.experiencedWalletRatio = labeled.filter(w => w.buyCount >= 500).length / labeled.length;
      t.avgFundAmount = labeled.reduce((s, w) => s + w.fundAmount, 0) / labeled.length;
      t.avgCreatedTokens = labeled.reduce((s, w) => s + w.createdTokenCount, 0) / labeled.length;
      t.hasTokenCreator = labeled.some(w => w.createdTokenCount > 0);
      t.tokenCreatorCount = labeled.filter(w => w.createdTokenCount > 0).length;

      // 大赢/大输
      t.walletsWithBigWins = labeled.filter(w => w.pnl2x5x + w.pnlGt5x > 0).length;
      t.walletsWithBigLosses = labeled.filter(w => w.pnlLtN50 > 3).length;

      // === 早期交易行为指标 ===
      t.labeledOnlyBuyCount = labeled.filter(w => w.isOnlyBuy).length;
      t.labeledFlipperCount = labeled.filter(w => w.isFlipper).length;
      t.labeledOnlyBuyRatio = t.labeledOnlyBuyCount / labeled.length;
      t.labeledNetBuyUsd = labeled.reduce((s, w) => s + w.netBuy, 0);
      t.labeledTotalBuyUsd = labeled.reduce((s, w) => s + w.buyUsd, 0);
      t.labeledTotalSellUsd = labeled.reduce((s, w) => s + w.sellUsd, 0);
      t.labeledBuySellRatio = t.labeledTotalSellUsd > 0 ? t.labeledTotalBuyUsd / t.labeledTotalSellUsd : 999;
      t.labeledAvgBuySize = t.labeledTotalBuyUsd / Math.max(labeled.reduce((s, w) => s + w.buys, 0), 1);

      // 按 category 的买卖
      t.axiomNetBuy = labeled.filter(w => w.category === 'axiom').reduce((s, w) => s + w.netBuy, 0);
      t.axiomOnlyBuyRatio = (() => {
        const axioms = labeled.filter(w => w.category === 'axiom');
        if (axioms.length === 0) return 0;
        return axioms.filter(w => w.isOnlyBuy).length / axioms.length;
      })();
      t.freshNetBuy = labeled.filter(w => w.category === 'fresh_wallet').reduce((s, w) => s + w.netBuy, 0);
      t.gmgnNetBuy = labeled.filter(w => w.category === 'gmgn').reduce((s, w) => s + w.netBuy, 0);

      // 净买入量占比（labeled 的净买入 / 总早期交易量）
      const totalVol = allEarlyTrades.reduce((s, tr) => s + (tr.from_usd || 0), 0);
      t.labeledVolumeShare = totalVol > 0 ? (t.labeledTotalBuyUsd + t.labeledTotalSellUsd) / totalVol : 0;
    }
  }

  // === 5. 分析 ===
  const f = (t, name) => { const v = parseFloat(t.factors[name]); return isNaN(v) ? null : v; };
  const BASE = t => f(t, 'earlyTradesTotalCount') >= 18 && f(t, 'earlyTradesDrawdownFromHighest') > -5 && f(t, 'earlyTradesVolume') > 50 && f(t, 'earlyTradesCountPerMin') < 100;

  const withLabels = tokens.filter(t => t.labeledCount > 0);
  const baseLabeled = tokens.filter(t => BASE(t) && t.labeledCount > 0);

  function ev(name, filter) {
    const items = tokens.filter(filter);
    if (items.length === 0) return;
    const tp = items.reduce((s, t) => s + t.pnl, 0);
    const wr = (items.filter(t => t.pnl > 0).length / items.length * 100).toFixed(1);
    const avg = (items.reduce((s, t) => s + t.pnlPct, 0) / items.length).toFixed(2);
    const wins = items.filter(t => t.pnl > 0).length;
    console.log(`${name}`);
    console.log(`  n=${items.length} WR=${wr}% 总PnL=${tp.toFixed(4)} 平均=${avg}% 精确率=${wins}/${items.length}\n`);
  }

  function evLabeled(name, filter) {
    const items = withLabels.filter(filter);
    if (items.length === 0) return;
    const tp = items.reduce((s, t) => s + t.pnl, 0);
    const wr = (items.filter(t => t.pnl > 0).length / items.length * 100).toFixed(1);
    const avg = (items.reduce((s, t) => s + t.pnlPct, 0) / items.length).toFixed(2);
    const wins = items.filter(t => t.pnl > 0).length;
    console.log(`${name}`);
    console.log(`  n=${items.length} WR=${wr}% 总PnL=${tp.toFixed(4)} 平均=${avg}%\n`);
  }

  console.log(`\n总代币: ${tokens.length}, 有标签钱包: ${withLabels.length}, 基线+有标签: ${baseLabeled.length}\n`);

  // ===== A. 钱包质量与收益 =====
  console.log('========================================');
  console.log('=== A. 钱包质量指标与收益 ===');
  console.log('========================================\n');

  // 参与钱包平均胜率
  console.log('--- 参与钱包平均胜率 ---\n');
  for (const [name, min, max] of [['<30%', 0, 0.3], ['30-40%', 0.3, 0.4], ['40-50%', 0.4, 0.5], ['50-60%', 0.5, 0.6], ['>=60%', 0.6, 1.01]]) {
    evLabeled(`钱包平均WR ${name}`, t => t.avgWalletWinrate >= min && t.avgWalletWinrate < max);
  }

  // 高WR钱包比例
  console.log('--- 高胜率钱包占比(>=50%) ---\n');
  for (const [name, min, max] of [['0%', 0, 0.01], ['1-20%', 0.01, 0.2], ['20-40%', 0.2, 0.4], ['40-60%', 0.4, 0.6], ['>=60%', 0.6, 1.01]]) {
    evLabeled(`高WR钱包占比 ${name}`, t => t.ratioHighWR >= min && t.ratioHighWR < max);
  }

  // 盈利钱包占比
  console.log('--- 参与钱包中盈利钱包占比 ---\n');
  for (const [name, min, max] of [['<20%', 0, 0.2], ['20-40%', 0.2, 0.4], ['40-60%', 0.4, 0.6], ['>=60%', 0.6, 1.01]]) {
    evLabeled(`盈利钱包占比 ${name}`, t => t.profitableWalletRatio >= min && t.profitableWalletRatio < max);
  }

  // 参与钱包平均经验(买入次数)
  console.log('--- 参与钱包平均买入次数 ---\n');
  for (const [name, min, max] of [['<100', 0, 100], ['100-300', 100, 300], ['300-500', 300, 500], ['>=500', 500, 999999]]) {
    evLabeled(`平均buyCount ${name}`, t => t.avgWalletBuyCount >= min && t.avgWalletBuyCount < max);
  }

  // 经验钱包占比
  console.log('--- 经验丰富钱包占比(>=500 buys) ---\n');
  for (const [name, min, max] of [['<10%', 0, 0.1], ['10-30%', 0.1, 0.3], ['30-50%', 0.3, 0.5], ['>=50%', 0.5, 1.01]]) {
    evLabeled(`经验钱包占比 ${name}`, t => t.experiencedWalletRatio >= min && t.experiencedWalletRatio < max);
  }

  // ===== B. 早期交易行为指标 =====
  console.log('========================================');
  console.log('=== B. 早期交易行为与收益 ===');
  console.log('========================================\n');

  // labeled only-buy ratio
  console.log('--- 只买不卖钱包占比 ---\n');
  for (const [name, min, max] of [['<20%', 0, 0.2], ['20-40%', 0.2, 0.4], ['40-60%', 0.4, 0.6], ['>=60%', 0.6, 1.01]]) {
    evLabeled(`只买不卖占比 ${name}`, t => t.labeledOnlyBuyRatio >= min && t.labeledOnlyBuyRatio < max);
  }

  // labeled net buy
  console.log('--- labeled 钱包净买入量(SOL) ---\n');
  for (const [name, min, max] of [['<-10', -99999, -10], ['-10~0', -10, 0], ['0~10', 0, 10], ['10~50', 10, 50], ['>=50', 50, 999999]]) {
    evLabeled(`净买入 ${name}`, t => t.labeledNetBuyUsd >= min && t.labeledNetBuyUsd < max);
  }

  // labeled buy/sell ratio
  console.log('--- labeled 钱包买卖比 ---\n');
  for (const [name, min, max] of [['<0.5', 0, 0.5], ['0.5-1', 0.5, 1], ['1-2', 1, 2], ['>=2', 2, 999999]]) {
    evLabeled(`买卖比 ${name}`, t => t.labeledBuySellRatio >= min && t.labeledBuySellRatio < max);
  }

  // labeled volume share
  console.log('--- labeled 钱包交易量占早期总交易量比例 ---\n');
  for (const [name, min, max] of [['<5%', 0, 0.05], ['5-10%', 0.05, 0.1], ['10-20%', 0.1, 0.2], ['>=20%', 0.2, 1.01]]) {
    evLabeled(`量占比 ${name}`, t => t.labeledVolumeShare >= min && t.labeledVolumeShare < max);
  }

  // labeled avg buy size
  console.log('--- labeled 钱包平均单笔买入量(USD) ---\n');
  for (const [name, min, max] of [['<50', 0, 50], ['50-100', 50, 100], ['100-200', 100, 200], ['>=200', 200, 999999]]) {
    evLabeled(`单笔买入 ${name}`, t => t.labeledAvgBuySize >= min && t.labeledAvgBuySize < max);
  }

  // ===== C. 特定类别行为 =====
  console.log('========================================');
  console.log('=== C. 特定类别钱包行为 ===');
  console.log('========================================\n');

  // axiom 净买入
  console.log('--- axiom 钱包净买入 ---\n');
  const axiomTokens = withLabels.filter(t => t.hasAxiom);
  evLabeled('axiom 净买入>0', t => t.axiomNetBuy > 0);
  evLabeled('axiom 净买入<=0', t => t.hasAxiom && t.axiomNetBuy <= 0);

  // axiom 只买不卖比例
  console.log('--- axiom 只买不卖比例 ---\n');
  evLabeled('axiom onlyBuyRatio>=50%', t => t.hasAxiom && t.axiomOnlyBuyRatio >= 0.5);
  evLabeled('axiom onlyBuyRatio<50%', t => t.hasAxiom && t.axiomOnlyBuyRatio < 0.5);

  // fresh 净买入
  console.log('--- fresh_wallet 钱包净买入 ---\n');
  evLabeled('fresh 净买入>0', t => t.hasFresh && t.freshNetBuy > 0);
  evLabeled('fresh 净买入<=0', t => t.hasFresh && t.freshNetBuy <= 0);

  // gmgn 净买入
  console.log('--- gmgn 钱包净买入 ---\n');
  evLabeled('gmgn 净买入>0', t => t.hasGmgn && t.gmgnNetBuy > 0);
  evLabeled('gmgn 净买入<=0', t => t.hasGmgn && t.gmgnNetBuy <= 0);

  // 代币创建者
  console.log('--- 参与钱包中有代币创建者 ---\n');
  evLabeled('有代币创建者', t => t.hasTokenCreator);
  evLabeled('无代币创建者', t => !t.hasTokenCreator);
  for (const [name, min, max] of [['1个', 1, 2], ['>=2个', 2, 999]]) {
    evLabeled(`代币创建者${name}`, t => (t.tokenCreatorCount || 0) >= min && (t.tokenCreatorCount || 0) < max);
  }

  // ===== D. 盈亏组钱包特征对比 =====
  console.log('========================================');
  console.log('=== D. 盈亏组钱包特征对比 ===');
  console.log('========================================\n');

  const wins = withLabels.filter(t => t.pnl > 0);
  const losses = withLabels.filter(t => t.pnl <= 0);

  const metrics = [
    'avgWalletWinrate', 'profitableWalletRatio', 'avgWalletProfit',
    'avgWalletBuyCount', 'avgWalletTokenCount', 'avgWalletHoldingPeriod',
    'ratioHighWR', 'experiencedWalletRatio', 'avgFundAmount',
    'labeledOnlyBuyRatio', 'labeledNetBuyUsd', 'labeledBuySellRatio',
    'labeledVolumeShare', 'labeledAvgBuySize',
  ];

  console.log('指标'.padEnd(35) + '| 盈利组(n=' + wins.length + ') | 亏损组(n=' + losses.length + ') | 差值');
  console.log('-'.repeat(85));
  for (const m of metrics) {
    const wv = wins.map(t => t[m]).filter(v => v !== undefined && !isNaN(v));
    const lv = losses.map(t => t[m]).filter(v => v !== undefined && !isNaN(v));
    if (wv.length < 5 || lv.length < 5) continue;
    const wa = wv.reduce((s, v) => s + v, 0) / wv.length;
    const la = lv.reduce((s, v) => s + v, 0) / lv.length;
    const d = wa - la;
    console.log(`${m.padEnd(35)}| ${wa.toFixed(4).padStart(14)} | ${la.toFixed(4).padStart(14)} | ${d >= 0 ? '+' : ''}${d.toFixed(4)}`);
  }

  // ===== E. 在基线上叠加最有希望的指标 =====
  console.log('\n========================================');
  console.log('=== E. 基线 + 钱包指标组合 ===');
  console.log('========================================\n');

  ev('基线(4因子)', BASE);

  // 高WR钱包
  ev('基线 AND avgWalletWR>=0.45', t => BASE(t) && t.avgWalletWinrate >= 0.45);
  ev('基线 AND avgWalletWR>=0.5', t => BASE(t) && t.avgWalletWinrate >= 0.5);
  ev('基线 AND highWRRatio>=40%', t => BASE(t) && t.ratioHighWR >= 0.4);

  // !hasFresh
  ev('基线 AND !hasFresh', t => BASE(t) && !t.hasFresh);

  // 盈利钱包占比
  ev('基线 AND profitableRatio>=40%', t => BASE(t) && t.profitableWalletRatio >= 0.4);
  ev('基线 AND profitableRatio>=60%', t => BASE(t) && t.profitableWalletRatio >= 0.6);

  // 经验钱包
  ev('基线 AND experiencedRatio>=20%', t => BASE(t) && t.experiencedWalletRatio >= 0.2);

  // 只买不卖
  ev('基线 AND onlyBuyRatio>=40%', t => BASE(t) && t.labeledOnlyBuyRatio >= 0.4);
  ev('基线 AND onlyBuyRatio>=60%', t => BASE(t) && t.labeledOnlyBuyRatio >= 0.6);

  // 买卖比
  ev('基线 AND buySellRatio>=1.5', t => BASE(t) && t.labeledBuySellRatio >= 1.5);

  // 无代币创建者
  ev('基线 AND !hasTokenCreator', t => BASE(t) && !t.hasTokenCreator);

  // 组合
  console.log('--- 组合 ---\n');
  ev('基线 AND !hasFresh AND avgWR>=0.4', t => BASE(t) && !t.hasFresh && t.avgWalletWinrate >= 0.4);
  ev('基线 AND !hasFresh AND !hasTokenCreator', t => BASE(t) && !t.hasFresh && !t.hasTokenCreator);
  ev('基线 AND !hasFresh AND profitableRatio>=40%', t => BASE(t) && !t.hasFresh && t.profitableWalletRatio >= 0.4);
  ev('基线 AND !hasFresh AND onlyBuyRatio>=40%', t => BASE(t) && !t.hasFresh && t.labeledOnlyBuyRatio >= 0.4);
  ev('基线 AND !hasFresh AND experiencedRatio>=20%', t => BASE(t) && !t.hasFresh && t.experiencedWalletRatio >= 0.2);
  ev('基线 AND !hasFresh AND buySellRatio>=1.5', t => BASE(t) && !t.hasFresh && t.labeledBuySellRatio >= 1.5);

  // ===== F. 全面对比 =====
  console.log('========================================');
  console.log('=== F. 所有方案对比 ===');
  console.log('========================================\n');

  const allPlans = [
    ['无筛选', () => true],
    ['基线(4因子)', BASE],
    ['基线 + !hasFresh', t => BASE(t) && !t.hasFresh],
    ['基线 + avgWR>=0.45', t => BASE(t) && t.avgWalletWinrate >= 0.45],
    ['基线 + avgWR>=0.5', t => BASE(t) && t.avgWalletWinrate >= 0.5],
    ['基线 + highWRRatio>=40%', t => BASE(t) && t.ratioHighWR >= 0.4],
    ['基线 + profitableRatio>=40%', t => BASE(t) && t.profitableWalletRatio >= 0.4],
    ['基线 + profitableRatio>=60%', t => BASE(t) && t.profitableWalletRatio >= 0.6],
    ['基线 + onlyBuyRatio>=40%', t => BASE(t) && t.labeledOnlyBuyRatio >= 0.4],
    ['基线 + onlyBuyRatio>=60%', t => BASE(t) && t.labeledOnlyBuyRatio >= 0.6],
    ['基线 + buySellRatio>=1.5', t => BASE(t) && t.labeledBuySellRatio >= 1.5],
    ['基线 + !hasTokenCreator', t => BASE(t) && !t.hasTokenCreator],
    ['基线 + !hasFresh AND !hasTokenCreator', t => BASE(t) && !t.hasFresh && !t.hasTokenCreator],
    ['基线 + !hasFresh AND avgWR>=0.4', t => BASE(t) && !t.hasFresh && t.avgWalletWinrate >= 0.4],
    ['基线 + !hasFresh AND profitableRatio>=40%', t => BASE(t) && !t.hasFresh && t.profitableWalletRatio >= 0.4],
    ['基线 + !hasFresh AND onlyBuyRatio>=40%', t => BASE(t) && !t.hasFresh && t.labeledOnlyBuyRatio >= 0.4],
    ['基线 + !hasFresh AND buySellRatio>=1.5', t => BASE(t) && !t.hasFresh && t.labeledBuySellRatio >= 1.5],
    ['基线 + !hasFresh AND experiencedRatio>=20%', t => BASE(t) && !t.hasFresh && t.experiencedWalletRatio >= 0.2],
  ];

  console.log('方案'.padEnd(50) + '| n    | WR%   | 总PnL        | 平均%');
  console.log('-'.repeat(95));
  for (const [name, filter] of allPlans) {
    const items = tokens.filter(filter);
    if (items.length === 0) continue;
    const tp = items.reduce((s, t) => s + t.pnl, 0);
    const wr = (items.filter(t => t.pnl > 0).length / items.length * 100).toFixed(1);
    const avg = (items.reduce((s, t) => s + t.pnlPct, 0) / items.length).toFixed(2);
    console.log(`${name.padEnd(50)}| ${String(items.length).padStart(4)} | ${wr.padStart(5)} | ${tp.toFixed(4).padStart(12)} | ${avg.padStart(6)}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
