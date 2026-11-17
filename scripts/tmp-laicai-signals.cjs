// 来财同名 7 票信号行分辨（2026-11-15，182 跑）：v122 日志触发行只打 symbol 不打地址，
// 需分辨 0xc84a0ff2（parity 首两波臂新增挡票）与同名兄弟票的信号归属。
const { dbManager } = require('../src/services/dbManager.js');

async function main() {
  const c = await dbManager.getClient();
  const ids = {};
  {
    const { data } = await c.from('experiments').select('id,experiment_name').limit(500);
    for (const pre of ['883e2513', '415b4ea0', '631bd2c2']) {
      const hit = data.find((e) => e.id.startsWith(pre));
      if (!hit) throw new Error(pre + ' 未找到');
      ids[pre] = hit.id;
    }
  }
  for (const [tag, pre] of [['v119 基线', '883e2513'], ['v120 簇臂', '415b4ea0'], ['v122 扩展门', '631bd2c2']]) {
    const { data, error } = await c.from('strategy_signals')
      .select('token_address,signal_type,created_at,executed,reason')
      .eq('experiment_id', ids[pre]).eq('token_symbol', '来财')
      .order('created_at', { ascending: true }).limit(60);
    if (error) throw new Error(tag + ': ' + error.message);
    console.log(`\n===== ${tag} 来财族信号 ${data.length} 行 =====`);
    for (const r of data)
      console.log(`  ${r.created_at} ${r.signal_type} exec=${r.executed} ${r.token_address} [${r.reason}]`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
