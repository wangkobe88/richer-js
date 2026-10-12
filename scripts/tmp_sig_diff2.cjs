'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const PERF = '17da408e-c930-4049-97c4-dbf2f12ee3ef';
const V0 = '5517e3db-608b-4572-bcc9-159fc46f3b26';
(async () => {
  const sb = dbManager.getClient();
  const fetch = async (id, limit) => {
    const rows = []; let off = 0;
    for (;;) {
      const { data, error } = await sb.from('strategy_signals')
        .select('token_address,created_at')
        .eq('experiment_id', id).eq('action', 'buy')
        .order('id', { ascending: true }).range(off, off + 999);
      if (error) throw new Error(error.message);
      rows.push(...data);
      if (rows.length >= limit || data.length < 1000) break;
      off += 1000;
    }
    return rows.slice(0, limit);
  };
  const pf = await fetch(PERF, 100000);
  const v0All = await fetch(V0, 100000);
  const v0Head = v0All.slice(0, pf.length);
  const v0HeadSet = new Set(v0Head.map(r => r.token_address));
  const pfSet = new Set(pf.map(r => r.token_address));
  console.log(`perf 前${pf.length}信号 token=${pfSet.size} | V0 前${pf.length}信号 token=${v0HeadSet.size}`);
  console.log('首信号时刻对比（perf 前 3 token）:');
  let i = 0;
  for (const t of pfSet) {
    const p = pf.find(r => r.token_address === t).created_at;
    const v = v0All.find(r => r.token_address === t);
    const vHead = v0Head.find(r => r.token_address === t);
    console.log(`  ${t.slice(0, 12)} perf首=${p} v0首=${v ? v.created_at : '无'} v0前${pf.length}内=${vHead ? '在' : '不在'}`);
    if (++i >= 3) break;
  }
  console.log(`perf 信号时间范围: ${pf[0].created_at} → ${pf[pf.length - 1].created_at}`);
  console.log(`V0  前${pf.length}信号时间范围: ${v0Head[0].created_at} → ${v0Head[v0Head.length - 1].created_at}`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
