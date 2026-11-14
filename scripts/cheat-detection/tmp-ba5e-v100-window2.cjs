// 一次性（182 跑）：v100 实验窗口确认 + ba5e ticks 正确 id 段 + v100 信号行概况。
const { dbManager } = require('../../src/services/dbManager.js');
const V100 = 'ed113d10-8d0b-495d-b1f1-9b597f564c21';
const T = '0xba5ed45b42479e0a75316de7bf990ec90a3e4444';
async function main() {
  const sb = await dbManager.getClient();
  const { data: exp, error: e1 } = await sb.from('experiments').select('name,status,config,created_at').eq('id', V100).limit(1);
  if (e1) console.log('exp err:', e1.message);
  const e = exp && exp[0];
  if (e) {
    const bt = (e.config || {}).backtest || {};
    const s = bt.startTime || bt.start || bt.from, en = bt.endTime || bt.end || bt.to;
    console.log(`v100: name=${e.name} status=${e.status} created=${e.created_at}`);
    console.log(`  backtest: source=${bt.sourceExperimentId || bt.sourceExperiment || '?'} 窗=[${s}, ${en}] signalGateReal=${bt.signalGateReal}`);
  } else console.log('experiments 无行');
  // v100 信号行概况（实验级查询有索引）
  const { data: sigs } = await sb.from('strategy_signals')
    .select('created_at,signal_type,status,token_address').eq('experiment_id', V100)
    .order('created_at').limit(500);
  const buy = (sigs||[]).filter(r=>r.signal_type==='BUY');
  console.log(`\nv100 信号行 ${(sigs||[]).length}（BUY ${buy.length}）；时间范围 ${sigs&&sigs.length?sigs[0].created_at.slice(5,19):'-'} → ${sigs&&sigs.length?sigs[sigs.length-1].created_at.slice(5,19):'-'}`);
  const byTok = new Map();
  for (const r of buy) byTok.set(r.token_address, (byTok.get(r.token_address)||0)+1);
  console.log('BUY 票数=' + byTok.size + '；ba5e 在内=' + byTok.has(T));
  // ba5e ticks：1110万~11239398 带扫
  let total = 0, first = null, last = null;
  for (let base = 11000000; base < 11239398; base += 45000) {
    const { data: seg } = await sb.from('wss_price_ticks')
      .select('id,block_time,trade_type,bnb_amount,token_address')
      .gt('id', base).lt('id', base + 46000).limit(1000).order('id', { ascending: true });
    if (!seg || !seg.length) continue;
    const hits = seg.filter((r) => r.token_address === T);
    if (hits.length) { total += hits.length; if (!first) first = hits[0]; last = hits[hits.length - 1]; }
  }
  console.log(`\nba5e ticks（11.0M~11.24M 带）命中 ${total} 行`);
  if (first) {
    console.log(`  首行 ${first.block_time.slice(5,19)} 末行 ${last.block_time.slice(5,19)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
