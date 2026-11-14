// 一次性（182 跑）：R3 苹果SI 专项——09:14:39 买入 1 秒后全卖的成交点位取证。
// ①全周期价格时间线（5min 桶）②09:00-09:30 行明细 ③graduation 事件 ④09:14 附近 BUY 信号
// ⑤trades 完整 metadata（1 秒卖的触发原因：毕业卖/cheat 清仓/止损？）
const { dbManager } = require('../../src/services/dbManager.js');
const EXP = '11fc182a-b051-4665-857c-5c14e6713334';
const ADDR = '0xc9bf4530033f6497002d228296fedb45036f7777';
const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m) : (m || {}); } catch { return {}; } };
const ts = (s) => new Date(s).toISOString().slice(11, 19);

(async () => {
  const c = await dbManager.getClient();
  const q = 'id,block_time,trade_type,bnb_amount,token_amount,price_bnb,platform';
  const { data: rows, error } = await c.from('wss_price_ticks').select(q)
    .eq('token_address', ADDR).order('id', { ascending: true }).limit(8000);
  if (error) throw new Error('ticks: ' + error.message);
  console.log(`总行 ${rows.length}`);

  // ① 全周期 5min 桶价格
  console.log('--- 全周期 5min 桶（末价 | min~max | 行数/买笔）---');
  const bucket = new Map();
  for (const r of rows) {
    const p = Number(r.price_bnb);
    if (!(p > 0)) continue;
    const t = Date.parse(r.block_time);
    const k = Math.floor(t / 300000);
    const e = bucket.get(k) || { ps: [], n: 0, buys: 0 };
    e.ps.push(p); e.n++;
    if (r.trade_type === 'buy') e.buys++;
    bucket.set(k, e);
  }
  [...bucket.entries()].sort((a, b) => a[0] - b[0]).forEach(([k, e]) => {
    console.log(`${new Date(k * 300000).toISOString().slice(11, 16)} 末=${e.ps[e.ps.length - 1].toExponential(4)} ${Math.min(...e.ps).toExponential(3)}~${Math.max(...e.ps).toExponential(3)} ${e.n}行/买${e.buys}`);
  });

  // ② 09:00-09:30 行明细
  console.log('--- 09:00-09:30 行明细 ---');
  rows.filter((r) => {
    const s = new Date(r.block_time).toISOString().slice(11, 19);
    return s >= '09:00:00' && s <= '09:30:00';
  }).forEach((r) => console.log(`${ts(r.block_time)} ${r.trade_type} bnb=${Number(r.bnb_amount).toFixed(4)} tok=${Number(r.token_amount || 0).toFixed(1)} postP=${Number(r.price_bnb || 0).toExponential(4)}`));

  // ③ wss_events
  const { data: evs } = await c.from('wss_events').select('kind,block_time,payload')
    .eq('token_address', ADDR).order('id');
  console.log('--- wss_events ---');
  for (const e of evs || []) console.log(`${ts(e.block_time)} ${e.kind} ${String(JSON.stringify(e.payload)).slice(0, 160)}`);

  // ④ 09:05-09:20 BUY 信号
  const { data: sigs } = await c.from('strategy_signals').select('id,created_at,metadata')
    .eq('experiment_id', EXP).eq('signal_type', 'BUY').eq('token_address', ADDR).order('id');
  console.log('--- 全部 BUY 信号（时间/状态/腿/cheat/BP/fire价）---');
  for (const s of sigs || []) {
    const m = parse(s.metadata);
    const cc = m.cheatCheck || {}; const bp = m.buyPoint || {};
    console.log(`${ts(s.created_at)} ${m.execution_status || '?'} ${(m.strategyName || '').replace('买入策略 ', '')} trig=${(m.signalGate || {}).triggerNo ?? '-'} cheat=${cc.grade} bp=${(bp.assessment || {}).rule || '无段'} price=${m.currentPriceBnb ?? m.price ?? '?'}`);
  }

  // ⑤ trades 完整行
  const { data: trades } = await c.from('trades').select('*')
    .eq('experiment_id', EXP).eq('token_address', ADDR).order('id');
  console.log('--- trades 完整（1 秒卖的触发原因）---');
  for (const t of trades || []) {
    const m = parse(t.metadata);
    console.log(`${ts(t.executed_at || t.created_at)} ${t.trade_direction} in=${t.input_amount} out=${t.output_amount} unit=${t.unit_price}`);
    console.log(`  metadata: ${JSON.stringify(m).slice(0, 500)}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
