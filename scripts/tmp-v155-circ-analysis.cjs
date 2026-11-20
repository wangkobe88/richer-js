#!/usr/bin/env node
// b8ae9f2e（bt-v156, T167d/FP20 ladder v32+18 卖腿全门链, both 平台, 48h 未用窗 10-19~10-21）
// 买入点位流通占比分析：买点时刻 流通筹码(_circTokens=Σ买−Σ卖, 剔尘<0.001) ÷ totalSupply ×100
//   vs 前向收益(+1/+5/+15min maxRise/last) 与成交面 realized pnl —— 阈值判别力验证
// 内存优化版：时间界 [创建, 最后买点+15min] + 分批流式重放（拉一批→重放→丢原始行）。
// 182 跑：NODE_OPTIONS=--max-old-space-size=8192 node scripts/tmp-b8ae-circ-analysis.cjs
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');
// stdout 行阻塞（nohup 文件块缓冲防失明）
if (process.stdout._handle) process.stdout._handle.setBlocking(true);

const EXP = 'dddbe79e-480a-402a-aa35-85a72d2f591e';
const LAUNCH = 4496173469e-18;               // four.meme 主流档常量
const FLAP_LAUNCH = 6.14 / (107036752 + 1e9); // ≈5.546e-9
const FLAP_TOTAL_SUPPLY = 1e9;
const DUST = 0.001;                           // minTickBnb 尘门（FA 口径）
const FWD = 900e3;                            // 前向窗 15min

