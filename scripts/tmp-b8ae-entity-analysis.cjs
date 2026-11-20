#!/usr/bin/env node
// b8ae9f2e（bt-v156, ladder 全门链, both, 48h 窗）买入点位**筹码结构**维度分析：
//   买点时刻 top1/top2 净持仓占流通(T91a 分母)/占总供应、正净持有者数、exDust(净持×价≥0.015)、
//   buyersTotal(曾买钱包) —— wallet=sender||trader 同 FA 口径，尘 tick<0.001 剔除
// 182 跑：NODE_OPTIONS=--max-old-space-size=8192 node scripts/tmp-b8ae-chips-analysis.cjs
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');
if (process.stdout._handle) process.stdout._handle.setBlocking(true);

const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
const LAUNCH = 4496173469e-18;
const FLAP_LAUNCH = 6.14 / (107036752 + 1e9);
const FLAP_TOTAL_SUPPLY = 1e9;
const DUST = 0.001;
const FWD = 900e3;
const HOLDER_DUST_BNB = 0.015;   // holdersExDust 尘门（FA 同值）
const lc = s => (s || '').toLowerCase();

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

  // ── 2. trades 全量 + signal join（虚拟时钟）──
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
  const sigTime = new Map();
  {
    const ids = trades.map(t => t.signal_id).filter(Boolean);
    for (let i = 0; i < ids.length; i += 50) {
      const { data, error } = await withRetry(() => sb.from('strategy_signals')
        .select('id,created_at,metadata').in('id', ids.slice(i, i + 50)), 'sigjoin');
      if (error) throw error;
      for (const s of data || []) sigTime.set(s.id, { ms: new Date(s.created_at).getTime(), leg: s.metadata?.strategyName || '?' });
    }
  }
  console.log(`trades: buy=${buyTrades.length} sell=${sellTrades.length} sigjoin=${sigTime.size}`);

  // ── 3. token meta ──
  const tokenSet = new Map();
  const touch = (tok, ms) => { let e = tokenSet.get(tok); if (!e) { e = { lastPointMs: 0 }; tokenSet.set(tok, e); } if (ms > e.lastPointMs) e.lastPointMs = ms; };
  // 查询点构建（信号面 + 成交面骨架）
  const sigRaw = sigs.map(s => {
    const ms = new Date(s.created_at).getTime();
    touch(s.token_address, ms);
    return { token: s.token_address, ms, kind: 'sig', status: s.metadata?.execution_status, leg: s.metadata?.strategyName || '', chips: null, fwd: null, circPct: null, curVs: null };
  });
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
  const buyRaw = buyTrades.map(b => {
    const tok = b.token_address;
    const sig = b.signal_id ? sigTime.get(b.signal_id) : null;
    const ms = sig?.ms ?? new Date(b.executed_at || b.created_at).getTime();
    touch(tok, ms);
    const unit = Number(b.unit_price);
    const later = (sellsByTok.get(tok) || []).filter(s => s.ms >= ms);
    let realPct = null, soldBnb = later.reduce((x, s) => x + s.bnb, 0), soldTok = later.reduce((x, s) => x + s.tok, 0);
    if (later.length && soldTok > 0 && unit > 0) realPct = (soldBnb / soldTok / unit - 1) * 100;
    const tokBuyBnb = buyTrades.filter(x => x.token_address === tok).reduce((x, y) => x + Number(y.input_amount), 0);
    const allocNet = tokBuyBnb > 0 ? (tokNet.get(tok) || 0) * (Number(b.input_amount) / tokBuyBnb) : 0;
    return { token: tok, ms, kind: 'buy', trade: b.id.slice(0, 8), leg: sig?.leg, unit, bnb: Number(b.input_amount), realPct, allocNet, chips: null, fwd: null, circPct: null, curVs: null };
  });
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
  console.log(`token_create meta: ${meta.size}`);

  // ── 4. 单 token keyset 重放：流通 + wallet 净持仓 + 查询点筹码快照 ──
  const pointsByTok = new Map();
  for (const p of [...sigRaw, ...buyRaw]) {
    let a = pointsByTok.get(p.token);
    if (!a) { a = []; pointsByTok.set(p.token, a); }
    a.push(p);
  }
  for (const a of pointsByTok.values()) a.sort((x, y) => x.ms - y.ms);

  const rel = new Map(); // token -> events
  const t0 = Date.now();
  let totalRows = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const m = meta.get(tok);
    const LC = m?.platform === 'flap' ? FLAP_LAUNCH : LAUNCH;
    const sup = m?.totalSupply || 0;
    const hiMs = (tokenSet.get(tok)?.lastPointMs || 0) + FWD;
    let cursor = 0;
    const rows = [];
    for (;;) {
      const { data, error } = await withRetry(() => sb.from('wss_price_ticks')
        .select('id,block_time,block_number,log_index,trade_type,bnb_amount,token_amount,price_bnb,sender_address,trader_address')
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
    rows.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
    let circ = 0, firstBuy = null, minRel = null, lastRel = null;
    const walletNet = new Map();
    const everBuy = new Set();
    // T188 二连：主体级 HHI 原料——同块买入簇 ∪ 等额桶(≥3, T74 线) union-find
    const blockBuys = new Map();   // block -> Map(wallet -> tokenAmt)
    const amtBuys = new Map();     // bnb.toFixed(4) -> Map(wallet -> tokenAmt)
    const parent = new Map();
    const find = x => { while (parent.get(x) && parent.get(x) !== x) x = parent.get(x); return x; };
    const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
    const events = [];
    const pts = pointsByTok.get(tok) || [];
    let pi = 0;
    const fillSnap = p => {
      let t1 = 0, t2 = 0, pos = 0, sumPos = 0, sumSq = 0, exD = 0;
      const vals = [];
      for (const v of walletNet.values()) {
        if (v > 0) {
          pos++; sumPos += v; vals.push(v); sumSq += v * v;
          if (v > t1) { t2 = t1; t1 = v; } else if (v > t2) t2 = v;
          if (lastRel != null && v * lastRel >= HOLDER_DUST_BNB) exD++;
        }
      }
      // 基尼系数（正净持仓分布不平等度；升序 x_i: G = 2Σ(i+1)x_i/(nΣx) − (n+1)/n）
      let gini = null;
      if (vals.length >= 2) {
        vals.sort((a, b) => a - b);
        let cum = 0;
        for (let j = 0; j < vals.length; j++) cum += (j + 1) * vals[j];
        gini = 2 * cum / (vals.length * sumPos) - (vals.length + 1) / vals.length;
      }
      const circDen = Math.max(circ, sumPos);
      p.circPct = sup > 0 ? circ / sup * 100 : null;
      p.curVs = (lastRel != null) ? (lastRel / Math.min(LC, firstBuy ?? LC, minRel ?? LC) - 1) * 100 : null;
      p.chips = {
        t1c: circDen > 0 ? t1 / circDen * 100 : null,
        t2c: circDen > 0 ? (t1 + t2) / circDen * 100 : null,
        t1s: sup > 0 ? t1 / sup * 100 : null,
        t2s: sup > 0 ? (t1 + t2) / sup * 100 : null,
        posH: pos,
        exD,
        buyersT: everBuy.size,
        gini,
        hhi: sumPos > 0 ? sumSq / (sumPos * sumPos) : null,
        hhiM: (() => {
          if (sumPos <= 0 || pos < 2) return null;
          const merged = new Map();
          for (const entry of walletNet.entries()) {
            const v = entry[1];
            if (v <= 0) continue;
            const w = entry[0];
            const root = parent.has(w) ? find(w) : w;
            merged.set(root, (merged.get(root) || 0) + v);
          }
          let sq = 0;
          for (const v of merged.values()) sq += (v / sumPos) * (v / sumPos);
          return sq;
        })(),
      };
    };
    for (const r of rows) {
      if (Number(r.bnb_amount) < DUST) continue;
      const ms = new Date(r.block_time).getTime();
      const isBuy = r.trade_type === 'buy';
      const amt = Number(r.token_amount), price = r.price_bnb != null ? Number(r.price_bnb) : null;
      circ += isBuy ? amt : -amt;
      const w = lc(r.sender_address) || lc(r.trader_address);
      if (w) {
        walletNet.set(w, (walletNet.get(w) || 0) + (isBuy ? amt : -amt));
        if (isBuy) {
          const isFirst = !everBuy.has(w);
          everBuy.add(w);
          if (isFirst) { // 同块「首买」≥2 钱包=组织共进指纹（bundleCluster 同口径）
            let bb = blockBuys.get(r.block_number); if (!bb) { bb = new Map(); blockBuys.set(r.block_number, bb); }
            if (bb.size >= 1) { const it = bb.keys(); const k0 = it.next().value; uni(k0, w); }
            bb.set(w, (bb.get(w) || 0) + amt);
          }
          const ak = Number(r.bnb_amount).toFixed(4);
          let ab = amtBuys.get(ak); if (!ab) { ab = new Map(); amtBuys.set(ak, ab); }
          const prevA = ab.get(w) || 0; ab.set(w, prevA + amt);
          if (prevA === 0 && ab.size >= 3) { const it = ab.keys(); const k0 = it.next().value; uni(k0, w); }
        }
      }
      if (price != null) {
        lastRel = price;
        if (isBuy && firstBuy == null) firstBuy = price;
        if (minRel == null || price < minRel) minRel = price;
      }
      while (pi < pts.length && ms >= pts[pi].ms) { fillSnap(pts[pi]); pi++; }
      events.push({ ms, circ, price, launchFloor: Math.min(LC, firstBuy ?? LC, minRel ?? LC) });
    }
    while (pi < pts.length) { fillSnap(pts[pi]); pi++; }
    rel.set(tok, { events });
    if (i % 100 === 0) console.log(`  token ${i + 1}/${tokens.length} rows=${totalRows} ${(Date.now() - t0) / 1000 | 0}s rss=${(process.memoryUsage().rss / 1e6 | 0)}MB`);
  }
  console.log(`ticks: ${totalRows} 行, ${(Date.now() - t0) / 1000 | 0}s`);

  // ── 5. 前向收益 ──
  function forward(tok, ms) {
    const R = rel.get(tok);
    if (!R) return null;
    let lo = 0, hi = R.events.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (R.events[mid].ms <= ms) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    if (ans < 0) return null;
    let p = R.events[ans].price, k = ans;
    while (p == null && k > 0) { k--; p = R.events[k].price; }
    if (p == null) return null;
    let lo2 = 0, hi2 = R.events.length - 1, st = R.events.length;
    while (lo2 <= hi2) { const mid = (lo2 + hi2) >> 1; if (R.events[mid].ms >= ms) { st = mid; hi2 = mid - 1; } else lo2 = mid + 1; }
    let max15 = null, last15 = null;
    for (let k2 = st; k2 < R.events.length; k2++) {
      const e = R.events[k2];
      if (e.ms > ms + FWD) break;
      if (e.price != null) { if (max15 == null || e.price > max15) max15 = e.price; last15 = e.price; }
    }
    return { m15Max: max15 != null ? (max15 / p - 1) * 100 : null, m15Last: last15 != null ? (last15 / p - 1) * 100 : null };
  }
  for (const p of [...sigRaw, ...buyRaw]) p.fwd = forward(p.token, p.ms);

  // ── 6. 汇总 ──
  const med = a => { const v = a.filter(x => x != null).sort((x, y) => x - y); return v.length ? v[v.length >> 1] : null; };
  function summarize(rows, getter, BINS, LABELS, title, isBuy) {
    console.log(`\n══ ${title} ══`);
    console.log('桶 | n | 胜率 | Σ净BNB | med(m15Max) | med(m15Last) | med(circ%) | med(posH)');
    for (let i = 0; i < LABELS.length; i++) {
      const g = rows.filter(r => { const v = getter(r); return v != null && v >= BINS[i] && v < BINS[i + 1]; });
      if (!g.length) { console.log(`${LABELS[i].padEnd(9)} | 0 |`); continue; }
      const wins = g.filter(r => (isBuy ? r.allocNet : (r.fwd?.m15Last ?? -1)) > 0).length;
      console.log(`${LABELS[i].padEnd(9)} | ${String(g.length).padStart(4)} | ${(wins / g.length * 100).toFixed(0)}% | ${g.reduce((x, r) => x + (r.allocNet || 0), 0).toFixed(3)} | ${med(g.map(r => r.fwd?.m15Max))?.toFixed(1) ?? '-'} | ${med(g.map(r => r.fwd?.m15Last))?.toFixed(1) ?? '-'} | ${med(g.map(r => r.circPct))?.toFixed(1) ?? '-'} | ${med(g.map(r => r.chips?.posH)) ?? '-'}`);
    }
  }
  const B = {
    hhiM: { BINS: [0, 0.1, 0.2, 0.35, 0.55, 1.001], L: ['<0.10', '0.10-0.20', '0.20-0.35', '0.35-0.55', '0.55+'] },
    hhi: { BINS: [0, 0.1, 0.2, 0.35, 0.55, 1.001], L: ['w<0.10', 'w0.10-0.20', 'w0.20-0.35', 'w0.35-0.55', 'w0.55+'] },
  };
  for (const [k, { BINS, L }] of Object.entries(B)) {
    summarize(buyRaw, r => r.chips?.[k], BINS, L, `成交面·${k}`, true);
    summarize(sigRaw, r => r.chips?.[k], BINS, L, `信号面·${k}`, false);
  }

  // 基尼象限与联合分析（T187 深化：分散度连续轴）
  const GB = [0, 0.1, 0.2, 0.35, 0.55, 1.001], GLg = ['<0.10', '0.10-0.20', '0.20-0.35', '0.35-0.55', '0.55+'];
  const q = (arr, p) => { const v = arr.filter(x => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length * p)] : null; };
  console.log('\nhhi 分位（成交面）: p10=' + q(buyRaw.map(r => r.chips?.hhi), .1)?.toFixed(2) + ' p25=' + q(buyRaw.map(r => r.chips?.hhi), .25)?.toFixed(2) + ' p50=' + q(buyRaw.map(r => r.chips?.hhi), .5)?.toFixed(2) + ' p75=' + q(buyRaw.map(r => r.chips?.hhi), .75)?.toFixed(2) + ' p90=' + q(buyRaw.map(r => r.chips?.hhi), .9)?.toFixed(2));
  console.log('hhi 分位（信号面）: p10=' + q(sigRaw.map(r => r.chips?.hhi), .1)?.toFixed(2) + ' p25=' + q(sigRaw.map(r => r.chips?.hhi), .25)?.toFixed(2) + ' p50=' + q(sigRaw.map(r => r.chips?.hhi), .5)?.toFixed(2) + ' p75=' + q(sigRaw.map(r => r.chips?.hhi), .75)?.toFixed(2) + ' p90=' + q(sigRaw.map(r => r.chips?.hhi), .9)?.toFixed(2));

  // 象限：gini × posH（成交 pnl）——分散轴两维联合
  const PB = [0, 10, 25, 1e9], PL = ['posH<10', '10-25', '25+'];
  console.log('\n象限（成交面 n/Σpnl）gini\\posH | ' + PL.join(' | '));
  for (let gi = 0; gi < GLg.length; gi++) {
    const cells = [];
    for (let pi = 0; pi < PL.length; pi++) {
      const g = buyRaw.filter(r => r.chips?.hhi != null && r.chips.hhi >= GB[gi] && r.chips.hhi < GB[gi + 1]
        && r.chips?.posH != null && r.chips.posH >= PB[pi] && r.chips.posH < PB[pi + 1]);
      cells.push(g.length ? `${g.length}/${g.reduce((x, r) => x + (r.allocNet || 0), 0).toFixed(2)}` : '-');
    }
    console.log(`${GLg[gi].padEnd(9)}| ` + cells.join(' | '));
  }
  // 信号面象限（n|medM15Max）
  console.log('\n象限（信号面 n|medM15Max）gini\\posH | ' + PL.join(' | '));
  for (let gi = 0; gi < GLg.length; gi++) {
    const cells = [];
    for (let pi = 0; pi < PL.length; pi++) {
      const g = sigRaw.filter(r => r.chips?.hhi != null && r.chips.hhi >= GB[gi] && r.chips.hhi < GB[gi + 1]
        && r.chips?.posH != null && r.chips.posH >= PB[pi] && r.chips.posH < PB[pi + 1]);
      cells.push(g.length ? `${g.length}|${med(g.map(r => r.fwd?.m15Max))?.toFixed(0) ?? '-'}` : '-');
    }
    console.log(`${GLg[gi].padEnd(9)}| ` + cells.join(' | '));
  }
  // gini 与 t1c 相关性 + T187 门进出票的 gini 分布
  console.log('\nT187 门视角：');
  for (const [lbl, cond] of [
    ['被拦票（posH≥25∧非豁免）', r => (r.chips?.posH ?? 0) >= 25 && (r.chips?.t1c ?? 0) < 45 && (r.chips?.t2c ?? 0) < 60],
    ['放行票（其余）', r => !((r.chips?.posH ?? 0) >= 25 && (r.chips?.t1c ?? 0) < 45 && (r.chips?.t2c ?? 0) < 60)],
  ]) {
    const g = buyRaw.filter(cond);
    console.log(lbl + ': ' + g.length + ' 票 Σ' + g.reduce((x, r) => x + (r.allocNet || 0), 0).toFixed(3) + ' | gini p25=' + q(g.map(r => r.chips?.hhi), .25)?.toFixed(2) + ' p50=' + q(g.map(r => r.chips?.hhi), .5)?.toFixed(2) + ' p75=' + q(g.map(r => r.chips?.hhi), .75)?.toFixed(2));
  }
  // gini 阈值扫描（gini < X 门在成交面的净效应——纯 gini 门与 T187 关系）
  for (const X of [0.3, 0.35, 0.4, 0.45, 0.5]) {
    const g = buyRaw.filter(r => (r.chips?.hhi ?? 1) < X);
    console.log(`gini<${X}: ${g.length} 票 Σ${g.reduce((x, r) => x + (r.allocNet || 0), 0).toFixed(3)} 胜${g.length ? Math.round(g.filter(r => (r.allocNet || 0) > 0).length / g.length * 100) : 0}% | med posH=${med(g.map(r => r.chips?.posH))} med t1c=${med(g.map(r => r.chips?.t1c))?.toFixed(0)}`);
  }

  // 主体级 vs 钱包级 低集中端对比（用户裁定「集中度高不是问题，低才是；加绑定机制」）
  console.log('\n低集中端对比（成交面）：');
  for (const [lbl, cond] of [
    ['钱包级<0.10（T188 现行线）', r => (r.chips?.hhi ?? 1) < 0.10],
    ['主体级<0.10（合并簇后）', r => (r.chips?.hhiM ?? 1) < 0.10],
    ['主体级<0.15', r => (r.chips?.hhiM ?? 1) < 0.15],
    ['主体级<0.20', r => (r.chips?.hhiM ?? 1) < 0.20],
  ]) {
    const g = buyRaw.filter(cond);
    const rp = g.map(r => r.realPct).filter(x => x != null);
    const mean = rp.length ? (rp.reduce((a, b) => a + b, 0) / rp.length) : null;
    console.log(lbl + ': ' + g.length + ' 票 Σ' + g.reduce((x, r) => x + (r.allocNet || 0), 0).toFixed(3) + ' 胜' + (g.length ? Math.round(g.filter(r => (r.allocNet || 0) > 0).length / g.length * 100) : 0) + '% 均real=' + (mean != null ? mean.toFixed(0) + '%' : '-'));
  }
  // 明细：主体级<0.15 全票
  console.log('\n主体级<0.15 明细：');
  for (const r of buyRaw.filter(r => (r.chips?.hhiM ?? 1) < 0.15).sort((a, b) => (a.allocNet || 0) - (b.allocNet || 0))) {
    console.log('  ' + r.token.slice(0, 10) + ' hhiW=' + (r.chips?.hhi ?? 0).toFixed(2) + '→hhiM=' + (r.chips?.hhiM ?? 0).toFixed(2) + ' posH=' + r.chips?.posH + ' t1c=' + (r.chips?.t1c || 0).toFixed(0) + '% pnl=' + (r.allocNet || 0).toFixed(3) + ' real=' + (r.realPct != null ? r.realPct.toFixed(0) : '-') + '% leg=' + (r.leg || '?'));
  }
  fs.writeFileSync('/tmp/b8ae-gini-out.json', JSON.stringify({ sigRaw: sigRaw.map(r => ({ ...r, chips: r.chips, fwd: r.fwd })), buyRaw, tokNet: [...tokNet.entries()] }));
  console.log('\n明细已写 /tmp/b8ae-gini-out.json');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
