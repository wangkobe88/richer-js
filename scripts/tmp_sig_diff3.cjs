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
        .select('token_address,created_at')
        .eq('experiment_id', id).eq('action', 'buy')
        .order('id', { ascending: true }).range(off, off + 999);
      if (error) throw new Error(error.message);
      rows.push(...data);
      if (data.length < 1000) break;
      off += 1000;
    }
    return rows;
  };
  const pf = await fetch(PERF);
  const v0 = await fetch(V0);
  pf.sort((a, b) => a.created_at.localeCompare(b.created_at));
  v0.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const tEnd = pf[pf.length - 1].created_at;
  const v0in = v0.filter(r => r.created_at <= tEnd);
  console.log(`perf 总 ${pf.length}（→${tEnd}）| V0 同时间前缀内 ${v0in.length}`);
  // 逐 token 次数对比（同前缀）
  const cnt = (rows) => { const m = {}; for (const r of rows) m[r.token_address] = (m[r.token_address] || 0) + 1; return m; };
  const cp = cnt(pf), cv = cnt(v0in);
  const tokens = [...new Set([...Object.keys(cp), ...Object.keys(cv)])];
  let diff = 0, shown = 0;
  for (const t of tokens) {
    if ((cp[t] || 0) !== (cv[t] || 0)) {
      diff++;
      if (shown < 6) { console.log(`  次≠: ${t.slice(0, 14)} perf=${cp[t] || 0} v0=${cv[t] || 0}`); shown++; }
    }
  }
  console.log(`同前缀逐 token 次数差异数: ${diff}/${tokens.length}`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
