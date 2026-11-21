/**
 * 一次性回填（2026-11-21，JG6 token_meta 迁移配套）：8 个 JG6 集合回测实验
 * （caseCollectionId=6fd0372f…）运行时用空 symbol 写的 experiment_tokens.token_symbol
 * 与 trades.token_symbol（纯展示冗余列，引擎/统计不读它做决策）→ 从集合表迁移后
 * 的权威 token_meta.payload.symbol 回填。只填空值（token_symbol=''），不覆盖非空。
 *
 * per-(exp,token) update（PostgREST 无 join-update），并发 20 池。182 跑（红线 #9）。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const COLLECTION_ID = '6fd0372f-48eb-494d-890b-5fa652127609';
const CONCURRENCY = 20;

const expIds = [
  '6cdc438f-911e-45fe-b7de-fb2a3ac24e79',
  '070ae384-816d-4588-8d05-dca33faa98b9',
  '652e638c-6f3e-41c9-ab8c-5e9cf99f6855',
  '3a5e3d38-ab25-4653-bd77-e4573ee5dbd6',
  'f070cb4e-ccb5-4f53-b333-1e32413a44a5',
  'b9cf1028-c5c1-4a5e-8d4b-8a889223e779',
  '6f08daf1-5ed1-492c-b153-070fc28b0fb9',
  'd56643bb-30c9-4ed1-a2db-92a15e634771',
];

async function main() {
  const c = dbManager.getClient();

  // 1) 集合权威 symbol 映射
  const { count: mCount } = await c.from('case_collection_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('collection_id', COLLECTION_ID);
  const symMap = new Map();
  for (let from = 0; from < mCount; from += 500) {
    const { data: page } = await c.from('case_collection_tokens')
      .select('token_address, token_meta')
      .eq('collection_id', COLLECTION_ID)
      .order('id', { ascending: true })
      .range(from, from + 499);
    if (!page || !page.length) break;
    for (const m of page) {
      const sym = m.token_meta && m.token_meta.payload && m.token_meta.payload.symbol;
      if (sym) symMap.set(m.token_address, sym);
    }
    if (page.length < 500) break;
  }
  console.log(`集合权威 symbol: ${symMap.size}/${mCount} 票`);

  // 2) 圈任务：各实验 token_symbol='' 的去重地址（experiment_tokens / trades 分开）
  const tasks = []; // { table, expId, addr, sym }
  for (const expId of expIds) {
    for (const table of ['experiment_tokens', 'trades']) {
      const addrs = new Set();
      for (let from = 0; ; from += 1000) {
        const { data: page, error } = await c.from(table)
          .select('token_address')
          .eq('experiment_id', expId)
          .eq('token_symbol', '')
          .order('token_address', { ascending: true })
          .range(from, from + 999);
        if (error) throw new Error(`${table} 圈地址 ${expId}: ${error.message}`);
        if (!page || !page.length) break;
        for (const r of page) addrs.add(r.token_address);
        if (page.length < 1000) break;
      }
      for (const addr of addrs) {
        const sym = symMap.get(addr);
        if (sym) tasks.push({ table, expId, addr, sym });
      }
      console.log(`${expId} ${table}: 空symbol地址 ${addrs.size}`);
    }
  }
  console.log(`任务总数: ${tasks.length}`);

  // 3) 并发池执行
  let done = 0, failures = 0;
  async function worker() {
    while (tasks.length > 0) {
      const t = tasks.shift();
      if (!t) break;
      try {
        const { error } = await c.from(t.table)
          .update({ token_symbol: t.sym })
          .eq('experiment_id', t.expId)
          .eq('token_address', t.addr)
          .eq('token_symbol', '');
        if (error) throw new Error(error.message);
      } catch (e) {
        failures++;
        console.error(`FAIL ${t.table} ${t.expId} ${t.addr}: ${e.message}`);
      }
      if (++done % 1000 === 0) console.log(`  …${done}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`回填完成: ${done} 任务, 失败 ${failures}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
