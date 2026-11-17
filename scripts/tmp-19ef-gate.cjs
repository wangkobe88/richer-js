// bt-v134 (19ef6433) 拒因分布 + 亏损票门链轨迹 + 策略引用
const { dbManager } = require('../src/services/dbManager.js');
const EXP = '19ef6433-0c92-47ff-a6fd-9f6bea745b8d';
async function main() {
  const c = await dbManager.getClient();
  // 策略引用
  const { data: erow } = await c.from('experiments').select('config').eq('id', EXP).limit(1);
  const cfg = (erow && erow[0] && erow[0].config) || {};
  const fw = cfg.fourmemeWs || {};
  console.log('cheatCheck:', JSON.stringify(fw.cheatCheck ? { enabled: fw.cheatCheck.enabled } : null));
  const refs = (cfg.strategiesConfig && cfg.strategiesConfig.libraryRefs) || [];
  console.log('libraryRefs:', JSON.stringify(refs));
  const strat = cfg.strategies || [];
  for (const st of strat) {
    if (st.side === 'buy') {
      console.log(`buy strategy legs=${(st.legs || []).length}`);
      for (const l of (st.legs || []).slice(0, 20)) console.log(`  ${l.id || l.name} | ${String(l.condition || '').slice(0, 160)}`);
    }
  }

  // 拉 trades per-token net（复用）
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
  const nets = [...m.entries()].map(([addr, e]) => ({ addr, sym: e.sym, net: e.sellBnb - e.buyBnb }));
  const tot = nets.reduce((s, x) => s + x.net, 0);
  const win = nets.filter((x) => x.net > 0).length;
  console.log(`\n== 总净额 ${tot >= 0 ? '+' : ''}${tot.toFixed(4)} BNB | ${win}/${nets.length} 票胜率 ${(win / nets.length * 100).toFixed(1)}% ==`);
  const lossSum = nets.filter((x) => x.net < 0).reduce((s, x) => s + x.net, 0);
  const winSum = nets.filter((x) => x.net > 0).reduce((s, x) => s + x.net, 0);
  console.log(`亏损票合计 ${lossSum.toFixed(4)} / 盈利票合计 +${winSum.toFixed(4)}`);

  // signals 全量
  let all = [];
  for (let off = 0; off < 3000; off += 1000) {
    const { data } = await c.from('strategy_signals')
      .select('token_address,token_symbol,signal_type,action,reason,executed,created_at,metadata')
      .eq('experiment_id', EXP).range(off, off + 999);
    all = all.concat(data || []);
    if (!data || data.length < 1000) break;
  }
  console.log(`\nsignals ${all.length} 行`);
  const buys = all.filter((s) => s.signal_type === 'BUY');
  const stMap = new Map();
  for (const s of buys) {
    const md = s.metadata || {};
    const st = md.execution_status || s.executed || '?';
    stMap.set(st, (stMap.get(st) || 0) + 1);
  }
  console.log('-- BUY execution_status 分布 --');
  for (const [k, v] of [...stMap.entries()].sort((a, b) => b[1] - a[1])) console.log(`${v}\t${k}`);
  // 拒因归类
  const rejMap = new Map();
  for (const s of buys) {
    const md = s.metadata || {};
    if (md.execution_status === 'executed' || md.execution_status === 'success') continue;
    const r = md.execution_reason || md.reason || s.reason || '(none)';
    rejMap.set(r, (rejMap.get(r) || 0) + 1);
  }
  console.log('-- BUY 拒因分布 --');
  for (const [k, v] of [...rejMap.entries()].sort((a, b) => b[1] - a[1])) console.log(`${v}\t${k}`);

  // 亏损票的门链轨迹（买入成功的票，net<0，看它们放行时 factorCheck/cheat/buyPoint 说了什么）
  const loss = nets.filter((x) => x.net < 0).sort((a, b) => a.net - b.net);
  console.log(`\n-- 亏损票门链轨迹（最差 25 张）--`);
  for (const x of loss.slice(0, 25)) {
    const sg = buys.filter((s) => s.token_address === x.addr && (s.metadata || {}).execution_status === 'executed');
    if (!sg.length) { console.log(`${x.net.toFixed(4)} ${x.sym} (无执行信号行)`); continue; }
    const md = sg[sg.length - 1].metadata || {};
    const fc = md.factorCheck || {};
    const cc = md.cheatCheck || {};
    const bp = md.buyPoint || {};
    const gate = md.signalGate || {};
    const leg = (gate.legId || md.strategyId || '?');
    console.log(`${x.net.toFixed(4)} ${x.sym} leg=${leg} trig=${gate.triggerNo ?? '?'} fp=${fc.pass === undefined ? (fc.blocked ?? JSON.stringify(fc).slice(0, 40)) : fc.pass}${fc.reason ? '/' + fc.reason : ''} cheat=${cc.grade ?? (cc.info && cc.info.grade) ?? '?'} bp=${bp.bucket ?? (bp.info && bp.info.bucket) ?? '?'}${bp.rule ? '/' + bp.rule : ''}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
