// 找当前 running 实验 + 该票信号归属实验
const { dbManager } = require('../src/services/dbManager.js');
const TOKEN = '0x48ce79731e040194fcfa71496a94090a28f57777';

async function main() {
  const client = await dbManager.getClient();

  const { data: running, error: rErr } = await client.from('experiments')
    .select('id,experiment_name,status,started_at,updated_at')
    .eq('status', 'running').order('started_at', { ascending: false }).limit(10);
  if (rErr) throw rErr;
  console.log('=== running 实验 ===');
  for (const e of running) console.log(`${e.id} | ${e.experiment_name} | started=${e.started_at} | updated=${e.updated_at}`);

  // 该票全部信号（跨实验）——直接按 token 查 strategy_signals（有 experiment_id 过滤不了，先试 token 全局）
  const { data: sigs, error: sErr } = await client.from('strategy_signals')
    .select('experiment_id,created_at,signal_type,action,executed,metadata')
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(50);
  if (sErr) throw sErr;
  console.log(`\n=== 该票信号（全局 ${sigs?.length ?? 0} 条）===`);
  for (const s of sigs || []) {
    const m = s.metadata || {};
    console.log(`${s.experiment_id?.slice(0, 8)} ${s.created_at} | ${s.signal_type} ${s.action} | ex=${s.executed} | strat=${m.strategyId ?? ''}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
