#!/usr/bin/env node
/**
 * JG-32e-4（182 跑）：用户框架全域检验——B 形状（首波清仓∧后波持有）× famBlkBun 2×2 分层
 * 锚=每票首个 BUY 信号；B 形状判定=JG-32c 同款（earlyCut=t0+10s、首波≥0.1B 全清仓≤10%、后波≥2 家持有≥50%）
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
      if (totalB < 0.1) continue;
      // famBlkBun
      const byBlk = new Map();
      for (const r of obs) { let x=byBlk.get(r.block_number); if(!x){x={bnb:0,ws:new Set(),fam:false};byBlk.set(r.block_number,x);} x.bnb+=r._b; x.ws.add(r._w); if(FAM.has(r._w)) x.fam=true; }
      let famBlkBun = 0;
      for (const [,x] of byBlk) if (x.fam && x.ws.size>=2) famBlkBun += x.bnb;
      const pct = famBlkBun/totalB*100;
      // B 形状（JG-32c 同款，钱包账本 as-of tBuy 全窗）
      const all = rows.filter(r=>r._t<=tBuy);
      const wBuy = new Map(), wSell = new Map(), wFirstT = new Map();
      for (const r of all) {
        if (!r._w) continue;
        if (r.trade_type==='buy') { wBuy.set(r._w,(wBuy.get(r._w)||0)+r._b); if(!wFirstT.has(r._w)) wFirstT.set(r._w,r._t); }
        else wSell.set(r._w,(wSell.get(r._w)||0)+r._b);
      }
      const net = w => (wBuy.get(w)||0)-(wSell.get(w)||0);
      const earlyCut = t0 + 10_000;
      const early = [], later = [];
      for (const [w,b] of wBuy) { if (b < 0.1) continue; (wFirstT.get(w)<=earlyCut?early:later).push(w); }
      let shapeB = false;
      if (early.length >= 1) {
        shapeB = early.every(w => net(w) <= wBuy.get(w)*0.1) && later.filter(w => net(w) >= wBuy.get(w)*0.5).length >= 2;
      }
      const seg = rel.filter(r=>r._t>=tBuy && r._t<=tBuy+3600_000);
      const fwd = seg.length ? (Math.max(...seg.map(r=>r._p))/pAt._p-1)*100 : null;
      res.push({ addr: a, sym: e.sym, pct: +pct.toFixed(1), shapeB, fwd: fwd===null?null:+fwd.toFixed(1) });
    }
    console.log(`\n═══ ${wname} ═══ 首信号票 ${res.length}`);
    grand.push({ wname, res });
  }
  const cell = (list) => {
    const ok = list.filter(r=>r.fwd!==null).sort((a,b)=>a.fwd-b.fwd);
    const med = ok.length?ok[Math.floor(ok.length/2)].fwd:null;
    const tails = ok.filter(r=>r.fwd>=200);
    const names = tails.length? ' → '+tails.slice(-4).map(r=>(r.sym||r.addr.slice(0,6))+'='+r.fwd).join(',') : '';
    return `n=${list.length} 中位=${med===null?'-':med.toFixed(1)}% ≥20%:${ok.filter(r=>r.fwd>20).length} ≥200%:${tails.length}${names}`;
  };
  console.log('\n════ 四窗 2×2：B 形状 × famBlkBun ════');
  for (const [bLabel, bf] of [['非B', r=>!r.shapeB], ['B(sniper走光+有人接)', r=>r.shapeB]]) {
    for (const [fLabel, ff] of [['famBlk<15%', r=>r.pct<15], ['famBlk≥15%', r=>r.pct>=15]]) {
      const all = grand.flatMap(g=>g.res.filter(r=>bf(r)&&ff(r)));
      console.log(`${bLabel.padEnd(16)} | ${fLabel.padEnd(10)} | ${cell(all)}`);
    }
  }
  // 逐窗 B 域细分
  console.log('\n════ B 形状域内逐窗 ════');
  for (const g of grand) {
    const b0 = g.res.filter(r=>r.shapeB && r.pct<15), b1 = g.res.filter(r=>r.shapeB && r.pct>=15);
    console.log(`${g.wname}: B∧fam<15 ${cell(b0)} || B∧fam≥15 ${cell(b1)}`);
  }
  process.exit(0);
})().catch(e=>{console.error('失败:',e.message);process.exit(1);});
