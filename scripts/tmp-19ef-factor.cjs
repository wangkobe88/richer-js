// bt-v134 (19ef6433)：①executed 票 BP bucket×净额 ②亏损vs盈利因子分布 ③act_low 拒面构成
const { dbManager } = require('../src/services/dbManager.js');
const EXP = '19ef6433-0c92-47ff-a6fd-9f6bea745b8d';
async function main() {
  const c = await dbManager.getClient();
  const { data: rows } = await c.from('trades')
    .select('token_address,token_symbol,trade_direction,input_currency,input_amount,output_currency,output_amount,success')
    .eq('experiment_id', EXP).range(0, 999);
  const m = new Map();
  for (const t of rows || []) {
    if (t.success === false) continue;
    const buy = t.trade_direction === 'buy';
    const v = buy ? (t.input_currency === 'BNB' ? Number(t.input_amount || 0) : Number(t.output_amount || 0))
      : (t.output_currency === 'BNB' ? Number(t.output_amount || 0) : Number(t.input_amount || 0));
    let e = m.get(t.token_address);
    if (!e) { e = { sym: t.token_symbol, buyBnb: 0, sellBnb: 0 }; m.set(t.token_address, e); }
    if (buy) e.buyBnb += v; else e.sellBnb += v;
  }
  const netOf = (a) => { const e = m.get(a); return e ? e.sellBnb - e.buyBnb : null; };

  let all = [];
  for (let off = 0; off < 3000; off += 1000) {
    const { data } = await c.from('strategy_signals')
      .select('token_address,signal_type,metadata,created_at')
      .eq('experiment_id', EXP).eq('signal_type', 'BUY').range(off, off + 999);
    all = all.concat(data || []);
    if (!data || data.length < 1000) break;
  }
  const exec = all.filter((s) => (s.metadata || {}).execution_status === 'executed');

  // ① BP bucket × 净额（executed 票）
  console.log('== ① executed 票 BP status × 净额 ==');
  const bpMap = new Map();
  for (const s of exec) {
    const bp = (s.metadata || {}).buyPoint || {};
    const st = bp.status || '?';
    if (!bpMap.has(st)) bpMap.set(st, { n: 0, sum: 0, win: 0 });
    const e2 = bpMap.get(st); const n2 = netOf(s.token_address);
    if (n2 != null) { e2.n++; e2.sum += n2; if (n2 > 0) e2.win++; }
  }
  for (const [k, v] of bpMap) console.log(`${k}: ${v.n} 票 净额 ${v.sum >= 0 ? '+' : ''}${v.sum.toFixed(4)} 胜率 ${v.win}/${v.n}`);

  // ② 亏损 vs 盈利票因子分布（首 exec 信号 trendFactors）
  console.log('\n== ② 亏损 vs 盈利票首 exec 因子分位 ==');
  const feats = [];
  for (const s of exec) {
    const n2 = netOf(s.token_address); if (n2 == null) continue;
    const tf = (s.metadata || {}).trendFactors || {};
    feats.push({ net: n2, tf });
  }
  feats.sort((a, b) => a.net - b.net);
  const L = feats.filter((f) => f.net < 0), W = feats.filter((f) => f.net > 0);
  const q = (arr, k) => { const vs = arr.map((f) => Number(f.tf[k])).filter((x) => Number.isFinite(x)).sort((a, b) => a - b); if (!vs.length) return 'n/a'; return `p25=${vs[Math.floor(vs.length * .25)]?.toFixed?.(2) ?? vs[Math.floor(vs.length * .25)]} med=${vs[Math.floor(vs.length / 2)]} p75=${vs[Math.floor(vs.length * .75)]}`; };
  const keys = ['tokenAgeSec', 'tradeCount', 'buyVolumeBnb', 'actTotalBnb', 'actBuyBnb', 'holdersExDust', 'buyWallets', 'currentVsLaunchPct', 'tradesNetBuyRatioShortWin', 'tradesNetBuyRatioLongWin', 'tradesRouterPct', 'top2HolderCircPct', 'bundleClusterSize', 'bundleClusterHoldCircPct', 'firstBlockBuyShare', 'cheatActivityLevel', 'cheatStallBurstWave', 'cheatSlowGrindPump', 'maxBlockBuyCircPct', 'riseSpeed', 'recentBlockDropPct'];
  console.log('key | 亏损票(L) | 盈利票(W)');
  for (const k of keys) console.log(`${k}\n  L: ${q(L, k)}\n  W: ${q(W, k)}`);
  // cheatActivityLevel/StallBurstWave 是字符串/数字枚举，看分布
  for (const k of ['cheatActivityLevel', 'cheatStallBurstWave']) {
    const dist = (arr) => { const d = new Map(); for (const f of arr) { const v2 = f.tf[k]; d.set(String(v2), (d.get(String(v2)) || 0) + 1); } return [...d.entries()].map(([a, b]) => `${a}:${b}`).join(' '); };
    console.log(`${k} L: ${dist(L)} | W: ${dist(W)}`);
  }

  // ③ act_low 拒面构成：token 去重，窗口内后续是否 executed
  console.log('\n== ③ factor_gate_act_low 拒面 ==');
  const actLowRejectedTokens = new Map(); // addr -> {rejN, everExec, sym}
  for (const s of all) {
    const md = s.metadata || {};
    if (md.execution_status === 'executed') { if (actLowRejectedTokens.has(s.token_address)) actLowRejectedTokens.get(s.token_address).everExec = true; continue; }
    if (md.execution_reason === 'factor_gate_act_low') {
      if (!actLowRejectedTokens.has(s.token_address)) actLowRejectedTokens.set(s.token_address, { rejN: 0, everExec: false, sym: (md.trendFactors || {}).tokenSymbol || '' });
      actLowRejectedTokens.get(s.token_address).rejN++;
    }
  }
  const alt = [...actLowRejectedTokens.values()];
  const never = alt.filter((x) => !x.everExec).length;
  console.log(`act_low 拒及 token 数 ${alt.length}，其中全程未成交 ${never}、后来成交 ${alt.length - never}`);
  // 其它 factor_gate 拒因同样统计
  for (const r of ['factor_gate_act_ultra', 'factor_gate_cd400_dump_no_absorption', 'factor_gate_pvp_no_big_participation', 'factor_gate_cd403_dump_low_absorption', 'factor_gate_cd405_burst_bundled_wave']) {
    const tk = new Set(); let n3 = 0;
    for (const s of all) { const md = s.metadata || {}; if (md.execution_reason === r) { tk.add(s.token_address); n3++; } }
    let everExec = 0; for (const a of tk) { if (exec.some((s2) => s2.token_address === a)) everExec++; }
    console.log(`${r}: ${n3} 信号 / ${tk.size} token，后来成交 ${everExec}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
