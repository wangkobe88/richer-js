#!/usr/bin/env node
// 一次性：查 0xc0e8 金狗在 bt-v164 (9e9163de) 未买入原因——实验形状+信号行+ticks 概览。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
const TOKEN = '0xc0e896ddec43881055a25786c17fa5d5d6337777';

(async () => {
  const sb = dbManager.getClient();

  // 1) 实验行
  const { data: exp, error: e1 } = await sb.from('experiments')
    .select('id, experiment_name, trading_mode, status, created_at, config')
    .eq('id', EXP).single();
  if (e1) throw new Error(e1.message);
  const cfg = exp.config || {};
  console.log('=== 实验 ===');
  console.log(JSON.stringify({ id: exp.id, name: exp.experiment_name, trading_mode: exp.trading_mode, status: exp.status, created_at: exp.created_at,
    strategyId: cfg.strategyId, backtest: cfg.backtest ? { sourceExperimentId: cfg.backtest.sourceExperimentId, startTime: cfg.backtest.startTime, endTime: cfg.backtest.endTime, signalGateReal: cfg.backtest.signalGateReal, caseCollectionId: cfg.backtest.caseCollectionId, tokenAddresses: cfg.backtest.tokenAddresses } : null }, null, 2));

  // 2) 该 token 的全部信号行
  const { data: sigs, error: e2 } = await sb.from('strategy_signals')
    .select('id, created_at, signal_type, action, status, token_address, leg_id, reason, metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(50);
  if (e2) throw new Error(e2.message);
  console.log(`\n=== 信号行 ${sigs.length} 条 ===`);
  for (const s of sigs) {
    const md = s.metadata || {};
    const gate = md.signalGate || md.factorCheck || md.cheatCheck || md.buyPoint ? 'GATE' : '';
    console.log(JSON.stringify({ id: s.id, at: s.created_at, type: s.signal_type, action: s.action, status: s.status, leg: s.leg_id, reason: s.reason, gateKeys: Object.keys(md) }));
  }

  // 3) ticks 概览（首尾+行数）
  const { count: tickCount, error: e3 } = await sb.from('wss_price_ticks')
    .select('id', { count: 'exact', head: true })
    .eq('token_address', TOKEN);
  if (e3) throw new Error(e3.message);
  console.log(`\n=== ticks 行数: ${tickCount} ===`);
  if (tickCount) {
    const { data: first } = await sb.from('wss_price_ticks')
      .select('block_number, log_index, price_bnb, trading_mode, created_at')
      .eq('token_address', TOKEN).order('id', { ascending: true }).limit(1);
    const { data: last } = await sb.from('wss_price_ticks')
      .select('block_number, log_index, price_bnb, created_at')
      .eq('token_address', TOKEN).order('id', { ascending: false }).limit(1);
    console.log('first:', JSON.stringify(first[0]), '\nlast:', JSON.stringify(last[0]));
  }

  // 4) token_create 事件（平台+时间）
  const { data: ev, error: e4 } = await sb.from('wss_events')
    .select('kind, platform, block_number, log_index, payload, created_at')
    .eq('token_address', TOKEN).order('id', { ascending: true }).limit(10);
  if (e4) throw new Error(e4.message);
  console.log(`\n=== wss_events ${ev.length} 条 ===`);
  for (const e of ev) {
    const p = e.payload || {};
    console.log(JSON.stringify({ kind: e.kind, platform: e.platform, bn: e.block_number, at: e.created_at, name: p.name, symbol: p.symbol, creator: p.creator ? String(p.creator).slice(0, 10) : undefined }));
  }

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
