import { dbManager } from '../../src/services/dbManager.js';
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../../config/.env', import.meta.url), 'utf8');
for (const line of env.split('\n')) {
  if (/^(SUPABASE_URL|SUPABASE_ANON_KEY)\s*=/.test(line)) console.log(line.slice(0, 60));
}
const c = await dbManager.getClient();
const e = await c.from('experiments').select('id,name', { count: 'exact', head: true });
console.log('experiments count:', e.count, 'error:', JSON.stringify(e.error?.message ?? null));
const tok = '0x2591c5cbd66a0a532870f6ceef68f10d25bc7777';
const t = await c.from('wss_price_ticks').select('block_time', { count: 'exact', head: true }).ilike('token_address', tok);
console.log('ticks count for token:', t.count, 'error:', JSON.stringify(t.error?.message ?? null));
await dbManager.close?.();
