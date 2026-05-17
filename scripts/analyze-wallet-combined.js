/**
 * 钱包标签 + 已有因子组合分析
 * 在最优 preBuyCheck 条件基础上，看钱包标签的增量价值
 */

const { dbManager } = require('../src/services/dbManager');
const EXPERIMENT_ID = '0d364d3f-06ae-46ff-bf5b-fd51c90fe66d';

async function main() {
  const supabase = dbManager.getClient();

  // === 1. 加载钱包标签 ===
  const wallets = [];
  let wOffset = 0;
  while (true) {
    const { data } = await supabase.from('wallets').select('*').eq('chain', 'solana').range(wOffset, wOffset + 999);
    if (!data || data.length === 0) break;
    wallets.push(...data); wOffset += 1000; if (data.length < 1000) break;
  }

  const walletMap = {};
  for (const w of wallets) {
    const fullAddr = w.details?.wallet_address || w.address;
    if (fullAddr) walletMap[fullAddr] = w.category;
  }
  console.log(`钱包标签库: ${wallets.length} 个`);

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

  // === 3. 获取早期交易者钱包 ===
  const earlyTrades = [];
  let eOffset = 0;
  while (true) {
    const { data } = await supabase.from('early_participant_trades')
      .select('token_address, trades_data')
      .eq('experiment_id', EXPERIMENT_ID).range(eOffset, eOffset + 49);
    if (!data || data.length === 0) break;
    earlyTrades.push(...data); eOffset += 50; if (data.length < 50) break;
  }

  const walletsByToken = {};
  for (const et of earlyTrades) {
    if (!walletsByToken[et.token_address]) walletsByToken[et.token_address] = new Set();
    if (Array.isArray(et.trades_data)) {
      for (const trade of et.trades_data) {
        if (trade.wallet_address) walletsByToken[et.token_address].add(trade.wallet_address);
      }
    }
  }

  // === 4. 给每个 token 打钱包标签 ===
  for (const t of tokens) {
    const earlyWallets = walletsByToken[t.addr];
    if (!earlyWallets) { t.walletLabels = {}; continue; }

    const labelCounts = {};
    let matchedCount = 0;
    for (const addr of earlyWallets) {
      const cat = walletMap[addr];
      if (cat) {
        labelCounts[cat] = (labelCounts[cat] || 0) + 1;
        matchedCount++;
      }
    }

    t.walletLabels = labelCounts;
    t.matchedLabelCount = matchedCount;
    t.earlyWalletCount = earlyWallets.size;
    t.hasAxiom = (labelCounts.axiom || 0) > 0;
    t.hasPhoton = (labelCounts.photon || 0) > 0;
    t.hasBullx = (labelCounts.bullx || 0) > 0;
    t.hasGmgn = (labelCounts.gmgn || 0) > 0;
    t.hasFresh = (labelCounts.fresh_wallet || 0) > 0;
    t.hasPadre = (labelCounts.padre || 0) > 0;
    t.hasTop = (labelCounts.top_renamed || 0) > 0;
    t.hasBotTool = (labelCounts.axiom || 0) > 0 || (labelCounts.photon || 0) > 0 || (labelCounts.bullx || 0) > 0;
    t.axiomCount = labelCounts.axiom || 0;
    t.freshCount = labelCounts.fresh_wallet || 0;
  }

  // === 5. 分析 ===
  const f = (t, name) => { const v = parseFloat(t.factors[name]); return isNaN(v) ? null : v; };

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

  // 基线条件
  const BASE = t => f(t, 'earlyTradesTotalCount') >= 18 && f(t, 'earlyTradesDrawdownFromHighest') > -5 && f(t, 'earlyTradesVolume') > 50 && f(t, 'earlyTradesCountPerMin') < 100;

  console.log(`总代币: ${tokens.length}\n`);

  // ===== A. 在基线条件上加钱包标签 =====
  console.log('========================================');
  console.log('=== A. 基线条件 + 钱包标签增量 ===');
  console.log('========================================\n');

  ev('【基线】无钱包标签筛选', () => true);
  ev('【基线】已有最优条件', BASE);

  console.log('--- 在已有最优条件上叠加钱包标签 ---\n');

  ev('基线 AND hasAxiom', t => BASE(t) && t.hasAxiom);
  ev('基线 AND !hasAxiom', t => BASE(t) && !t.hasAxiom);
  ev('基线 AND hasBotTool(axiom|photon|bullx)', t => BASE(t) && t.hasBotTool);
  ev('基线 AND !hasBotTool', t => BASE(t) && !t.hasBotTool);
  ev('基线 AND hasPhoton', t => BASE(t) && t.hasPhoton);
  ev('基线 AND hasBullx', t => BASE(t) && t.hasBullx);
  ev('基线 AND hasGmgn', t => BASE(t) && t.hasGmgn);
  ev('基线 AND hasTop', t => BASE(t) && t.hasTop);
  ev('基线 AND hasFresh', t => BASE(t) && t.hasFresh);
  ev('基线 AND !hasFresh', t => BASE(t) && !t.hasFresh);
  ev('基线 AND hasPadre', t => BASE(t) && t.hasPadre);

  // ===== B. 放宽基线，用钱包标签替代某些条件 =====
  console.log('========================================');
  console.log('=== B. 用钱包标签替代/简化基线条件 ===');
  console.log('========================================\n');

  ev('只有 hasBotTool (无其他条件)', t => t.hasBotTool);
  ev('只有 hasAxiom', t => t.hasAxiom);
  ev('只有 hasPhoton', t => t.hasPhoton);

  // 早期因子宽松版 + 钱包标签
  const LOOSE = t => f(t, 'earlyTradesTotalCount') >= 10 && f(t, 'earlyTradesDrawdownFromHighest') > -10 && f(t, 'earlyTradesCountPerMin') < 150;
  ev('宽松条件 + hasBotTool', t => LOOSE(t) && t.hasBotTool);
  ev('宽松条件 + hasAxiom', t => LOOSE(t) && t.hasAxiom);
  ev('宽松条件 + hasPhoton', t => LOOSE(t) && t.hasPhoton);

  // ===== C. 钱包标签组合 =====
  console.log('========================================');
  console.log('=== C. 钱包标签组合（在基线上）===');
  console.log('========================================\n');

  ev('基线 AND (hasAxiom OR hasPhoton)', t => BASE(t) && (t.hasAxiom || t.hasPhoton));
  ev('基线 AND (hasAxiom OR hasPhoton OR hasBullx)', t => BASE(t) && (t.hasAxiom || t.hasPhoton || t.hasBullx));
  ev('基线 AND hasBotTool AND hasFresh', t => BASE(t) && t.hasBotTool && t.hasFresh);
  ev('基线 AND hasBotTool AND !hasFresh', t => BASE(t) && t.hasBotTool && !t.hasFresh);
  ev('基线 AND hasAxiom AND hasFresh', t => BASE(t) && t.hasAxiom && t.hasFresh);
  ev('基线 AND hasAxiom AND !hasFresh', t => BASE(t) && t.hasAxiom && !t.hasFresh);

  // axiom数量
  console.log('--- axiom 数量（在基线上）---\n');
  for (const [name, min, max] of [['axiom=0', 0, 0], ['axiom=1', 1, 1], ['axiom>=2', 2, 99]]) {
    ev(`基线 AND ${name}`, t => BASE(t) && (min === 0 && max === 0 ? t.axiomCount === 0 : t.axiomCount >= min && t.axiomCount <= max));
  }

  // ===== D. 全面对比 =====
  console.log('========================================');
  console.log('=== D. 所有方案对比 ===');
  console.log('========================================\n');

  const allPlans = [
    ['无筛选', () => true],
    ['基线(4因子)', BASE],
    ['基线 + hasBotTool', t => BASE(t) && t.hasBotTool],
    ['基线 + (hasAxiom OR hasPhoton)', t => BASE(t) && (t.hasAxiom || t.hasPhoton)],
    ['基线 + hasAxiom', t => BASE(t) && t.hasAxiom],
    ['基线 + hasPhoton', t => BASE(t) && t.hasPhoton],
    ['基线 + hasFresh', t => BASE(t) && t.hasFresh],
    ['宽松条件 + hasBotTool', t => LOOSE(t) && t.hasBotTool],
    ['宽松条件 + hasAxiom', t => LOOSE(t) && t.hasAxiom],
    ['宽松条件 + hasPhoton', t => LOOSE(t) && t.hasPhoton],
    ['宽松条件 + (hasAxiom OR hasPhoton OR hasBullx)', t => LOOSE(t) && (t.hasAxiom || t.hasPhoton || t.hasBullx)],
    ['宽松条件 + hasBotTool + !hasFresh', t => LOOSE(t) && t.hasBotTool && !t.hasFresh],
    ['宽松条件 + hasAxiom + hasFresh', t => LOOSE(t) && t.hasAxiom && t.hasFresh],
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
