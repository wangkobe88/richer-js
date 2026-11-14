// SB BP 段原始形状 + 無為 cheat 段原始形状
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const EXP = 'ff1c8725-e6dd-46fb-a877-43fb6f463098';
(async () => {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  // SB 第 3 信号（cheat healthy 后首个 BP 拒）
  let { data } = await db.from('strategy_signals')
    .select('created_at,metadata')
    .eq('experiment_id', EXP).eq('token_address', '0x92aac04f03278ce7ac82ba0367dbaf9686437777')
    .eq('signal_type', 'BUY').order('created_at');
  const sb3 = data[2];
  console.log('== SB 第3信号', sb3.created_at, 'exec_reason=' + sb3.metadata.execution_reason);
  console.log('   buyPoint=' + JSON.stringify(sb3.metadata.buyPoint));
  // 無為首信号 cheat 段
  const w = await db.from('strategy_signals').select('created_at,metadata')
    .eq('experiment_id', EXP).eq('token_address', '0xb97d5772d3ab609d568ae2a778705e3ca88bf556')
    .eq('signal_type', 'BUY').order('created_at').limit(1);
  const wm = w.data[0].metadata;
  console.log('\n== 無為首信号', w.data[0].created_at, 'exec_reason=' + wm.execution_reason);
  const cc = wm.cheatCheck || {};
  console.log('   cheat.status=' + cc.status, 'grade=' + cc.grade, 'reasons=' + JSON.stringify(cc.reasons));
  if (cc.levels) console.log('   levels=' + JSON.stringify(cc.levels));
  if (cc.buckets) console.log('   buckets=' + JSON.stringify(cc.buckets).slice(0, 400));
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
