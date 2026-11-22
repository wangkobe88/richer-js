#!/usr/bin/env node
// JG-24 v2（182 跑）：even_split_crew 命中行 × sbw 代理重算（CD401 结构前提机械化：
//   静默段≥30s→出口5s波≥2非尘钱包→贴锚≤60s→波净流入>0→段前60s背景低/中），
//   按 sbw 代理切分锚后 30min 前向。自包含：拉信号→even 命中→ticks→sbw+fwd。
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
const STALL_GAP_SEC = 30, WAVE_WIN_SEC = 5, WAVE_NEAR_SEC = 60, DUST_BNB = 0.03;
const PRESEG_MIN_BNB = 0.5, PRESEG_MIN_TICKS = 6, FWD_MIN = 30;

const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const isA = (q, s) => (q ?? 0) >= 60000 && (s ?? 0) >= 0.1;

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

async function fetchTicks(sb, token, anchorTs) {
  const from = new Date(anchorTs - 660000).toISOString();
  const to = new Date(anchorTs + FWD_MIN * 60000).toISOString();
  const { data, error } = await sb.from('wss_price_ticks')
    .select('trade_type,bnb_amount,block_time,sender_address,price_bnb,price_outlier')
    .eq('token_address', token).gte('block_time', from).lte('block_time', to)
    .order('block_time', { ascending: true }).limit(6000);
  if (error) throw new Error('ticks: ' + error.message);
  return (data || []).map(r => ({
    ts: Date.parse(r.block_time), buy: r.trade_type === 'buy',
    amt: Number(r.bnb_amount || 0), w: (r.sender_address || '').toLowerCase(),
    p: Number(r.price_bnb), out: !!r.price_outlier,
  }));
}

