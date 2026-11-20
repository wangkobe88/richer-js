const { dbManager } = require('../src/services/dbManager');

async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('strategy_library')
    .select('name,side,version,legs,updated_at')
    .eq('name', 'signal-source-ladder-v1')
    .order('version', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data[0];
  console.log('库条目:', row.name, 'v' + row.version, row.updated_at, '腿数:', row.legs.length);
  // 打印每个 signalGate 腿的 condition 全文 + signalGate 段
  for (const leg of row.legs) {
    if (leg.side !== 'buy') continue;
    const cond = leg.condition || '';
    // 只打印含 launch 或 G 门特征的腿（前缀摘要）
    const name = leg.name || leg.id || '?';
    console.log('\n=== 腿', name, 'priority=', leg.priority, 'maxTriggers=', leg.signalGate && leg.signalGate.maxTriggers);
    console.log(cond);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
