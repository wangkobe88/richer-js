const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const ADDR = '0x9d70e873394d31e928ab213f4a2aed24de637777';
const EXP = 'aed2091d-f22f-4660-ae62-42f48a9048de';
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();
  const { data: trades, error: e3 } = await client.from('trades')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true });
  if (e3) { console.error('trades err:', e3.message); process.exit(1); }
  console.log('rows:', (trades || []).length);
  if (trades && trades.length) {
    console.log('columns:', Object.keys(trades[0]).join(', '));
    for (const t of trades) {
      console.log(JSON.stringify({
        dir: t.trade_direction, success: t.success,
        qty: t.token_amount ?? t.quantity, bnb: t.bnb_amount ?? t.amount_bnb,
        price: t.price_bnb, at: t.created_at,
        cards: t.metadata && t.metadata.cardTrade ? t.metadata.cardTrade : undefined,
      }));
    }
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
