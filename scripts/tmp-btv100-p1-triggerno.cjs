// 一次性（182 跑）：bt-v100 P1 腿 triggerNo 分布——验证 maxTriggers=2 消耗语义
const { dbManager } = require('../src/services/dbManager.js');
(async () => {
  const c = await dbManager.getClient();
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await c.from('strategy_signals')
      .select('id,token_address,token_symbol,created_at,metadata')
      .eq('experiment_id', '11fc182a-b051-4665-857c-5c14e6713334')
      .eq('signal_type', 'BUY').order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const perTok = new Map();
  let noTn = 0, maxTn = 0;
  for (const s of rows) {
    const m = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata || {};
    if (!/P1[^0-9]/.test(String(m.strategyName || ''))) continue; // 只看 P1（t0 腿）
    const tn = m.signalGate && m.signalGate.triggerNo;
    if (tn == null) { noTn++; continue; }
    maxTn = Math.max(maxTn, tn);
    if (!perTok.has(s.token_address)) perTok.set(s.token_address, []);
    perTok.get(s.token_address).push(tn);
  }
  const dist = {};
  for (const [, l] of perTok) { const mx = Math.max(...l); dist[mx] = (dist[mx] || 0) + 1; }
  console.log(`P1 信号（带 triggerNo）：per-token 最大 triggerNo 分布=${JSON.stringify(dist)} | 全局最大=${maxTn} | 无 triggerNo=${noTn}`);
  const over = [...perTok.entries()].filter(([, l]) => Math.max(...l) > 2);
  console.log(`triggerNo>2 的票：${over.length}`);
  for (const [tok, l] of over.slice(0, 8)) console.log(`  ${tok.slice(0, 10)}… triggerNo 序列=${l.join(',')}`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
