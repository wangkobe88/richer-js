// 单行小读取：查实验 3e8460f1 完整配置
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });
const { dbManager } = require('/Users/nobody1/Desktop/Codes/richer-js/src/services/dbManager');

async function main() {
  const client = dbManager.getClient();
  const { data, error } = await client
    .from('experiments')
    .select('*')
    .eq('id', '3e8460f1-ba61-40e1-b3c0-0d3c26bd8833')
    .single();
  if (error) throw error;
  for (const k of Object.keys(data)) {
    if (k === 'config') continue;
    if (/_at$/.test(k) || ['id', 'name', 'status', 'mode', 'blockchain', 'type'].includes(k)) {
      console.log(`${k}: ${JSON.stringify(data[k])}`);
    }
  }
  console.log('--- config ---');
  console.log(JSON.stringify(data.config, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
