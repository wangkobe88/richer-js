// 临时脚本：查 strategy_library pump-imbalance-exit v1 行形状（T116 接线镜像用）
const path = require('path');
const { dbManager } = require(path.join(__dirname, '../src/services/dbManager.js'));

(async () => {
  const client = await dbManager.getClient();
  const { data, error } = await client
    .from('strategy_library')
    .select('*')
    .eq('name', 'pump-imbalance-exit')
    .eq('version', 1);
  if (error) throw new Error(JSON.stringify(error));
  console.log('pump-imbalance-exit v1 形状:');
  console.log(JSON.stringify(data[0], null, 2));
  // 顺带列出全部卖腿条目名（供确认无重名）
  const { data: all } = await client
    .from('strategy_library')
    .select('name,side,version')
    .eq('side', 'sell')
    .order('name');
  console.log('--- 全部卖腿条目:');
  for (const r of all) console.log(`${r.name} v${r.version}`);
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
