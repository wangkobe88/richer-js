// 生产实验 SB1 观察臂命中计数（v73 c6efed13 / v74 7cb423af）
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
(async () => {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  for (const exp of ['c6efed13-ce9d-41b0-89a5-8ca8b029a609', '7cb423af-c1c0-40d6-8cf7-4e91c1e4d6f9']) {
    const { data: expRow } = await db.from('experiments').select('experiment_name,status').eq('id', exp);
    if (!expRow || !expRow[0]) { console.log(exp.slice(0, 8), ': 实验不存在'); continue; }
    const { count: total } = await db.from('strategy_signals').select('id', { count: 'exact', head: true })
      .eq('experiment_id', exp).eq('signal_type', 'BUY');
    const { count: hit } = await db.from('strategy_signals').select('id', { count: 'exact', head: true })
      .eq('experiment_id', exp).eq('signal_type', 'BUY')
      .eq('metadata->cheatCheck->>strongbackerLike', '1');
    console.log(exp.slice(0, 8), expRow[0].experiment_name, expRow[0].status, 'BUY=' + total, 'sbLike=1: ' + hit);
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
