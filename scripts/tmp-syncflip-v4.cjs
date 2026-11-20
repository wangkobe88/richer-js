require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const WINDOWS = [
  ['w1003热', 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f'],
  ['w1019中', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['w1012中', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['w1103冷', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];
const ROUTERS = require('../src/trading-engine/pre-check/aggregator-routers').AGGREGATOR_ROUTER_ADDRS;
function wallet(r) { return (r.sender_address || r.trader_address || '').toLowerCase(); }
async function main() {
  const sb = dbManager.getClient();
  const all = [];
  for (const [wname, exp] of WINDOWS) {
    const trs = [];
    for (let off = 0; ; off += 1000) {
      const { data: rows } = await sb.from('trades').select('token_address,token_symbol,trade_direction,input_amount,output_amount,created_at')
        .eq('experiment_id', exp).order('created_at', { ascending: true }).range(off, off + 999);
      if (!rows || !rows.length) break; trs.push(...rows); if (rows.length < 1000) break;
    }
    const { data: sigs } = await sb.from('strategy_signals').select('token_address,created_at,metadata').eq('experiment_id', exp).eq('signal_type', 'BUY').order('created_at').limit(5000);
    const firstSig = new Map();
    for (const s of sigs || []) if (!firstSig.has(s.token_address)) firstSig.set(s.token_address, s);
    const pnl = new Map();
    for (const t of trs) { const e = pnl.get(t.token_address) || { sym: t.token_symbol, buy: 0, sell: 0 }; if (t.trade_direction === 'buy') e.buy += Number(t.input_amount || 0); else e.sell += Number(t.output_amount || 0); pnl.set(t.token_address, e); }
    for (const [addr, e] of pnl) {
      if (e.buy <= 0) continue;
      const sig = firstSig.get(addr);
      const anchorIso = sig?.created_at || trs.find(t => t.token_address === addr && t.trade_direction === 'buy')?.created_at;
      const { data: rows } = await sb.from('wss_price_ticks').select('block_time,trade_type,sender_address,trader_address,bnb_amount,block_number')
        .eq('token_address', addr).lte('block_time', anchorIso).order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(3000);
      const wstat = new Map();
      for (const r of rows || []) { const w = wallet(r); if (!w || ROUTERS.has(w)) continue; const el = wstat.get(w) || { buy: 0, sell: 0 }; if (r.trade_type === 'buy') el.buy += Number(r.bnb_amount); else el.sell += Number(r.bnb_amount); wstat.set(w, el); }
      const oversellBnb = [...wstat.values()].filter(e2 => e2.sell >= 0.3 && e2.sell > e2.buy * 1.5).reduce((s, e2) => s + e2.sell, 0);
      // nearTail7BuyN：锚前 7s 买入笔数
      const t7 = (rows || []).filter(r => r.trade_type === 'buy' && r.block_time > anchorIso && (new Date(anchorIso) - new Date(r.block_time)) / 1000 <= 7).length;
      const anc = sig?.metadata?.buyPoint?.anchors || {};
      all.push({ win: wname, addr, sym: e.sym, pnl: e.sell - e.buy, walletN: wstat.size, oversellBnb,
        ath: anc.athVsLaunchPct, age: anc.tokenAgeSec, t7, fp28hit: anc.athVsLaunchPct != null && anc.athVsLaunchPct < 40 && anc.tokenAgeSec != null && anc.tokenAgeSec < 90 && t7 <= 2 });
    }
  }
  const S = (minBnb, maxW) => all.filter(p => p.oversellBnb >= minBnb && p.walletN <= maxW);
  console.log(`敏感性（命中/Σ/正票数）：`);
  for (const [b, w] of [[0.4,12],[0.5,12],[0.6,12],[0.5,10],[0.5,14],[0.5,15],[0.3,12],[1.0,12]]) {
    const h = S(b, w); const pos = h.filter(x => x.pnl > 0.001);
    console.log(`  超卖≥${b}B ∧ 钱包≤${w}: ${h.length}票 Σ${h.reduce((s,x)=>s+x.pnl,0).toFixed(3)} 正票${pos.length}(Σ${pos.reduce((s,x)=>s+x.pnl,0).toFixed(3)})`);
  }
  console.log(`\nA 轴（0.5/12）命中 9 票 vs FP28 重叠：`);
  for (const p of S(0.5, 12)) {
    console.log(`  [${p.win}] ${p.sym} ${p.addr.slice(0,10)}… ${p.pnl>=0?'+':''}${p.pnl.toFixed(4)} w${p.walletN} 超卖${p.oversellBnb.toFixed(2)}B | ath=${p.ath?.toFixed(1)} age=${p.age} t7=${p.t7} → FP28:${p.fp28hit ? '已拦(重叠)' : '未拦'}`);
  }
  const only = S(0.5, 12).filter(p => !p.fp28hit);
  console.log(`净增量（FP28 之外）: ${only.length} 票 Σ${only.reduce((s,x)=>s+x.pnl,0).toFixed(3)}B 正票 ${only.filter(x=>x.pnl>0.001).length}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
