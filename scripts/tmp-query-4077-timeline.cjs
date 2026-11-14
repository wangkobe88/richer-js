// 一次性查询：0x4077…7777 信号为何晚发——创建/叙事轮次/信号全时间线（单 token 小结果，本地跑）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x40772383e4e59b8443257f715e0b2db3a2637777';

function parseMaybeJson(v) {
  if (typeof v !== 'string') return v ?? {};
  try { return JSON.parse(v); } catch { return {}; }
}

async function main() {
  const client = await dbManager.getClient();

  // 1) 创建事件（token 年龄锚点）
  const { data: ev, error: e1 } = await client
    .from('wss_events')
    .select('kind,block_time,payload')
    .eq('token_address', ADDR)
    .in('kind', ['token_create', 'graduation', 'token_quote_set'])
    .order('block_time', { ascending: true })
    .limit(5);
  if (e1) throw e1;
  let createdAt = null;
  for (const r of ev || []) {
    console.log(`[wss_events] ${r.kind} block_time=${r.block_time}`);
    if (r.kind === 'token_create') createdAt = r.block_time;
  }

  // 2) 叙事轮次（触发模型时间线）
  const { data: rounds, error: e2 } = await client
    .from('narrative_analysis_rounds')
    .select('*')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(15);
  if (e2) console.log('narrative_analysis_rounds err:', e2.message);
  for (const r of rounds || []) {
    console.log(`[round] ${JSON.stringify(r).slice(0, 400)}`);
  }

  // 3) 信号全量（BUY/OBSERVE + 拒绝轨迹）
  const { data: sigs, error: e3 } = await client
    .from('strategy_signals')
    .select('id,experiment_id,signal_type,action,confidence,reason,created_at,executed,metadata')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(20);
  if (e3) throw e3;
  console.log(`\n[strategy_signals] ${sigs ? sigs.length : 0} 行`);
  for (const s of sigs || []) {
    const md = parseMaybeJson(s.metadata);
    console.log(`\n--- signal #${s.id} exp=${(s.experiment_id || '').slice(0, 8)} ${s.signal_type}/${s.action} conf=${s.confidence} exec=${s.executed} at=${s.created_at}`);
    console.log(`    reason=${String(s.reason ?? '').slice(0, 260)}`);
    if (md.narrativeRating !== undefined) console.log(`    narrativeRating=${md.narrativeRating}`);
    if (md.narrativeCall) {
      const nc = md.narrativeCall;
      console.log(`    narrativeCall: rating=${nc.rating} timing=${JSON.stringify(nc.timing ?? null).slice(0, 300)}`);
    }
    if (md.cheatCheck) console.log(`    cheatCheck: ${JSON.stringify(md.cheatCheck).slice(0, 400)}`);
    if (md.gmgnCheck) console.log(`    gmgnCheck: ${JSON.stringify(md.gmgnCheck).slice(0, 300)}`);
    if (md.narrative) console.log(`    narrative: rating=${md.narrative.rating} ${JSON.stringify(md.narrative).slice(0, 200)}`);
  }

  // 4) token_narrative 终态
  const { data: tn, error: e4 } = await client
    .from('token_narrative')
    .select('rating,updated_at,token_category,pre_check_result')
    .eq('token_address', ADDR)
    .maybeSingle();
  if (!e4 && tn) {
    console.log(`\n[token_narrative] rating=${tn.rating} updated_at=${tn.updated_at} category=${tn.token_category ?? '-'}`);
  }

  if (createdAt) console.log(`\n创建锚=${createdAt}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
