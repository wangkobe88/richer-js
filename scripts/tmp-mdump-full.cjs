#!/usr/bin/env node
// 一次性（182 跑）：近期实验 entry_shape=malicious_dump 全量扫描 + 锚后前向收益
// 用后可删。输出：明细 /tmp/mdump-full.json + 分组统计
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

// 近期回测实验（11-15 以来）+ bt-v164 重跑
const EXPS = [
  'bd2dddb5-c853-428c-b446-71f3c2eeb80e', // bt-v165(bt-v164 重跑)
  '9e9163de-a677-4d39-9c33-9ec9df05e400', // bt-v164
  'ce102e94-293c-4f8f-af98-cd06f4b0e98c', // bt-v159
  'dddbe79e-480a-402a-aa35-85a72d2f591e', // bt-v155
  '8d20f3ba-9b5f-496d-afeb-884a63e46e40', // bt-v154
  '2448116a-bebe-457d-9d8a-b4556c9a8e0d', // bt-v145
  'a869d119-c389-47e0-89ce-89e86114ad0e', // bt-v144
  '8a7b6b09-e2bc-4773-8393-a696821ff531', // bt-v142
  '3916fb15-66a1-45f0-bde1-1c145513817a', // bt-v141
  '341dd3af-fe17-430f-9fbb-490b4f4e42d0', // bt-v111-kol
  'b67b7318-1715-443d-a29b-7919b2db6e65', // bt-v111-kol
];

(async () => {
  const db = dbManager.getClient();
  const rows = [];
  for (const exp of EXPS) {
    let offset = 0;
    for (;;) {
      const page = await db.from('strategy_signals')
        .select('id, token_address, token_symbol, created_at, executed, metadata')
        .eq('experiment_id', exp)
        .eq('signal_type', 'BUY')
        .order('created_at', { ascending: true })
        .range(offset, offset + 999);
      if (page.error) throw new Error(`${exp}: ${page.error.message}`);
      for (const r of page.data) {
        const bp = r.metadata?.buyPoint;
        if (!bp || bp.dimensions?.entry_shape?.bucket !== 'malicious_dump') continue;
        const a = bp.anchors || {};
        rows.push({
          exp: exp.slice(0, 8), token: r.token_address, sym: r.token_symbol,
          at: r.created_at, sigPrice: r.metadata?.price ?? null, executed: r.executed,
          esProb: bp.dimensions.entry_shape.prob,
          dumpSec: a.dumpBlockSecToAnchor ?? null, d2Sec: a.dump2BlockSecToAnchor ?? null,
          dumpBnb: a.dumpBlockBnb ?? null, d2Bnb: a.dump2BlockBnb ?? null,
          dumpDrop: a.dumpBlockDropPct ?? null, d2Drop: a.dump2BlockDropPct ?? null,
          dumpSellers: a.dumpBlockSellers ?? null, d2Sellers: a.dump2BlockSellers ?? null,
          dumpFbRatio: a.dumpBlockFollowBuyRatio ?? null, d2FbRatio: a.dump2BlockFollowBuyRatio ?? null,
          age: a.tokenAgeSec ?? null, curVsAth: a.currentVsAthPct ?? null, secSinceAth: a.secSinceAth ?? null,
          curVsL: a.currentVsLaunchPct ?? null, chg5: a.chg5Pct ?? null, chg30: a.chg30Pct ?? null,
          idlePct: a.actIdlePct ?? null, totalVol: a.totalVolumeBnb ?? null,
        });
      }
      if (page.data.length < 1000) break;
      offset += 1000;
    }
    console.log(`exp ${exp.slice(0, 8)} 累计 ${rows.length}`);
  }

  // per token 去重（同 token 跨实验锚几乎同时，取首条）算前向收益
  const byToken = new Map();
  for (const r of rows) {
    if (!byToken.has(r.token)) byToken.set(r.token, r);
  }
  console.log(`\nmalicious_dump 信号 ${rows.length} 条，去重 token ${byToken.size} 个`);
  const tokens = [...byToken.values()];
  const fwd = [];
  for (const t of tokens) {
    const anchor = new Date(t.at);
    const end = new Date(anchor.getTime() + 15 * 60 * 1000);
    let sigPx = t.sigPrice;
    const { data: ticks, error } = await db.from('wss_price_ticks')
      .select('block_time, price_bnb, price_outlier')
      .eq('token_address', t.token)
      .gte('block_time', anchor.toISOString())
      .lte('block_time', end.toISOString())
      .order('block_time', { ascending: true })
      .limit(3000);
    if (error) throw new Error(error.message);
    const rel = (ticks || []).filter(x => x.price_bnb && !x.price_outlier);
    if (!rel.length || !sigPx) { fwd.push({ ...t, n: (ticks || []).length, note: 'no_fwd' }); continue; }
    if (!sigPx) sigPx = rel[0].price_bnb;
    let max5 = 0, max15 = 0;
    const t5 = anchor.getTime() + 5 * 60 * 1000;
    for (const x of rel) {
      const ts = new Date(x.block_time).getTime();
      const rise = (x.price_bnb / sigPx - 1) * 100;
      if (ts <= t5 && rise > max5) max5 = rise;
      if (rise > max15) max15 = rise;
    }
    const lastPx = rel[rel.length - 1].price_bnb;
    fwd.push({ ...t, n: rel.length, max5: +max5.toFixed(1), max15: +max15.toFixed(1),
      last15: +((lastPx / sigPx - 1) * 100).toFixed(1) });
    process.stdout.write('.');
  }
  console.log('');
  require('fs').writeFileSync('/tmp/mdump-full.json', JSON.stringify({ rows, fwd }, null, 1));

  // 分组统计：minSec = min(dumpSec, d2Sec)（砸块距锚最近距离）
  const grp = (minSec) => minSec == null ? 'null' : (minSec < 30 ? 'a<30s' : minSec < 60 ? 'b30-60' : minSec < 120 ? 'c60-120' : minSec < 240 ? 'd120-240' : 'e>=240');
  const stats = {};
  for (const f of fwd) {
    const ms = Math.min(...[f.dumpSec, f.d2Sec].filter(x => x != null));
    const g = grp(ms);
    (stats[g] = stats[g] || []).push(f);
  }
  for (const g of Object.keys(stats).sort()) {
    const arr = stats[g];
    const win = arr.filter(x => x.max15 != null && x.max15 >= 30).length;
    const pos = arr.filter(x => x.max15 != null && x.max15 > 0).length;
    const avgMax15 = arr.filter(x => x.max15 != null).reduce((s, x) => s + x.max15, 0) / Math.max(1, arr.filter(x => x.max15 != null).length);
    console.log(`\n[${g}] ${arr.length} 票 | max15>=30%: ${win} | max15>0: ${pos} | avgMax15=${avgMax15.toFixed(1)}%`);
    for (const f of arr) {
      console.log(`  ${f.token} (${f.sym}) ${f.at?.slice(5, 16)} dumpSec=${f.dumpSec}/${f.d2Sec} fb=${f.dumpFbRatio}/${f.d2FbRatio} curVsAth=${f.curVsAth} chg5=${f.chg5} idle=${f.idlePct} max15=${f.max15 ?? '-'}% last15=${f.last15 ?? '-'}%`);
    }
  }
  console.log('\nwritten /tmp/mdump-full.json');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
