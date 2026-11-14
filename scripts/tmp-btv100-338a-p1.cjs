// 一次性（182 跑）：0x338a 的 P1 信号行 triggerNo 序列（6 行>2 的形态取证）
const { dbManager } = require('../src/services/dbManager.js');
(async () => {
  const c = await dbManager.getClient();
  const { data: tk } = await c.from('strategy_signals').select('token_address')
    .eq('experiment_id', '11fc182a-b051-4665-857c-5c14e6713334').like('token_address', '0x338a%').limit(1);
  const addr = tk && tk[0] && tk[0].token_address;
  if (!addr) { console.log('未找到 338a'); process.exit(0); }
  const { data, error } = await c.from('strategy_signals')
    .select('id,created_at,metadata')
    .eq('experiment_id', '11fc182a-b051-4665-857c-5c14e6713334')
    .eq('token_address', addr)
    .order('id');
  if (error) throw new Error(error.message);
  console.log(`338a 全部信号行：${data.length}`);
  for (const s of data) {
    const m = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata || {};
    if (!/P1[^0-9]/.test(String(m.strategyName || ''))) continue;
    const sg = m.signalGate || {}, cc = m.cheatCheck || {}, bp = m.buyPoint || {}, a = bp.assessment || {};
    console.log(`#${s.id} @${s.created_at.slice(11, 19)} triggerNo=${sg.triggerNo} status=${m.execution_status} cheat=${cc.grade}${cc.exempt ? '(豁免←' + cc.exempt.originalGrade + ')' : ''}${cc.cached ? '/cached' : ''} BP=${a.bucket}/${a.rule}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
