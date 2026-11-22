#!/usr/bin/env node
// 一次性（本地小结果）：dump 0xc0e8…7777 在 bt-v164 (9e9163de) 的信号/成交/门链 metadata + 金狗集合成员状态。只读。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
const ADDR = '0x2335bc4868817a216be949c545f9a7e550bf7777';
const COLL = 'a8414632-7c24-4762-9253-c49bb0f53105';
(async () => {
  const sb = dbManager.getClient();
  // 1) 集合成员
  const { data: member, error: mErr } = await sb.from('case_collection_tokens')
    .select('token_address, platform, sync_state, note, token_meta')
    .eq('collection_id', COLL).eq('token_address', ADDR).maybeSingle();
  if (mErr) console.log('集合查询错误:', mErr.message);
  if (member) {
    const meta = member.token_meta || {};
    console.log('== 金狗集合成员:', (meta.payload && meta.payload.symbol) || meta.symbol || '?', 'platform=', member.platform, 'sync_state=', member.sync_state);
    console.log('原 note:', member.note || '(空)');
  } else {
    console.log('== 金狗集合：不在集合中');
  }
  // 2) experiment_tokens
  const { data: et } = await sb.from('experiment_tokens')
    .select('token_symbol, platform, status, first_seen_at, created_at').eq('experiment_id', EXP).eq('token_address', ADDR).maybeSingle();
  console.log('== experiment_tokens:', JSON.stringify(et));
  // 3) 信号行
  const { data: sigs, error: sErr } = await sb.from('strategy_signals').select('*')
    .eq('experiment_id', EXP).eq('token_address', ADDR).order('created_at', { ascending: true });
  if (sErr) throw new Error(sErr.message);
  console.log('== strategy_signals 条数:', sigs.length);
  for (const s of sigs) {
    const { metadata, ...rest } = s;
    console.log('\n=== 行字段:', JSON.stringify(rest));
    const m = metadata || {};
    for (const k of Object.keys(m)) {
      const v = m[k];
      if (k === 'buyPoint' && v && typeof v === 'object') {
        console.log(`[${k}] passed=${v.passed} status=${v.status} bucket=${v.bucket} rule=${v.rule}`, JSON.stringify(v.reason || v.detail || '').slice(0, 400));
      } else if (k === 'factorCheck' && v && typeof v === 'object') {
        console.log(`[${k}]`, JSON.stringify(v).slice(0, 500));
      } else if (k === 'cheatCheck' && v && typeof v === 'object') {
        console.log(`[${k}]`, JSON.stringify(v).slice(0, 400));
      } else if (k === 'actFrontGate' && v && typeof v === 'object') {
        console.log(`[${k}]`, JSON.stringify(v).slice(0, 400));
      } else if (k === 'signalGate' && v && typeof v === 'object') {
        console.log(`[${k}]`, JSON.stringify(v).slice(0, 400));
      } else if (k === 'trendFactors' || (v && typeof v === 'object' && Object.keys(v).length > 30)) {
        const pick = {};
        for (const fk of ['currentVsLaunchPct', 'athVsLaunchPct', 'actTotalBnb', 'actBuyBnb', 'actSellBnb', 'actTrades', 'actBuyers', 'actSellers', 'tokenAgeSec', 'quietSpanMs', 'quietSurgeBuyBnb', 'quietSurgeSec', 'recentBlockDropPct', 'mcapFromPeakPct', 'tradesRouterPct', 'tradesNetBuyRatioLongWin', 'tradesNetBuyRatioShortWin', 'mcapBnb', 'buyPriceBnb', 'chg5Pct', 'chg10Pct', 'chg30Pct', 'holdersExDust', 'buyWallets', 'top1BuySharePct', 'bundleClusterHoldCircPct', 'top2HolderCircPct']) if (v[fk] !== undefined) pick[fk] = v[fk];
        console.log(`[${k}]`, JSON.stringify(pick));
      } else {
        console.log(`[${k}]`, JSON.stringify(v).slice(0, 500));
      }
    }
  }
  // 4) 成交
  const { data: trs, error: tErr } = await sb.from('trades').select('*')
    .eq('experiment_id', EXP).eq('token_address', ADDR).order('created_at', { ascending: true });
  if (tErr) throw new Error(tErr.message);
  console.log('\n== trades 条数:', trs.length);
  for (const t of trs) console.log(JSON.stringify({ id: t.id, side: t.side, qty: t.quantity, price: t.price_bnb, bnb: t.bnb_amount, at: t.created_at, executed_at: t.executed_at, profit: t.profit_bnb, metadata: t.metadata ? JSON.stringify(t.metadata).slice(0, 200) : null }));
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
