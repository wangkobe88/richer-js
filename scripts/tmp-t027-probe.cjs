// T027 探针：打印 07:20-07:24 窗信号行 token_address 长度分布（182 跑）
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager.js');

(async () => {
  const c = await dbManager.getClient();
  const probe = await c.from('strategy_signals')
    .select('id,created_at,signal_type,token_address')
    .eq('experiment_id', 'c6efed13-ce9d-41b0-89a5-8ca8b029a609')
    .gte('created_at', '2026-11-05T07:20:00Z')
    .lte('created_at', '2026-11-05T07:24:00Z')
    .order('id', { ascending: true })
    .limit(400);
  (probe.data || []).forEach((r) => {
    const ta = r.token_address || '';
    console.log(r.id.slice(0, 8), r.signal_type, 'len=' + ta.length, ta);
  });
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
