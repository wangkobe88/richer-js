// 查 7 票分歧票信号行真实实验归属（182 跑）
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');

const TOKENS = [
  ['CD29', '0xe0ff22c9ba345f6f1d722b5b2fc561a17c167777'],
  ['CD70', '0xafca788eae23f6027ed8643f885c4b22a1e77777'],
  ['CD79', '0xcb85365c1af90782f13b540c49d4a3feb1437777'],
  ['CD98', '0x247cd0fc5b23b12affc74b1737988ab7dc657777'],
  ['CD99', '0x0b35285fe783dd3441573b84be4fbdb743457777'],
  ['CD108', '0xe7e3ff3f303fdf867ef21fe16907882319a07777'],
  ['CD145', '0xc5432ededd3fae68f0859dfda98d5ceb62fa7777'],
];

(async () => {
  const client = dbManager.getClient();
  for (const [cd, addr] of TOKENS) {
    const { data, error } = await client
      .from('strategy_signals')
      .select('experiment_id, signal_type, created_at')
      .eq('token_address', addr)
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) { console.log(cd, addr, 'ERR', error.message); continue; }
    const exps = [...new Set((data || []).map(r => r.experiment_id))];
    const types = {};
    for (const r of data || []) types[r.signal_type] = (types[r.signal_type] || 0) + 1;
    console.log(cd, addr, 'exps=' + exps.join(','), 'rows=' + (data || []).length, JSON.stringify(types), 'first=' + (data && data[0] ? data[0].created_at : '-'));
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
