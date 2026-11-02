// 触发条件 + token 后续活动（单票小读取）
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0xdb1160d96885993a69bd9cb149ebff4d4a437777';
const EXP = '7dd26b85-16ac-43dd-a4f7-98840198cebf';

(async () => {
  const db = dbManager.getClient();

  const { data: exp, error: ee } = await db.from('experiments')
    .select('id,status,config').eq('id', EXP).single();
  if (ee) throw ee;
   console.log('=== 实验:', exp.id, '| status:', exp.status);
  const legs = exp.config?.strategies?.legs || exp.config?.strategies || [];
  const arr = Array.isArray(legs) ? legs : [];
  for (const leg of arr) {
    if (leg.side === 'buy' || leg.type === 'buy' || leg.narrativeTriggerCondition) {
      console.log('--- 买腿 narrativeTriggerCondition:', leg.narrativeTriggerCondition);
      console.log('    condition(买条件):', (leg.condition || '').slice(0, 500));
    }
  }
  const ws = exp.config?.fourmemeWs || exp.config?.flapWs || {};
  console.log('--- narrativeRetry:', JSON.stringify(ws.narrativeRetry || '(默认 10s×3)'));

  const first = await db.from('wss_price_ticks')
    .select('block_time,price_bnb')
    .eq('token_address', ADDR).order('block_time', { ascending: true }).limit(1);
  const last = await db.from('wss_price_ticks')
    .select('block_time,price_bnb')
    .eq('token_address', ADDR).order('block_time', { ascending: false }).limit(1);
  const cnt = await db.from('wss_price_ticks')
    .select('id', { count: 'exact', head: true })
    .eq('token_address', ADDR);
  console.log('\n=== token ticks: count=', cnt.count,
    '| first:', JSON.stringify(first.data?.[0]),
    '| last:', JSON.stringify(last.data?.[0]));

  // 14:59:09（首轮完成）之后 60s 内是否还有 tick（决定 retry 轮有没有机会）
  const after = await db.from('wss_price_ticks')
    .select('block_time,price_bnb')
    .eq('token_address', ADDR)
    .gte('block_time', '2026-10-27T14:59:19Z')
    .lte('block_time', '2026-10-27T15:00:30Z')
    .order('block_time', { ascending: true }).limit(5);
  console.log('14:59:19 后的 tick（前5）:', JSON.stringify(after.data));

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
