const { dbManager } = require('../src/services/dbManager.js');
const EXP = 'f0898589-58f1-4101-a648-0dc9cad41f3a';
async function main() {
  const c = await dbManager.getClient();
  const { data: rows } = await c.from('manual_trade_requests')
    .select('*').eq('experiment_id', EXP)
    .order('requested_at', { ascending: false }).limit(6);
  for (const r of rows || []) {
    console.log(JSON.stringify({ id: r.id, token: (r.token_address || '').slice(0, 12), status: r.status, dir: r.direction, pct: r.sell_pct ?? r.sellPct, at: r.requested_at }));
  }
  await dbManager.close?.();
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
