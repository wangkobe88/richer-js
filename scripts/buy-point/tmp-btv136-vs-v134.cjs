// bt-v136(54c045ff) vs bt-v134(19ef6433) 同窗对比 + 改进项逐项验证
// 跑法：node scripts/buy-point/tmp-btv136-vs-v134.cjs [--exp 54c045ff...]
const { dbManager } = require('../../src/services/dbManager.js');

const V134 = '19ef6433-0c92-47ff-a6fd-9f6bea745b8d';

async function pull(c, exp, wallFloor = null) {
  // trades 全量（分页）
  const trades = [];
  let from = 0;
  while (true) {
    const r = await c.from('trades').select('trade_direction,input_amount,output_amount,unit_price,created_at,executed_at,token_address,token_symbol,metadata')
      .eq('experiment_id', exp).order('id', { ascending: true }).range(from, from + 999);
    if (r.error) throw new Error(r.error.message);
    if (!r.data.length) break;
    // 污染剔除（wallFloor 非空时）：起点前行 = 前任进程死亡 flush 尾巴
    trades.push(...(wallFloor ? r.data.filter(t => (t.executed_at || '') >= wallFloor) : r.data)); from += r.data.length;
    if (r.data.length < 1000) break;
  }
  // BUY 信号全量（分页，metadata 含门链四段）
  const sigs = [];
  from = 0;
  while (true) {
    const r = await c.from('strategy_signals').select('signal_type,token_address,token_symbol,created_at,reason,metadata')
      .eq('experiment_id', exp).eq('signal_type', 'BUY').order('id', { ascending: true }).range(from, from + 999);
    if (r.error) throw new Error(r.error.message);
    if (!r.data.length) break;
    sigs.push(...r.data); from += r.data.length;
    if (r.data.length < 1000) break;
  }
  // 信号去重：v24b 死亡 flush 与 v24c 同点位双写（无墙钟列，按 (token,ts,reason) 去重取一）
  const seen = new Set();
  sigs.dedup = sigs.length;
  const dd = [];
  for (const s of sigs) {
    const k = s.token_address + '|' + s.created_at + '|' + (s.reason || '');
    if (seen.has(k)) continue;
    seen.add(k); dd.push(s);
  }
  sigs.length = 0; sigs.push(...dd);
  return { trades, sigs };
}

/** per-token 轮级盈亏：Σ卖得 − Σ买入（token 粒度，回放结束强平=全清） */
function tokenPnl(trades) {
  const m = new Map();
  for (const t of trades) {
    const e = m.get(t.token_address) || { symbol: t.token_symbol, buy: 0, sell: 0, buys: 0, sells: 0 };
    if (t.trade_direction === 'buy') { e.buy += t.input_amount; e.buys++; }
    else { e.sell += t.output_amount; e.sells++; }
    m.set(t.token_address, e);
  }
  for (const [k, e] of m) e.pnl = +(e.sell - e.buy).toFixed(4);
  return m;
}

