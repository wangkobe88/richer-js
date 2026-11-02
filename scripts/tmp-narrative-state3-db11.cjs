// 解析 jev_prompt 字符串 → state 全文 + 信号留痕
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0xdb1160d96885993a69bd9cb149ebff4d4a437777';

(async () => {
  const db = dbManager.getClient();
  const { data } = await db.from('token_narrative')
    .select('jev_prompt').eq('token_address', ADDR).single();
  const jp = JSON.parse(data.jev_prompt);
  console.log('=== jev_prompt 键:', Object.keys(jp).join(','));
  console.log('stateStats:', JSON.stringify(jp.stateStats));
  const st = jp.state;
  console.log('\n=== state 全文 ===');
  console.log(typeof st === 'string' ? st : JSON.stringify(st, null, 1));

  const { data: sig, error: es } = await db
    .from('strategy_signals')
    .select('id,signal_type,action,reason,metadata,created_at')
    .eq('experiment_id', '7dd26b85-16ac-43dd-a4f7-98840198cebf')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true });
  if (es) console.log('signals error:', es.message);
  else {
    console.log('\n=== strategy_signals 行数:', sig.length);
    for (const s of sig) {
      console.log(`[${s.created_at}] type=${s.signal_type} action=${s.action} reason=${(s.reason||'').slice(0,200)}`);
      const md = s.metadata || {};
      if (Object.keys(md).length) {
        console.log('   metadata.narrativeRating:', md.narrativeRating, '| category:', md.narrativeCategory, '| rounds:', md.narrativeRounds, '| keys:', Object.keys(md).slice(0,20).join(','));
      }
    }
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
