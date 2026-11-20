const { dbManager } = require('../src/services/dbManager');

const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
const BUY_DUST = 0.015;   // holderDustBnb 尘线（f0/wave 计数口径）
const BIG_LINE = 0.19;    // bigBuy 线
const WAVE_MS = 2000;     // 首两波窗

async function main() {
  const sb = dbManager.getClient();

  // 成交票 + 盈亏
  const { data: buys } = await sb.from('trades')
    .select('token_address,input_amount,token_symbol').eq('experiment_id', EXP)
    .eq('trade_direction', 'buy').eq('trade_status', 'success').limit(1000);
  const { data: sells } = await sb.from('trades')
    .select('token_address,output_amount').eq('experiment_id', EXP)
    .eq('trade_direction', 'sell').eq('trade_status', 'success').limit(2000);
  const sym = new Map(), buyIn = new Map(), sellOut = new Map();
  for (const b of buys || []) { sym.set(b.token_address, b.token_symbol); buyIn.set(b.token_address, (buyIn.get(b.token_address) || 0) + Number(b.input_amount)); }
  for (const s of sells || []) sellOut.set(s.token_address, (sellOut.get(s.token_address) || 0) + Number(s.output_amount));
  const tokens = [...new Set((buys || []).map(b => b.token_address))];
  console.log('成交票数:', tokens.length);

  // 每票首块形状重放
  const out = [];
  let done = 0;
  for (const t of tokens) {
    const { data: ticks } = await sb.from('wss_price_ticks')
      .select('block_number,block_time,trade_type,bnb_amount,sender_address,trader_address')
      .eq('token_address', t)
      .gt('block_number', 0)
      .order('block_number', { ascending: true })
      .order('log_index', { ascending: true })
      .limit(500);
    const ts = ticks || [];
    if (!ts.length) { out.push({ t, f0: null }); done++; continue; }
    const wallet = r => (r.sender_address || r.trader_address || '').toLowerCase();
    const fb = ts[0].block_number;
    const fbTs = new Date(ts[0].block_time).getTime();
    // 出生窗内（简化：拉到的 500 行都当出生窗原料——90s 出生窗内行数 <500 则精确）
    // 每钱包出生窗累计买入（bigBuy 口径）与首买指纹
    const wBuys = new Map(); const firstBuyBlk = new Map();
    for (const r of ts) {
      if (r.trade_type !== 'buy') continue;
      const w = wallet(r); if (!w) continue;
      const amt = Number(r.bnb_amount || 0);
      wBuys.set(w, (wBuys.get(w) || 0) + amt);
      if (!firstBuyBlk.has(w)) firstBuyBlk.set(w, r.block_number);
    }
    // 块首行时间（wave 窗）
    const blkFirstTs = new Map();
    for (const r of ts) {
      if (!blkFirstTs.has(r.block_number)) blkFirstTs.set(r.block_number, new Date(r.block_time).getTime());
    }
    // f0 / wave（尘线：累计买入 ≥0.015 的钱包）
    const sizedW = w => (wBuys.get(w) || 0) >= BUY_DUST;
    let f0 = 0, f0Bnb = 0;
    const fbWallets = new Set();
    for (const [w, blk] of firstBuyBlk) {
      if (blk === fb && sizedW(w)) { f0++; fbWallets.add(w); }
    }
    for (const w of fbWallets) f0Bnb += wBuys.get(w);
    // wave = f0 + 首块后 ≤2s 内全部块的首买钱包
    const waveBlks = new Set();
    for (const [blk, tsMs] of blkFirstTs) if (blk > fb && tsMs - fbTs <= WAVE_MS) waveBlks.add(blk);
    let fNext = 0; const waveWallets = new Set(fbWallets);
    for (const [w, blk] of firstBuyBlk) {
      if (waveBlks.has(blk) && sizedW(w) && !waveWallets.has(w)) { fNext++; waveWallets.add(w); }
    }
    let waveBnb = 0;
    for (const w of waveWallets) waveBnb += wBuys.get(w);
    // bigBuy（不做 T172 等额合并——简化，误差≤等额对跨线情形）
    let bigBuy = 0;
    for (const v of wBuys.values()) if (v >= BIG_LINE) bigBuy += v;
    // 首块总买额（raw，含尘埃）
    let fbRawBnb = 0;
    for (const r of ts) if (r.block_number === fb && r.trade_type === 'buy') fbRawBnb += Number(r.bnb_amount || 0);

    const pnl = (sellOut.get(t) || 0) - (buyIn.get(t) || 0);
    out.push({ t, sym: sym.get(t), f0, wave: f0 + fNext, waveBnb: +waveBnb.toFixed(3), f0Bnb: +f0Bnb.toFixed(3), fbRawBnb: +fbRawBnb.toFixed(3), bigBuy: +bigBuy.toFixed(3), pnl: +pnl.toFixed(4) });
    done++;
    if (done % 20 === 0) console.error(`  ...${done}/${tokens.length}`);
  }

  // 汇总
  const valid = out.filter(o => o.f0 !== null);
  console.log('\n=== 首块形状分布（成交面 ' + valid.length + ' 票）===');
  const bands = [
    ['f0 >= 4', o => o.f0 >= 4],
    ['f0 == 3', o => o.f0 === 3],
    ['f0 == 2', o => o.f0 === 2],
    ['f0 <= 1', o => o.f0 <= 1],
    ['wave >= 6', o => o.wave >= 6],
    ['wave >= 4', o => o.wave >= 4],
    ['首两波额 >= 2.0B', o => o.waveBnb >= 2.0],
    ['首两波额 >= 1.5B', o => o.waveBnb >= 1.5],
    ['bigBuy >= 2.0B', o => o.bigBuy >= 2.0],
  ];
  for (const [name, f] of bands) {
    const sub = valid.filter(f);
    if (!sub.length) { console.log(`${name}: 0 票`); continue; }
    const tot = sub.reduce((a, o) => a + o.pnl, 0);
    const neg = sub.filter(o => o.pnl < 0).length;
    console.log(`${name}: ${sub.length} 票 | pnl Σ=${tot.toFixed(3)} | 负 ${neg}/${sub.length}`);
  }
  console.log('\n=== f0>=4 全列 ===');
  for (const o of valid.filter(o => o.f0 >= 4).sort((a, b) => a.pnl - b.pnl))
    console.log(`  ${o.t.slice(0, 10)} ${String(o.sym).slice(0, 12)} f0=${o.f0} wave=${o.wave} 波额=${o.waveBnb}B bigBuy=${o.bigBuy}B pnl=${o.pnl}`);
  console.log('\n=== wave>=6 或 波额>=2.0（f0<4 子集）===');
  for (const o of valid.filter(o => o.f0 < 4 && (o.wave >= 6 || o.waveBnb >= 2.0)).sort((a, b) => a.pnl - b.pnl))
    console.log(`  ${o.t.slice(0, 10)} ${String(o.sym).slice(0, 12)} f0=${o.f0} wave=${o.wave} 波额=${o.waveBnb}B bigBuy=${o.bigBuy}B pnl=${o.pnl}`);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
