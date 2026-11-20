// d345c vs d345b 对拍报告（182 跑后）：T170b 断流阈值全链对照（50s/90s/180s 两档 vs 40s/60s 单档）。
// 口径同 tmp-btv148-report：净盈亏=per token Σ卖(output)−Σ买(input)，仅 success 行；全腿（两实验同配置）。
const { dbManager } = require('../src/services/dbManager.js');
const EXPS = {
  d345b: 'c73b62be-bb1d-4acf-8002-652e5fb8a507',
  d345c: '2fe55b27-e275-4792-b3bd-e815bb045be8',
};

async function pullAll(table, expId) {
  const c = await dbManager.getClient();
  const out = [];
  let from = 0;
  for (;;) {
    const { data, error } = await c.from(table).select('*').eq('experiment_id', expId).order('id').range(from, from + 999);
    if (error) throw new Error(table + ': ' + error.message);
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

async function load(name) {
  const trades = await pullAll('trades', EXPS[name]);
  const sigs = await pullAll('strategy_signals', EXPS[name]);
  const stallSells = sigs.filter(s => /流动性止损/.test(s.reason || ''));
  const byToken = new Map();
  for (const t of trades) {
    if (!t.success) continue;
    const addr = t.token_address;
    let st = byToken.get(addr);
    if (!st) { st = { symbol: t.token_symbol || '', buys: [], sells: [], netBnb: 0 }; byToken.set(addr, st); }
    const isBuy = t.trade_direction === 'buy';
    const bnb = isBuy ? Number(t.input_amount) : Number(t.output_amount);
    if (!isFinite(bnb)) continue;
    st.netBnb += isBuy ? -bnb : bnb;
    (isBuy ? st.buys : st.sells).push({ bnb, at: t.executed_at || t.created_at });
  }
  return { name, byToken, stallSells };
}

function agg(byToken) {
  let n = 0, net = 0, wins = 0;
  for (const st of byToken.values()) {
    if (st.buys.length === 0) continue;
    n++; net += st.netBnb; if (st.netBnb > 0) wins++;
  }
  return { n, net, winRate: n ? (wins / n * 100).toFixed(1) + '%' : '-' };
}

async function main() {
  const B = await load('d345b');
  const C = await load('d345c');
  console.log('═══ 一、实验级对比（全腿，success 成交）═══');
  console.log('d345b(40s/60s单档):', JSON.stringify(agg(B.byToken)));
  console.log('d345c(50s/90s/180s):', JSON.stringify(agg(C.byToken)));

  console.log('\n═══ 二、断流卖出行为对比 ═══');
  console.log('d345b 断流卖出行:', B.stallSells.length);
  const tiers = { almost: 0, breakdown: 0, null_: 0 };
  const fmtCount = {};
  for (const s of C.stallSells) {
    const sc = (s.metadata || {}).stallClose;
    if (sc) tiers[sc.tier || 'null_']++;
    const key = (s.reason || '').match(/无成交超时\((\d+s[^,)]*)/) ? RegExp.$1 : (s.reason || '').slice(0, 30);
    fmtCount[key] = (fmtCount[key] || 0) + 1;
  }
  console.log('d345c 断流卖出行:', C.stallSells.length, '| stallClose 段 tier 分布:', JSON.stringify(tiers));
  console.log('d345c 信号名分布:', JSON.stringify(fmtCount));

  console.log('\n═══ 三、差集归因：d345b 被 40s 断流卖出的票在 d345c 的命运 ═══');
  const bStallTokens = new Set(B.stallSells.map(s => s.token_address));
  const diff = [];
  for (const addr of bStallTokens) {
    const b = B.byToken.get(addr), c = C.byToken.get(addr);
    const bNet = b ? b.netBnb : 0, cNet = c ? c.netBnb : 0;
    const d = cNet - bNet;
    if (Math.abs(d) < 1e-9) continue;
    const cStall = C.stallSells.filter(s => s.token_address === addr);
    const sc = cStall.length ? (cStall[cStall.length - 1].metadata || {}).stallClose : null;
    diff.push({ addr, symbol: (b || c || {}).symbol, bNet: +bNet.toFixed(4), cNet: +cNet.toFixed(4), delta: +d.toFixed(4), cTier: sc ? sc.tier : '(d345c 无断流卖)' });
  }
  diff.sort((a, b) => b.delta - a.delta);
  let dSum = 0; for (const r of diff) dSum += r.delta;
  console.log('净差>0 行数:', diff.filter(r => r.delta > 0).length, '| <0:', diff.filter(r => r.delta < 0).length, '| Σdelta:', dSum.toFixed(4));
  for (const r of diff.slice(0, 12)) console.log(`  ${r.symbol} ${r.addr.slice(0, 10)}… d345b=${r.bNet} d345c=${r.cNet} Δ=${r.delta} [${r.cTier}]`);
  if (diff.length > 12) { console.log('  …尾部:');
    for (const r of diff.slice(-6)) console.log(`  ${r.symbol} ${r.addr.slice(0, 10)}… d345b=${r.bNet} d345c=${r.cNet} Δ=${r.delta} [${r.cTier}]`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
// 附：tier 分组净额（重跑差集聚合）
