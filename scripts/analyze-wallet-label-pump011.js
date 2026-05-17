/**
 * 早期交易者钱包标签与交易收益关联分析 v2
 * 从 early_participant_trades.trades_data 提取钱包地址
 */

const { dbManager } = require('../src/services/dbManager');
const EXPERIMENT_ID = '799470d1-fb59-4280-ac96-38a1893b6d0e';

async function main() {
  const supabase = dbManager.getClient();

  // === 1. 获取 Solana 钱包标签 ===
  console.log('=== 加载 Solana 钱包标签 ===');
  const wallets = [];
  let wOffset = 0;
  while (true) {
    const { data } = await supabase.from('wallets').select('*').eq('chain', 'solana').range(wOffset, wOffset + 999);
    if (!data || data.length === 0) break;
    wallets.push(...data); wOffset += 1000; if (data.length < 1000) break;
  }
  console.log(`钱包总数: ${wallets.length}`);

  // 构建完整地址 -> 标签映射
  const walletMap = {};
  for (const w of wallets) {
    const fullAddr = w.details?.wallet_address || w.address;
    if (fullAddr) {
      walletMap[fullAddr] = {
        category: w.category,
        winrate: w.winrate,
        realized_profit: parseFloat(w.realized_profit) || 0,
        buy_count: w.buy_count || 0,
        avg_holding_period: w.details?.pnl_stat?.avg_holding_period || 0,
        profit_pnl: parseFloat(w.details?.realized_profit_pnl || 0),
        tags: w.details?.common?.tags || []
      };
    }
  }

  // Category 统计
  const catStats = {};
  for (const w of wallets) {
    const c = w.category || 'unknown';
    if (!catStats[c]) catStats[c] = { count: 0, wrSum: 0, profitSum: 0 };
    catStats[c].count++;
    catStats[c].wrSum += w.winrate || 0;
    catStats[c].profitSum += parseFloat(w.realized_profit) || 0;
  }
  console.log('\n钱包标签概览:');
  for (const [cat, s] of Object.entries(catStats).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${(cat || 'null').padEnd(20)} n=${String(s.count).padStart(4)} 平均WR=${(s.wrSum / s.count * 100).toFixed(1)}% 总利润=${s.profitSum.toFixed(0).padStart(10)} SOL`);
  }

  // === 2. 获取交易配对 ===
  console.log('\n=== 获取交易数据 ===');
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
    tokens.push({ addr, symbol: buy.token_symbol, pnl, pnlPct });
  }
  console.log(`总代币: ${tokens.length}`);

  // === 3. 获取早期交易者的钱包地址 ===
  console.log('\n=== 获取早期交易者数据 ===');
  const earlyTrades = [];
  let eOffset = 0;
  while (true) {
    const { data } = await supabase.from('early_participant_trades')
      .select('token_address, trades_data')
      .eq('experiment_id', EXPERIMENT_ID)
      .range(eOffset, eOffset + 999);
    if (!data || data.length === 0) break;
    earlyTrades.push(...data); eOffset += 1000; if (data.length < 999) break;
  }
  console.log(`early_participant_trades 记录: ${earlyTrades.length}`);

  // 按 token 汇总钱包地址
  const walletsByToken = {};
  for (const et of earlyTrades) {
    const tokenAddr = et.token_address;
    if (!walletsByToken[tokenAddr]) walletsByToken[tokenAddr] = new Set();
    if (Array.isArray(et.trades_data)) {
      for (const trade of et.trades_data) {
        if (trade.wallet_address) walletsByToken[tokenAddr].add(trade.wallet_address);
      }
    }
  }

  // === 4. 匹配钱包标签 ===
  console.log('\n=== 匹配钱包标签 ===');
  let totalEarlyWallets = 0;
  let totalMatched = 0;

  const tokenAnalysis = [];
  for (const t of tokens) {
    const earlyWallets = walletsByToken[t.addr];
    if (!earlyWallets) continue;

    totalEarlyWallets += earlyWallets.size;
    const matched = [];
    for (const addr of earlyWallets) {
      const info = walletMap[addr];
      if (info) {
        matched.push({ address: addr, ...info });
        totalMatched++;
      }
    }

    tokenAnalysis.push({
      ...t,
      earlyWalletCount: earlyWallets.size,
      matchedWallets: matched,
      matchedCount: matched.length,
      // 按类别统计
      axiomCount: matched.filter(w => w.category === 'axiom').length,
      freshCount: matched.filter(w => w.category === 'fresh_wallet').length,
      gmgnCount: matched.filter(w => w.category === 'gmgn').length,
      photonCount: matched.filter(w => w.category === 'photon').length,
      bullxCount: matched.filter(w => w.category === 'bullx').length,
      padreCount: matched.filter(w => w.category === 'padre').length,
      trojanCount: matched.filter(w => w.category === 'trojan').length,
      topCount: matched.filter(w => w.category === 'top_renamed').length,
      botCount: matched.filter(w => ['sandwich_bot', 'arbitrager'].includes(w.category)).length,
    });

    // 钱包质量指标
    if (matched.length > 0) {
      t.avgWalletWR = matched.reduce((s, w) => s + (w.winrate || 0), 0) / matched.length;
      t.profitableWalletRatio = matched.filter(w => (w.realized_profit || 0) > 0).length / matched.length;
    }
  }

  console.log(`有早期交易数据的代币: ${tokenAnalysis.length}/${tokens.length}`);
  console.log(`早期交易者钱包总数: ${totalEarlyWallets}`);
  console.log(`匹配到标签: ${totalMatched} (${(totalMatched / totalEarlyWallets * 100).toFixed(1)}%)`);

  function ev(name, items) {
    if (items.length === 0) return;
    const tp = items.reduce((s, t) => s + t.pnl, 0);
    const wr = (items.filter(t => t.pnl > 0).length / items.length * 100).toFixed(1);
    const avg = (items.reduce((s, t) => s + t.pnlPct, 0) / items.length).toFixed(2);
    console.log(`  ${name}`);
    console.log(`    n=${items.length} WR=${wr}% 总PnL=${tp.toFixed(4)} SOL 平均=${avg}%\n`);
  }

  // === 5. 钱包标签类型与收益 ===
  console.log('========================================');
  console.log('=== 5. 钱包标签类型与代币收益 ===');
  console.log('========================================\n');

  ev('基线（全部有早期数据的代币）', tokenAnalysis);
  ev('有标签钱包参与', tokenAnalysis.filter(t => t.matchedCount > 0));
  ev('无标签钱包参与', tokenAnalysis.filter(t => t.matchedCount === 0));

  // 按标签类型
  console.log('  --- 按是否包含某类标签 ---\n');
  const tagFilters = [
    ['有 axiom', t => t.axiomCount > 0],
    ['有 fresh_wallet', t => t.freshCount > 0],
    ['有 gmgn', t => t.gmgnCount > 0],
    ['有 photon', t => t.photonCount > 0],
    ['有 bullx', t => t.bullxCount > 0],
    ['有 padre', t => t.padreCount > 0],
    ['有 top_renamed', t => t.topCount > 0],
    ['有 bot', t => t.botCount > 0],
    ['无 axiom', t => t.axiomCount === 0],
    ['无 fresh_wallet', t => t.freshCount === 0],
  ];
  for (const [name, filter] of tagFilters) {
    ev(name, tokenAnalysis.filter(filter));
  }

  // === 6. axiom 数量与收益 ===
  console.log('========================================');
  console.log('=== 6. axiom/bot 数量梯度 ===');
  console.log('========================================\n');

  for (let i = 0; i <= 5; i++) {
    const items = tokenAnalysis.filter(t => t.axiomCount === i);
    if (items.length > 0) ev(`axiom=${i}`, items);
  }
  ev('axiom>=3', tokenAnalysis.filter(t => t.axiomCount >= 3));

  console.log('  --- fresh_wallet 数量 ---\n');
  for (let i = 0; i <= 3; i++) {
    const items = tokenAnalysis.filter(t => t.freshCount === i);
    if (items.length > 0) ev(`fresh_wallet=${i}`, items);
  }
  ev('fresh_wallet>=3', tokenAnalysis.filter(t => t.freshCount >= 3));

  // === 7. 钱包质量与收益 ===
  console.log('========================================');
  console.log('=== 7. 参与钱包质量指标 ===');
  console.log('========================================\n');

  const withMatched = tokenAnalysis.filter(t => t.matchedCount > 0);

  // 钱包平均胜率
  console.log('  --- 参与钱包平均胜率 ---\n');
  const wrRanges = [
    ['<30%', 0, 0.3], ['30-40%', 0.3, 0.4], ['40-50%', 0.4, 0.5], ['50-60%', 0.5, 0.6], ['>=60%', 0.6, 1.01]
  ];
  for (const [name, min, max] of wrRanges) {
    ev(`钱包平均WR ${name}`, withMatched.filter(t => t.avgWalletWR >= min && t.avgWalletWR < max));
  }

  // 盈利钱包比例
  console.log('  --- 参与钱包中盈利钱包比例 ---\n');
  const profitRanges = [
    ['<20%', 0, 0.2], ['20-40%', 0.2, 0.4], ['40-60%', 0.4, 0.6], ['>=60%', 0.6, 1.01]
  ];
  for (const [name, min, max] of profitRanges) {
    ev(`盈利钱包占比 ${name}`, withMatched.filter(t => t.profitableWalletRatio >= min && t.profitableWalletRatio < max));
  }

  // === 8. 组合筛选 ===
  console.log('========================================');
  console.log('=== 8. 组合筛选 ===');
  console.log('========================================\n');

  ev('基线', tokenAnalysis);
  ev('有 axiom (bot交易平台)', tokenAnalysis.filter(t => t.axiomCount > 0));
  ev('有 axiom 且有 fresh_wallet', tokenAnalysis.filter(t => t.axiomCount > 0 && t.freshCount > 0));
  ev('有 axiom 且无 fresh_wallet', tokenAnalysis.filter(t => t.axiomCount > 0 && t.freshCount === 0));
  ev('有 gmgn 或 top_renamed (高质量)', tokenAnalysis.filter(t => t.gmgnCount > 0 || t.topCount > 0));
  ev('有 photon (专业交易工具)', tokenAnalysis.filter(t => t.photonCount > 0));
  ev('axiom>=2 AND 无 fresh_wallet', tokenAnalysis.filter(t => t.axiomCount >= 2 && t.freshCount === 0));
  ev('axiom>=1 AND fresh>=1', tokenAnalysis.filter(t => t.axiomCount >= 1 && t.freshCount >= 1));
  ev('纯 axiom (只有axiom无其他标签)', tokenAnalysis.filter(t => {
    if (t.axiomCount === 0) return false;
    return t.freshCount === 0 && t.gmgnCount === 0 && t.photonCount === 0 && t.bullxCount === 0 && t.padreCount === 0 && t.trojanCount === 0;
  }));

  // === 9. axiom 占比分析 ===
  console.log('========================================');
  console.log('=== 9. axiom 占比与收益 ===');
  console.log('========================================\n');

  for (const [name, min, max] of [['0%', 0, 0.01], ['1-20%', 0.01, 0.2], ['20-40%', 0.2, 0.4], ['40-60%', 0.4, 0.6], ['>=60%', 0.6, 1.01]]) {
    const items = withMatched.filter(t => {
      const ratio = t.axiomCount / t.matchedCount;
      return ratio >= min && ratio < max;
    });
    ev(`axiom占比 ${name}`, items);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
