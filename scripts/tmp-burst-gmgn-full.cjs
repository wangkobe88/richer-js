require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');
const { GMGNPortfolioAPI } = require('../src/core/gmgn-api/portfolio-api');

const WINS = [
  { k: 'v155', id: 'dddbe79e-480a-402a-aa35-85a72d2f591e' },
  { k: 'v156', id: 'b8ae9f2e-832f-42db-bbda-8d8701aecb63' },
  { k: 'v140', id: '6e75ed6d-807a-4164-9551-d3b95d1fc37b' },
  { k: 'v145', id: '2448116a-bebe-457d-9d8a-b4556c9a8e0d' },
];
const OUT = '/tmp/gmgn-wallet-stats.jsonl';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 最密 5s 买入窗定位（对齐 BP burst5 口径）
function densest5s(ticks) {
  if (!ticks.length) return { wallets: new Map(), from: null, to: null, buyBnb: 0 };
  const arr = ticks.map(t => ({ ms: new Date(t.block_time).getTime(), w: (t.sender_address || t.trader_address || '').toLowerCase(), bnb: Number(t.bnb_amount) })).filter(t => t.w);
  arr.sort((a, b) => a.ms - b.ms);
  let best = { n: 0 };
  for (let i = 0; i < arr.length; i++) {
    let n = 0;
    for (let j = i; j < arr.length && arr[j].ms - arr[i].ms <= 5000; j++) n++;
    if (n > best.n) best = { n, i };
  }
  const wallets = new Map();
  if (!best.n) return { wallets, from: null, to: null, buyBnb: 0 };
  for (let j = best.i; j < arr.length && arr[j].ms - arr[best.i].ms <= 5000; j++) {
    wallets.set(arr[j].w, (wallets.get(arr[j].w) || 0) + arr[j].bnb);
  }
  const buyBnb = [...wallets.values()].reduce((x, y) => x + y, 0);
  return { wallets, n: best.n, buyBnb };
}

