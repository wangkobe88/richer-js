// 一次性诊断：bt-v140 票 0x05d2…7777 为何 T113 pump 失衡全清臂（只买不卖持续拉升）没触发
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x05d26fcacc92500d1de680ee3b428cd2dbe17777';
const EXP = '6e75ed6d-807a-4164-9551-d3b95d1fc37b'; // bt-v140

(async () => {
  const c = await dbManager.getClient();

  // 1) 精确地址信号行
  const { data: sigs } = await c.from('strategy_signals')
    .select('id,signal_type,action,executed,reason,created_at,metadata')
    .eq('experiment_id', EXP).eq('token_address', ADDR)
    .order('created_at', { ascending: true });
  console.log(`精确地址信号行=${(sigs||[]).length}`);
  for (const s of sigs || []) console.log(`  ${s.created_at} ${s.signal_type}/${s.action} executed=${s.executed} reason=${s.reason}`);

  // 2) 精确地址成交
  const { data: tr } = await c.from('trades')
    .select('id,trade_direction,trade_status,input_amount,output_amount,created_at,metadata')
    .eq('experiment_id', EXP).eq('token_address', ADDR)
    .order('created_at', { ascending: true });
  console.log(`\n精确地址成交行=${(tr||[]).length}`);
  for (const t of tr || []) console.log(`  ${t.created_at} ${t.trade_direction}/${t.trade_status} in=${t.input_amount} out=${t.output_amount}`);

  // 3) 前缀模糊（防手敲地址错位）
  const { data: pref } = await c.from('trades')
    .select('token_address,trade_direction,trade_status,input_amount,created_at')
    .eq('experiment_id', EXP).like('token_address', '0x05d2%')
    .order('created_at', { ascending: true });
  console.log(`\n前缀 0x05d2 成交行=${(pref||[]).length}`);
  for (const t of pref || []) console.log(`  ${t.token_address} ${t.created_at} ${t.trade_direction}/${t.trade_status} in=${t.input_amount}`);

  // 4) 尾缀 7777 全部买入票（供人工比对地址）
  const { data: all } = await c.from('trades')
    .select('token_address,trade_direction,trade_status,input_amount,created_at')
    .eq('experiment_id', EXP).eq('trade_direction', 'buy')
    .order('created_at', { ascending: true }).limit(300);
  console.log(`\n全部买入成交(≤300)=${(all||[]).length}`);
  const seen = new Set();
  for (const t of all || []) {
    if (seen.has(t.token_address)) continue;
    seen.add(t.token_address);
    console.log(`  ${t.token_address}`);
  }
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
