// 0x8cf171df…7777（中国屌会飞）v131 首信号拒因取证（182 跑）
const { dbManager } = require('../src/services/dbManager.js');

async function main() {
  const c = await dbManager.getClient();
  const { data: sig } = await c.from('strategy_signals')
    .select('id,created_at,signal_type,executed,status,reason,metadata')
    .eq('experiment_id', 'f3dd5537-654b-48a2-8e2a-1ba3699af29a')
    .ilike('token_address', '0x8cf171df%')
    .order('created_at', { ascending: true }).limit(4);
  for (const s of sig || []) {
    const m = s.metadata || {};
    console.log(`\n=== ${s.created_at} signal_type=${s.signal_type} executed=${s.executed} status=${s.status} ===`);
    console.log('reason 列:', s.reason);
    console.log('metadata 顶层键:', Object.keys(m).join(','));
    console.log('execution_reason:', m.execution_reason);
    console.log('tradeResult:', JSON.stringify(m.tradeResult || null).slice(0, 200));
    if (m.factorCheck) console.log('factorCheck:', JSON.stringify(m.factorCheck).slice(0, 400));
    if (m.cheatCheck) console.log('cheatCheck.status:', m.cheatCheck.status, 'grade:', m.cheatCheck.grade);
    if (m.buyPoint) console.log('buyPoint.status:', m.buyPoint.status, 'reason:', m.buyPoint.reason);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
