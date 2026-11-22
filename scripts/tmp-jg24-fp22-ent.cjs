#!/usr/bin/env node
// JG-24 v4（182 跑）：FP22 even_split_crew 命中面 × 同块合并实体 HHI 重放。
// 用户思路：捆绑购买（同块买入钱包群）=一个钱包；合并后仍 HHI<0.10 才是真
//   「均分无主力」残局；合并后 ≥0.10=新实体刚接管筹码的主力盘（豁免面）。
//   A) 全域两窗+参照集合 even 命中行：锚时刻持仓（尘门 0.015）按首买块合并
//      → 实体 HHI vs 散户 HHI → 分组 fwd（锚后 30min）。
//   B) 案源负票 7 票：全史扫描「散户 HHI<0.10 ∧ posH≥10」时点的实体 HHI
//      （预期簇已派发、合并不改变=反证通过照拦）。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXPS = [
  { tag: 'w1003-bt-v164', id: '9e9163de-a677-4d39-9c33-9ec9df05e400', kind: 'global' },
  { tag: 'w1019-bt-v159', id: 'ce102e94-293c-4f8f-af98-cd06f4b0e98c', kind: 'global' },
  { tag: 'oos-bt-v175', id: null, kind: 'ref' },
  { tag: 'oos-bt-v176', id: null, kind: 'ref' },
  { tag: 'jindog-bt-v177', id: '4d74f39e-4055-4adb-afa3-de8a22bb9f49', kind: 'ref' },
];
const SOURCES = [
  ['币安锁', '0x426c0acab93fda89ceed0026103e310195d57777'],
  ['大美', '0x61a1f7cf65b5b0c38c10184b90506fe02b607777'],
  ['猫厨师', '0xdc212d5b12e6d8a7691656964a791c8ab71a7777'],
  ['不对劲', '0xb84e7e0e29513923272cbfb7ab1cc8e7de307777'],
  ['프론티어', '0x0b46c99274a633a0ee7e89f72c288573ac1f7777'],
  ['豆皮儿', '0x531d8babfdd7a5e0e37ef0fdbcc395167ebc7777'],
  ['币安之旅', '0x579343c72e546a7b4e78526c0f1c853c979c7777'],
];
const DUST = 0.015, FWD_MIN = 30;
const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function fetchAllSignals(sb, expId) {
  const out = []; let off = 0;
  for (;;) {
    const { data, error } = await sb.from('strategy_signals')
      .select('token_address,token_symbol,created_at,metadata')
      .eq('experiment_id', expId).eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).range(off, off + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
    off += 1000;
  }
  return out;
}

async function fetchTicks(sb, token, fromTs, toTs) {
  const { data, error } = await sb.from('wss_price_ticks')
    .select('trade_type,bnb_amount,block_number,block_time,sender_address,price_bnb,price_outlier')
    .eq('token_address', token)
    .gte('block_time', new Date(fromTs).toISOString()).lte('block_time', new Date(toTs).toISOString())
    .order('block_time', { ascending: true }).limit(8000);
  if (error) throw new Error('ticks: ' + error.message);
  return (data || []).map(r => ({
    ts: Date.parse(r.block_time), buy: r.trade_type === 'buy', blk: r.block_number,
    amt: Number(r.bnb_amount || 0), w: (r.sender_address || '').toLowerCase(),
    p: Number(r.price_bnb), out: !!r.price_outlier,
  }));
}

/** 锚时刻持仓结构：散户/实体两口径 HHI + top 实体 */
function holdingsAt(ticks, anchorTs) {
  const net = new Map(), firstBlk = new Map();
  for (const t of ticks) {
    if (t.ts > anchorTs) break;
    if (!t.w) continue;
    net.set(t.w, (net.get(t.w) || 0) + (t.buy ? t.amt : -t.amt));
    if (t.buy && !firstBlk.has(t.w)) firstBlk.set(t.w, t.blk);
  }
  const pos = [...net.entries()].filter(([, v]) => v > DUST);
  if (pos.length < 2) return null;
  const sum = pos.reduce((s, [, v]) => s + v, 0);
  let solo = 0; for (const [, v] of pos) solo += Math.pow(v / sum, 2);
  // 同块合并（首买块相同 → 一实体）
  const byBlk = new Map();
  for (const [w, v] of pos) {
    const k = 'b' + (firstBlk.get(w) ?? 'x');
    byBlk.set(k, (byBlk.get(k) || 0) + v);
  }
  let ent = 0, topEnt = 0;
  for (const v of byBlk.values()) { const sh = v / sum; ent += sh * sh; if (v > topEnt) topEnt = v; }
  return { posH: pos.length, soloHHI: solo, entHHI: ent, topEntPct: topEnt / sum * 100, entN: byBlk.size };
}

function fwdOf(ticks, anchorTs) {
  const px = ticks.filter(t => t.p > 0 && !t.out && t.ts >= anchorTs - 1500);
  if (!px.length) return { dead: true };
  const p0 = px[0].p; let peak = p0, last = p0;
  for (const r of px) { if (r.p > peak) peak = r.p; last = r.p; }
  return { dead: false, fwdPeak: (peak / p0 - 1) * 100, fwdEnd: (last / p0 - 1) * 100 };
}

