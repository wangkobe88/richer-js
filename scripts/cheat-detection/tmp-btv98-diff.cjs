// 一次性（182 跑）：bt-v98 vs bt-v97 成交票集合分解——③臂拦掉票的 v97 盈亏+量门放宽新增票
const { dbManager } = require('../../src/services/dbManager.js');
const V97 = 'afe7faa8-bb8b-4b40-b57e-35000f3ad472';
const V98 = 'fe029df4-cd1f-490c-bfaf-f945feed287b';

async function fetchAll(client, table, cols, eq) {
  const out = []; let from = 0;
  for (;;) {
    const { data, error } = await client.from(table).select(cols).eq('experiment_id', eq).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}
async function pnlByToken(client, expId) {
  const trades = await fetchAll(client, 'trades', 'trade_direction,input_amount,output_amount,success,token_address', expId);
  const m = new Map();
  for (const t of trades.filter((x) => x.success)) {
    const cur = m.get(t.token_address) || { in: 0, out: 0 };
    if (t.trade_direction === 'buy') cur.in += Number(t.input_amount || 0); else cur.out += Number(t.output_amount || 0);
    m.set(t.token_address, cur);
  }
  return new Map([...m.entries()].map(([a, c]) => [a, c.out - c.in]));
}
async function main() {
  const client = await dbManager.getClient();
  const p97 = await pnlByToken(client, V97);
  const p98 = await pnlByToken(client, V98);
  const dropped = [...p97.keys()].filter((a) => !p98.has(a)).map((a) => ({ a, pnl: p97.get(a) })).sort((x, y) => y.pnl - x.pnl);
  const added = [...p98.keys()].filter((a) => !p97.has(a)).map((a) => ({ a, pnl: p98.get(a) })).sort((x, y) => y.pnl - x.pnl);
  const kept = [...p97.keys()].filter((a) => p98.has(a));
  const drift = kept.reduce((s, a) => s + (p98.get(a) - p97.get(a)), 0);
  console.log(`v97 ${p97.size} 票 / v98 ${p98.size} 票；交集 ${kept.length} 票净额漂移 ${drift.toFixed(4)}`);
  console.log(`\n== v98 拦掉/丢掉的 ${dropped.length} 票（v97 盈亏）：Σ=${dropped.reduce((s, r) => s + r.pnl, 0).toFixed(4)}`);
  for (const r of dropped) console.log(`  ${r.a} ${r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(4)}`);
  console.log(`\n== v98 新增 ${added.length} 票（v98 盈亏）：Σ=${added.reduce((s, r) => s + r.pnl, 0).toFixed(4)}`);
  for (const r of added) console.log(`  ${r.a} ${r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(4)}`);
  // 拦掉票在 v98 的 BP 判读（signals metadata）
  for (const r of dropped.slice(0, 6)) {
    const sigs = await fetchAll(client, 'strategy_signals', 'metadata,signal_type', V98);
    const s = sigs.find((x) => x.signal_type === 'BUY' && x.metadata && x.metadata.tokenAddress === r.a);
    if (!s) continue;
    const bp = s.metadata.buyPoint || {};
    console.log(`\n${r.a.slice(0, 8)} v98 BP: status=${bp.status} rule=${bp.rule || ''} dims=${JSON.stringify((bp.dimensions && Object.entries(bp.dimensions).map(([k, v]) => k + ':' + (v && v.bucket))) || [])}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
