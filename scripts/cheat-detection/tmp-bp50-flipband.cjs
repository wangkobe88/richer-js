// 一次性查询（182 跑）：bt-v84 BUY 信号 buyPoint.anchors.minVsLaunchPct 分布——
// (10,20] 带=BP50（almost 上界 20→10）reset 判定腿退场的行为翻转面清单
const { dbManager } = require('../../src/services/dbManager.js');

async function main() {
  const client = await dbManager.getClient();
  const { data: exps } = await client.from('experiments')
    .select('id,experiment_name,status').ilike('experiment_name', 'bt-v84%');
  if (!exps || !exps.length) throw new Error('bt-v84 实验未找到');
  for (const e of exps) console.log(`EXP ${e.id} ${e.experiment_name} [${e.status}]`);
  const exp = exps[0].id;

  const { data: sigs, error } = await client.from('strategy_signals')
    .select('id,token_address,created_at,metadata')
    .eq('experiment_id', exp).eq('signal_type', 'BUY').order('created_at');
  if (error) throw new Error(error.message);

  const bands = { 'null/无锚': 0, '<=10': 0, '(10,20]': 0, '(20,50]': 0, '>50': 0 };
  const flip = [];
  for (const s of sigs) {
    const mv = s.metadata && s.metadata.buyPoint && s.metadata.buyPoint.anchors
      && s.metadata.buyPoint.anchors.minVsLaunchPct;
    if (mv == null) bands['null/无锚']++;
    else if (mv <= 10) bands['<=10']++;
    else if (mv <= 20) { bands['(10,20]']++; flip.push(`${s.token_address} ${s.created_at.slice(5,19)} minVs=${mv} ${s.metadata && s.metadata.execution_status || ''}`); }
    else if (mv <= 50) bands['(20,50]']++;
    else bands['>50']++;
  }
  console.log(`BUY 信号 ${sigs.length} 条，minVs 分布:`, JSON.stringify(bands));
  console.log('-- (10,20] 翻转带票（BP50 下 reset 判定退场 → 改判走原窗/CD384 或 reset 失效）--');
  const uniq = [...new Set(flip.map((x) => x.split(' ')[0]))];
  console.log(`去重 token ${uniq.length} 个：`);
  for (const f of flip) console.log('  ' + f);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
