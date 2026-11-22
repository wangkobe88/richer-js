#!/usr/bin/env node
// JG-24 验证（182 跑）：FP22 even_split_crew 拦截面 × A 判据（沉寂重启豁免
//   quietSpanMs>=60s ∧ quietSurgeBuyBnb>=0.1）分组前向收益。
// 口径对齐 FP39/FP40：per-token 首 even_split 命中行为锚，锚后 30min
//   wss_price_ticks 非可靠价剔除，fwdPeak/fwdEnd 相对窗内首笔价。
// 窗：bt-v164(w1003 热)/bt-v159(w1019 中)=全域；bt-v175/176(OOS 375 票)/
//   bt-v177(金狗 30 票)=正样本参照。冷窗无 FP22 版本=覆盖缺失留档。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXPS = [
  { tag: 'w1003-bt-v164', id: '9e9163de-a677-4d39-9c33-9ec9df05e400', kind: 'global' },
  { tag: 'w1019-bt-v159', id: 'ce102e94-293c-4f8f-af98-cd06f4b0e98c', kind: 'global' },
  { tag: 'oos-bt-v175', id: null, kind: 'ref' },   // id 由名字解析
  { tag: 'oos-bt-v176', id: null, kind: 'ref' },
  { tag: 'jindog-bt-v177', id: '4d74f39e-4055-4adb-afa3-de8a22bb9f49', kind: 'ref' },
];
// FP22 立法案源负票（代码注释档）+ 误伤知情票
const SOURCES = ['0x426c0aca', '0x61a1f7cf', '0xdc212d5b', '0xb84e7e0e', '0x0b46c992', '0x531d', '0x5793'];
const FWD_MIN = 30;

const isA = (quiet, surge) => (quiet ?? 0) >= 60000 && (surge ?? 0) >= 0.1;
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function fetchAllSignals(sb, expId) {
  const out = []; let off = 0;
  for (;;) {
    const { data, error } = await sb.from('strategy_signals')
      .select('token_address,token_symbol,reason,created_at,metadata')
      .eq('experiment_id', expId).eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).range(off, off + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
    off += 1000;
  }
  return out;
}

async function fwdForToken(sb, token, anchorIso) {
  const from = new Date(Date.parse(anchorIso) - 2000).toISOString();
  const to = new Date(Date.parse(anchorIso) + FWD_MIN * 60000).toISOString();
  const { data, error } = await sb.from('wss_price_ticks')
    .select('price_bnb,block_time,price_outlier')
    .eq('token_address', token).gte('block_time', from).lte('block_time', to)
    .order('block_time', { ascending: true }).limit(4000);
  if (error) throw new Error('ticks: ' + error.message);
  const rows = (data || []).filter(r => r.price_bnb > 0 && !r.price_outlier);
  if (!rows.length) return { dead: true };
  const anchorTs = Date.parse(anchorIso);
  const after = rows.filter(r => Date.parse(r.block_time) >= anchorTs - 1500);
  if (!after.length) return { dead: true };
  const p0 = Number(after[0].price_bnb);
  let peak = p0, last = p0;
  for (const r of after) { const p = Number(r.price_bnb); if (p > peak) peak = p; last = p; }
  return { dead: false, p0, fwdPeak: (peak / p0 - 1) * 100, fwdEnd: (last / p0 - 1) * 100, n: after.length };
}

function summarize(tag, rows) {
  const groups = { A: [], nonA: [] };
  for (const r of rows) (isA(r.quiet, r.surge) ? groups.A : groups.nonA).push(r);
  for (const [g, list] of Object.entries(groups)) {
    const alive = list.filter(r => !r.dead);
    const peaks = alive.map(r => r.fwdPeak);
    const ends = alive.map(r => r.fwdEnd);
    console.log(`  [${tag}|${g}] n=${list.length} 死票=${list.length - alive.length}` +
      ` fwdPeak中位=${median(peaks) !== null ? median(peaks).toFixed(1) + '%' : '-'} 正率=${alive.length ? (peaks.filter(p => p > 0).length / alive.length * 100).toFixed(0) + '%' : '-'}` +
      ` ≥50%=${peaks.filter(p => p >= 50).length} ≥100%=${peaks.filter(p => p >= 100).length} ≤-30%=${peaks.filter(p => p <= -30).length}` +
      ` fwdEnd中位=${median(ends) !== null ? median(ends).toFixed(1) + '%' : '-'}`);
  }
}