async function withRetry(fn, tag) {
  for (let a = 1; ; a++) {
    try { return await fn(); } catch (e) {
      if (a >= 4) throw e;
      console.log(`retry ${tag} #${a}: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000 * a));
    }
  }
}

async function main() {
  const sb = dbManager.getClient();

  // ── 1. BUY 信号全量 ──
  const sigs = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await withRetry(() => sb.from('strategy_signals')
      .select('id,token_address,created_at,metadata')
      .eq('experiment_id', EXP).eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).range(off, off + 999), 'sigs');
    if (error) throw error;
    if (!data.length) break;
    sigs.push(...data);
    if (data.length < 1000) break;
  }
  console.log(`BUY 信号: ${sigs.length}`);

  // ── 2. trades 全量 ──
  const trades = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await withRetry(() => sb.from('trades')
      .select('id,token_address,trade_direction,trade_status,input_amount,output_amount,unit_price,created_at,executed_at,signal_id,sold_cards')
      .eq('experiment_id', EXP).order('created_at', { ascending: true }).range(off, off + 999), 'trades');
    if (error) throw error;
    if (!data.length) break;
    trades.push(...data);
    if (data.length < 1000) break;
  }
  const buyTrades = trades.filter(t => t.trade_direction === 'buy');
  const sellTrades = trades.filter(t => t.trade_direction === 'sell');
  console.log(`trades: buy=${buyTrades.length} sell=${sellTrades.length}`);

  // ── 2b. 回测 trades.executed_at=墙钟坑（T182 同款）：成交买点时刻改用
  //        trade.signal_id → signal.created_at（虚拟时钟）──
  const sigTime = new Map(); // signal_id -> {ms, leg}
  {
    const ids = trades.map(t => t.signal_id).filter(Boolean);
    for (let i = 0; i < ids.length; i += 50) {
      const { data, error } = await withRetry(() => sb.from('strategy_signals')
        .select('id,created_at,metadata').in('id', ids.slice(i, i + 50)), 'sigjoin');
      if (error) throw error;
      for (const s of data || []) sigTime.set(s.id, { ms: new Date(s.created_at).getTime(), leg: s.metadata?.strategyName || '?' });
    }
    console.log(`signal join: ${sigTime.size}`);
  }

  // ── 3. token 集合 + 平台/totalSupply（wss_events token_create）──
  const tokenSet = new Map(); // token -> {lastPointMs}
  const touch = (tok, ms) => {
    let e = tokenSet.get(tok);
    if (!e) { e = { lastPointMs: 0 }; tokenSet.set(tok, e); }
    if (ms > e.lastPointMs) e.lastPointMs = ms;
  };
  for (const s of sigs) touch(s.token_address, new Date(s.created_at).getTime());
  for (const t of trades) touch(t.token_address, new Date(t.executed_at || t.created_at).getTime());
  const tokens = [...tokenSet.keys()];
  console.log(`token 去重: ${tokens.length}`);

  const meta = new Map();
  for (let i = 0; i < tokens.length; i += 50) {
    const batch = tokens.slice(i, i + 50);
    const { data, error } = await withRetry(() => sb.from('wss_events')
      .select('token_address,platform,payload,block_time')
      .eq('kind', 'token_create').in('token_address', batch), 'meta');
    if (error) throw error;
    for (const r of data || []) {
      if (!meta.has(r.token_address)) {
        const plat = r.platform === 'flap' ? 'flap' : 'fourmeme';
        meta.set(r.token_address, {
          totalSupply: plat === 'flap' ? FLAP_TOTAL_SUPPLY : (Number(r.payload?.totalSupply) || 1e9),
          createdAtMs: r.block_time ? new Date(r.block_time).getTime() : null,
          platform: plat,
        });
      }
    }
  }
  const platCount = { fourmeme: 0, flap: 0 };
  for (const m of meta.values()) platCount[m.platform]++;
  console.log(`token_create meta: ${meta.size} 行`, JSON.stringify(platCount));

  // ── 4. 单 token keyset（BT 同款安全形状：eq 等值 + ORDER BY id 升序 + max 游标）──
  const rel = new Map(); // token -> {events:[{ms,circ,price,launchFloor}]}
  const t0 = Date.now();
  let totalRows = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const m = meta.get(tok);
    const LC = m?.platform === 'flap' ? FLAP_LAUNCH : LAUNCH;
    const hiMs = (tokenSet.get(tok)?.lastPointMs || 0) + FWD;
    let cursor = 0;
    const rows = [];
    for (;;) {
      const { data, error } = await withRetry(() => sb.from('wss_price_ticks')
        .select('id,block_time,block_number,log_index,trade_type,bnb_amount,token_amount,price_bnb')
        .eq('token_address', tok).gt('id', cursor)
        .lte('block_time', new Date(hiMs || Date.now()).toISOString())
        .order('id', { ascending: true }).limit(1000), 'ticks');
      if (error) throw error;
      if (!data.length) break;
      rows.push(...data);
      totalRows += data.length;
      cursor = data[data.length - 1].id;
      if (data.length < 1000) break;
    }
    // 链上真序 (block_number, log_index) 重放（id 序≠真序——大表红线）
    rows.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
    let circ = 0, firstBuy = null, minRel = null;
    const events = [];
    for (const r of rows) {
      if (Number(r.bnb_amount) < DUST) continue; // 尘 tick 不进 FA
      const ms = new Date(r.block_time).getTime();
      const isBuy = r.trade_type === 'buy';
      const amt = Number(r.token_amount), price = r.price_bnb != null ? Number(r.price_bnb) : null;
      circ += isBuy ? amt : -amt;
      if (isBuy && firstBuy == null && price != null) firstBuy = price;
      if (price != null && (minRel == null || price < minRel)) minRel = price;
      events.push({ ms, circ, price, launchFloor: Math.min(LC, firstBuy ?? LC, minRel ?? LC) });
    }
    rel.set(tok, { events });
    if (i % 100 === 0) console.log(`  token ${i + 1}/${tokens.length} rows=${totalRows} ${(Date.now() - t0) / 1000 | 0}s rss=${(process.memoryUsage().rss / 1e6 | 0)}MB`);
  }
  console.log(`ticks: ${totalRows} 行(含尘), 载入 ${(Date.now() - t0) / 1000 | 0}s, rss=${(process.memoryUsage().rss / 1e6 | 0)}MB`);

  // ── 5. 买点查询 ──
  function atPoint(tok, ms) {
    const R = rel.get(tok);
    if (!R) return null;
    let lo = 0, hi = R.events.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (R.events[mid].ms <= ms) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    if (ans < 0) return null;
    const e = R.events[ans];
    const sup = meta.get(tok)?.totalSupply || 0;
    let p = e.price, k = ans;
    while (p == null && k > 0) { k--; p = R.events[k].price; }
    return {
      circPct: sup > 0 ? e.circ / sup * 100 : null,
      price: p,
      curVs: (p != null && e.launchFloor > 0) ? (p / e.launchFloor - 1) * 100 : null,
    };
  }
  function forward(tok, ms) {
    const R = rel.get(tok);
    if (!R) return null;
    const base = atPoint(tok, ms);
    if (!base || base.price == null) return null;
    // 二分起点（events 按 (bn,li) 排序后 ms 近似单调）
    let lo = 0, hi = R.events.length - 1, st = R.events.length;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (R.events[mid].ms >= ms) { st = mid; hi = mid - 1; } else lo = mid + 1; }
    const out = {};
    for (const [tag, win] of [['m1', 60e3], ['m5', 300e3], ['m15', 900e3]]) {
      let maxP = null, lastP = null;
      for (let k = st; k < R.events.length; k++) {
        const e = R.events[k];
        if (e.ms > ms + win) break;
        if (e.price != null) { if (maxP == null || e.price > maxP) maxP = e.price; lastP = e.price; }
      }
      out[tag + 'Max'] = maxP != null ? (maxP / base.price - 1) * 100 : null;
      out[tag + 'Last'] = lastP != null ? (lastP / base.price - 1) * 100 : null;
    }
    return out;
  }

  // ── 6. 信号面 ──
  const sigRows = [];
  for (const s of sigs) {
    const tok = s.token_address;
    const ms = new Date(s.created_at).getTime();
    const pt = atPoint(tok, ms);
    const fw = forward(tok, ms);
    sigRows.push({
      sig: s.id.slice(0, 8), token: tok, ms, platform: meta.get(tok)?.platform,
      status: s.metadata?.execution_status, leg: s.metadata?.strategyName || '',
      circPct: pt?.circPct ?? null, curVs: pt?.curVs ?? null,
      m5Max: fw?.m5Max ?? null, m15Max: fw?.m15Max ?? null, m15Last: fw?.m15Last ?? null,
    });
  }

  // ── 7. 成交面 ──
  const sellsByTok = new Map();
  for (const t of sellTrades) {
    let a = sellsByTok.get(t.token_address);
    if (!a) { a = []; sellsByTok.set(t.token_address, a); }
    const sg = t.signal_id ? sigTime.get(t.signal_id) : null;
    a.push({ ms: sg?.ms ?? new Date(t.executed_at || t.created_at).getTime(), bnb: Number(t.output_amount), tok: Number(t.input_amount) });
  }
  const tokNet = new Map();
  for (const t of trades) {
    if (t.trade_direction === 'buy') tokNet.set(t.token_address, (tokNet.get(t.token_address) || 0) - Number(t.input_amount));
    else tokNet.set(t.token_address, (tokNet.get(t.token_address) || 0) + Number(t.output_amount));
  }
  const buyRows = [];
  for (const b of buyTrades) {
    const tok = b.token_address;
    const sig = b.signal_id ? sigTime.get(b.signal_id) : null;
    const ms = sig?.ms ?? new Date(b.executed_at || b.created_at).getTime();
    const pt = atPoint(tok, ms);
    const fw = forward(tok, ms);
    const unit = Number(b.unit_price);
    const later = (sellsByTok.get(tok) || []).filter(s => s.ms >= ms);
    let realPct = null, soldBnb = later.reduce((x, s) => x + s.bnb, 0), soldTok = later.reduce((x, s) => x + s.tok, 0);
    if (later.length && soldTok > 0 && unit > 0) realPct = (soldBnb / soldTok / unit - 1) * 100;
    const tokBuyBnb = buyTrades.filter(x => x.token_address === tok).reduce((x, y) => x + Number(y.input_amount), 0);
    const allocNet = tokBuyBnb > 0 ? (tokNet.get(tok) || 0) * (Number(b.input_amount) / tokBuyBnb) : 0;
    buyRows.push({
      trade: b.id.slice(0, 8), token: tok, ms, leg: sig?.leg, platform: meta.get(tok)?.platform, unit, bnb: Number(b.input_amount),
      circPct: pt?.circPct ?? null, curVs: pt?.curVs ?? null,
      realPct, nSells: later.length, allocNet,
      m5Max: fw?.m5Max ?? null, m15Max: fw?.m15Max ?? null, m15Last: fw?.m15Last ?? null,
    });
  }

  // ── 8. 分桶汇总 ──
  const BINS = [-1e9, 0, 3, 6, 10, 15, 25, 40, 60, 1e9];
  const BIN_LABELS = ['≤0(负流)', '<3', '3-6', '6-10', '10-15', '15-25', '25-40', '40-60', '60+'];
  const binOf = v => {
    if (v == null) return -1;
    for (let i = 0; i < BINS.length - 1; i++) if (v >= BINS[i] && v < BINS[i + 1]) return i;
    return -1;
  };
  const med = a => { const v = a.filter(x => x != null).sort((x, y) => x - y); return v.length ? v[v.length >> 1] : null; };
  function summarize(rows, label, winTag) {
    console.log(`\n══ ${label} ══`);
    console.log('circPct | n | 胜率 | Σ净BNB | med(m15Max) | med(m15Last) | med(curVs)');
    for (let i = 0; i < BIN_LABELS.length; i++) {
      const g = rows.filter(r => binOf(r.circPct) === i);
      if (!g.length) { console.log(`${BIN_LABELS[i].padEnd(7)} | 0 |`); continue; }
      const wins = g.filter(r => (r.realPct != null ? r.realPct : (r.m15Last ?? -1)) > 0).length;
      console.log(`${BIN_LABELS[i].padEnd(7)} | ${String(g.length).padStart(4)} | ${(wins / g.length * 100).toFixed(0)}% | ${g.reduce((x, r) => x + (r.allocNet || 0), 0).toFixed(3)} | ${med(g.map(r => r.m15Max))?.toFixed(1) ?? '-'} | ${med(g.map(r => r.m15Last))?.toFixed(1) ?? '-'} | ${med(g.map(r => r.curVs))?.toFixed(1) ?? '-'}`);
    }
  }
  summarize(buyRows, '成交面（118 buy trades）');
  summarize(sigRows, '信号面（2980 BUY 信号）');

  const q = (arr, p) => { const v = arr.filter(x => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length * p)] : null; };
  const sc = sigRows.map(r => r.circPct), bc = buyRows.map(r => r.circPct);
  console.log(`\ncircPct 分位(信号面): p10=${q(sc, .1)?.toFixed(2)} p25=${q(sc, .25)?.toFixed(2)} p50=${q(sc, .5)?.toFixed(2)} p75=${q(sc, .75)?.toFixed(2)} p90=${q(sc, .9)?.toFixed(2)} p99=${q(sc, .99)?.toFixed(2)}`);
  console.log(`circPct 分位(成交面): p10=${q(bc, .1)?.toFixed(2)} p25=${q(bc, .25)?.toFixed(2)} p50=${q(bc, .5)?.toFixed(2)} p75=${q(bc, .75)?.toFixed(2)} p90=${q(bc, .9)?.toFixed(2)} p99=${q(bc, .99)?.toFixed(2)}`);

  // 象限：curVs × circPct（成交面 Σ净BNB / 票数）
  const CV = [-1e9, 0, 10, 28.5, 80, 1e9];
  const CVL = ['破发', '0-10', '10-28.5', '28.5-80', '80+'];
  console.log('\n象限（成交面）curVs\\circPct | ' + BIN_LABELS.join(' | '));
  for (let ci = 0; ci < CVL.length; ci++) {
    const cells = [];
    for (let bi = 0; bi < BIN_LABELS.length; bi++) {
      const g = buyRows.filter(r => binOf(r.circPct) === bi && r.curVs != null && r.curVs >= CV[ci] && r.curVs < CV[ci + 1]);
      cells.push(g.length ? `${g.length}/${g.reduce((x, r) => x + (r.allocNet || 0), 0).toFixed(2)}` : '-');
    }
    console.log(`${CVL[ci].padEnd(9)}| ` + cells.join(' | '));
  }
  // 信号面象限（转化率+med m15Max）
  console.log('\n象限（信号面 n|medM15Max）curVs\\circPct | ' + BIN_LABELS.join(' | '));
  for (let ci = 0; ci < CVL.length; ci++) {
    const cells = [];
    for (let bi = 0; bi < BIN_LABELS.length; bi++) {
      const g = sigRows.filter(r => binOf(r.circPct) === bi && r.curVs != null && r.curVs >= CV[ci] && r.curVs < CV[ci + 1]);
      cells.push(g.length ? `${g.length}|${med(g.map(r => r.m15Max))?.toFixed(0) ?? '-'}` : '-');
    }
    console.log(`${CVL[ci].padEnd(9)}| ` + cells.join(' | '));
  }

  fs.writeFileSync('/tmp/v155-circ-out.json', JSON.stringify({ sigRows, buyRows, tokNet: [...tokNet.entries()] }));
  console.log('\n明细已写 /tmp/v155-circ-out.json');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
