#!/usr/bin/env node
// 一次性：bt-v177 金狗集合回测拒因分析（182 跑）。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXP = '4d74f39e-4055-4adb-afa3-de8a22bb9f49';
const TRADED = ['0x4509204c', '0x898af40e', '0x3bebfa16', '0xe83626c4'];

(async () => {
  const c = dbManager.getClient();
  const { data: sig, error } = await c.from('strategy_signals')
    .select('token_address,token_symbol,action,reason,metadata,created_at')
    .eq('experiment_id', EXP).order('created_at');
  if (error) throw new Error(error.message);

  const byTok = {};
  for (const s of sig) {
    const a = s.token_address.toLowerCase();
    (byTok[a] = byTok[a] || { symbol: s.token_symbol, rows: [] }).rows.push(s);
  }
  const isTraded = (a) => TRADED.some((t) => a.startsWith(t));

  // 票级拒因：execution_status=failed 的信号按 execution_reason 聚合
  const rejCount = {};
  const tokFinal = {};
  for (const [a, v] of Object.entries(byTok)) {
    if (isTraded(a)) continue;
    const labels = new Map(); // reason -> 该票命中信号数
    for (const s of v.rows) {
      const m = s.metadata || {};
      if (m.execution_status === 'failed' && m.execution_reason) {
        labels.set(m.execution_reason, (labels.get(m.execution_reason) || 0) + 1);
      }
    }
    tokFinal[a] = [...labels.entries()].map(([r, n]) => r + (n > 1 ? '×' + n : ''));
    for (const [r] of labels) rejCount[r] = (rejCount[r] || 0) + 1;
  }

  console.log('=== 22 票未成交 · 拒因分布（票级，一票可多臂）===');
  for (const [k, n] of Object.entries(rejCount).sort((x, y) => y[1] - x[1])) {
    console.log(String(n).padStart(3), k);
  }

  console.log('\n=== 每票拒因臂全集 ===');
  for (const [a, labels] of Object.entries(tokFinal)) {
    console.log(a.slice(0, 10), String(byTok[a].symbol).padEnd(12), labels.length ? labels.join(' ; ') : '（信号全非 failed=别因）');
  }

  // 无信号票
  const { data: toks } = await c.from('case_collection_tokens')
    .select('token_address,token_meta->payload->symbol')
    .eq('collection_id', 'a8414632-7c24-4762-9253-c49bb0f53105');
  console.log('\n=== 无信号票（触发条件从未满足）===');
  for (const t of toks) {
    const a = t.token_address.toLowerCase();
    if (!byTok[a]) console.log(a.slice(0, 10), t.symbol);
  }
  process.exit(0);
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
