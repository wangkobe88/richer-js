// 一次性查询：0x1243…7777 信号行 + 叙事轮次（单条小结果）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x12434b4a4e587984c0422929163b58c8a67c7777';

async function main() {
  const client = await dbManager.getClient();

  const { data: sigs, error: e1 } = await client
    .from('strategy_signals')
    .select('id,experiment_id,signal_type,action,reason,created_at,metadata')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: false })
    .limit(5);
  if (e1) throw e1;
  if (!sigs || !sigs.length) {
    console.log('strategy_signals 无行');
  } else {
    for (const s of sigs) {
      console.log(`--- signal ${s.id} exp=${s.experiment_id} type=${s.signal_type} action=${s.action} at=${s.created_at}`);
      console.log(`    reason=${String(s.reason ?? '').slice(0, 300)}`);
      const md = s.metadata ?? {};
      const nr = md.narrativeRating ?? md.narrative?.rating ?? md.narrativeCall?.rating;
      console.log(`    metadata.narrativeRating=${nr ?? '-'} keys=${Object.keys(md).slice(0, 20).join(',')}`);
    }
  }

  const { data: rounds, error: e2 } = await client
    .from('narrative_analysis_rounds')
    .select('id,round,reason,rating,category,started_at,finished_at,error')
    .eq('token_address', ADDR)
    .order('started_at', { ascending: true })
    .limit(10);
  if (!e2 && rounds && rounds.length) {
    for (const r of rounds) {
      console.log(`--- round ${r.round} reason=${r.reason} rating=${r.rating} category=${r.category ?? '-'} at=${r.started_at} err=${r.error ?? '-'}`);
    }
  } else if (!e2) {
    console.log('narrative_analysis_rounds 无行（legacy 直调路径）');
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
