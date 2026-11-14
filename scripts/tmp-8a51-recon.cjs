// 侦察 8a51f2fd 实验:config/信号/叙事轮次/成交概况(小结果,本地可跑)
const { dbManager } = require('../src/services/dbManager');
const EXP = '8a51f2fd-e467-4459-9004-18b9486ab567';
(async () => {
  const client = dbManager.getClient();
  // 1) 实验行
  const { data: exp, error: e1 } = await client
    .from('experiments').select('id,status,created_at,config').eq('id', EXP).single();
  if (e1) { console.log('ERR exp', e1.message); process.exit(1); }
  console.log('=== experiment ===');
  console.log('status:', exp.status, '| created_at:', exp.created_at);
  const cfg = exp.config || {};
  console.log('config keys:', Object.keys(cfg).join(','));
  const sc = cfg.strategiesConfig || {};
  console.log('--- strategiesConfig ---');
  console.log(JSON.stringify(sc, null, 2).slice(0, 4000));
  // 2) 信号概况
  const { data: sigs, error: e2 } = await client
    .from('strategy_signals').select('signal_type,status,token_address,created_at')
    .eq('experiment_id', EXP).limit(5000);
  if (e2) console.log('ERR sigs', e2.message);
  else {
    const byType = {};
    for (const s of sigs) { const k = `${s.signal_type}/${s.status || '-'}`; byType[k] = (byType[k] || 0) + 1; }
    console.log('=== strategy_signals (rows=' + sigs.length + ') ===');
    console.log(JSON.stringify(byType));
    const buys = sigs.filter(s => s.signal_type === 'BUY');
    console.log('BUY tokens uniq:', new Set(buys.map(b => b.token_address)).size, 'first:', buys[0]?.created_at, 'last:', buys[buys.length - 1]?.created_at);
  }
  // 3) 叙事轮次
  const { data: rounds, error: e3 } = await client
    .from('narrative_analysis_rounds').select('token_address,rating,round,reason,created_at')
    .eq('experiment_id', EXP).limit(5000);
  if (e3) console.log('ERR rounds', e3.message);
  else {
    const byRating = {}; const toks = new Set();
    for (const r of rounds) { const k = String(r.rating); byRating[k] = (byRating[k] || 0) + 1; toks.add(r.token_address); }
    console.log('=== narrative_analysis_rounds (rows=' + rounds.length + ', tokens=' + toks.size + ') ===');
    console.log('rating dist:', JSON.stringify(byRating));
    console.log('first:', rounds[0]?.created_at, 'last:', rounds[rounds.length - 1]?.created_at);
  }
  // 4) 成交
  const { data: trs, error: e4 } = await client
    .from('trades').select('trade_direction,trade_status,token_address,output_amount,input_amount,trade_time')
    .eq('experiment_id', EXP).limit(2000);
  if (e4) console.log('ERR trades', e4.message);
  else {
    const byDir = {};
    for (const t of trs) { const k = `${t.trade_direction}/${t.trade_status}`; byDir[k] = (byDir[k] || 0) + 1; }
    console.log('=== trades (rows=' + trs.length + ') ===', JSON.stringify(byDir));
    console.log('BUY-trade tokens:', new Set(trs.filter(t => t.trade_direction === 'BUY').map(t => t.token_address)).size);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
