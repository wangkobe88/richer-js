// 一次性取证（182 跑）：
// 1) v98 回测窗口起点（experiments.config backtest 段）——ba5e 07:39:24 create，
//    四实验首信号 07:52:18，确认 07:39-07:52 是否在窗口外/因子缺失
// 2) ba5e 07:52:18 / ea78 09:59:57 cheatCheck.anchors 完整键值（burst 三键为何未授予豁免）
// 3) ba5e / ea78 在 v98 窗口内的首 tick 时间（wss_price_ticks 首行 block_time）
const { dbManager } = require('../../src/services/dbManager.js');

const V98 = 'fe029df4-cd1f-490c-bfaf-f945feed287b';

async function main() {
  const client = await dbManager.getClient();
  // 1) 实验窗口
  const { data: exp } = await client.from('experiments')
    .select('id,experiment_name,config').eq('id', V98).limit(1);
  const cfg = (exp && exp[0] && exp[0].config) || {};
  const bt = cfg.backtest || {};
  console.log('v98 name=', exp[0].experiment_name);
  console.log('backtest 段:', JSON.stringify({ startTime: bt.startTime, endTime: bt.endTime, sourceExperimentId: bt.sourceExperimentId, signalGateReal: bt.signalGateReal, windowHours: bt.windowHours }, null, 0));

  // 2) ba5e/ea78 首信号 anchors 全量
  for (const [name, addr] of [['ba5e', '0xba5ed45b42479e0a75316de7bf990ec90a3e4444'], ['ea78', '0xea7886d590ba1d7d6d4e7761148ba26405c67777']]) {
    const { data } = await client.from('strategy_signals')
      .select('created_at,metadata').eq('experiment_id', V98).eq('token_address', addr)
      .eq('signal_type', 'BUY').order('created_at', { ascending: true }).limit(1);
    const cc = (data && data[0] && data[0].metadata && data[0].metadata.cheatCheck) || {};
    console.log(`\n${name} 首信号 ${data && data[0] ? data[0].created_at.slice(5, 19) : '?'}:`);
    console.log('  anchors 全量:', JSON.stringify(cc.anchors || {}, null, 1).slice(0, 1600));
  }

  // 3) 窗口内首 tick（id 探针窗避免大表坑：按 platform 表走 block_time 排序会超时，
  //    用 created_at gt 探针 + 窗内过滤）——直接查两票在 11-05 当天 07:30-08:10 的首行
  for (const [name, addr] of [['ba5e', '0xba5ed45b42479e0a75316de7bf990ec90a3e4444'], ['ea78', '0xea7886d590ba1d7d6d4e7761148ba26405c67777']]) {
    const { data, error } = await client.from('wss_price_ticks')
      .select('block_time,price_bnb').eq('token_address', addr)
      .gte('block_time', '2026-11-05T07:30:00').lt('block_time', '2026-11-05T10:30:00')
      .order('block_time', { ascending: true }).limit(3);
    if (error) { console.log(`${name} ticks err: ${error.message}`); continue; }
    console.log(`${name} 窗内首 tick:`, (data || []).map((r) => `${r.block_time.slice(5, 19)}@${r.price_bnb.toExponential(3)}`).join(' | ') || '(无)');
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
