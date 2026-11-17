// v128（v21 豁免臂）vs v126（v20）C 窗豁免增量归因（2026-11-15，182 跑）
const { dbManager } = require('../src/services/dbManager.js');

async function expId(c, pre) {
  const { data } = await c.from('experiments').select('id').limit(500);
  return data.find((e) => e.id.startsWith(pre)).id;
}

async function net(c, id) {
  let rows = [], from = 0;
  while (true) {
    const { data, error } = await c.from('trades')
      .select('token_address,token_symbol,trade_direction,input_currency,input_amount,output_currency,output_amount,success,created_at')
      .eq('experiment_id', id).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows = rows.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const m = new Map();
  for (const t of rows) {
    if (t.success === false) continue;
    const buy = t.trade_direction === 'buy';
    const v = buy ? (t.input_currency === 'BNB' ? Number(t.input_amount || 0) : Number(t.output_amount || 0))
      : (t.output_currency === 'BNB' ? Number(t.output_amount || 0) : Number(t.input_amount || 0));
    let e = m.get(t.token_address);
    if (!e) { e = { sym: t.token_symbol, buyBnb: 0, sellBnb: 0, firstBuyAt: null }; m.set(t.token_address, e); }
    if (buy) { e.buyBnb += v; if (!e.firstBuyAt || t.created_at < e.firstBuyAt) e.firstBuyAt = t.created_at; } else e.sellBnb += v;
  }
  for (const [, e] of m) e.net = e.sellBnb - e.buyBnb;
  return m;
}

async function main() {
  const c = await dbManager.getClient();
  const ids = {
    v124: await expId(c, 'cd40fc2a'), v125: await expId(c, 'f31d615f'),
    v126: await expId(c, '8eddeb38'), v128: await expId(c, '76ad229e'),
  };
  const m = {};
  for (const [k, id] of Object.entries(ids)) m[k] = await net(c, id);
  for (const k of Object.keys(m)) {
    const arr = [...m[k].values()];
    console.log(`${k}: ${m[k].size} 票 net=${arr.reduce((s, e) => s + e.net, 0).toFixed(4)} win=${arr.filter((e) => e.net > 0).length}/${m[k].size}`);
  }
  const rescued = [...m.v126.keys()].filter((k) => !m.v128.has(k) === false && !m.v126.has(k) === false).filter((k) => m.v128.has(k)); // 占位
  // v128 比 v126 多买（豁免救回）
  const gained = [...m.v128.keys()].filter((k) => !m.v126.has(k));
  const lost = [...m.v126.keys()].filter((k) => !m.v128.has(k));
  const both = [...m.v126.keys()].filter((k) => m.v128.has(k));
  console.log(`\n== 豁免救回（v126 未买→v128 买）${gained.length} 票 ==`);
  for (const k of gained.sort((a, b) => m.v128.get(b).net - m.v128.get(a).net))
    console.log(`  v128净${m.v128.get(k).net >= 0 ? '+' : ''}${m.v128.get(k).net.toFixed(4)}  基线口径净${(m.v124.get(k) || m.v125.get(k) || { net: NaN }).net >= 0 ? '+' : ''}${((m.v124.get(k) || m.v125.get(k) || { net: NaN }).net || 0).toFixed(4)}  ${(m.v128.get(k).sym || '?').slice(0, 12).padEnd(13)} ${k}`);
  console.log(`\n== 反向丢失（v126 买→v128 未买）${lost.length} 票 ==`);
  for (const k of lost)
    console.log(`  v126净${m.v126.get(k).net >= 0 ? '+' : ''}${m.v126.get(k).net.toFixed(4)}  ${(m.v126.get(k).sym || '?').slice(0, 12).padEnd(13)} ${k}`);
  console.log(`\n== 共同票 ${both.length} 张 漂移=${both.reduce((s, k) => s + m.v128.get(k).net - m.v126.get(k).net, 0).toFixed(4)} ==`);
  for (const k of both.filter((k) => Math.abs(m.v128.get(k).net - m.v126.get(k).net) >= 0.03))
    console.log(`  Δ=${(m.v128.get(k).net - m.v126.get(k).net).toFixed(4)} ${(m.v126.get(k).sym || '?').slice(0, 12)} ${m.v128.get(k).firstBuyAt !== m.v126.get(k).firstBuyAt ? '[首买不同]' : ''} ${k}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
