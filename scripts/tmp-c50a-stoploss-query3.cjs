// 一次性查询 3：腿 description/priority 映射 + 最后一笔卖出信号原始 metadata
const { dbManager } = require('../src/services/dbManager.js');

const EXP = 'edbd5b38-27db-4dd4-8205-4bebfa410ea6';
const TOKEN = '0xc50a297634f887496988c45cdfcb0a516e2b7777';

async function main() {
  const client = await dbManager.getClient();

  const { data: exp } = await client.from('experiments').select('config').eq('id', EXP).limit(1);
  const sells = exp[0]?.config?.strategiesConfig?.sellStrategies || [];
  sells.forEach((l, i) => {
    console.log(`[${i}] P=${l.priority} desc=${l.description} | cards=${JSON.stringify(l.cards)} cooldown=${l.cooldownSec ?? '-'} maxEx=${l.maxExecutions ?? '-'}`);
  });

  const { data: sigs } = await client.from('strategy_signals')
    .select('id,created_at,metadata,reason')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(100);
  const sellSigs = (sigs || []).filter(s => (s.metadata || {}).strategyId?.startsWith('sell_') && s.created_at >= '2026-11-04T20:57:55');
  for (const s of sellSigs) {
    console.log(`\n=== 最后一笔 SELL ${s.created_at} ===`);
    console.log(JSON.stringify(s.metadata, null, 1).slice(0, 4000));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
