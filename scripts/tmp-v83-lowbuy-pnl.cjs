// tmp: 黄金点位(almost_launch ≤+20)跳过 cheat 提案的决策材料（修正版）
// A. bt-v83(fail-open 时代) 成交票按首买 curVs 分桶的真实净盈亏——提案会复活的买入区间（旧锚口径）
// B. bt-v85(现行 CD384) cheat 拒信号 curVs 分布 + 其中 BP 门后成交的 token 数
const { dbManager } = require('../src/services/dbManager');

const EXP83 = 'b0b3bf11-cfde-4a13-9031-1fa9269a13e3';
const EXP85 = 'ba242cca-2237-4e31-9807-75a87871b7ba';

function bucket(curVs) {
  if (curVs == null) return 'null';
  if (curVs <= 20) return 'A:<=20(almost)';
  if (curVs <= 40) return 'B:20-40(near)';
  if (curVs <= 80) return 'C:40-80(low)';
  return 'D:>80';
}

async function pullSignals(c, expId) {
  const out = [];
  let from = 0;
  for (;;) {
    const { data } = await c.from('strategy_signals').select('created_at,token_address,metadata')
      .eq('experiment_id', expId).eq('signal_type', 'BUY').order('created_at')
      .range(from, from + 999);
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

(async () => {
  const c = dbManager.getClient();

  // ---- A. bt-v83 fail-open: 成交票首买 curVs 分桶 × per-token 净盈亏 ----
  const [sig83, tr83, sig85] = await Promise.all([
    pullSignals(c, EXP83),
    c.from('trades').select('token_address,trade_direction,input_currency,input_amount,output_currency,output_amount,success')
      .eq('experiment_id', EXP83).limit(5000).then(r => r.data || []),
    pullSignals(c, EXP85),
  ]);
  const exec83 = sig83.filter(s => (s.metadata || {}).execution_status === 'executed');
  const firstBuyCurVs = new Map();
  for (const s of exec83) {
    if (firstBuyCurVs.has(s.token_address)) continue;
    const cv = ((s.metadata || {}).trendFactors || {}).currentVsLaunchPct;
    firstBuyCurVs.set(s.token_address, cv == null ? null : Number(cv));
  }
  const pnl83 = new Map();
  for (const t of tr83) {
    if (t.success === false) continue;
    const e = pnl83.get(t.token_address) || { buy: 0, sell: 0 };
    if (t.trade_direction === 'buy') {
      const v = t.input_currency === 'BNB' ? Number(t.input_amount || 0) : t.output_currency === 'BNB' ? Number(t.output_amount || 0) : 0;
      e.buy += v;
    } else {
      const v = t.output_currency === 'BNB' ? Number(t.output_amount || 0) : t.input_currency === 'BNB' ? Number(t.input_amount || 0) : 0;
      e.sell += v;
    }
    pnl83.set(t.token_address, e);
  }
  const buckets = new Map();
  for (const [tok, e] of pnl83) {
    if (e.buy <= 0) continue;
    const cv = firstBuyCurVs.get(tok);
    const b = bucket(cv);
    const rec = buckets.get(b) || { tokens: 0, net: 0, pos: 0, neg: 0, worst: [], best: [] };
    const net = e.sell - e.buy;
    rec.tokens++; rec.net += net;
    if (net >= 0) rec.pos++; else rec.neg++;
    rec.worst.push([net.toFixed(4), tok.slice(0, 10)]); rec.best.push([net.toFixed(4), tok.slice(0, 10)]);
    buckets.set(b, rec);
  }
  console.log('==== A. bt-v83 (fail-open 时代) 成交票按首买 curVs 分桶净盈亏（旧锚口径）====');
  console.log('executed 信号', exec83.length, '| 成交 token', [...pnl83].filter(([, e]) => e.buy > 0).length);
  for (const b of ['A:<=20(almost)', 'B:20-40(near)', 'C:40-80(low)', 'D:>80', 'null']) {
    const r = buckets.get(b);
    if (!r) continue;
    r.worst.sort((x, y) => Number(x[0]) - Number(y[0]));
    r.best.sort((x, y) => Number(y[0]) - Number(x[0]));
    console.log(`${b.padEnd(16)} token=${String(r.tokens).padStart(3)} 净=${r.net.toFixed(4).padStart(9)} 正${r.pos}/负${r.neg} | 最差: ${r.worst.slice(0, 3).map(x => x[1] + ' ' + x[0]).join(', ')}`);
  }

  // ---- B. bt-v85 现行: cheat 拒信号 curVs 分布 + 后续 BP 成交 token ----
  const executed85Tokens = new Set(sig85.filter(s => (s.metadata || {}).execution_status === 'executed').map(s => s.token_address));
  const cheatRejectedA = new Map(); // token -> 最早被拒时刻（A 桶）
  let dist = {};
  for (const s of sig85) {
    const r = (s.metadata || {}).execution_reason || '';
    if (!r.startsWith('cheat_gate')) continue;
    const cv = ((s.metadata || {}).trendFactors || {}).currentVsLaunchPct;
    const b = bucket(cv == null ? null : Number(cv));
    dist[b] = (dist[b] || 0) + 1;
    if (b === 'A:<=20(almost)' && !cheatRejectedA.has(s.token_address)) cheatRejectedA.set(s.token_address, s.created_at);
  }
  const both = [...cheatRejectedA.keys()].filter(t => executed85Tokens.has(t));
  console.log('');
  console.log('==== B. bt-v85 cheat 拒信号 curVs 分布（信号数 / 去重 token）====');
  console.log(JSON.stringify(dist));
  console.log('A 桶(≤20)被 cheat 拒 token=' + cheatRejectedA.size + ' | 其中 v85 内后续仍成交(经 BP 过)=' + both.length);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
