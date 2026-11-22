#!/usr/bin/env node
/**
 * JG-32e-3（182 跑）：「famous 同块买入占比」全域四窗重放——门形状判别力验证
 * 口径：每票首个 BUY 信号时刻 tBuy，观测窗 [t0, tBuy] 买入：
 *   famBlkBunPct = famous 所在块(且块内≥2 钱包)买入额 / 观测窗总买入额 ×100
 * 前向收益=fwdPeak（锚后 60min 峰值/锚价−1，JG-32c 同款）+ stall 出口对照。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');
const FAM = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '../config/rosters/famous-copy-wallets.json'), 'utf8')).wallets.map(w => String(w).toLowerCase()));
const WINDOWS = [
  ['w1003', '9e9163de-a677-4d39-9c33-9ec9df05e400', '2026-10-02T23:50:00.000Z', '2026-10-05T06:00:00.000Z'],
  ['w1019', 'ce102e94-293c-4f8f-af98-cd06f4b0e98c', '2026-10-19T00:00:00.000Z', '2026-10-21T00:00:00.000Z'],
  ['w1012', 'dddbe79e-480a-402a-aa35-85a72d2f591e', '2026-10-12T00:00:00.000Z', '2026-10-13T00:00:00.000Z'],
  ['w1103', '2448116a-bebe-457d-9d8a-b4556c9a8e0d', '2026-11-04T00:00:00.000Z', '2026-11-05T00:00:00.000Z'],
];
const num = v => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : 0; };
async function fetchAll(from, pageSize = 1000) {
  const rows = []; let offset = 0;
  for (;;) { const page = await from.range(offset, offset + pageSize - 1); if (page.error) throw new Error(page.error.message); rows.push(...page.data); if (page.data.length < pageSize) return rows; offset += pageSize; }
}
(async () => {
  const db = dbManager.getClient();
  const grand = [];
  for (const [wname, expId, winStart, winEnd] of WINDOWS) {
    const sigs = await fetchAll(db.from('strategy_signals').select('token_address, token_symbol, created_at').eq('experiment_id', expId).eq('signal_type', 'BUY').order('created_at', { ascending: true }));
    const firstSig = new Map();
    for (const s of sigs) { const a = (s.token_address||'').toLowerCase(); if (!a || firstSig.has(a)) continue; firstSig.set(a, { ts: s.created_at, sym: s.token_symbol || '' }); }
    const addrs = [...firstSig.keys()];
    const spillEnd = new Date(new Date(winEnd).getTime() + 6*3600_000).toISOString();
    const tickByToken = new Map();
    for (let i = 0; i < addrs.length; i += 50) {
      const trows = await fetchAll(db.from('wss_price_ticks')
        .select('token_address, trade_type, sender_address, trader_address, bnb_amount, price_bnb, price_outlier, block_number, log_index, block_time')
        .in('token_address', addrs.slice(i, i+50))
        .gte('block_time', new Date(new Date(winStart).getTime() - 600_000).toISOString())
        .lte('block_time', spillEnd));
      for (const r of trows) { const a = r.token_address.toLowerCase(); let arr = tickByToken.get(a); if (!arr) { arr = []; tickByToken.set(a, arr); } arr.push(r); }
    }
    const res = [];
    for (const [a, e] of firstSig) {
      const ticks = tickByToken.get(a) || [];
      if (!ticks.length) continue;
      const rows = ticks.map((r,i)=>({...r,_t:new Date(r.block_time).getTime(),_w:((r.sender_address||r.trader_address)||'').toLowerCase(),_b:num(r.bnb_amount),_p:num(r.price_bnb)}))
        .sort((x,y)=>x.block_number-y.block_number||x.log_index-y.log_index);
      const t0 = rows[0]._t, tBuy = new Date(e.ts).getTime();
      const rel = rows.filter(r=>!r.price_outlier&&r._p>0);
      const pAt = rel.filter(r=>r._t<=tBuy).slice(-1)[0];
      if (!pAt) continue;
      const obs = rows.filter(r=>r._t>=t0 && r._t<=tBuy && r.trade_type==='buy');
      const totalB = obs.reduce((s,r)=>s+r._b,0);
      if (totalB < 0.1) continue; // 尘票跳过
      const byBlk = new Map();
      for (const r of obs) { let x=byBlk.get(r.block_number); if(!x){x={bnb:0,ws:new Set(),fam:false};byBlk.set(r.block_number,x);} x.bnb+=r._b; x.ws.add(r._w); if(FAM.has(r._w)) x.fam=true; }
      let famBlkBun = 0;
      for (const [,x] of byBlk) if (x.fam && x.ws.size>=2) famBlkBun += x.bnb;
      const pct = famBlkBun/totalB*100;
      // fwdPeak 60min
      const seg = rel.filter(r=>r._t>=tBuy && r._t<=tBuy+3600_000);
      const fwd = seg.length ? (Math.max(...seg.map(r=>r._p))/pAt._p-1)*100 : null;
      res.push({ addr: a, sym: e.sym, pct: +pct.toFixed(1), fwd: fwd===null?null:+fwd.toFixed(1) });
    }
    // 分层统计
    const line = (label, list) => {
      if (!list.length) { console.log(`  ${label}: 0`); return; }
      const fwdOk = list.filter(r=>r.fwd!==null);
      const med = arr => arr.length ? arr.sort((x,y)=>x-y)[Math.floor(arr.length/2)] : null;
      const fwdMed = med(fwdOk.map(r=>r.fwd));
      const pos = fwdOk.filter(r=>r.fwd>20).length, tail = fwdOk.filter(r=>r.fwd>=200).length;
      console.log(`  ${label}: n=${list.length} fwd中位=${fwdMed===null?'-':fwdMed.toFixed(1)}% ≥20%:${pos} ≥200%(肥尾):${tail}${tail?` → ${fwdOk.filter(r=>r.fwd>=200).sort((a,b)=>b.fwd-a.fwd).slice(0,3).map(r=>(r.sym||r.addr.slice(0,6))+'='+r.fwd).join(',')}:''}`);
    };
    console.log(`\n═══ ${wname} ═══ 首信号票 ${res.length}`);
    line('全域(基线)', res);
    line('famBlkBun=0%', res.filter(r=>r.pct===0));
    line('famBlkBun (0,15%)', res.filter(r=>r.pct>0&&r.pct<15));
    line('famBlkBun ≥15%', res.filter(r=>r.pct>=15));
    line('famBlkBun ≥30%', res.filter(r=>r.pct>=30));
    grand.push({ wname, res });
  }
  console.log('\n════ 四窗合计 ════');
  for (const [label, f] of [['=0', r=>r.pct===0], ['(0,15)', r=>r.pct>0&&r.pct<15], ['≥15', r=>r.pct>=15], ['≥30', r=>r.pct>=30]]) {
    const all = grand.flatMap(g=>g.res.filter(f));
    const fwdOk = all.filter(r=>r.fwd!==null).sort((a,b)=>a.fwd-b.fwd);
    const med = fwdOk.length?fwdOk[Math.floor(fwdOk.length/2)].fwd:null;
    console.log(`${label}: n=${all.length} fwd中位=${med===null?'-':med.toFixed(1)}% ≥20%:${fwdOk.filter(r=>r.fwd>20).length} ≥200%:${fwdOk.filter(r=>r.fwd>=200).length}（${fwdOk.filter(r=>r.fwd>=200).slice(-5).map(r=>(r.sym||r.addr.slice(0,6))+'='+r.fwd).join(',')}）`);
  }
  process.exit(0);
})().catch(e=>{console.error('失败:',e.message);process.exit(1);});