(async () => {
  const sb = dbManager.getClient();
  // 解析集合实验 id
  const { data: exps } = await sb.from('experiments').select('id,experiment_name').ilike('experiment_name', 'bt-v%').limit(60);
  for (const e of EXPS) {
    if (e.id) continue;
    const hit = (exps || []).find(x => x.experiment_name && x.experiment_name.startsWith(e.tag.split('-').slice(1).join('-')));
    e.id = hit ? hit.id : null;
  }
  const detailAll = [];
  for (const e of EXPS) {
    if (!e.id) { console.log(`### ${e.tag}: 实验未找到跳过`); continue; }
    const sigs = await fetchAllSignals(sb, e.id);
    const perToken = new Map();
    for (const s of sigs) {
      const arms = s.metadata?.factorCheck?.arms;
      if (!Array.isArray(arms) || !arms.includes('even_split_crew')) continue;
      if (!perToken.has(s.token_address)) perToken.set(s.token_address, s); // 首命中行
    }
    console.log(`### ${e.tag} (${e.kind}) BUY=${sigs.length} even命中行=${[...perToken.values()].length ? '(per-token 首行)' : 0} tokens=${perToken.size}`);
    const rows = [];
    for (const [tok, s] of perToken) {
      const tf = s.metadata?.trendFactors || {};
      const f = await fwdForToken(sb, tok, s.created_at);
      rows.push({
        exp: e.tag, sym: s.token_symbol, tok: tok.slice(0, 10), t: s.created_at.slice(5, 19),
        quiet: tf.quietSpanMs ?? null, surge: tf.quietSurgeBuyBnb ?? null,
        chg5: tf.chg5Pct ?? null, curVs: tf.currentVsLaunchPct ?? null,
        arms: (s.metadata.factorCheck.arms || []).join('+'),
        dead: !!f.dead, fwdPeak: f.fwdPeak ?? null, fwdEnd: f.fwdEnd ?? null, n: f.n ?? 0,
      });
    }
    summarize(e.tag, rows);
    for (const r of rows) detailAll.push(r);
    // 单臂行（豁免即放行面）
    const solo = rows.filter(r => r.arms === 'even_split_crew');
    console.log(`  单臂行(豁免即真放回)=${solo.length}: ${solo.map(r => `${r.sym}@${r.t}${isA(r.quiet, r.surge) ? '[A]' : ''}fwdPeak=${r.fwdPeak !== null ? r.fwdPeak.toFixed(0) : 'dead'}%`).join(' | ')}`);
    // 案源票
    for (const r of rows) {
      if (SOURCES.some(p => r.tok.startsWith(p.slice(0, 8)))) {
        console.log(`  [案源?] ${r.sym} ${r.tok} ${r.t} quiet=${r.quiet} surge=${r.surge} ${isA(r.quiet, r.surge) ? '*** A 豁免了案源票 ***' : 'A 不豁免✓'} fwdPeak=${r.fwdPeak !== null ? r.fwdPeak.toFixed(1) : 'dead'}%`);
      }
    }
  }
  console.log('\n--- 全窗合并明细（A 命中行） ---');
  for (const r of detailAll.filter(r => isA(r.quiet, r.surge))) {
    console.log(`  ${r.exp} ${r.sym || r.tok} ${r.t} quiet=${r.quiet} surge=${r.surge} curVs=${r.curVs} arms=${r.arms} fwdPeak=${r.fwdPeak !== null ? r.fwdPeak.toFixed(1) : 'dead'}% fwdEnd=${r.fwdEnd !== null ? r.fwdEnd.toFixed(1) : '-'}%`);
  }
  const fs = require('fs');
  fs.writeFileSync('/tmp/jg24-fp22-fwd.json', JSON.stringify(detailAll, null, 1));
  console.log('明细已落 /tmp/jg24-fp22-fwd.json，共', detailAll.length, '行');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
