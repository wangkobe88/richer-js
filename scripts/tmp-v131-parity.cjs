// v131（因子门）vs v129（基线）对拍归因（182 跑）：Newly-blocked/救回/漂移+duanju 验收
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
  const id129 = await expId(c, '4af09d63'), id131 = await expId(c, 'f3dd5537'), id132 = await expId(c, 'b67b7318');
  const m129 = await net(c, id129), m131 = await net(c, id131), m132 = await net(c, id132);
  for (const [k, m] of [['v129', m129], ['v131', m131], ['v132', m132]]) {
    const arr = [...m.values()];
    console.log(`${k}: ${m.size} 票 net=${arr.reduce((s, e) => s + e.net, 0).toFixed(4)} win=${arr.filter((e) => e.net > 0).length}/${m.size}`);
  }
  const lost = [...m131.keys()].filter((k) => !m132.has(k));
  const gained = [...m132.keys()].filter((k) => !m131.has(k));
  const both = [...m131.keys()].filter((k) => m132.has(k));
  console.log(`\n== v132 相对 v131：新增买入 ${gained.length} 票 ==`);
  for (const k of lost.sort((a, b) => m129.get(b).net - m129.get(a).net)) {
    // 该票在 v131 的因子门拒因
    const { data: sig } = await c.from('strategy_signals')
      .select('created_at,executed,er:metadata->>execution_reason,fc:metadata->factorCheck')
      .eq('experiment_id', id132).eq('token_address', k).eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).limit(3);
    const reasons = (sig || []).map((s) => `${s.created_at.slice(11, 19)}:${s.er || (s.executed ? '买' : '?')}`).join(' | ');
    const fcs = [...new Set((sig || []).map((s) => s.fc && s.fc.reason).filter(Boolean))].join(',');
    console.log(`  v131净${m131.get(k).net >= 0 ? '+' : ''}${m131.get(k).net.toFixed(4)}  ${(m129.get(k).sym || '?').slice(0, 12).padEnd(13)} 因子:${fcs || '-'} | ${reasons}  ${k}`);
  }
  console.log(`\n== v131 买→v132 未买（三修收紧面）${lost.length} 票 ==`);
  for (const k of lost)
    console.log(`  v131净${m131.get(k).net >= 0 ? '+' : ''}${m131.get(k).net.toFixed(4)}  ${(m131.get(k).sym || '?').slice(0, 12)} ${k}`);
  const drift = both.reduce((s, k) => s + m131.get(k).net - m129.get(k).net, 0);
  const driftBig = both.filter((k) => Math.abs(m131.get(k).net - m129.get(k).net) >= 0.03);
  console.log(`\n== v131/v132 共同 ${both.length} 张 漂移=${drift.toFixed(4)}（|Δ|≥0.03 ${driftBig.length} 张） ==`);
  for (const k of driftBig.sort((a, b) => Math.abs(m132.get(b).net - m131.get(b).net) - Math.abs(m132.get(a).net - m131.get(a).net)).slice(0, 8))
    console.log(`  Δ=${(m132.get(k).net - m131.get(k).net).toFixed(4)} ${(m129.get(k).sym || '?').slice(0, 12)} ${m132.get(k).firstBuyAt !== m131.get(k).firstBuyAt ? '[首买不同]' : ''} ${k}`);
  // duanju 验收
  const { data: dj } = await c.from('strategy_signals')
    .select('created_at,executed,er:metadata->>execution_reason,fc:metadata->factorCheck')
    .eq('experiment_id', id132).eq('signal_type', 'BUY')
    .ilike('token_address', '0x65aebe91%').limit(2);
  console.log(`\n== duanju 验收：${dj && dj[0] ? `${dj[0].created_at.slice(11, 19)} exec=${dj[0].executed} er=${dj[0].er || '(过门链)'} 因子=${dj[0].fc ? JSON.stringify({ s: dj[0].fc.status, pass: dj[0].fc.pass, r: dj[0].fc.reason, b: dj[0].fc.pvp && dj[0].fc.pvp.branch }) : '无段'}` : '无信号行'} ==`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
