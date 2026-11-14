import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const { data, error } = await c.from('trades')
  .select('trade_direction,input_amount,output_amount,created_at,signal_id')
  .eq('experiment_id', '5390bbfa-0c86-48a2-b9e1-94537c54ac17')
  .eq('token_address', '0x591018ffb7de68d0047ce285a25a2f0142e87777')
  .order('created_at');
if (error) throw new Error(JSON.stringify(error));
let buyBnb = 0, sellBnb = 0;
for (const t of data) {
  const inB = Number(t.input_amount || 0), outB = Number(t.output_amount || 0);
  console.log(t.created_at, t.trade_direction, 'in=' + inB, 'out=' + outB);
  if (t.trade_direction === 'buy') buyBnb += inB; else sellBnb += outB;
}
console.log('净额=' + (sellBnb - buyBnb).toFixed(4) + ' BNB');
