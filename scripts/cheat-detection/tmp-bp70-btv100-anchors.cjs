// 一次性（182 跑）：bt-v100 28ad P1 两行信号的 BP anchors 现价（确认实跑锚窗 curVs<28.5，
// BP70 落地后 t2 可走通统一门；parity 的 30.3=信号行 created_at 晚于 fire tick 的锚时差）
const { dbManager } = require('../../src/services/dbManager.js');
(async () => {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('strategy_signals')
    .select('id,created_at,metadata')
    .eq('experiment_id', '11fc182a-b051-4665-857c-5c14e6713334')
    .eq('token_address', '0x28ad2c7d08d83a85467bd4afcfd673dfce564444')
    .order('id');
  if (error) throw new Error(error.message);
  for (const s of data) {
    const m = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata || {};
    if (!/P1[^0-9]/.test(String(m.strategyName || ''))) continue;
    const bp = m.buyPoint || {}, a = bp.assessment || {}, an = bp.anchors || {};
    console.log(`#${s.id} @${s.created_at.slice(11, 19)} triggerNo=${(m.signalGate || {}).triggerNo} BP=${a.bucket}/${a.rule}` +
      ` curVs=${an.currentVsLaunchPct ?? '?'} minVs=${an.minVsLaunchPct ?? '?'} anchorTicks=${an.anchorTickCount ?? '?'}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
