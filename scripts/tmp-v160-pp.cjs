require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const { AGGREGATOR_ROUTER_ADDRS } = require('../src/trading-engine/pre-check/aggregator-routers');
const { selectTopBuyers, aggregateParticipantProfile } = require('../src/market-analysis/participant-profile');
const { GMGNPortfolioAPI } = require('../src/core/gmgn-api');

const EXP = 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f';
const FETCH = process.argv.includes('--fetch'); // miss 钱包补拉 GMGN（烧配额显式 opt-in）
const TICK_CAP = 3000; // BP 门 pullLimit 同款 tail 帽

async function main() {
  const sb = dbManager.getClient();
  // ① 票级成交配对（盈亏锚=首买时刻）
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
  const tokens = [...byTok.entries()].map(([addr, e]) => ({
    addr, sym: e.sym, pnl: e.sellBnb - e.buyBnb, anchor: e.firstBuy,
  })).filter(t => t.anchor);
  console.log(`票数 ${tokens.length}（有首买锚）`);

  // ② 每票买点前 tail ticks → top10 买家
  const perTokTop = new Map();
  const allWallets = new Set();
  for (const t of tokens) {
    const { data: rows } = await sb.from('wss_price_ticks')
      .select('block_time,trade_type,sender_address,trader_address,bnb_amount')
      .eq('token_address', t.addr).lte('block_time', t.anchor)
      .order('block_number', { ascending: false }).limit(TICK_CAP);
    const realRows = (rows || []).filter(r => !AGGREGATOR_ROUTER_ADDRS.has(String(r.sender_address || r.trader_address || '').toLowerCase()));
    const top = selectTopBuyers(realRows.slice().reverse());
    perTokTop.set(t.addr, top);
    for (const w of top) allWallets.add(w.wallet);
    process.stdout.write(`\r[scan] ${perTokTop.size}/${tokens.length} top钱包池=${allWallets.size}   `);
  }
  process.stdout.write('\n');

  // ③ 查库
  const walletList = [...allWallets];
  const prof = new Map();
  for (let i = 0; i < walletList.length; i += 50) {
    const { data } = await sb.from('gmgn_wallet_profiles')
      .select('address,tags,created_at_sec,token_num,realized_profit,winrate,last_active_sec')
      .in('address', walletList.slice(i, i + 50));
    for (const r of data || []) prof.set(String(r.address).toLowerCase(), r);
  }
  const miss = walletList.filter(w => !prof.has(w));
  console.log(`top 钱包池 ${walletList.length} | 库内 ${walletList.length - miss.length} | miss ${miss.length}`);

  // ④ miss 补拉（30d 快照——老窗口钱包多为已死号，预期 miss/死钱包占比高）
  if (FETCH && miss.length) {
    const api = new GMGNPortfolioAPI({ apiKey: process.env.GMGN_API_KEY, timeout: 10000 });
    console.log(`[--fetch] 补拉 ${miss.length} 个 miss 钱包（interval 400ms）…`);
    let ok = 0;
    for (const w of miss) {
      try {
        const data = await api.getWalletStats('bsc', w, '30d');
        const c = data?.common || {}, p = data?.pnl_stat || {};
        const num = v => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
        const row = {
          address: w, tags: Array.isArray(c.tags) ? c.tags : [], created_at_sec: num(c.created_at),
          fund_from_address: c.fund_from_address || null, stats_period: '30d',
          buy_count: num(data?.buy), sell_count: num(data?.sell), token_num: num(p.token_num),
          realized_profit: num(data?.realized_profit), winrate: num(p.winrate),
          last_active_sec: num(data?.last_timestamp), native_balance_bnb: num(data?.native_balance_bnb),
          fetched_at: new Date().toISOString(), fetch_count: 1,
        };
        const { error } = await sb.from('gmgn_wallet_profiles').upsert(row, { onConflict: 'address' });
        if (error) throw new Error(error.message);
        prof.set(w, row); ok++;
      } catch (e) { console.log(`\n[fail] ${w.slice(0, 12)} ${String(e.message).slice(0, 60)}`); }
      process.stdout.write(`\r[fetch] ${ok}/${miss.length}   `);
      await new Promise(r => setTimeout(r, 400));
    }
    process.stdout.write('\n');
  }

  // ⑤ per 票聚合 + 输出
  const nowSec = Math.floor(Date.now() / 1000);
  const BOT = ['gmgn', 'gmgn_go', 'arbitrager'];
  const results = tokens.map(t => {
    const top = perTokTop.get(t.addr);
    const seg = aggregateParticipantProfile(top, prof, { nowSec });
    // 死钱包观察：命中者中 30d 零交易（buy_count+sell_count===0 或 token_num===0）
    const hitRows = top.map(w => prof.get(w.wallet)).filter(Boolean);
    const dead = hitRows.filter(r => (Number(r.buy_count) || 0) + (Number(r.sell_count) || 0) === 0).length;
    const botN = hitRows.filter(r => (r.tags || []).some(x => BOT.includes(x))).length;
    return { ...t, seg, deadN: dead, hitN: hitRows.length, botN };
  });
  results.sort((a, b) => a.pnl - b.pnl);
  console.log(`\n== 票级 PP1（按盈亏升序；profiled=库命中/top10 | bot% | 死号% | 票数中位 | 小亏带% | 新号%）==`);
  for (const r of results) {
    const s = r.seg;
    const pct = v => v == null ? '—' : v.toFixed(0);
    console.log(`${r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(3)} ${String(r.sym || '').slice(0, 12).padEnd(12)} hit=${s.profiled}/${s.selected} bot=${pct(s.botTagPct)}% 死=${r.hitN ? (r.deadN / r.hitN * 100).toFixed(0) : '—'}% 票中位=${s.medianTokenNum ?? '—'} 小亏=${pct(s.smallLoserPct)}% 新=${pct(s.youngPct)}%`);
  }

  // ⑥ 盈亏分组对比
  const grp = (rows) => {
    const n = rows.length;
    const key = f => {
      const vals = rows.map(f).filter(Number.isFinite);
      if (!vals.length) return null;
      vals.sort((a, b) => a - b);
      return vals[Math.floor((vals.length - 1) / 2)];
    };
    const hitTot = rows.reduce((s, r) => s + r.seg.profiled, 0);
    const topTot = rows.reduce((s, r) => s + r.seg.selected, 0);
    const deadTot = rows.reduce((s, r) => s + r.deadN, 0);
    const botTot = rows.reduce((s, r) => s + r.botN, 0);
    return {
      n, pnl: rows.reduce((s, r) => s + r.pnl, 0),
      hitRate: topTot ? (hitTot / topTot * 100).toFixed(0) : '—',
      botPct: hitTot ? (botTot / hitTot * 100).toFixed(0) : '—',
      deadPct: hitTot ? (deadTot / hitTot * 100).toFixed(0) : '—',
      medTok: key(r => r.seg.medianTokenNum),
      medSmallLoser: key(r => r.seg.smallLoserPct),
      medYoung: key(r => r.seg.youngPct),
      medRp: key(r => r.seg.medianRealizedProfit),
      medWr: key(r => r.seg.medianWinrate),
    };
  };
  const win = results.filter(r => r.pnl > 0), lose = results.filter(r => r.pnl <= 0);
  const big = results.filter(r => r.pnl > 0.05), bad = results.filter(r => r.pnl < -0.03);
  const fmt = g => `n=${g.n} Σ${g.pnl.toFixed(2)}B | top命中率=${g.hitRate}% bot=${g.botPct}% 死号=${g.deadPct}% | 票数中位=${g.medTok ?? '—'} 小亏带中位=${g.medSmallLoser ?? '—'}% 新号中位=${g.medYoung ?? '—'}% rp中位=${g.medRp ?? '—'}$ wr中位=${g.medWr ?? '—'}`;
  console.log(`\n== 分组对比 ==`);
  console.log(`盈利票:   ${fmt(grp(win))}`);
  console.log(`亏损票:   ${fmt(grp(lose))}`);
  console.log(`大赢(>5%): ${fmt(grp(big))}`);
  console.log(`深亏(<-15%): ${fmt(grp(bad))}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