async function main() {
  const sb = dbManager.getClient();
  // 1) 目标票（spike ∪ 锚chg5>=25 成交票，四窗去重）
  const rows = [];
  const seen = new Map();
  for (const w of WINS) {
    const sigs = [];
    let from = 0;
    while (true) {
      const { data, error } = await sb.from('strategy_signals').select('*')
        .eq('experiment_id', w.id).eq('signal_type', 'BUY')
        .order('created_at', { ascending: true }).range(from, from + 999);
      if (error) throw error;
      if (!data || !data.length) break;
      sigs.push(...data); from += 1000;
      if (data.length < 1000) break;
    }
    const first = new Map();
    for (const s of sigs) if (!first.has(s.token_address)) first.set(s.token_address, s);
    const tmap = new Map();
    let f2 = 0;
    while (true) {
      const { data, error } = await sb.from('trades').select('*')
        .eq('experiment_id', w.id).order('created_at').range(f2, f2 + 999);
      if (error) throw error;
      if (!data || !data.length) break;
      for (const t of data) {
        if (!tmap.has(t.token_address)) tmap.set(t.token_address, { b: 0, s: 0, nBuy: 0 });
        const o = tmap.get(t.token_address);
        if (t.trade_direction === 'buy' && t.success) { o.b += Number(t.input_amount); o.nBuy++; }
        if (t.trade_direction === 'sell' && t.success) o.s += Number(t.output_amount);
      }
      f2 += 1000;
      if (data.length < 1000) break;
    }
    for (const [tok, s] of first) {
      const dedupKey = tok + '|' + (s.created_at || '').slice(0, 13);
      if (seen.has(dedupKey)) continue;
      seen.set(dedupKey, 1);
      const t = tmap.get(tok);
      if (!t || !t.nBuy) continue;
      const m = s.metadata || {};
      const bp = m.buyPoint || {};
      const an = bp.anchors || {};
      const dim = bp.dimensions || {};
      const shape = dim.entry_shape && dim.entry_shape.bucket;
      const chg5 = an.chg5Pct;
      if (shape !== 'spike' && !(typeof chg5 === 'number' && chg5 >= 25)) continue;
      rows.push({
        win: w.k, tok, sigT: s.created_at,
        roi: t.b > 0 ? +((t.s / t.b - 1) * 100).toFixed(1) : null,
        shape, chg5, sbw: (m.cheatCheck && m.cheatCheck.levels && m.cheatCheck.levels.stallBurstWave) ?? (m.actFrontGate && m.actFrontGate.sbw),
      });
    }
  }
  console.log('目标票:', rows.length);

  // 2) per 票 burst 窗钱包
  const walletTokens = new Map(); // wallet -> [{tok, bnb}]
  for (const r of rows) {
    const since = new Date(new Date(r.sigT).getTime() - 60000).toISOString();
    const { data: ticks } = await sb.from('wss_price_ticks')
      .select('block_time,sender_address,trader_address,bnb_amount,trade_type')
      .eq('token_address', r.tok).eq('trade_type', 'buy')
      .gte('block_time', since).lte('block_time', r.sigT).limit(300);
    const d = densest5s(ticks || []);
    r.burstWallets = [...d.wallets.entries()].map(([w, bnb]) => {
      if (!walletTokens.has(w)) walletTokens.set(w, []);
      walletTokens.get(w).push(r.tok);
      return w;
    });
    r.burstBnb = +d.buyBnb.toFixed(3);
  }
  const allW = [...walletTokens.keys()];
  console.log('burst 组成钱包(去重):', allW.length, '| 总查询次数预估:', allW.length);

  // 3) GMGN 增量查询（已查跳过）
  const done = new Set();
  if (fs.existsSync(OUT)) {
    for (const line of fs.readFileSync(OUT, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { done.add(JSON.parse(line).w); } catch (e) {}
    }
  }
  console.log('已查过:', done.size);
  const api = new GMGNPortfolioAPI({ apiKey: process.env.GMGN_API_KEY, timeout: 15000 });
  let fail = 0, ok = 0;
  const todo = allW.filter(w => !done.has(w));
  console.log('待查:', todo.length);
  const t0 = Date.now();
  for (let i = 0; i < todo.length; i++) {
    const w = todo[i];
    try {
      const r = await api.getWalletStats('bsc', w, '30d');
      fs.appendFileSync(OUT, JSON.stringify({ w, r: r && !r.code ? {
        rp: r.realized_profit, buy: r.buy, sell: r.sell,
        tokNum: r.pnl_stat && r.pnl_stat.token_num, wr: r.pnl_stat && r.pnl_stat.winrate,
        p2x: r.pnl_stat && r.pnl_stat.pnl_2x_5x_num, p5x: r.pnl_stat && r.pnl_stat.pnl_gt_5x_num,
        tags: (r.common && r.common.tags) || [], tag: (r.common && r.common.tag) || '',
        last: r.last_timestamp,
      } : null }) + '\n');
      ok++;
    } catch (e) {
      await sleep(2000);
      try {
        const r2 = await api.getWalletStats('bsc', w, '30d');
        fs.appendFileSync(OUT, JSON.stringify({ w, r: r2 && !r2.code ? { rp: r2.realized_profit, buy: r2.buy, sell: r2.sell, tokNum: r2.pnl_stat && r2.pnl_stat.token_num, wr: r2.pnl_stat && r2.pnl_stat.winrate, p2x: r2.pnl_stat && r2.pnl_stat.pnl_2x_5x_num, p5x: r2.pnl_stat && r2.pnl_stat.pnl_gt_5x_num, tags: (r2.common && r2.common.tags) || [], tag: (r2.common && r2.common.tag) || '', last: r2.last_timestamp } : null }) + '\n');
        ok++;
      } catch (e2) {
        fail++;
        console.log('FAIL', w, e2.message.slice(0, 50));
        if (fail >= 5) { console.log('连续失败熔断，停止'); break; }
      }
    }
    if (i % 50 === 0) console.log(`进度 ${i}/${todo.length} ok=${ok} fail=${fail} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    await sleep(250);
  }
  console.log(`完成: ok=${ok} fail=${fail}，共 ${done.size + ok} 钱包已落盘 ${OUT}`);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
