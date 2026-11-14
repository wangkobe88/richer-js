import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const tok = '0x2591c5cbd66a0a532870f6ceef68f10d25bc7777';
const s = await c.from('strategy_signals').select('created_at,executed,metadata')
  .eq('experiment_id','5390bbfa-0c86-48a2-b9e1-94537c54ac17')
  .ilike('token_address', tok).eq('action','buy').order('created_at',{ascending:true}).limit(5);
for (const row of s.data ?? []) {
  const m = row.metadata ?? {};
  const cc = m.cheatCheck ?? {};
  const an = cc.anchors ?? {};
  console.log('=== BUY', row.created_at, 'exec=' + row.executed, 'exempt=' + JSON.stringify(cc.exempt));
  console.log('anchors.nearDump:', JSON.stringify(an.nearDump ?? null));
  console.log('anchors.burstExitSeg:', JSON.stringify(an.burstExitSeg ?? null));
  console.log('anchors keys:', Object.keys(an).join(','));
  const bp = m.buyPoint ?? {};
  console.log('bp keys:', Object.keys(bp).join(','));
  console.log('bp.info:', JSON.stringify(bp.info ?? {}).slice(0, 600));
  console.log('sg:', JSON.stringify((m.signalGate ?? {})).slice(0, 300));
}
// 成交与盈亏
const tr = await c.from('trades').select('side,quantity,price_bnb,bnb_amount,created_at,profit_loss,metadata')
  .eq('experiment_id','5390bbfa-0c86-48a2-b9e1-94537c54ac17')
  .ilike('token_address', tok).order('created_at',{ascending:true}).limit(10);
for (const t of (tr.data ?? [])) {
  console.log('trade', t.created_at, t.side, 'qty=' + t.quantity, 'px=' + t.price_bnb, 'bnb=' + t.bnb_amount, 'pnl=' + t.profit_loss);
}
await dbManager.close?.();
