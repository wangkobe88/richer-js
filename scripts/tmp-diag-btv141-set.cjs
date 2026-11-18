const { dbManager } = require('../src/services/dbManager.js');
(async () => {
  const c = await dbManager.getClient();
  const { data: tr } = await c.from('trades')
    .select('token_address,trade_type,amount_bnb,profit_loss')
    .eq('experiment_id', '3916fb15-66a1-45f0-bde1-1c145513817a');
  const toks = new Set((tr||[]).filter(t=>t.trade_type==='buy').map(t=>t.token_address));
  console.log('bt-v141 成交票数:', toks.size, '总成交行:', (tr||[]).length);
  // 买入时间范围（用 experiment_tokens 或 config 窗口）
  const { data: exp } = await c.from('experiments').select('config').eq('id','3916fb15-66a1-45f0-bde1-1c145513817a').single();
  const bt = exp.config?.backtest || {};
  console.log('窗口:', bt.startTime, '→', bt.endTime, '| 源实验:', bt.sourceExperimentId || '(win)');
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
