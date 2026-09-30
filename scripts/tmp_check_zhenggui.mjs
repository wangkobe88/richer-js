import { dbManager } from './src/services/dbManager.js';
const ADDR = '0x969c6981ff56be42404542a7d459d34955997777'.toLowerCase();
const c = dbManager.getClient();

let { data: rows, error } = await c.from('token_narrative')
  .select('*')
  .eq('token_address', ADDR)
  .order('analyzed_at', { ascending: false, nullsFirst: false })
  .limit(1);
if (error) { console.log('error:', JSON.stringify(error).slice(0, 300)); process.exit(1); }
const r = rows?.[0];
if (!r) { console.log('no row'); process.exit(0); }

// stage1_result.details 里找 relevance / name_referent 概率
console.log('== stage1_result.details ==');
console.log(r.stage1_result?.details ? JSON.stringify(r.stage1_result.details).slice(0, 3000) : 'null');

// stage1_raw_output 里找 relevance_type 概率分布
const raw = r.stage1_raw_output;
console.log('\n== stage1_raw_output type ==', typeof raw, raw ? (Array.isArray(raw) ? 'array' : Object.keys(raw).join(',')) : 'null');
if (raw) {
  const s = JSON.stringify(raw);
  // 找 relevance_type 相关片段
  const idx = [];
  let p = 0;
  while ((p = s.indexOf('relevance_type', p)) !== -1) { idx.push(p); p += 10; }
  for (const i of idx.slice(0, 4)) {
    console.log('--- relevance_type @', i, '---');
    console.log(s.slice(Math.max(0, i - 50), i + 400));
  }
}
process.exit(0);
