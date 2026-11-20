// FP28 端到端重放（182）：真 buildBuyPointSnapshot+evaluateFactorPreBuy 对四窗 W1 域候选票
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot.js');
const M = require('../src/market-analysis/factor-pre-buy-check.js');

const EXPS = [
  ['w1003热', 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f'],
  ['w1019中', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['w1012中', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['w1103冷', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];

async function loadTrades(expId) {
  const sb = dbManager.getClient();
  const { data: trades } = await sb.from('trades')
    .select('token_address,token_symbol,trade_direction,input_amount,output_amount,signal_id,created_at')
    .eq('experiment_id', expId).order('created_at', { ascending: true }).limit(600);
  const by = new Map();
  for (const t of trades) {
    if (!by.has(t.token_address)) by.set(t.token_address, { symbol: t.token_symbol, cost: 0, got: 0, sig: null, at: null });
    const e = by.get(t.token_address);
    if (t.trade_direction === 'buy') { e.cost += Number(t.input_amount || 0); e.sig = t.signal_id; e.at = t.created_at; }
    else e.got += Number(t.output_amount || 0);
  }
  const tokens = [...by.entries()].map(([addr, v]) => ({ addr, symbol: v.symbol, pnl: v.got - v.cost, sig: v.sig, at: v.at }));
  const ids = tokens.map(t => t.sig).filter(Boolean);
  const meta = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const { data } = await sb.from('strategy_signals').select('id,metadata').in('id', ids.slice(i, i + 50));
    for (const r of data || []) meta.set(r.id, r.metadata || {});
  }
  return tokens.map(t => ({ ...t, A: ((meta.get(t.sig) || {}).buyPoint || {}).anchors || {} }));
}

(async () => {
  const sb = dbManager.getClient();
  console.log('模块版本:', M.FACTOR_PREBUY_VERSION);
  const totals = { n: 0, win: 0, pnl: 0 };
  const detail = [];
  for (const [w, id] of EXPS) {
    const ss = await loadTrades(id);
    // W1 域候选（ath<40 ∧ age<90）——FP28 三腿的域，逐票真 snapshot
    const cand = ss.filter(s => Number(s.A.athVsLaunchPct) < 40 && Number(s.A.tokenAgeSec) < 90);
    let hit = 0, winN = 0, pnl = 0; const misses = [];
    for (const s of cand) {
      // tokenMeta：createdAt 从 wss_events token_create
      const { data: ev } = await sb.from('wss_events').select('block_time,platform,payload')
        .eq('kind', 'token_create').eq('token_address', s.addr).limit(1);
      if (!ev?.[0]) { misses.push(s.symbol + ':无token_create'); continue; }
      const platform = ev[0].platform || 'fourmeme';
      const totalSupply = platform === 'flap' ? 1e9 : 1e9;
      // 锚窗 ticks：create → 锚（买点）
      const { data: ticks } = await sb.from('wss_price_ticks')
        .select('block_time,block_number,log_index,trade_type,bnb_amount,token_amount,price_bnb,sender_address,trader_address')
        .eq('token_address', s.addr).lte('block_time', s.at)
        .order('block_time', { ascending: true }).limit(2000);
      if (!ticks?.length) { misses.push(s.symbol + ':无ticks'); continue; }
      const meta0 = { platform, totalSupply, createdAt: ev[0].block_time };
      try {
        const snap = buildBuyPointSnapshot(ticks, meta0, {});
        const r = M.evaluateFactorPreBuy(snap);
        const arm = (r.arms || []).includes('launch_fail_dead');
        if (arm) { hit++; winN += s.pnl > 0.0005 ? 1 : 0; pnl += s.pnl; }
        detail.push({ w, sym: s.symbol, pnl: s.pnl, arm, tail7: ((snap.buyDerived || {}).activity || {}).nearTail7BuyN });
      } catch (e) { misses.push(s.symbol + ':' + e.message.slice(0, 30)); }
    }
    console.log(`[${w}] 域候选 ${cand.length} | FP28 真命中 ${hit} 胜${winN} 净${pnl.toFixed(3)}${misses.length ? ' | 跳过:' + misses.length : ''}`);
    totals.n += hit; totals.win += winN; totals.pnl += pnl;
  }
  console.log(`\n四窗合计: FP28 命中 ${totals.n} 票 胜${totals.win} 净${totals.pnl.toFixed(3)}`);
  // 关键票核对
  for (const sym of ['Missy', '唐三角', '凑凑', 'Maggie', 'MOLLY', 'テスラSI能飞', '车水马龙', 'Bramble']) {
    const d = detail.find(x => x.sym && x.sym.includes(sym));
    if (d) console.log(' ', sym.padEnd(10), d.w, 'pnl', d.pnl.toFixed(4), 'tail7=' + d.tail7, d.arm ? '→拦' : '→放');
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
