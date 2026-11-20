const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('strategy_signals').select('reason,created_at,metadata')
    .eq('experiment_id','c73b62be-bb1d-4acf-8002-652e5fb8a507')
    .ilike('reason','%流动性止损%')
    .order('created_at',{ascending:true}).limit(30);
  if (error) throw error;
  console.log('断流卖出行数:', data.length);
  for (const s of data.slice(0, 15)) {
    const sc = (s.metadata || {}).stallClose;
    console.log(`[${s.created_at}] ${s.reason}` + (sc ? ` | stallClose段=${JSON.stringify(sc)}` : ' | 无stallClose段'));
  }
  const { data: all, error: e2 } = await sb.from('strategy_signals').select('signal_type', { count: 'exact', head: true })
    .eq('experiment_id','c73b62be-bb1d-4acf-8002-652e5fb8a507');
  console.log('总信号行:', all ? '(count ok)' : '', e2 ? '' : '');
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
