import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const e = await c.from('experiments').select('id,name,status,created_at').order('created_at',{ascending:false}).limit(5);
console.log('error:', JSON.stringify(e.error ?? null));
console.log('rows:', JSON.stringify(e.data ?? null, null, 1));
await dbManager.close?.();