(async () => {
  const sb = dbManager.getClient();
  const { data: exps } = await sb.from('experiments').select('id,experiment_name').ilike('experiment_name', 'bt-v%').limit(60);
  for (const e of EXPS) {
    if (e.id) continue;
    const pref = e.tag.split('-').slice(1).join('-');
    e.id = ((exps || []).find(x => x.experiment_name && x.experiment_name.startsWith(pref)) || {}).id || null;
  }
  const all = [];
  for (const e of EXPS) {
    if (!e.id) { console.log(`### ${e.tag}: 跳过`); continue; }
    const sigs = await fetchAllSignals(sb, e.id);
    const perToken = new Map();
    for (const s of sigs) {
      const arms = s.metadata?.factorCheck?.arms;
      if (!Array.isArray(arms) || !arms.includes('even_split_crew')) continue;
      if (!perToken.has(s.token_address)) perToken.set(s.token_address, s);
    }
    console.log(`### ${e.tag} (${e.kind}) evenTokens=${perToken.size}`);
    for (const [tok, s] of perToken) {
      const anchorTs = Date.parse(s.created_at);
      const ticks = await fetchTicks(sb, tok, anchorTs - 7 * 3600000, anchorTs + FWD_MIN * 60000);
      const h = holdingsAt(ticks, anchorTs);
      const f = fwdOf(ticks, anchorTs);
      const tf = s.metadata?.trendFactors || {};
      all.push({
        exp: e.tag, kind: e.kind, sym: s.token_symbol, tok: tok.slice(0, 10), t: s.created_at.slice(5, 19),
        arms: (s.metadata.factorCheck.arms || []).join('+'),
        posH: h?.posH ?? null, soloHHI: h ? +h.soloHHI.toFixed(4) : null, entHHI: h ? +h.entHHI.toFixed(4) : null,
        topEntPct: h ? +h.topEntPct.toFixed(1) : null, entN: h?.entN ?? null,
        quiet: tf.quietSpanMs ?? null, dead: !!f.dead, fwdPeak: f.fwdPeak ?? null, fwdEnd: f.fwdEnd ?? null,
      });
    }
  }
  // 分组汇总：实体 HHI ≥0.10（豁免面）vs <0.10（照拦）
  for (const kind of ['global', 'ref']) {
    const sub = all.filter(r => r.kind === kind && r.entHHI !== null);
    for (const [g, list] of [['entHHI≥0.10', sub.filter(r => r.entHHI >= 0.10)], ['entHHI<0.10', sub.filter(r => r.entHHI < 0.10)]]) {
      const alive = list.filter(r => !r.dead); const p = alive.map(r => r.fwdPeak); const en = alive.map(r => r.fwdEnd);
      console.log(`[${kind}|${g}] n=${list.length} 死=${list.length - alive.length} peakMed=${med(p)?.toFixed?.(1) ?? '-'}% 正率=${alive.length ? Math.round(p.filter(x => x > 0).length / alive.length * 100) : 0}% ≥50%=${p.filter(x => x >= 50).length} ≥100%=${p.filter(x => x >= 100).length} ≤-30%=${p.filter(x => x <= -30).length} endMed=${med(en)?.toFixed?.(1) ?? '-'}%`);
    }
  }
  console.log('--- entHHI≥0.10 明细（豁免面） ---');
  for (const r of all.filter(r => r.entHHI !== null && r.entHHI >= 0.10)) {
    console.log(`  ${r.exp} ${r.sym || r.tok} ${r.t} solo=${r.soloHHI} ent=${r.entHHI} topEnt=${r.topEntPct}% (${r.entN}实体/${r.posH}钱包) fwdPeak=${r.fwdPeak?.toFixed?.(1) ?? 'dead'}% [${r.arms}]`);
  }
  const zk = all.find(r => r.tok === '0xa79e7364');
  if (zk) console.log('ZKind: ', JSON.stringify({ soloHHI: zk.soloHHI, entHHI: zk.entHHI, topEnt: zk.topEntPct, entN: zk.entN, posH: zk.posH, fwdPeak: zk.fwdPeak }));

  // ===== B) 案源负票反证：全史扫描 FP22 域时点 =====
  console.log('\n=== 案源负票反证（散户HHI<0.10 ∧ posH≥10 时点的实体 HHI） ===');
  for (const [name, addr] of SOURCES) {
    
    const t0 = Date.parse('2026-10-13T00:00:00Z');
    const ticks = await fetchTicks(sb, addr, t0, t0 + 38 * 24 * 3600000);
    if (ticks.length < 10) { console.log(`  ${name} ${addr.slice(0, 10)} ticks=${ticks.length} 数据不足跳过`); continue; }
    const hits = [];
    let lastTs = 0;
    for (const t of ticks) {
      if (t.ts - lastTs < 60000 && t.ts !== ticks[ticks.length - 1].ts) continue; // 每 60s 采样
      lastTs = t.ts;
      const h = holdingsAt(ticks, t.ts);
      if (h && h.posH >= 10 && h.soloHHI < 0.10) hits.push({ ts: t.ts, solo: +h.soloHHI.toFixed(3), ent: +h.entHHI.toFixed(3), top: +h.topEntPct.toFixed(0) });
    }
    if (!hits.length) { console.log(`  ${name}: 全史无 FP22 域时点（soloHHI 恒≥0.10 或 posH<10）`); continue; }
    const entLow = hits.filter(h => h.ent < 0.10).length;
    console.log(`  ${name}: FP22域时点 ${hits.length} 个采样，其中实体HHI仍<0.10（照拦）=${entLow}，合并后≥0.10（会被豁免）=${hits.length - entLow}`);
    for (const h of hits.slice(0, 6)) console.log(`    ${new Date(h.ts).toISOString().slice(5, 19)} solo=${h.solo} ent=${h.ent} topEnt=${h.top}%`);
  }
  require('fs').writeFileSync('/tmp/jg24-fp22-ent.json', JSON.stringify(all, null, 1));
  console.log('明细', all.length, '行 → /tmp/jg24-fp22-ent.json');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
