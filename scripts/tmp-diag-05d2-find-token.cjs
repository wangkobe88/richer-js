// 找 bt-v140 里真实票：按前缀/尾缀模糊匹配 + 列出该实验全部买入票
const { dbManager } = require('../src/services/dbManager.js');
const EXP = '6e75ed6d-807a-4164-9551-d3b95d1fc37b';

(async () => {
  const c = await dbManager.getClient();

  // 1) signals 里前缀 05d2 的票
  const { data: pref } = await c.from('strategy_signals')
    .select('token_address,signal_type,action,execution_status,created_at')
    .eq('experiment_id', EXP).like('token_address', '0x05d2%');
  console.log(`前缀 0x05d2 信号行=${(pref||[]).length}`);
  for (const s of pref || []) console.log(`  ${s.token_address} ${s.signal_type}/${s.action}/${s.execution_status} ${s.created_at}`);

  // 2) 全部 BUY 信号票清单（execution_status 成功的）
  const { data: buys } = await c.from('strategy_signals')
    .select('token_address,execution_status,created_at')
    .eq('experiment_id', EXP).eq('signal_type', 'BUY');
  console.log(`\nBUY 信号总数=${(buys||[]).length}`);
  const byTok = {};
  for (const b of buys || []) (byTok[b.token_address] = byTok[b.token_address] || []).push(b.execution_status);
  const toks = Object.keys(byTok);
  console.log(`去重票数=${toks.length}`);
  for (const t of toks) {
    const st = byTok[t];
    console.log(`  ${t}  buys=${st.length} exec=${st.filter(x=>x==='executed').length}`);
  }
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
