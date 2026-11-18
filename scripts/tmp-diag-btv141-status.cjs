const { dbManager } = require('../src/services/dbManager.js');
(async () => {
  const c = await dbManager.getClient();
  const EXP='3916fb15-66a1-45f0-bde1-1c145513817a';
  const { count: sigN } = await c.from('strategy_signals').select('id',{count:'exact',head:true}).eq('experiment_id',EXP);
  console.log('bt-v141 信号总数:', sigN);
  const { data: toks } = await c.from('experiment_tokens')
    .select('status,token_address').eq('experiment_id',EXP).limit(2000);
  const by = {};
  for (const t of toks||[]) by[t.status]=(by[t.status]||0)+1;
  console.log('experiment_tokens 状态分布:', JSON.stringify(by), '总数:', (toks||[]).length);
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
