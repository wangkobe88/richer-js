// bt-v110 ba5e 三卡 HOLD 不触发归因：卖信号 metadata 的 fB/fS 因子快照
import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const V110 = '80e3867f-db2c-4f68-9647-180758287ded';
const BA5E = '0xba5ed45b42479e0a75316de7bf990ec90a3e4444';
const LC = '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777'; // 来财对照
const rows = []; let from = 0;
while (true) {
  const { data, error } = await c.from('strategy_signals').select('id,token_address,metadata,created_at')
    .eq('experiment_id', V110).eq('action', 'sell').order('id', { ascending: true }).range(from, from + 999);
  if (error) throw new Error(error.message);
  rows.push(...data); if (data.length < 1000) break; from += 1000;
}
for (const [tag, addr] of [['ba5e', BA5E], ['来财', LC]]) {
  console.log(`=== ${tag} ===`);
  for (const s of rows.filter(r => r.token_address === addr)) {
    const m = s.metadata || {};
    console.log(`  ${s.created_at.slice(11, 19)} ${m.strategyId} pp=${m.profitPercent != null ? Number(m.profitPercent).toFixed(0) : '?'} fB=${m.sinceLastFamousBigBuySec} fS=${m.recentFamousSellBnb}`);
  }
}
process.exit(0);
