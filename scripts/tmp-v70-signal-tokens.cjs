// 一次性查询：v70 f0898589 全部买信号票清单（per-token 首条信号）+ fixtures 已收录比对
const { dbManager } = require('../src/services/dbManager.js');
const { readFileSync } = require('fs');

const EXP = 'f0898589-58f1-4101-a648-0dc9cad41f3a';

async function main() {
  const client = await dbManager.getClient();

  // 1) 该实验全部 BUY 信号（不带 metadata 瘦列）
  const { data: sigs, error } = await client
    .from('strategy_signals')
    .select('id,signal_type,action,reason,created_at,token_address')
    .eq('experiment_id', EXP)
    .eq('signal_type', 'BUY')
    .order('created_at', { ascending: true })
    .limit(1000);
  if (error) throw error;
  console.log(`BUY 信号共 ${sigs.length} 行`);

  // per-token 聚合
  const byToken = new Map();
  for (const s of sigs) {
    let t = byToken.get(s.token_address);
    if (!t) { t = { addr: s.token_address, firstAt: s.created_at, firstReason: s.reason, n: 0, reasons: {} }; byToken.set(s.token_address, t); }
    t.n += 1;
    t.reasons[s.reason || '-'] = (t.reasons[s.reason || '-'] || 0) + 1;
  }

  // 2) cheat_detection 首析行（锚对照：生产 anchor_tick_count）
  const addrs = [...byToken.keys()];
  const { data: cd, error: e2 } = await client
    .from('cheat_detection')
    .select('token_address,anchor_tick_count,source_experiment_id,analyzed_at,question_version,fail_reason')
    .in('token_address', addrs.length <= 50 ? addrs : addrs.slice(0, 50))
    .order('analyzed_at', { ascending: true })
    .limit(500);
  if (e2) throw e2;
  const cdFirst = new Map();
  for (const r of cd || []) {
    if (!cdFirst.has(r.token_address)) cdFirst.set(r.token_address, r);
  }

  // 3) fixtures 已收录比对
  const fixtures = JSON.parse(readFileSync(__dirname + '/cheat-detection/fixtures.json', 'utf8'));
  const known = new Map(fixtures.cases.map((c) => [c.addr.toLowerCase(), c.caseId]));

  console.log(`\ntoken 数=${byToken.size}；cheat_detection 命中=${cdFirst.size}；fixtures 已收录=${[...byToken.keys()].filter(a => known.has(a.toLowerCase())).length}`);
  console.log('\naddr | 首信号时刻 | 信号数 | 首析锚(qv) | 首析fail | 已收录 | reasons');
  for (const t of byToken.values()) {
    const c = cdFirst.get(t.addr);
    console.log(`${t.addr} | ${t.firstAt} | ${t.n} | ${c ? c.anchor_tick_count + '(' + c.question_version + ')' : '-'} | ${c ? (c.fail_reason ?? '-') : '-'} | ${known.get(t.addr.toLowerCase()) ?? '-'} | ${JSON.stringify(t.reasons)}`);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
