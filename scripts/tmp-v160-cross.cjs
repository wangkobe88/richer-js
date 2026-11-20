require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const { AGGREGATOR_ROUTER_ADDRS } = require('../src/trading-engine/pre-check/aggregator-routers');
const { selectTopBuyers } = require('../src/market-analysis/participant-profile');
const EXP = 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f';

async function main() {
  const sb = dbManager.getClient();
  const { data: trades } = await sb.from('trades')
    .select('token_symbol,token_address,trade_direction,input_amount,output_amount,created_at,executed_at')
    .eq('experiment_id', EXP).order('created_at', { ascending: true }).limit(1000);
  const byTok = new Map();
  for (const t of trades || []) {
    const e = byTok.get(t.token_address) || { sym: t.token_symbol, buyBnb: 0, sellBnb: 0, firstBuy: null };
    if (t.trade_direction === 'buy') {
      e.buyBnb += Number(t.input_amount || 0);
      const ts = t.executed_at || t.created_at;
      if (!e.firstBuy || ts < e.firstBuy) e.firstBuy = ts;
    } else e.sellBnb += Number(t.output_amount || 0);
    byTok.set(t.token_address, e);
  }
  const tokens = [...byTok.entries()].map(([addr, e]) => ({ addr, sym: e.sym, pnl: e.sellBnb - e.buyBnb, anchor: e.firstBuy })).filter(t => t.anchor);

  // per token top10 + wallet→tokens 映射
  const wTok = new Map(); // wallet -> [{addr,pnl}]
  for (const t of tokens) {
    const { data: rows } = await sb.from('wss_price_ticks')
      .select('block_time,trade_type,sender_address,trader_address,bnb_amount')
      .eq('token_address', t.addr).lte('block_time', t.anchor)
      .order('block_number', { ascending: false }).limit(3000);
    const realRows = (rows || []).filter(r => !AGGREGATOR_ROUTER_ADDRS.has(String(r.sender_address || r.trader_address || '').toLowerCase()));
    for (const b of selectTopBuyers(realRows.slice().reverse())) {
      if (!wTok.has(b.wallet)) wTok.set(b.wallet, []);
      wTok.get(b.wallet).push(t);
    }
    process.stdout.write(`\r[scan] ${wTok.size ? '' : ''}${t.addr.slice(0, 6)}   `);
  }
  process.stdout.write('\n');

  // 画像（tags/created_at/last_active）
  const wl = [...wTok.keys()];
  const prof = new Map();
  for (let i = 0; i < wl.length; i += 50) {
    const { data } = await sb.from('gmgn_wallet_profiles')
      .select('address,tags,created_at_sec,token_num,realized_profit,winrate,last_active_sec')
      .in('address', wl.slice(i, i + 50));
    for (const r of data || []) prof.set(String(r.address).toLowerCase(), r);
  }
  const BOT = ['gmgn', 'gmgn_go', 'arbitrager'];

  // 钱包级：跨票数、所在票平均盈亏、亏损票占比
  const ws = [...wTok.entries()].map(([w, toks]) => {
    const p = prof.get(w);
    const winN = toks.filter(t => t.pnl > 0).length;
    const avgPnl = toks.reduce((s, t) => s + t.pnl, 0) / toks.length;
    return {
      w, n: toks.length, winN, avgPnl,
      bot: p ? (p.tags || []).some(t => BOT.includes(t)) : false,
      dead: p ? (Number(p.buy_count) || 0) + (Number(p.sell_count) || 0) === 0 : null,
      tok30: p?.token_num ?? null, tags: p ? (p.tags || []).join('/') : 'MISS',
    };
  }).sort((a, b) => b.n - a.n);

  console.log(`== 跨票复用 top25（出现在多张票的钱包）==`);
  for (const w of ws.slice(0, 25)) {
    console.log(`${w.w} 票数=${w.n} 盈${w.winN} 均${w.avgPnl >= 0 ? '+' : ''}${w.avgPnl.toFixed(3)}B ${w.bot ? 'BOT' : '   '} ${w.dead ? '死' : '活'} 30d票=${w.tok30 ?? '?'} [${w.tags.slice(0, 40)}]`);
  }

  // 分组：跨票广度与盈亏的关系（按钱包跨票数分桶看平均票盈亏）
  console.log(`\n== 钱包跨票数分桶 × 所在票平均盈亏 ==`);
  for (const [lo, hi] of [[1, 1], [2, 3], [4, 6], [7, 12], [13, 99]]) {
    const bucket = ws.filter(w => w.n >= lo && w.n <= hi);
    if (!bucket.length) continue;
    const avg = bucket.reduce((s, w) => s + w.avgPnl, 0) / bucket.length;
    const winShare = bucket.reduce((s, w) => s + w.winN, 0) / bucket.reduce((s, w) => s + w.n, 0);
    console.log(`跨${lo}-${hi === 99 ? '+' : hi}票: n=${bucket.length} 钱包 | 所在票均盈亏=${(avg * 1000).toFixed(1)}mB/票 | 票胜率=${(winShare * 100).toFixed(0)}% | bot=${(bucket.filter(w => w.bot).length / bucket.length * 100).toFixed(0)}%`);
  }

  // 票级复盘维度：每票 top10 中「跨 ≥4 票的钱包占比」× 票盈亏
  console.log(`\n== 票级：top10 中跨 ≥4 票钱包占比 × 盈亏 ==`);
  const wN = new Map(ws.map(w => [w.w, w.n]));
  const rows = tokens.map(t => {
    return t;
  });
  // 反查：per token 的跨票占比
  const perTok = new Map();
  for (const [w, toks] of wTok) for (const t of toks) {
    if (!perTok.has(t.addr)) perTok.set(t.addr, []);
    perTok.get(t.addr).push(wN.get(w) || 1);
  }
  const tokRows = tokens.map(t => {
    const ns = perTok.get(t.addr) || [];
    const multi = ns.filter(n => n >= 4).length;
    return { sym: t.sym, pnl: t.pnl, multiPct: ns.length ? multi / ns.length * 100 : 0, n: ns.length };
  }).sort((a, b) => b.multiPct - a.multiPct);
  const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
  const winT = tokRows.filter(r => r.pnl > 0), loseT = tokRows.filter(r => r.pnl <= 0);
  console.log(`盈利票 跨≥4票钱包占比: 中位=${med(winT.map(r => r.multiPct)).toFixed(0)}% | 亏损票: 中位=${med(loseT.map(r => r.multiPct)).toFixed(0)}%`);
  const badT = tokRows.filter(r => r.pnl < -0.03), bigT = tokRows.filter(r => r.pnl > 0.05);
  console.log(`深亏(<-15%) 中位=${med(badT.map(r => r.multiPct)).toFixed(0)}% | 大赢(>5%) 中位=${med(bigT.map(r => r.multiPct)).toFixed(0)}%`);
  console.log(`\n占比最高/最低各 8 票：`);
  for (const r of [...tokRows.slice(0, 8), ...tokRows.slice(-8)]) {
    console.log(`  ${r.multiPct.toFixed(0)}% ${r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(3)} ${r.sym?.slice(0, 12)}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
