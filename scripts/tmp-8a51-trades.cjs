// 侦察4:trades 实际方向值 + signals BUY 行统计
const { dbManager } = require('../src/services/dbManager');
const EXP = '8a51f2fd-e467-4459-9004-18b9486ab567';
(async () => {
  const client = dbManager.getClient();
  const { data: trs } = await client.from('trades').select('*').eq('experiment_id', EXP).limit(20);
  for (const t of (trs || []).slice(0, 3)) console.log('trade sample:', JSON.stringify({ dir: t.trade_direction, status: t.trade_status, tok: t.token_address, in: t.input_amount, out: t.output_amount, at: t.created_at || t.trade_at || t.timestamp }));
  const byDir = {};
  for (const t of (trs || [])) byDir[t.trade_direction] = (byDir[t.trade_direction] || 0) + 1;
  console.log('all trades dir dist:', JSON.stringify(byDir), 'rows:', (trs || []).length);
  // signals
  const { data: sigs } = await client.from('strategy_signals').select('signal_type,action,token_address,created_at,executed,reason').eq('experiment_id', EXP).limit(5000);
  const byType = {};
  for (const s of (sigs || [])) { const k = `${s.signal_type}|${s.action}|exec=${s.executed}`; byType[k] = (byType[k] || 0) + 1; }
  console.log('signals dist:', JSON.stringify(byType, null, 1));
  const buys = (sigs || []).filter(s => s.signal_type === 'BUY');
  console.log('BUY signal rows:', buys.length, '| uniq tokens:', new Set(buys.map(b => b.token_address)).size);
  if (buys[0]) console.log('first BUY:', buys[0].created_at, buys[0].token_address, '| last BUY:', buys[buys.length - 1]?.created_at, buys[buys.length - 1]?.token_address);
  const lastSig = (sigs || []).filter(s => s.signal_type !== 'OBSERVE').pop();
  console.log('last non-observe signal:', lastSig ? `${lastSig.signal_type} ${lastSig.created_at} ${lastSig.token_address}` : 'none');
  const lastAny = (sigs || []).pop();
  console.log('last any signal:', lastAny ? `${lastAny.signal_type} ${lastAny.created_at}` : 'none');
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
