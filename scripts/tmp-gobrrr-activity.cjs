// Go Brrrrr 活跃度画像取证（182 跑）：① 全窗分时成交节奏（判断 39s 静默在盘中地位）；
// ② v130/v129 同票 cheat 门 act 判定（用户在 signals 页看到的 activityLevel）。
const { dbManager } = require('../src/services/dbManager.js');
const PRE = '0xdae106c8';

async function main() {
  const c = await dbManager.getClient();
  // ① 全窗分时
  let rows = [], off = 0;
  while (true) {
    const { data, error } = await c.from('wss_price_ticks')
      .select('block_time,trade_type,bnb_amount')
      .ilike('token_address', PRE + '%')
      .gte('block_time', '2026-11-03T15:00:00Z').lte('block_time', '2026-11-04T14:00:00Z')
      .order('block_time', { ascending: true }).range(off, off + 999);
    if (error) throw new Error(error.message);
    rows = rows.concat(data);
    if (data.length < 1000) break;
    off += 1000;
  }
  console.log(`全窗 ${rows.length} 行；时间范围 ${rows[0]?.block_time?.slice(11, 19)} → ${rows[rows.length - 1]?.block_time?.slice(11, 19)}`);
  // 分时桶（30s）
  const bySlot = new Map();
  for (const r of rows) {
    const t = new Date(r.block_time).getTime();
    const k = Math.floor(t / 30000) * 30000;
    let e = bySlot.get(k);
    if (!e) { e = { n: 0, buy: 0, sell: 0 }; bySlot.set(k, e); }
    e.n++;
    if (r.trade_type === 'buy') e.buy += Number(r.bnb_amount || 0); else e.sell += Number(r.bnb_amount || 0);
  }
  console.log('\n08:35:00→08:43:00 逐 30s 槽（n 行 / 买 / 卖 BNB）：');
  for (const [k, e] of [...bySlot.entries()].sort()) {
    const ts = new Date(k).toISOString().slice(11, 19);
    if (ts < '08:35:00' || ts > '08:43:00') continue;
    console.log(`  ${ts}  ${String(e.n).padStart(3)} 行  买${e.buy.toFixed(3)}  卖${e.sell.toFixed(3)}`);
  }
  // 全窗静默 gap 分布（≥20s）
  let prev = null; const gaps = [];
  for (const r of rows) {
    const t = new Date(r.block_time).getTime();
    if (prev !== null && t - prev >= 20000) gaps.push({ gap: Math.round((t - prev) / 1000), at: r.block_time.slice(11, 19) });
    prev = t;
  }
  console.log(`\n全窗 ≥20s 静默 gap 共 ${gaps.length} 个（最长 ${Math.max(...gaps.map(g=>g.gap))}s）：`);
  for (const g of gaps) console.log(`  gap ${g.gap}s @ ${g.at}`);
  // ② v130（旧代码跑）该票 cheatCheck
  const { data: exps } = await c.from('experiments').select('id').limit(500);
  const e130 = exps.find((e) => e.id.startsWith('f927e187')).id;
  const { data: sig } = await c.from('strategy_signals')
    .select('created_at,executed,er:metadata->>execution_reason,cc:metadata->cheatCheck')
    .eq('experiment_id', e130).eq('signal_type', 'BUY')
    .ilike('token_address', PRE + '%')
    .order('created_at', { ascending: true }).limit(6);
  console.log('\n== v130（你在页面上看的）同票 cheat 门判定 ==');
  for (const s of sig || []) {
    const cc = s.cc || {};
    console.log(`${s.created_at.slice(11, 19)} er=${s.er || (s.executed ? '(买)' : '?')} act=${cc.levels ? cc.levels.activityLevel : '?'} sbw=${cc.levels ? cc.levels.stallBurstWave : '?'} grade=${cc.grade || '?'}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
