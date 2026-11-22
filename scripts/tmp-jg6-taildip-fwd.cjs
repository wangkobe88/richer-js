#!/usr/bin/env node
// JG-6 因子门合理性①：bt-v164 全窗 tail_dip_knife（T182）被拦信号前向收益分布（182 跑）。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';

(async () => {
  const sb = dbManager.getClient();

  // 金狗名单
  const { data: gd, error: eg } = await sb.from('case_collection_tokens')
    .select('token_address, token_meta')
    .eq('collection_id', 'a8414632-7c24-4762-9253-c49bb0f53105');
  if (eg) throw new Error(eg.message);
  const golden = new Map((gd || []).map(t => [t.token_address, ((t.token_meta || {}).symbol || '金狗')]));

  // 被 tail_dip_knife 拦的 BUY 信号（jsonb 过滤，失败则回退全拉）
  let sigs = [];
  {
    let from = 0;
    while (true) {
      const { data, error } = await sb.from('strategy_signals')
        .select('id, token_address, token_symbol, created_at, metadata')
        .eq('experiment_id', EXP)
        .eq('signal_type', 'BUY')
        .filter('metadata->>execution_reason', 'eq', 'factor_gate_tail_dip_knife')
        .order('id', { ascending: true }).range(from, from + 499);
      if (error) throw new Error('信号查询失败: ' + error.message);
      if (!data || !data.length) break;
      sigs.push(...data);
      if (data.length < 500) break;
      from += 500;
    }
  }
  console.log('tail_dip_knife 被拦信号:', sigs.length, '行 /', new Set(sigs.map(s => s.token_address)).size, '票');

  // 票级去重：首次被拦
  const firstByToken = new Map();
  for (const s of sigs) if (!firstByToken.has(s.token_address)) firstByToken.set(s.token_address, s);

  // per token ticks 全量（护栏 3 万行；id 升序近似链序）
  async function loadTicks(addr) {
    const rows = [];
    let from = 0;
    while (from < 30000) {
      const { data, error } = await sb.from('wss_price_ticks')
        .select('price_bnb, block_time')
        .eq('token_address', addr).order('id', { ascending: true }).range(from, from + 999);
      if (error) throw new Error('ticks 查询失败: ' + error.message);
      if (!data || !data.length) break;
      rows.push(...data);
      if (data.length < 1000) break;
      from += 1000;
    }
    for (const r of rows) r.t = new Date(r.block_time).getTime();
    rows.sort((a, b) => a.t - b.t);
    return rows;
  }

  const results = [];
  for (const [addr, s] of firstByToken) {
    const t0 = new Date(s.created_at).getTime();
    const ticks = await loadTicks(addr);
    let anchor = null;
    for (const r of ticks) if (r.t <= t0 && r.price_bnb > 0) anchor = r;
    if (!anchor || !anchor.price_bnb) { results.push({ addr, sym: s.token_symbol, t0, skip: '锚前行缺失' }); continue; }
    let r10 = 0, r30 = 0, rPeak = 0, nAfter = 0;
    for (const r of ticks) {
      if (r.t <= t0 || !r.price_bnb) continue;
      nAfter++;
      const gain = (r.price_bnb / anchor.price_bnb - 1) * 100;
      if (r.t <= t0 + 600e3 && gain > r10) r10 = gain;
      if (r.t <= t0 + 1800e3 && gain > r30) r30 = gain;
      if (gain > rPeak) rPeak = gain;
    }
    results.push({ addr, sym: s.token_symbol, t0, anchor: anchor.price_bnb, nAfter, r10, r30, rPeak, golden: golden.has(addr) });
  }

  results.sort((a, b) => (b.rPeak ?? -1e9) - (a.rPeak ?? -1e9));
  console.log('\n=== 票级（首次被拦时刻锚）前向峰值收益，降序 ===');
  for (const r of results) {
    console.log(`${r.addr.slice(0, 10)} ${(r.sym || '').slice(0, 10).padEnd(10)} ${new Date(r.t0).toISOString().slice(5, 16)} 锚${r.anchor.toExponential(2)} 后续${String(r.nAfter).padStart(4)}行 | 10min +${(r.r10 || 0).toFixed(0).padStart(4)}% 30min +${(r.r30 || 0).toFixed(0).padStart(4)}% 峰值 +${(r.rPeak || 0).toFixed(0).padStart(5)}% ${r.golden ? golden.get(r.addr) + '★' : ''}${r.skip ? ' SKIP:' + r.skip : ''}`);
  }

  const ok = results.filter(r => !r.skip);
  const stat = (arr, f, label) => {
    const v = arr.map(f).sort((a, b) => a - b);
    if (!v.length) return console.log(label, 'n/a');
    const med = v[Math.floor(v.length / 2)];
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const ge = x => (v.filter(y => y >= x).length / v.length * 100).toFixed(0) + '%';
    console.log(`${label} n=${v.length} 中位+${med.toFixed(0)}% 均值+${mean.toFixed(0)}% | ≥0:${ge(0)} ≥+50:${ge(50)} ≥+100:${ge(100)} ≥+300:${ge(300)}`);
  };
  console.log('\n=== 分布汇总（票级） ===');
  stat(ok, r => r.rPeak, '峰值:');
  stat(ok, r => r.r30, '30min峰:');
  stat(ok, r => r.r10, '10min峰:');
  const g = ok.filter(r => r.golden);
  if (g.length) console.log('金狗票:', g.map(r => `${r.addr.slice(0, 6)}(峰值+${r.rPeak.toFixed(0)}%)`).join(' '));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
