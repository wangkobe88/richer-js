// 对拍：experiment_tokens(源实验).platform vs wss_events token_create payload.platform
import { dbManager } from '../../src/services/dbManager.js';
const SRC = '67803108-485a-4f1e-b300-a24061849d7d';
const TOKEN = '0xe4fe922f88c09cbe127cebfa25f84d2f00917777';
const c = await dbManager.getClient();

const { data: et, error: e1 } = await c.from('experiment_tokens')
  .select('token_address,platform,created_at,raw_api_data')
  .eq('experiment_id', SRC).eq('token_address', TOKEN).limit(1);
if (e1) throw new Error(e1.message);
console.log('experiment_tokens(源 67803108):', JSON.stringify(et[0] ? {
  platform: et[0].platform, created_at: et[0].created_at,
  totalSupply: et[0].raw_api_data?.totalSupply,
} : null));

const { data: ev, error: e2 } = await c.from('wss_events')
  .select('payload,block_time')
  .eq('token_address', TOKEN).eq('kind', 'token_create').limit(1);
if (e2) throw new Error(e2.message);
console.log('wss_events token_create:', JSON.stringify(ev[0] ? {
  platform: ev[0].payload?.platform, block_time: ev[0].block_time,
  totalSupply: ev[0].payload?.totalSupply,
} : null));

// 该票 ticks 的 platform 列分布 + quote_token 标记
const { data: tk, error: e3 } = await c.from('wss_price_ticks')
  .select('platform,quote_token,price_bnb').eq('token_address', TOKEN).limit(5);
if (e3) throw new Error(e3.message);
console.log('ticks 前5行 platform/quote:', JSON.stringify(tk.map(t => [t.platform, t.quote_token, Number(t.price_bnb).toExponential(4)])));
process.exit(0);
