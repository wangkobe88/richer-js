'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const PERF = '17da408e-c930-4049-97c4-dbf2f12ee3ef';
const V0 = '5517e3db-608b-4572-bcc9-159fc46f3b26';
(async () => {
  const sb = dbManager.getClient();
  const fetch = async (id) => {
    const rows = []; let off = 0;
    for (;;) {
      const { data, error } = await sb.from('strategy_signals')
        .select('token_address,created_at,action,reason')
        .eq('experiment_id', id)
        .order('id', { ascending: true }).range(off, off + 999);
      if (error) throw new Error(error.message);
      rows.push(...data);
      if (data.length < 1000) break;
      off += 1000;
    }
    rows.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.token_address.localeCompare(b.token_address));
    return rows;
  };
  const pf = await fetch(PERF);
  const v0 = await fetch(V0);
  console.log(`perf 总信号=${pf.length}（含 sell）`);
  // 找第一个分叉：V0 前 N 个里 perf 没有的（perf 是进行时，取 min(len) 段）
  const n = Math.min(pf.length, v0.length, 2000);
  for (let i = 0; i < n; i++) {
    const a = pf[i], b = v0[i];
    if (a.token_address !== b.token_address || a.created_at !== b.created_at || a.action !== b.action) {
      console.log(`第一个分叉 @ idx=${i}`);
      for (let k = Math.max(0, i - 2); k <= Math.min(i + 4, n - 1); k++) {
        const p = pf[k], q = v0[k];
        console.log(`  [${k}] perf: ${(p.action || '?')[0]} ${p.created_at} ${p.token_address.slice(0, 14)} ${p.reason || ''}`);
        console.log(`       v0  : ${(q.action || '?')[0]} ${q.created_at} ${q.token_address.slice(0, 14)} ${q.reason || ''}`);
      }
      process.exit(0);
    }
  }
  console.log(`前 ${n} 个信号完全一致`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
