const { dbManager } = require('../src/services/dbManager');
const EXP = '2bdf98ab-d85f-40fa-84b5-d79099e1006c';
const TOKEN = '0xe9e82d1fa74283991dec5543453373ec836b7777';
async function main() {
  const sb = dbManager.getClient();
  const { data: ts } = await sb.from('trades').select('*').eq('experiment_id', EXP).eq('token_address', TOKEN).order('executed_at');
  for (const t of ts || []) {
    console.log(t.executed_at || t.created_at, '| side=', t.side || t.trade_type, '| qty=', t.quantity, '| bnb=', t.bnb_amount, '| pnl=', t.profit_loss ?? t.pnl, '| price=', t.price, '| meta.reason=', t.metadata?.reason || t.metadata?.sellReason || '');
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
