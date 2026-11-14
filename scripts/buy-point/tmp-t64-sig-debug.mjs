import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
// 这票在该实验的 signals——先看按 id 前 3 行形状
const a = await c.from('strategy_signals').select('id,token_address,action,created_at')
  .eq('experiment_id', '5390bbfa-0c86-48a2-b9e1-94537c54ac17')
  .ilike('token_address', '%2692bcbc%').limit(5);
console.log('ilike %2692bcbc%:', JSON.stringify(a.data));
// 用 review 合成路径验证：trades.signal_id 反查
const t = await c.from('trades').select('id,token_address,signal_id,trade_direction,created_at')
  .eq('experiment_id', '5390bbfa-0c86-48a2-b9e1-94537c54ac17')
  .ilike('token_address', '%2692bcbc%').order('id').limit(10);
console.log('trades:', JSON.stringify(t.data, null, 1));
await dbManager.destroy?.();
