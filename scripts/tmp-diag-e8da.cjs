#!/usr/bin/env node
/** 临时诊断:0xe8da…7777 在最新实验为何没买入(C84 链路全查) */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const ADDR = '0xe8da305a2ea91281592e5a8e4565ad9aaa3c7777';

async function main() {
  const db = dbManager.getClient();

  // 1. running 实验确认最新
  const exps = await db.from('experiments').select('id,name,status,mode,platform,started_at')
    .eq('status', 'running').order('started_at', { ascending: false }).limit(5);
  console.log('=== running experiments ===');
  for (const e of exps.data || []) console.log(JSON.stringify(e));

  // 2. token_create 事件(有无被采集到)
  const ev = await db.from('wss_events').select('kind,created_at,block_number,metadata')
    .eq('token_address', ADDR).order('created_at').limit(5);
  console.log('\n=== wss_events ===', (ev.data || []).length);
  for (const e of ev.data || []) console.log(JSON.stringify({ kind: e.kind, created_at: e.created_at, block: e.block_number, meta: e.metadata ? JSON.stringify(e.metadata).slice(0, 200) : null }));

  // 3. signals
  const sg = await db.from('strategy_signals').select('id,experiment_id,side,status,created_at,price,reason')
    .eq('token_address', ADDR).limit(10);
  console.log('\n=== strategy_signals ===', (sg.data || []).length);
  for (const s of sg.data || []) console.log(JSON.stringify({ ...s, id: s.id.slice(0, 8), experiment_id: (s.experiment_id || '').slice(0, 8) }));

  // 4. trades
  const tr = await db.from('trades').select('id,experiment_id,side,amount_bnb,executed_at,metadata')
    .eq('token_address', ADDR).limit(5);
  console.log('\n=== trades ===', (tr.data || []).length);
  for (const t of tr.data || []) console.log(JSON.stringify({ ...t, id: (t.id || '').slice(0, 8), experiment_id: (t.experiment_id || '').slice(0, 8) }));

  // 5. 叙事轮次(最新实验)
  const nr = await db.from('narrative_analysis_rounds').select('*').eq('token_address', ADDR)
    .order('created_at').limit(20);
  console.log('\n=== narrative_analysis_rounds ===', (nr.data || []).length);
  for (const r of nr.data || []) console.log(JSON.stringify({ ...r, experiment_id: (r.experiment_id || '').slice(0, 8) }));

  // 6. token_narrative 全局缓存
  const tn = await db.from('token_narrative').select('token_address,numeric_rating,final_rating,block_reason,updated_at,created_at')
    .eq('token_address', ADDR).limit(2);
  console.log('\n=== token_narrative ===', (tn.data || []).length);
  for (const n of tn.data || []) console.log(JSON.stringify(n));

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
