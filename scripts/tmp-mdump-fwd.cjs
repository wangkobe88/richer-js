#!/usr/bin/env node
// 一次性（182 跑）：从 /tmp/mdump-full.json 重读 tokens，用 BNB 域可靠价重算前向收益
// 基线=锚前 60s 最后一笔可靠价（缺则锚后首笔）
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
(async () => {
  const db = dbManager.getClient();
  const { fwd } = JSON.parse(require('fs').readFileSync('/tmp/mdump-full.json', 'utf8'));
  const res = [];
  for (const t of fwd) {
    const anchor = new Date(t.at);
    const start = new Date(anchor.getTime() - 60 * 1000);
    const end = new Date(anchor.getTime() + 15 * 60 * 1000);
    const { data: ticks, error } = await db.from('wss_price_ticks')
      .select('block_time, price_bnb, price_outlier')
      .eq('token_address', t.token)
      .gte('block_time', start.toISOString())
      .lte('block_time', end.toISOString())
      .order('block_time', { ascending: true })
      .limit(3000);
    if (error) throw new Error(error.message);
    const rel = (ticks || []).filter(x => x.price_bnb && !x.price_outlier);
    if (!rel.length) { res.push({ ...t, note: 'no_ticks' }); continue; }
    const at = anchor.getTime();
    let base = null;
    for (const x of rel) if (new Date(x.block_time).getTime() <= at) base = x.price_bnb;
    if (base == null) base = rel[0].price_bnb;
    let max5 = 0, max15 = 0;
    const t5 = at + 5 * 60 * 1000;
    for (const x of rel) {
      const ts = new Date(x.block_time).getTime();
      if (ts <= at) continue;
      const rise = (x.price_bnb / base - 1) * 100;
      if (ts <= t5 && rise > max5) max5 = rise;
      if (rise > max15) max15 = rise;
    }
    const lastPx = rel[rel.length - 1].price_bnb;
    res.push({ ...t, max5: +max5.toFixed(1), max15: +max15.toFixed(1),
      last15: +((lastPx / base - 1) * 100).toFixed(1) });
    process.stdout.write('.');
  }
  console.log('');
  require('fs').writeFileSync('/tmp/mdump-fwd.json', JSON.stringify(res, null, 1));
  const grp = (ms) => ms == null ? 'null' : (ms < 30 ? 'a<30s' : ms < 60 ? 'b30-60' : ms < 120 ? 'c60-120' : ms < 240 ? 'd120-240' : 'e>=240');
  const stats = {};
  for (const f of res) {
    const ms = Math.min(...[f.dumpSec, f.d2Sec].filter(x => x != null));
    (stats[grp(ms)] = stats[grp(ms)] || []).push(f);
  }
  for (const g of Object.keys(stats).sort()) {
    const arr = stats[g].filter(x => x.max15 != null);
    const win = arr.filter(x => x.max15 >= 30).length;
    const pos = arr.filter(x => x.max15 > 0).length;
    const avgMax15 = arr.reduce((s, x) => s + x.max15, 0) / Math.max(1, arr.length);
    const avgLast15 = arr.reduce((s, x) => s + x.last15, 0) / Math.max(1, arr.length);
    console.log(`\n[${g}] ${arr.length} 票 | max15>=30%: ${win} | max15>0: ${pos} | avgMax15=${avgMax15.toFixed(1)}% avgLast15=${avgLast15.toFixed(1)}%`);
    for (const f of arr) console.log(`  ${f.token.slice(0, 10)}… (${f.sym}) ${f.at?.slice(5, 16)} dumpSec=${f.dumpSec}/${f.d2Sec} chg5=${f.chg5} idle=${f.idlePct} | max5=${f.max5}% max15=${f.max15}% last15=${f.last15}%`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
