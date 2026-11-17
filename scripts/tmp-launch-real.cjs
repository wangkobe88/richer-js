// 真口径重放：298 票首块/首波买入额（FA wave 定义）+ 首波后承接原料 → data/tmp-launch-real.json
const { dbManager } = require('../src/services/dbManager.js');
const fs = require('fs');
const WINDOWS = [
  ['v109', '029bd863-55e5-4319-91d5-10803a6a9a82'],
  ['v121', '54dac9c5-6fdf-4759-8b5a-2195313b6820'],
  ['v123', 'f454a704-706e-48d4-8049-6f885f9ae46b'],
  ['v129', '4af09d63-1ce1-4987-9c31-baf78c5a5334'],
  ['v132', 'b67b7318-1715-443d-a29b-7919b2db6e65'],
  ['v133', '550f9e89-1deb-49af-98b9-9906265b1161'],
  ['v134', '19ef6433-0c92-47ff-a6fd-9f6bea745b8d'],
];
const DUST = 0.001;
async function main() {
  const c = await dbManager.getClient();
  // 1) 298 票基表（净额+窗）
  const tickets = []; const seenTok = new Set();
  for (const [name, id] of WINDOWS) {
    const { data: tr } = await c.from('trades')
      .select('token_address,trade_direction,input_currency,input_amount,output_currency,output_amount,success')
      .eq('experiment_id', id).range(0, 999);
    const m = new Map();
    for (const t of tr || []) {
      if (t.success === false) continue;
      const buy = t.trade_direction === 'buy';
      const v = buy ? (t.input_currency === 'BNB' ? Number(t.input_amount || 0) : Number(t.output_amount || 0))
        : (t.output_currency === 'BNB' ? Number(t.output_amount || 0) : Number(t.input_amount || 0));
      let e = m.get(t.token_address);
      if (!e) { e = { b: 0, s: 0 }; m.set(t.token_address, e); }
      if (buy) e.b += v; else e.s += v;
    }
    let sigs = [];
    for (let off = 0; off < 3000; off += 1000) {
      const { data } = await c.from('strategy_signals')
        .select('token_address,signal_type,metadata,token_symbol')
        .eq('experiment_id', id).eq('signal_type', 'BUY').range(off, off + 999);
      sigs = sigs.concat(data || []);
      if (!data || data.length < 1000) break;
    }
    const seen = new Set();
    for (const s of sigs) {
      const md = s.metadata || {};
      if (md.execution_status !== 'executed' || seen.has(s.token_address)) continue;
      seen.add(s.token_address);
      if (seenTok.has(s.token_address)) continue;
      seenTok.add(s.token_address);
      const e = m.get(s.token_address); if (!e) continue;
      const tf = md.trendFactors || {};
      tickets.push({
        addr: s.token_address, sym: s.token_symbol || '?', win: name, exp: id, net: e.s - e.b,
        oldAmt: Number.isFinite(Number(tf.firstBlockBuyShare)) ? (Number(tf.buyVolumeBnb) || 0) * Number(tf.firstBlockBuyShare) : null,
        curVs: tf.currentVsLaunchPct != null ? Number(tf.currentVsLaunchPct) : null,
        age: tf.tokenAgeSec != null ? Number(tf.tokenAgeSec) : null,
      });
    }
  }
  console.log(`基表 ${tickets.length} 票`);
  // 2) token_create 时间（批 50）
  const addr2create = new Map();
  for (let i = 0; i < tickets.length; i += 50) {
    const batch = tickets.slice(i, i + 50).map((t) => t.addr);
    const { data } = await c.from('wss_events').select('token_address,block_time')
      .eq('kind', 'token_create').in('token_address', batch);
    for (const r of data || []) if (!addr2create.has(r.token_address)) addr2create.set(r.token_address, r.block_time);
  }
  console.log(`token_create 锚 ${addr2create.size}/${tickets.length}`);
  // 3) per-token ticks 重放（前 180s，并发 5）
  const out = [];
  let done = 0; const queue = [...tickets];
  async function worker() {
    const c2 = await dbManager.getClient();
    while (queue.length) {
      const t = queue.shift(); if (!t) break;
      const create = addr2create.get(t.addr);
      if (!create) { out.push({ ...t, err: 'no_create' }); done++; continue; }
      const end = new Date(new Date(create).getTime() + 180000).toISOString();
      try {
        const { data: rows } = await c2.from('wss_price_ticks')
          .select('block_number,block_time,trade_type,bnb_amount,sender_address,trader_address,price_outlier')
          .eq('token_address', t.addr).gte('block_time', create).lt('block_time', end)
          .order('block_number', { ascending: true }).range(0, 1499);
        const buys = (rows || []).filter((r) => r.trade_type === 'buy' && r.price_outlier !== true && Number(r.bnb_amount) >= DUST);
        const t0 = new Date(create).getTime();
        if (!buys.length) { out.push({ ...t, firstBlockBnb: null, err: 'no_buys' }); done++; continue; }
        // block 分组
        const blocks = new Map();
        for (const b of buys) {
          if (!blocks.has(b.block_number)) blocks.set(b.block_number, []);
          blocks.get(b.block_number).push(b);
        }
        const bl = [...blocks.entries()].sort((a, b2) => a[0] - b2[0]);
        const first = bl[0];
        const firstT = new Date(first[1][0].block_time).getTime();
        // 首波 = 首块 + 首块后 ≤2s 内第一个「有交易」块（含卖块；买额只计 buy）
        let waveBlock = null;
        for (let i = 1; i < bl.length; i++) {
          const bt = new Date(bl[i][1][0].block_time).getTime();
          if (bt - firstT <= 2000) { waveBlock = bl[i]; break; }
        }
        // （严格说「有交易块」含纯卖块，但纯卖块买额=0，对额度无影响；对 wave 钱包数有影响——本分析聚焦额度）
        const sumB = (rs) => rs.reduce((s, r) => s + Number(r.bnb_amount), 0);
        const firstBlockBnb = sumB(first[1]);
        const waveBnb = waveBlock ? firstBlockBnb + sumB(waveBlock[1]) : firstBlockBnb;
        const firstMaxSingle = Math.max(...first[1].map((r) => Number(r.bnb_amount)));
        const waveMaxSingle = waveBlock ? Math.max(firstMaxSingle, Math.max(...waveBlock[1].map((r) => Number(r.bnb_amount)))) : firstMaxSingle;
        // 延伸原料：首波钱包集合与其后 60s 卖出额；首波结束后 60s 新钱包买入额
        const waveWallets = new Set([...first[1], ...(waveBlock ? waveBlock[1] : [])].map((r) => (r.sender_address || r.trader_address || '').toLowerCase()).filter(Boolean));
        const sells = (rows || []).filter((r) => r.trade_type === 'sell' && r.price_outlier !== true);
        const waveEndT = waveBlock ? new Date(waveBlock[1][0].block_time).getTime() : firstT;
        const waveWalletSell60 = sells.filter((r) => { const ts = new Date(r.block_time).getTime(); return ts > waveEndT && ts <= waveEndT + 60000 && waveWallets.has((r.sender_address || r.trader_address || '').toLowerCase()); })
          .reduce((s, r) => s + Number(r.bnb_amount), 0);
        const followBuy60 = buys.filter((r) => { const ts = new Date(r.block_time).getTime(); return ts > waveEndT && ts <= waveEndT + 60000 && !waveWallets.has((r.sender_address || r.trader_address || '').toLowerCase()); })
          .reduce((s, r) => s + Number(r.bnb_amount), 0);
        const followNewWallets = new Set(buys.filter((r) => { const ts = new Date(r.block_time).getTime(); return ts > waveEndT && ts <= waveEndT + 60000 && !waveWallets.has((r.sender_address || r.trader_address || '').toLowerCase()); })
          .map((r) => (r.sender_address || r.trader_address || '').toLowerCase()).filter(Boolean)).size;
        out.push({
          ...t, firstBlockBnb: +firstBlockBnb.toFixed(4), waveBnb: +waveBnb.toFixed(4),
          firstMaxSingle: +firstMaxSingle.toFixed(4), waveMaxSingle: +waveMaxSingle.toFixed(4),
          waveWalletSell60: +waveWalletSell60.toFixed(4), followBuy60: +followBuy60.toFixed(4), followNewWallets,
          truncated: (rows || []).length >= 1500,
        });
      } catch (e2) {
        out.push({ ...t, err: e2.message });
      }
      done++;
      if (done % 50 === 0) console.log(`  …${done}/${tickets.length}`);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);
  fs.writeFileSync(__dirname + '/../data/tmp-launch-real.json', JSON.stringify(out));
  const ok = out.filter((r) => r.firstBlockBnb != null);
  console.log(`落盘 ${out.length} 行（成功 ${ok.length}，失败 ${out.length - ok.length}）→ data/tmp-launch-real.json`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
