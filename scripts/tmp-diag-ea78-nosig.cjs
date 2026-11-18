// 一次性诊断：e5941591 实验 0xea78…7777 为何 13:48:33 前期没发信号
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0xea7886d590ba1d7d6d4e7761148ba26405c67777';
const EXP = 'e5941591-df22-4434-ae29-1a93ced0f841';

(async () => {
  const c = await dbManager.getClient();

  // 1) 该 token 信号行
  const sigQ = await c.from('strategy_signals')
    .select('id,signal_type,action,created_at,metadata,reason,status')
    .eq('experiment_id', EXP).eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(200);
  const sigs = sigQ.data || [];
  if (sigQ.error) console.error('signals err', sigQ.error);
  console.log(`信号行数=${sigs.length}`);
  for (const s of sigs) {
    console.log(`  signal ${s.id} ${s.signal_type} ${s.created_at} status=${s.status} reason=${s.reason}`);
  }
  if (sigs.length) {
    console.log('\n首条信号 metadata keys:', Object.keys(sigs[0].metadata || {}));
    console.log(JSON.stringify(sigs[0].metadata, null, 1).slice(0, 3000));
  }

  // 2) token_create + 首 3 分钟 ticks
  const t0 = new Date('2026-11-05T05:47:30Z');
  const t1 = new Date('2026-11-05T05:52:00Z');
  const tickQ = await c.from('wss_price_ticks')
    .select('block_time,block_number,log_index,bnb_amount,price_bnb,trade_type,trader_address,sender_address,price_outlier')
    .eq('token_address', ADDR)
    .gte('block_time', t0.toISOString())
    .lte('block_time', t1.toISOString())
    .order('block_time', { ascending: true })
    .limit(500);
  const ticks = tickQ.data || [];
  if (tickQ.error) console.error('ticks err', tickQ.error);
  console.log(`\nticks 05:47:30~05:52:00Z 行数=${ticks.length}`);
  for (const t of ticks) {
    const ts = new Date(t.block_time);
    console.log(`  ${ts.toISOString()} blk=${t.block_number} log=${t.log_index} ${t.trade_type} bnb=${Number(t.bnb_amount).toFixed(4)} px=${t.price_bnb == null ? 'null' : Number(t.price_bnb).toExponential(3)} out=${t.price_outlier} w=${(t.sender_address || t.trader_address || '-').slice(0, 10)}`);
  }
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
