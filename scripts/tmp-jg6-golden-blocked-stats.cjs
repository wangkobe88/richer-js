#!/usr/bin/env node
// 一次性：金狗集合 30 票在 bt-v164 的信号/拦截分布——因子门合理性证据。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';

(async () => {
  const sb = dbManager.getClient();
  const { data: toks, error: e1 } = await sb.from('case_collection_tokens')
    .select('token_address, token_meta, note')
    .eq('collection_id', 'a8414632-7c24-4762-9253-c49bb0f53105')
    .order('added_at', { ascending: true });
  if (e1) throw new Error(e1.message);
  console.log('集合成员:', toks.length);

  const addrs = toks.map(t => t.token_address);
  // 分批拉信号行（30 票小结果）
  const sigs = [];
  for (let i = 0; i < addrs.length; i += 25) {
    const { data, error } = await sb.from('strategy_signals')
      .select('token_address, created_at, signal_type, executed, metadata')
      .eq('experiment_id', EXP).in('token_address', addrs.slice(i, i + 25))
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    sigs.push(...data);
  }
  const buys = sigs.filter(s => s.signal_type === 'BUY');

  // 票级汇总
  const byToken = new Map();
  for (const t of toks) byToken.set(t.token_address, { symbol: (t.token_meta || {}).symbol, buys: 0, executed: 0, arms: [], exec: [] });
  for (const s of buys) {
    const e = byToken.get(s.token_address); if (!e) continue;
    e.buys++;
    if (s.executed) e.executed++;
    const fc = (s.metadata || {}).factorCheck;
    const er = (s.metadata || {}).execution_reason;
    if (fc && fc.reason) e.arms.push(fc.reason);
    else if (er) e.exec.push(er);
  }
  const armCount = new Map();
  let noSignal = 0, bought = 0, blockedOnly = 0;
  console.log('\n=== 票级明细 ===');
  for (const [addr, e] of byToken) {
    if (e.buys === 0) { noSignal++; console.log(`${e.symbol || addr.slice(0, 10).padEnd(12)} 无信号`); continue; }
    if (e.executed > 0) { bought++; console.log(`${e.symbol || addr.slice(0, 10).padEnd(12)} ✅买入 ${e.executed}/${e.buys} 信号`); continue; }
    blockedOnly++;
    for (const a of e.arms) armCount.set(a, (armCount.get(a) || 0) + 1);
    console.log(`${e.symbol || addr.slice(0, 10).padEnd(12)} ❌被拦 ${e.buys} 信号: ${[...new Set(e.arms)].join(',') || [...new Set(e.exec)].join(',')}`);
  }
  console.log(`\n=== 汇总 === 30 票: 买入 ${bought} / 被拦未买 ${blockedOnly} / 无信号 ${noSignal}`);
  console.log('被拦臂分布（按信号次）:', [...armCount.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
