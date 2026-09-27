import { dbManager } from './src/services/dbManager.js';
const client = dbManager.getClient();
const addr = '0xbeea1d618e533a387d941f58a7d4c9b7bd377777';
const { count } = await client.from('wss_price_ticks').select('*', { count: 'exact', head: true }).eq('token_address', addr.toLowerCase());
console.log('牛来 ticks 行数:', count);
process.exit(0);
