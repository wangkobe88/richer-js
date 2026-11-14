const path = require('path'); require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();
(async () => {
  const T = '0xea7886d590ba1d7d6d4e7761148ba26405c67777';
  // token_create 锚（payload 含 symbol/platform）
  const { data: ev, error: e1 } = await db.from('wss_events')
    .select('block_time,payload').eq('kind', 'token_create').eq('token_address', T)
    .order('block_time', { ascending: true }).limit(1);
  if (e1) { console.log('ev err', e1.message); }
  else {
    const p = ev?.[0]?.payload || {};
    console.log('token_create block_time:', ev?.[0]?.block_time, '| symbol:', p.symbol, '| name:', p.name, '| platform:', p.platform, '| creator:', p.creatorAddress || p.creator_address || '');
  }
  // graduation
  const { data: gr, error: e2 } = await db.from('wss_events')
    .select('block_time').eq('kind', 'graduation').eq('token_address', T).limit(1);
  if (e2) console.log('gr err', e2.message);
  else console.log('graduation:', gr?.length ? gr[0].block_time : '(无)');
  // 最近单票 case 实验基底（M4GA 系）
  const { data: exps, error: e3 } = await db.from('experiments')
    .select('id,experiment_name,status,created_at')
    .or('experiment_name.ilike.%m4ga%,experiment_name.ilike.%backtest-token-case%')
    .order('created_at', { ascending: false }).limit(10);
  if (e3) console.log('exp err', e3.message);
  else for (const r of exps) console.log(`${r.experiment_name} ${r.id} ${r.status}`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
