// 一次性诊断：bt-v140 票 0x288b…7777 famous 非常早上车，用户判"基本无救"——取证 famous 行为时序
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x288b3aad44de17174bb815133355583c7d717777';
const EXP = '3916fb15-66a1-45f0-bde1-1c145513817a';

(async () => {
  const c = await dbManager.getClient();

  // 1) 实验行
  const { data: exp } = await c.from('experiments')
    .select('id,experiment_name,trading_mode,status,config').eq('id', EXP).limit(1);
  const e = exp[0];
  console.log(`实验: ${e.experiment_name} mode=${e.trading_mode} status=${e.status}`);

  // 2) token create 事件（出生锚）
  const { data: creates } = await c.from('wss_events')
    .select('block_time,payload').eq('token_address', ADDR).eq('kind', 'token_create').limit(1);
  const t0 = creates?.[0]?.block_time;
  console.log('token_create:', t0, JSON.stringify(creates?.[0]?.payload || {}).slice(0, 300));

  // 3) 信号行
  const { data: sigs } = await c.from('strategy_signals')
    .select('id,signal_type,action,created_at,execution_status,price,metadata,strategy_id')
    .eq('experiment_id', EXP).eq('token_address', ADDR)
    .order('created_at', { ascending: true });
  console.log('信号数:', (sigs || []).length);
  for (const s of sigs || []) {
    const m = s.metadata || {};
    const sg = m.signalGate || {};
    const fc = m.factorCheck || {};
    const cc = m.cheatCheck || {};
    const bp = m.buyPoint || {};
    console.log(`--- ${s.created_at} ${s.signal_type} ${s.strategy_id||''} ${s.execution_status} price=${s.price}`);
    if (Object.keys(sg).length) console.log('  signalGate:', JSON.stringify({leg: sg.legId ?? sg.leg, trig: sg.triggerNo}));
    if (Object.keys(fc).length) console.log('  factorCheck:', JSON.stringify(fc).slice(0, 500));
    if (cc.grade) console.log('  cheatCheck:', JSON.stringify({grade: cc.grade, reasons: cc.reasons, exempt: cc.exempt, activity: cc.levels?.activityLevel}));
    if (Object.keys(bp).length) console.log('  buyPoint:', JSON.stringify({bucket: bp.bucket, rule: bp.rule, mp: bp.market_pattern ?? bp.marketPattern, es: bp.entry_shape ?? bp.entryShape}));
    if (m.rejectionReason || m.failureReason) console.log('  reject:', m.rejectionReason || m.failureReason);
  }

  // 4) trades
  const { data: trades } = await c.from('trades')
    .select('trade_type,amount_bnb,price,profit_loss,created_at,metadata')
    .eq('experiment_id', EXP).eq('token_address', ADDR)
    .order('created_at', { ascending: true });
  console.log('成交数:', trades?.length ?? 0);
  for (const t of trades || []) {
    console.log(`  ${t.created_at} ${t.trade_type} bnb=${t.amount_bnb} price=${t.price} pnl=${t.profit_loss}`);
  }

  process.exit(0);
})().catch(err => { console.error('ERR', err.message); process.exit(1); });
