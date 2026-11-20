const { dbManager } = require('../src/services/dbManager');

const BUY_DUST = 0.015;
const BIG_LINE = 0.19;
const WAVE_MS = 2000;
const LAUNCH_WIN_MS = 90000;

async function scan(sb, expId, label) {
  const { data: buys } = await sb.from('trades')
    .select('token_address,input_amount,token_symbol').eq('experiment_id', expId)
    .eq('trade_direction', 'buy').eq('trade_status', 'success').limit(1000);
  const { data: sells } = await sb.from('trades')
    .select('token_address,output_amount').eq('experiment_id', expId)
    .eq('trade_direction', 'sell').eq('trade_status', 'success').limit(2000);
  const sym = new Map(), buyIn = new Map(), sellOut = new Map();
  for (const b of buys || []) { sym.set(b.token_address, b.token_symbol); buyIn.set(b.token_address, (buyIn.get(b.token_address) || 0) + Number(b.input_amount)); }
  for (const s of sells || []) sellOut.set(s.token_address, (sellOut.get(s.token_address) || 0) + Number(s.output_amount));
  const tokens = [...new Set((buys || []).map(b => b.token_address))];
  console.log(`\n########## ${label}: 成交 ${tokens.length} 票 ##########`);
  if (!tokens.length) return;

  const out = [];
  for (const t of tokens) {
    const { data: ticks } = await sb.from('wss_price_ticks')
      .select('block_number,block_time,trade_type,bnb_amount,sender_address,trader_address')
      .eq('token_address', t).gt('block_number', 0)
      .order('block_number', { ascending: true }).order('log_index', { ascending: true })
      .limit(600);
    const tsAll = ticks || [];
    if (!tsAll.length) { out.push({ t, f0: null }); continue; }
    const t0 = new Date(tsAll[0].block_time).getTime();
    const ts = tsAll.filter(r => new Date(r.block_time).getTime() - t0 <= LAUNCH_WIN_MS); // 出生窗 90s
    const wallet = r => (r.sender_address || r.trader_address || '').toLowerCase();
    const fb = ts[0].block_number;
    const fbTs = new Date(ts[0].block_time).getTime();
    const wBuys = new Map(); const firstBuyBlk = new Map();
    for (const r of ts) {
      if (r.trade_type !== 'buy') continue;
      const w = wallet(r); if (!w) continue;
      wBuys.set(w, (wBuys.get(w) || 0) + Number(r.bnb_amount || 0));
      if (!firstBuyBlk.has(w)) firstBuyBlk.set(w, r.block_number);
    }
    const blkFirstTs = new Map();
    for (const r of ts) if (!blkFirstTs.has(r.block_number)) blkFirstTs.set(r.block_number, new Date(r.block_time).getTime());
    const sizedW = w => (wBuys.get(w) || 0) >= BUY_DUST;
    let f0 = 0; const fbWallets = new Set();
    for (const [w, blk] of firstBuyBlk) if (blk === fb && sizedW(w)) { f0++; fbWallets.add(w); }
    const waveBlks = new Set();
    for (const [blk, tsMs] of blkFirstTs) if (blk > fb && tsMs - fbTs <= WAVE_MS) waveBlks.add(blk);
    let fNext = 0; const waveWallets = new Set(fbWallets);
    for (const [w, blk] of firstBuyBlk) if (waveBlks.has(blk) && sizedW(w) && !waveWallets.has(w)) { fNext++; waveWallets.add(w); }
    let waveBnb = 0; for (const w of waveWallets) waveBnb += wBuys.get(w);
    let bigBuy = 0; for (const v of wBuys.values()) if (v >= BIG_LINE) bigBuy += v;
    const pnl = (sellOut.get(t) || 0) - (buyIn.get(t) || 0);
    out.push({ t, sym: sym.get(t), f0, wave: f0 + fNext, waveBnb: +waveBnb.toFixed(3), bigBuy: +bigBuy.toFixed(3), pnl: +pnl.toFixed(4) });
  }

  const valid = out.filter(o => o.f0 !== null);
  const bands = [
    ['f0 >= 4 ', o => o.f0 >= 4],
    ['f0 == 3 ', o => o.f0 === 3],
    ['f0 == 2 ', o => o.f0 === 2],
    ['f0 <= 1 ', o => o.f0 <= 1],
  ];
  for (const [name, f] of bands) {
    const sub = valid.filter(f);
    if (!sub.length) { console.log(`${name}: 0 票`); continue; }
    const tot = sub.reduce((a, o) => a + o.pnl, 0);
    const neg = sub.filter(o => o.pnl < 0).length;
    const pos = sub.filter(o => o.pnl > 0);
    console.log(`${name}: ${sub.length} 票 | pnl Σ=${tot.toFixed(3)} | 负 ${neg} 正 ${pos.length}${pos.length ? ' (Σ+' + pos.reduce((a, o) => a + o.pnl, 0).toFixed(3) + ')' : ''}`);
  }
  console.log('-- f0>=4 全列:');
  for (const o of valid.filter(o => o.f0 >= 4).sort((a, b) => a.pnl - b.pnl))
    console.log(`   ${o.t.slice(0, 10)} ${String(o.sym).slice(0, 14)} f0=${o.f0} wave=${o.wave} 波额=${o.waveBnb}B bigBuy90s=${o.bigBuy}B pnl=${o.pnl}`);
  console.log('-- f0==3 列:');
  for (const o of valid.filter(o => o.f0 === 3).sort((a, b) => a.pnl - b.pnl))
    console.log(`   ${o.t.slice(0, 10)} ${String(o.sym).slice(0, 14)} f0=${o.f0} wave=${o.wave} 波额=${o.waveBnb}B pnl=${o.pnl}`);
}

async function main() {
  const sb = dbManager.getClient();
  await scan(sb, 'b8ae9f2e-832f-42db-bbda-8d8701aecb63', 'bt-v156 48h win1019 (主案窗)');
  await scan(sb, 'd3453504-03d5-480c-89e0-483db930361c', 'bt-v153 36h win1012');
  await scan(sb, '8ebaccce-62c6-4209-a2a0-40f361c49bf9', 'bt-v150 36h win1012 (ladder v32)');
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
