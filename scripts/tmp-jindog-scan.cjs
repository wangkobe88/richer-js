#!/usr/bin/env node
/**
 * 一次性脚本：金狗候选整理（bt-v164 signal-stats 口径，2026-11-21）
 * 有信号的代币 × token_profiles.max_change_percent > 500，排除已在金狗集合的票。
 * 用后可删。实验级小查询，本地可跑。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXP_ID = '9e9163de-a677-4d39-9c33-9ec9df05e400'; // bt-v164
const COLLECTION_ID = 'a8414632-7c24-4762-9253-c49bb0f53105'; // 大金狗-尽量保证买入
const THRESHOLD = 500;

async function fetchAllPages(from, pageSize = 1000) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const page = await from.range(offset, offset + pageSize - 1);
    if (page.error) throw new Error(page.error.message);
    rows.push(...page.data);
    if (page.data.length < pageSize) return rows;
    offset += pageSize;
  }
}

(async () => {
  const db = dbManager.getClient();

  // 1) 该实验全部信号的 token 集合（signal-stats 页面口径：有信号才上页面）
  const signalRows = await fetchAllPages(
    db.from('strategy_signals').select('token_address, signal_type, executed').eq('experiment_id', EXP_ID)
  );
  const sigMap = new Map();
  for (const r of signalRows) {
    const a = (r.token_address || '').toLowerCase();
    if (!a) continue;
    if (!sigMap.has(a)) sigMap.set(a, { buy: 0, sell: 0, executedBuy: 0, obs: 0 });
    const s = sigMap.get(a);
    if (r.signal_type === 'BUY') { s.buy++; if (r.executed) s.executedBuy++; }
    else if (r.signal_type === 'SELL') s.sell++;
    else if (r.signal_type === 'OBSERVE') s.obs++;
  }
  console.log(`信号涉及代币: ${sigMap.size}（信号行 ${signalRows.length}）`);

  // 2) experiment_tokens → symbol（批 100 .in）
  const addrs = [...sigMap.keys()];
  const symbolMap = new Map();
  for (let i = 0; i < addrs.length; i += 100) {
    const batch = addrs.slice(i, i + 100);
    const res = await db.from('experiment_tokens').select('token_address, token_symbol')
      .eq('experiment_id', EXP_ID).in('token_address', batch);
    if (res.error) throw new Error(res.error.message);
    for (const t of res.data) symbolMap.set(t.token_address.toLowerCase(), t.token_symbol || '?');
  }

  // 3) token_profiles → max_change_percent（批 100 .in）
  const changeMap = new Map();
  for (let i = 0; i < addrs.length; i += 100) {
    const batch = addrs.slice(i, i + 100);
    const res = await db.from('token_profiles').select('token_address, max_change_percent')
      .in('token_address', batch);
    if (res.error) throw new Error(res.error.message);
    for (const p of res.data) changeMap.set(p.token_address.toLowerCase(), p.max_change_percent);
  }

  // 4) 金狗集合已有代币
  const colRes = await db.from('case_collection_tokens').select('token_address, note, sync_state')
    .eq('collection_id', COLLECTION_ID);
  if (colRes.error) throw new Error(colRes.error.message);
  const inCollection = new Set(colRes.data.map(t => t.token_address.toLowerCase()));
  console.log(`集合已有: ${inCollection.size}`);

  // 5) 汇总：>500 且不在集合，按涨幅降序
  const hits = [];
  let noChange = 0;
  for (const a of sigMap.keys()) {
    const mc = changeMap.get(a);
    if (mc == null) { noChange++; continue; }
    if (mc > THRESHOLD && !inCollection.has(a)) {
      hits.push({ addr: a, symbol: symbolMap.get(a) || '?', maxChange: mc, ...sigMap.get(a) });
    }
  }
  hits.sort((x, y) => y.maxChange - x.maxChange);
  console.log(`\n涨幅 >${THRESHOLD}% 且不在集合: ${hits.length} 票（无涨幅数据 ${noChange} 票）`);
  for (const h of hits) {
    console.log(`${String(h.maxChange.toFixed(1)).padStart(9)}%  ${h.symbol.padEnd(20)} ${h.addr}  buy=${h.buy}(exec${h.executedBuy}) sell=${h.sell} obs=${h.obs}`);
  }
  console.log('\nADDRS=' + hits.map(h => h.addr).join(','));
  process.exit(0);
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
