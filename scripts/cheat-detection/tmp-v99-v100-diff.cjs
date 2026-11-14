// 一次性（182 跑）：v99（87cc5a7d，被 kill）vs v100（ed113d10，完整）买入差异归因。
// 问题：v100 比 v99 多买 20 票——是中途 kill 窗口没跑完，还是腿差异？
const { dbManager } = require('../../src/services/dbManager.js');
const V99 = '87cc5a7d-d845-4c46-8edd-f19dde4ef10f';
const V100 = 'ed113d10-8d0b-495d-b1f1-9b597f564c21';

async function buys(sb, exp) {
  // trades.id 是 uuid——用 created_at 游标分页
  const rows = [];
  let from = '';
  for (;;) {
    const q = sb.from('trades')
      .select('token_address,trade_direction,input_amount,output_amount,created_at')
      .eq('experiment_id', exp).eq('trade_direction', 'buy').order('created_at', { ascending: true }).limit(1000);
    const { data, error } = from ? await q.gt('created_at', from) : await q;
    if (error) throw error;
    if (!data || !data.length) break;
    // 去重（同 created_at 游标重取）
    for (const r of data) if (!rows.length || r.created_at >= rows[rows.length - 1].created_at) rows.push(r);
    if (data.length < 1000) break;
    from = data[data.length - 1].created_at;
  }
  return rows;
}

async function main() {
  const sb = await dbManager.getClient();
  // config 对比（买腿/窗口）
  const { data: exps } = await sb.from('experiments').select('id,experiment_name,status,created_at,config').in('id', [V99, V100]);
  for (const e of exps || []) {
    const c = e.config || {};
    const legs = (c.strategiesConfig && c.strategiesConfig.legs) || [];
    const buyLegs = legs.filter((l) => l.side === 'buy');
    console.log(`\n=== ${e.experiment_name} (${e.id.slice(0, 8)}) status=${e.status} created=${e.created_at.slice(5, 19)}`);
    console.log(`买腿 ${buyLegs.length} 条：${buyLegs.map((l) => `${l.name}:cards=${l.cards ?? '无'}`).join(' | ')}`);
    console.log(`窗口: ${JSON.stringify(c.backtest && { from: c.backtest.from, to: c.backtest.to, sourceExperimentId: c.backtest.sourceExperimentId } || {})}`);
  }
  const b99 = await buys(sb, V99), b100 = await buys(sb, V100);
  const s99 = new Set(b99.map((x) => x.token_address)), s100 = new Set(b100.map((x) => x.token_address));
  console.log(`\nv99 买入: ${b99.length} 笔 / ${s99.size} 票；v100 买入: ${b100.length} 笔 / ${s100.size} 票`);
  console.log(`v99 首笔=${b99[0] ? b99[0].created_at.slice(5, 19) : '-'} 末笔=${b99.length ? b99[b99.length - 1].created_at.slice(5, 19) : '-'}`);
  console.log(`v100 首笔=${b100[0] ? b100[0].created_at.slice(5, 19) : '-'} 末笔=${b100.length ? b100[b100.length - 1].created_at.slice(5, 19) : '-'}`);
  const only100 = [...s100].filter((x) => !s99.has(x));
  const only99 = [...s99].filter((x) => !s100.has(x));
  const both = [...s99].filter((x) => s100.has(x));
  console.log(`\n两边都买 ${both.length} 票；只 v100 买 ${only100.length} 票；只 v99 买 ${only99.length} 票`);
  // 只 v100 买的票：首笔成交时刻分布（是否集中在 v99 末笔之后=窗口没跑完）
  const only100First = only100.map((t) => {
    const f = b100.filter((x) => x.token_address === t)[0];
    return { t, at: f.created_at };
  }).sort((a, b) => a.at.localeCompare(b.at));
  console.log('\n只 v100 买的票（按首笔成交时刻）：');
  for (const x of only100First) console.log(`  ${x.at.slice(5, 19)} ${x.t}`);
  // 两边都买的票里，首笔成交时刻对比（v99 是否停在某时刻）
  console.log(`\nv99 末笔成交=${b99.length ? b99[b99.length - 1].created_at.slice(5, 19) : '-'}；只 v100 的票里晚于该时刻的=${only100First.filter((x) => x.at > (b99.length ? b99[b99.length - 1].created_at : '9999')).length}/${only100.length}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