function sbwProxy(ticks, anchorTs) {
  if (ticks.length < 2) return { ok: false, why: 'no_ticks' };
  let seg = null;
  for (let i = 1; i < ticks.length; i++) {
    const gap = (ticks[i].ts - ticks[i - 1].ts) / 1000;
    if (gap >= STALL_GAP_SEC && ticks[i].ts <= anchorTs + 2000) seg = { start: ticks[i - 1].ts, exitIdx: i };
  }
  if (!seg) return { ok: false, why: 'no_stall_seg' };
  const exit = ticks[seg.exitIdx];
  const waveEndTs = exit.ts + WAVE_WIN_SEC * 1000;
  const sinceWaveEnd = (anchorTs - waveEndTs) / 1000;
  if (sinceWaveEnd > WAVE_NEAR_SEC) return { ok: false, why: 'wave_not_near', stallSec: (exit.ts - seg.start) / 1000 };
  const wave = ticks.filter(t => t.ts >= exit.ts && t.ts <= waveEndTs);
  const buyWave = wave.filter(t => t.buy);
  const wallets = new Set(buyWave.filter(t => t.amt >= DUST_BNB).map(t => t.w).filter(Boolean));
  if (wallets.size < 2) return { ok: false, why: 'wave_lt2_wallets', wallets: wallets.size, waveBuyBnb: +buyWave.reduce((s, t) => s + t.amt, 0).toFixed(3), stallSec: (exit.ts - seg.start) / 1000 };
  const buyBnb = buyWave.reduce((s, t) => s + t.amt, 0);
  const sellBnb = wave.filter(t => !t.buy).reduce((s, t) => s + t.amt, 0);
  if (buyBnb - sellBnb <= 0) return { ok: false, why: 'wave_net_out', waveBuyBnb: +buyBnb.toFixed(3) };
  const pre = ticks.filter(t => t.ts >= seg.start - 60000 && t.ts < seg.start);
  const preBnb = pre.reduce((s, t) => s + t.amt, 0);
  if (preBnb >= PRESEG_MIN_BNB || pre.length >= PRESEG_MIN_TICKS) {
    return { ok: false, why: 'preseg_active', preBnb: +preBnb.toFixed(3), preN: pre.length, stallSec: (exit.ts - seg.start) / 1000 };
  }
  return { ok: true, stallSec: +((exit.ts - seg.start) / 1000).toFixed(0), waveWallets: wallets.size, waveBuyBnb: +buyBnb.toFixed(3), sinceWaveEnd: +sinceWaveEnd.toFixed(1), preN: pre.length, preBnb: +preBnb.toFixed(3) };
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
    const hit = (exps || []).find(x => x.experiment_name && x.experiment_name.startsWith(pref));
    e.id = hit ? hit.id : null;
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
      const ticks = await fetchTicks(sb, tok, anchorTs);
      const sbw = sbwProxy(ticks, anchorTs);
      const f = fwdOf(ticks, anchorTs);
      const tf = s.metadata?.trendFactors || {};
      all.push({
        exp: e.tag, sym: s.token_symbol, tok: tok.slice(0, 10), full: tok, t: s.created_at.slice(5, 19),
        quiet: tf.quietSpanMs ?? null, surge: tf.quietSurgeBuyBnb ?? null, chg5: tf.chg5Pct ?? null,
        curVs: tf.currentVsLaunchPct ?? null, arms: (s.metadata.factorCheck.arms || []).join('+'),
        sbwOk: sbw.ok, sbwWhy: sbw.why || '', sbwDetail: sbw.ok ? `${sbw.stallSec}s静默 波${sbw.waveWallets}钱包${sbw.waveBuyBnb}B 距锚${sbw.sinceWaveEnd}s 背景n${sbw.preN}/${sbw.preBnb}B` : '',
        dead: !!f.dead, fwdPeak: f.fwdPeak ?? null, fwdEnd: f.fwdEnd ?? null,
      });
    }
  }
  // 汇总：sbw 代理 × (全域/参照)
  for (const kind of ['global', 'ref']) {
    const sub = all.filter(r => EXPS.find(e => e.tag === r.exp)?.kind === kind);
    for (const [g, list] of [['sbw+', sub.filter(r => r.sbwOk)], ['sbw-', sub.filter(r => !r.sbwOk)]]) {
      const alive = list.filter(r => !r.dead); const p = alive.map(r => r.fwdPeak); const en = alive.map(r => r.fwdEnd);
      console.log(`[${kind}|${g}] n=${list.length} 死=${list.length - alive.length} peakMed=${med(p)?.toFixed?.(1) ?? '-'}% 正率=${alive.length ? Math.round(p.filter(x => x > 0).length / alive.length * 100) : 0}% ≥50%=${p.filter(x => x >= 50).length} ≥100%=${p.filter(x => x >= 100).length} ≤-30%=${p.filter(x => x <= -30).length} endMed=${med(en)?.toFixed?.(1) ?? '-'}%`);
    }
  }
  // 交叉：sbw × A 判据 一致性
  const cross = { both: 0, sbwOnly: 0, aOnly: 0, neither: 0 };
  for (const r of all) {
    const a = isA(r.quiet, r.surge);
    if (r.sbwOk && a) cross.both++; else if (r.sbwOk) cross.sbwOnly++; else if (a) cross.aOnly++; else cross.neither++;
  }
  console.log('sbw×A 交叉: ', JSON.stringify(cross));
  // 明细：sbw+ 全部行 + ZKind
  console.log('--- sbw+ 明细 ---');
  for (const r of all.filter(r => r.sbwOk)) {
    console.log(`  ${r.exp} ${r.sym || r.tok} ${r.t} [${r.arms}] ${r.sbwDetail} A=${isA(r.quiet, r.surge)} fwdPeak=${r.fwdPeak?.toFixed?.(1) ?? 'dead'}%`);
  }
  const zk = all.find(r => r.tok === '0xa79e7364');
  if (zk) console.log('ZKind 逐腿: ', JSON.stringify({ sbwOk: zk.sbwOk, why: zk.sbwWhy, detail: zk.sbwDetail, quiet: zk.quiet, surge: zk.surge }));
  // why 分布
  const whys = {};
  for (const r of all.filter(r => !r.sbwOk)) whys[r.sbwWhy] = (whys[r.sbwWhy] || 0) + 1;
  console.log('sbw- why 分布:', JSON.stringify(whys));
  require('fs').writeFileSync('/tmp/jg24-fp22-sbw.json', JSON.stringify(all, null, 1));
  console.log('明细', all.length, '行 → /tmp/jg24-fp22-sbw.json');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
