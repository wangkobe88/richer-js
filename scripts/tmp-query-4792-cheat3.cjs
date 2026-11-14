// 一次性查询（三）：前两个 BUY 信号完整 metadata
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x47922a47421d10d3d23687fec49f6077bcfb7777';
const EXP = '936e1bd9-630a-4f91-bb52-3f4afb1a27f4';

async function main() {
  const client = await dbManager.getClient();
  const { data: sigs, error } = await client
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(30);
  if (error) throw error;
  for (const s of sigs || []) {
    const m = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata;
    console.log(`\n=== signal ${s.id} ${s.signal_type}/${s.action} at=${s.created_at} status=${s.status ?? '-'}`);
    const keys = m ? Object.keys(m) : [];
    console.log(`metadata keys: ${keys.join(',')}`);
    if (m && m.failureReason) console.log(`failureReason: ${JSON.stringify(m.failureReason)}`);
    if (m && m.cheatGate) console.log(`cheatGate: ${JSON.stringify(m.cheatGate)}`);
    // 打印除因子表外的中小字段
    for (const k of keys) {
      const v = m[k];
      const s2 = JSON.stringify(v) || '';
      if (s2.length < 400 && !['factorResults','factors','preBuyCheckFactors','snapshot'].includes(k)) {
        console.log(`  ${k}: ${s2}`);
      } else {
        console.log(`  ${k}: <len ${s2.length}>`);
      }
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
