// 一次性取证（182 跑）：用户四件事四票信号核实——v94/v96/v97/v98 里 147d/258e/ba5e/ea78
// 的 BUY 信号与成交。查询形状沿用 tmp-bp53-parity.cjs 已验证可行的单实验单 token eq。
// 背景：上一轮 .in() 四实验组合查询被大表坑吞成空 data，得出「全零信号」错误结论——
// 但 parity 脚本里 147d 锚=V97 07:45:57 明明有信号，必须重查。
const { dbManager } = require('../../src/services/dbManager.js');

const EXPS = {
  v94: '85cbad14-696f-49b2-baa4-a5407df4a2d2',
  v96: 'e582e873-7f1a-44a5-b50f-0fca576847be',
  v97: 'afe7faa8-bb8b-4b40-b57e-35000f3ad472',
  v98: 'fe029df4-cd1f-490c-bfaf-f945feed287b',
};
const TOKENS = {
  '147d': '0x147d75f133130713c803d35a046da9b7c19effff',
  '258e': '0x258e485725b8d799b885b9f079241e2c812d7777',
  'ba5e': '0xba5ed45b42479e0a75316de7bf990ec90a3e4444',
  'ea78': '0xea7886d590ba1d7d6d4e7761148ba26405c67777',
};

async function main() {
  const client = await dbManager.getClient();
  for (const [name, addr] of Object.entries(TOKENS)) {
    console.log(`\n===== ${name} ${addr} =====`);
    for (const [expK, expId] of Object.entries(EXPS)) {
      const { data, error } = await client.from('strategy_signals')
        .select('id,created_at,action,executed,metadata')
        .eq('experiment_id', expId).eq('token_address', addr)
        .eq('signal_type', 'BUY').order('created_at', { ascending: true }).limit(20);
      if (error) { console.log(`  ${expK} 查询错误: ${JSON.stringify(error).slice(0, 200)}`); continue; }
      if (!data || !data.length) { console.log(`  ${expK}: 无 BUY 信号`); continue; }
      for (const r of data) {
        const md = r.metadata || {};
        const sg = md.signalGate || {};
        const cc = md.cheatCheck || {};
        const bp = md.buyPoint || {};
        console.log(`  ${expK} ${r.created_at.slice(5, 19)} action=${r.action} exec=${r.executed}` +
          ` leg=${sg.legId || '?'} tri=${sg.triggerNo ?? '?'}` +
          ` cheat=${cc.grade || cc.status || '-'} bp=${bp.bucket || bp.status || '-'}`);
      }
    }
    // 成交（逐实验单查，列名已验：trade_direction/success/input_amount）
    for (const [expK, expId] of Object.entries(EXPS)) {
      const { data, error } = await client.from('trades')
        .select('id,trade_direction,success,input_amount,created_at,metadata')
        .eq('experiment_id', expId).eq('token_address', addr).order('created_at', { ascending: true }).limit(12);
      if (error) { console.log(`  trades ${expK} 错误: ${JSON.stringify(error).slice(0, 120)}`); continue; }
      if (data && data.length) {
        for (const r of data) console.log(`  [trade ${expK}] ${r.created_at.slice(5, 19)} ${r.trade_direction} ok=${r.success} in=${r.input_amount}`);
      }
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
