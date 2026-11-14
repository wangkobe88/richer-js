// 一次性查询：0xdee305bc…7777 逐题答案+门条件串+trades（本地小结果读取）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0xdee305bcd072340779c7d30978c4bcdbd2367777';
const EXP = '936e1bd9-630a-4f91-bb52-3f4afb1a27f4';

async function main() {
  const client = await dbManager.getClient();

  // 1) cheat_detection 完整行（answers + digest 全键）
  const { data: rows, error: e1 } = await client
    .from('cheat_detection')
    .select('*')
    .eq('token_address', ADDR)
    .order('analyzed_at', { ascending: true })
    .limit(5);
  if (e1) throw e1;
  for (const r of rows || []) {
    const d = typeof r.snapshot_digest === 'string' ? JSON.parse(r.snapshot_digest) : r.snapshot_digest;
    console.log(`=== cheat #${r.id} qv=${r.question_version} verdict=${r.verdict} anchor=${r.anchor_tick_count} at=${r.analyzed_at}`);
    console.log(`digest keys: ${d ? Object.keys(d).join(',') : '-'}`);
    if (d) {
      for (const k of Object.keys(d)) {
        if (k === 'anchors') continue;
        console.log(`  ${k}: ${JSON.stringify(d[k]).slice(0, 2000)}`);
      }
    }
    const a = typeof r.answers_raw === 'string' ? JSON.parse(r.answers_raw) : r.answers_raw;
    if (a && a.answers) {
      console.log('--- 逐题答案:');
      for (const [qid, ans] of Object.entries(a.answers)) {
        console.log(`  ${qid}: ${JSON.stringify(ans)}`);
      }
    }
  }

  // 2) 信号行（列名先验：不选 status）
  const { data: sigs, error: e2 } = await client
    .from('strategy_signals')
    .select('id,signal_type,action,reason,created_at,metadata')
    .eq('experiment_id', EXP)
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(20);
  if (e2) throw e2;
  console.log(`\nstrategy_signals 共 ${sigs ? sigs.length : 0} 行`);
  for (const s of sigs || []) {
    const m = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata;
    console.log(`\n--- signal #${s.id} type=${s.signal_type} action=${s.action} reason=${s.reason} at=${s.created_at}`);
    if (m && m.cheatCheck) console.log(`cheatCheck: ${JSON.stringify(m.cheatCheck).slice(0, 6000)}`);
  }

  // 3) trades（买没买/盈亏）
  const { data: trs, error: e3 } = await client
    .from('trades')
    .select('id,side,amount_bnb,price_bnb,profit_loss_bnb,created_at,metadata')
    .eq('experiment_id', EXP)
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(20);
  if (e3) throw e3;
  console.log(`\ntrades 共 ${trs ? trs.length : 0} 行`);
  for (const t of trs || []) {
    console.log(`  ${t.created_at} ${t.side} bnb=${t.amount_bnb} price=${t.price_bnb} pnl=${t.profit_loss_bnb ?? '-'}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
