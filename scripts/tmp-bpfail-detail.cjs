// bp_gate_fail 专项（2026-11-15，182 跑）：v122 全实验 BUY 拒因分布 + fail 细节（metadata.buyPoint）
const { dbManager } = require('../src/services/dbManager.js');

async function main() {
  const c = await dbManager.getClient();
  const ids = {};
  {
    const { data } = await c.from('experiments').select('id,experiment_name').limit(500);
    for (const pre of ['19ef6433']) {
      const hit = data.find((e) => e.id.startsWith(pre));
      if (!hit) throw new Error(pre + ' 未找到');
      ids[pre] = hit.id;
    }
  }
  for (const [tag, pre] of [['v134 FP2 新窗 33h', '19ef6433']]) {
    let rows = [], from = 0;
    while (true) {
      const { data, error } = await c.from('strategy_signals')
        .select('id,token_symbol,created_at,executed,er:metadata->>execution_reason')
        .eq('experiment_id', ids[pre]).eq('signal_type', 'BUY')
        .order('created_at', { ascending: true }).range(from, from + 999);
      if (error) throw new Error(tag + ': ' + error.message);
      rows = rows.concat(data);
      if (data.length < 1000) break;
      from += 1000;
    }
    const dist = new Map();
    for (const r of rows) {
      const key = r.executed ? 'executed=true' : (r.er || '无拒因(exec=false)');
      dist.set(key, (dist.get(key) || 0) + 1);
    }
    console.log(`\n===== ${tag} BUY 信号 ${rows.length} 行 拒因分布 =====`);
    for (const [k, n] of [...dist.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${k}`);
    // bp_gate_fail 时间分布（首末+分钟粒度）
    const fails = rows.filter((r) => r.er === 'bp_gate_fail');
    if (fails.length) {
      const byMin = new Map();
      for (const f of fails) {
        const m = f.created_at.slice(11, 16);
        byMin.set(m, (byMin.get(m) || 0) + 1);
      }
      console.log(`  bp_gate_fail 时间分布(分): ${[...byMin.entries()].map(([m, n]) => m + '×' + n).join(' ')}`);
    }
  }
  // v123 抽查：任取一张 bp_gate_fail 票看是否 jev_error（若有）
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