async function main() {
  const c = dbManager.getClient();
  const exp = process.argv.includes('--exp') ? process.argv[process.argv.indexOf('--exp') + 1] : '54c045ff-ab63-4bad-b71e-08b2e224c266';
  const A = await pull(c, exp, '2026-11-16T08:50:40');   // bt-v136（v24c 起点，剔除 v24b 死亡 flush 污染）
  const B = await pull(c, V134);  // bt-v134
  const pa = tokenPnl(A.trades), pb = tokenPnl(B.trades);

  const sum = (m) => +[...m.values()].reduce((s, e) => s + e.pnl, 0).toFixed(4);
  const wins = (m) => [...m.values()].filter(e => e.pnl > 0).length;

  console.log(`\n═══ 总账对比 ═══`);
  console.log(`bt-v136: ${pa.size} 票 | 成交买 ${A.trades.filter(t=>t.trade_direction==='buy').length} 卖 ${A.trades.filter(t=>t.trade_direction==='sell').length} | Σpnl=${sum(pa)} | 胜 ${wins(pa)}`);
  console.log(`bt-v134: ${pb.size} 票 | 成交买 ${B.trades.filter(t=>t.trade_direction==='buy').length} 卖 ${B.trades.filter(t=>t.trade_direction==='sell').length} | Σpnl=${sum(pb)} | 胜 ${wins(pb)}`);

  // ── 差集归因 ──
  const onlyA = [...pa.keys()].filter(k => !pb.has(k));
  const onlyB = [...pb.keys()].filter(k => !pa.has(k));
  const both = [...pa.keys()].filter(k => pb.has(k));
  const diffBoth = both.map(k => ({ k, a: pa.get(k), b: pb.get(k), d: +(pa.get(k).pnl - pb.get(k).pnl).toFixed(4) })).sort((x, y) => x.d - y.d);
  console.log(`\n── v136 独买 ${onlyA.length} 票（Σpnl=${onlyA.reduce((s,k)=>s+pa.get(k).pnl,0).toFixed(4)}）`);
  for (const k of onlyA) { const e = pa.get(k); console.log(`  + ${e.symbol} pnl=${e.pnl}（买${e.buys}/卖${e.sells}）`); }
  console.log(`── v134 独买（v136 未买）${onlyB.length} 票（v134 Σpnl=${onlyB.reduce((s,k)=>s+pb.get(k).pnl,0).toFixed(4)}）`);
  for (const k of onlyB) { const e = pb.get(k); console.log(`  - ${e.symbol} pnl=${e.pnl}`); }
  console.log(`── 共同票 ${both.length} | v136−v134 差值 Σ=${diffBoth.reduce((s,x)=>s+x.d,0).toFixed(4)}`);
  console.log(`   差值最负 6（v136 更差）:`);
  for (const x of diffBoth.slice(0, 6)) console.log(`   ${x.a.symbol}: ${x.b.pnl} → ${x.a.pnl}（Δ${x.d}）`);
  console.log(`   差值最正 6（v136 更好）:`);
  for (const x of diffBoth.slice(-6).reverse()) console.log(`   ${x.a.symbol}: ${x.b.pnl} → ${x.a.pnl}（Δ${x.d}）`);

  // ── 改进项验证（v136 信号 metadata）──
  console.log(`\n═══ 改进项逐项验证（v136 BUY 信号 ${A.sigs.length} 条）═══`);
  // FP4 因子门
  let fpReject = 0, fpBranch = {};
  for (const s of A.sigs) {
    const fc = s.metadata?.factorCheck;
    if (!fc) continue;
    if (fc.pass === false) { fpReject++; const b = fc.reason || fc.pvp?.reason || '?'; fpBranch[b] = (fpBranch[b] || 0) + 1; }
  }
  console.log(`[FP4 因子门] 拒 ${fpReject} 信号 | 拒因分布: ${JSON.stringify(fpBranch)}`);
  // cheat 豁免/收紧
  let ultraExempt = 0, highExempt = 0, denied = {};
  for (const s of A.sigs) {
    const cc = s.metadata?.cheatCheck || {};
    if (cc.exempt?.code === 'activity_ultra') ultraExempt++;
    if (cc.exempt?.code === 'activity_high') highExempt++;
    if (cc.exemptDenied) denied[cc.exemptDenied] = (denied[cc.exemptDenied] || 0) + 1;
  }
  console.log(`[CD409] activity_ultra 豁免数=${ultraExempt}（应 0）| activity_high 豁免=${highExempt}`);
  console.log(`[CD380/CD400/401/403/405/410/412] exemptDenied 分布: ${JSON.stringify(denied)}`);
  // BP 门
  let bp = {};
  for (const s of A.sigs) {
    const b = s.metadata?.buyPoint;
    const st = b?.status || b?.result || '?';
    bp[st] = (bp[st] || 0) + 1;
  }
  console.log(`[BP 门] status 分布: ${JSON.stringify(bp)}`);
  // T147 卖臂触发
  const bweSells = A.trades.filter(t => t.trade_direction === 'sell' && JSON.stringify(t.metadata || {}).includes('sinceEntryEqualBundleWallets'));
  const t137 = A.trades.filter(t => t.trade_direction === 'sell' && (t.metadata?.strategyId || '').includes('famous') || JSON.stringify(t.metadata?.factors || {}).includes('sinceEntryFamousNearLaunchBuyBnb'));
  console.log(`[T147 bundle-wave-exit] 成交 ${bweSells.length} 笔 | [T133 famous-entry-exit] ${t137.length} 笔`);
  // 分卡卖出恢复验证
  const multiSell = [...pa.values()].filter(e => e.sells >= 3).length;
  console.log(`[卖腿阶梯恢复] 卖出≥3 笔的票数=${multiSell}（bt-v134=${[...pb.values()].filter(e=>e.sells>=3).length}）`);
  // T149 年龄门：v134 买了 v136 没买、且首笔交易晚于创建的票
  console.log(`[T149 年龄双门] v134 独买票（含 T149 拦截面+其它门差异，逐票见上）`);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
