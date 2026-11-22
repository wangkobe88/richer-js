#!/usr/bin/env node
// 一次性：bt-v177 金狗集合分批详情（182 跑）。--batch N=第 N 批（5 票/批，按集合 added_at 序）。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXP = '4d74f39e-4055-4adb-afa3-de8a22bb9f49';
const COL = 'a8414632-7c24-4762-9253-c49bb0f53105';
const FLAP_FLOOR = 5.546e-9;

const batchNo = parseInt(process.argv[2] || '--batch'.split(' ')[0], 10);
const argIdx = process.argv.indexOf('--batch');
const BATCH = argIdx >= 0 ? parseInt(process.argv[argIdx + 1], 10) : NaN;
if (!Number.isInteger(BATCH) || BATCH < 1) { console.error('用法: node tmp-v177-batch-detail.cjs --batch <N>'); process.exit(2); }

const fmt = (v, d = 2) => (v == null || Number.isNaN(Number(v))) ? '?' : Number(v).toFixed(d);

(async () => {
  const c = dbManager.getClient();
  // 批次票清单（集合 added_at 序）
  const { data: toks } = await c.from('case_collection_tokens')
    .select('token_address,token_meta,platform,note')
    .eq('collection_id', COL).order('added_at').order('id', { ascending: false });
  const all = toks || [];
  const start = (BATCH - 1) * 5;
  const batch = all.slice(start, start + 5);
  if (!batch.length) { console.error('批次越界'); process.exit(2); }

  // 成交
  const { data: trades } = await c.from('trades')
    .select('token_address,token_symbol,trade_direction,input_amount,output_amount,unit_price,created_at')
    .eq('experiment_id', EXP).order('created_at');
  const tradesBy = {};
  for (const t of (trades || [])) (tradesBy[t.token_address.toLowerCase()] = tradesBy[t.token_address.toLowerCase()] || []).push(t);

  for (const tok of batch) {
    const a = tok.token_address.toLowerCase();
    const meta = tok.token_meta || {};
    const sym = meta.payload?.symbol || '?';
    console.log('\n━━━ 批' + BATCH + ' · ' + sym + ' · ' + tok.token_address + ' ━━━');
    if (tok.note) console.log('票备注: ' + String(tok.note).replace(/\s+/g, ' ').slice(0, 200));

    // 信号
    const { data: sigs } = await c.from('strategy_signals')
      .select('action,reason,created_at,metadata').eq('experiment_id', EXP).eq('token_address', tok.token_address).order('created_at');
    console.log('信号 ' + (sigs || []).length + ' 条');
    for (const s of (sigs || [])) {
      const m = s.metadata || {};
      const tf = m.trendFactors || {};
      const line = ['  ' + (s.created_at || '').slice(5, 19), s.action.padEnd(4), (s.reason || '').slice(0, 26).padEnd(26)];
      if (m.execution_status === 'failed') line.push('拒=' + m.execution_reason);
      if (tf.age != null) line.push('age=' + fmt(tf.age, 1) + 'm');
      if (tf.currentVsLaunchPct != null) line.push('curVs=' + fmt(tf.currentVsLaunchPct, 1) + '%');
      if (tf.buyVolumeBnb != null) line.push('buyVol=' + fmt(tf.buyVolumeBnb, 2) + 'B');
      if (tf.holdersExDust != null) line.push('exDust=' + tf.holdersExDust);
      if (tf.actTotalBnb != null) line.push('act=' + fmt(tf.actTotalBnb, 2) + 'B');
      if (tf.chg5Pct != null) line.push('chg5=' + fmt(tf.chg5Pct, 1));
      console.log(line.join(' '));
      // FP 门 gates 摘要（首拦臂）
      const fc = m.factorCheck;
      if (fc && fc.pass === false) {
        const hit = (fc.gates || []).filter(g => g.hit);
        console.log('     FP 首拦: ' + (hit.map(g => g.id + (g.value != null ? '(' + g.value + ')' : '')).join(', ') || fc.reason || '?').slice(0, 200));
      }
      // 其余门链段（AF1/CD/BP）——顶层键枚举非空段
      for (const k of ['actFrontGate', 'cheatCheck', 'buyPoint', 'actFront', 'cheat', 'bp']) {
        if (m[k] && typeof m[k] === 'object' && (m[k].decision || m[k].action || m[k].bucket)) {
          console.log('     ' + k + ': ' + JSON.stringify(m[k]).slice(0, 160));
        }
      }
    }

    // 成交
    const tr = tradesBy[a] || [];
    if (tr.length) {
      const buys = tr.filter(x => x.trade_direction === 'buy');
      const sells = tr.filter(x => x.trade_direction === 'sell');
      const inB = buys.reduce((s, x) => s + Number(x.input_amount), 0);
      const outB = sells.reduce((s, x) => s + Number(x.output_amount), 0);
      console.log('成交: 买 ' + buys.length + ' 笔 / 卖 ' + sells.length + ' 笔 | 投入 ' + fmt(inB, 3) + 'B → 回收 ' + fmt(outB, 3) + 'B = ' + (outB - inB >= 0 ? '+' : '') + fmt(outB - inB, 3) + 'B (' + fmt((outB / inB - 1) * 100, 1) + '%)');
      for (const t of tr) console.log('  ' + (t.created_at || '').slice(5, 19) + ' ' + t.trade_direction.padEnd(4) + ' in=' + fmt(Number(t.input_amount), 3) + ' out=' + Number(t.output_amount).toPrecision(4) + ' px=' + Number(t.unit_price).toExponential(3));
    } else {
      console.log('成交: 0（未进场）');
    }

    // 终局：全窗峰值（BNB 轴 price_bnb）vs 信号时刻价/地板
    const { data: pk } = await c.from('wss_price_ticks')
      .select('price_bnb,block_time').eq('token_address', tok.token_address)
      .not('price_bnb', 'is', null).gt('price_bnb', 0)
      .order('price_bnb', { ascending: false }).limit(1);
    const { data: lo } = await c.from('wss_price_ticks')
      .select('price_bnb').eq('token_address', tok.token_address)
      .not('price_bnb', 'is', null).gt('price_bnb', 0)
      .order('price_bnb', { ascending: true }).limit(1);
    if (pk && pk[0] && lo && lo[0]) {
      const peak = Number(pk[0].price_bnb), floor = Number(lo[0].price_bnb);
      console.log('终局: 全窗峰值 ' + peak.toExponential(3) + '@' + (pk[0].block_time || '').slice(5, 16) + ' | 较窗内低点 ×' + fmt(peak / floor, 1) + ' | 较 flap 地板 ' + fmt((peak / FLAP_FLOOR - 1) * 100, 0) + '%');
      // 锚价=末信号（或买成交）时刻后首 tick 的 BNB 轴价——signal/trades 的 price 是 quote 轴不可混用（JG-16 坑）
      let anchorTag = null, anchorAt = null;
      if (tr.length) { anchorTag = '买成交时刻'; anchorAt = tr.find(x => x.trade_direction === 'buy').created_at; }
      else if (sigs && sigs.length) { anchorTag = '末信号时刻'; anchorAt = sigs[sigs.length - 1].created_at; }
      if (anchorAt) {
        const { data: ax } = await c.from('wss_price_ticks').select('price_bnb')
          .eq('token_address', tok.token_address).not('price_bnb', 'is', null).gt('price_bnb', 0)
          .gte('block_time', anchorAt).order('block_time').limit(1);
        if (ax && ax[0] && Number(ax[0].price_bnb) > 0) {
          console.log('      峰值 vs ' + anchorTag + 'BNB 价 ' + Number(ax[0].price_bnb).toExponential(3) + ' = ×' + fmt(peak / Number(ax[0].price_bnb), 1));
        }
      }
    }
  }
  process.exit(0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
