/**
 * 买入后「10 秒无交易 → 全部清仓」卖出思路回放分析（2026-10-29）
 *
 * 数据源：近 N 天全部实验 trades（真实成交，virtual+live）+ wss_price_ticks token 级 tick 流。
 * 模拟口径：
 *   - round = (experiment, token) 从空仓买起到清仓（卡牌分批卖算同一 round）
 *   - 持仓期内监控 token 链上成交流（wss_price_ticks 全行，含 outlier/dust——链上真实成交都算交易）
 *   - 若某笔成交距上一笔 > 10s 且空窗起点在买入之后 → 在「上一笔成交时刻 +10s」触发全清，
 *     清仓价 = 空窗前最后一笔成交价（bonding curve 当前价）
 *   - 买入时空窗已在进行（上一笔成交距买入 >=10s）→ 立即触发（按规则字面语义）
 *   - 触发点早于实际末笔卖出才算改变结果；触发前的部分卖出保留
 * 输出：触发率/触发时点分布/模拟 vs 实际盈亏/大票错过面/空窗后价格走势（10s 空窗到底预示什么）
 */
const { dbManager } = require('../src/services/dbManager.js');

const STALL_MS = 10000;
const DAYS = 8;
const TAIL_MS = 30 * 60 * 1000;      // 实际清仓后再追看 30min（错过面/复活面）
const MAX_TICK_ROWS = 60000;         // 每 round tick 行上限
const BNB_LIKE = new Set(['BNB', 'WBNB', 'WNB']);

const num = (v) => (v === null || v === undefined ? null : Number(v));
const ts = (s) => new Date(s).getTime();

(async () => {
  const db = await dbManager.getClient();
  const cutoff = new Date(Date.now() - DAYS * 86400e3).toISOString();

  // ---- 实验名映射 ----
  const exps = await db.from('experiments').select('id,config,created_at').gte('created_at', cutoff);
  if (exps.error) throw new Error(exps.error.message);
  const expName = new Map(exps.data.map(e => {
    let n = ''; try { n = (typeof e.config === 'string' ? JSON.parse(e.config) : e.config)?.name || ''; } catch (_) {}
    return [e.id, n];
  }));

  // ---- 全部成交 ----
  const tradesRes = await db.from('trades')
    .select('experiment_id,token_address,token_symbol,trade_direction,input_currency,output_currency,input_amount,output_amount,unit_price,created_at,executed_at,is_virtual_trade')
    .gte('created_at', cutoff).eq('success', true).order('created_at');
  if (tradesRes.error) throw new Error(tradesRes.error.message);
  const trades = tradesRes.data || [];
  console.error(`trades rows: ${trades.length}, experiments: ${expName.size}`);

  // ---- round 重建 ----
  const groups = new Map();
  for (const t of trades) {
    const key = t.experiment_id + '|' + t.token_address;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const rounds = [];
  let skippedCurrency = 0;
  for (const [key, list] of groups) {
    list.sort((a, b) => ts(a.created_at) - ts(b.created_at));
    let cur = null;
    for (const t of list) {
      const buy = t.trade_direction === 'buy';
      const bnbSide = buy ? t.input_currency : t.output_currency;
      const tokSide = buy ? t.output_currency : t.input_currency;
      if (!BNB_LIKE.has(bnbSide) || BNB_LIKE.has(tokSide)) { skippedCurrency++; continue; }
      const bnb = num(buy ? t.input_amount : t.output_amount);
      const tok = num(buy ? t.output_amount : t.input_amount);
      if (bnb === null || tok === null || !(bnb > 0) || !(tok > 0)) continue;
      const tms = ts(t.created_at);
      if (buy) {
        if (!cur || cur.qty <= 1e-12) { if (cur) rounds.push(cur); cur = null; }
        if (!cur) cur = { exp: t.experiment_id, token: t.token_address, symbol: t.token_symbol, qty: 0, cost: 0, proceeds: 0, events: [], virtual: t.is_virtual_trade };
        cur.qty += tok; cur.cost += bnb;
        cur.events.push({ t: tms, dir: 'buy', bnb, tok });
      } else {
        if (!cur || cur.qty <= 1e-12) continue; // 无持仓的卖（异常）忽略
        const sellTok = Math.min(tok, cur.qty);
        cur.qty -= sellTok; cur.proceeds += bnb;
        cur.events.push({ t: tms, dir: 'sell', bnb, tok: sellTok });
      }
    }
    if (cur) rounds.push(cur);
  }
  console.error(`rounds: ${rounds.length} (skipped currency rows: ${skippedCurrency})`);

  // ---- 每 round 拉 ticks + 模拟 ----
  const out = [];
  for (const r of rounds) {
    const t0 = r.events[0].t;
    const lastEvent = r.events[r.events.length - 1];
    const winEnd = lastEvent.t + TAIL_MS;
    // ticks 分页
    const ticks = [];
    let cursorId = 0, truncated = false;
    for (;;) {
      const q = db.from('wss_price_ticks')
        .select('id,block_time,price_bnb,bnb_amount,price_outlier')
        .eq('token_address', r.token).gt('id', cursorId)
        .gte('block_time', new Date(t0 - 120e3).toISOString())
        .lte('block_time', new Date(winEnd).toISOString())
        .order('id', { ascending: true }).range(0, 999);
      const res = await q;
      if (res.error) throw new Error('ticks: ' + res.error.message);
      for (const row of res.data || []) {
        const p = num(row.price_bnb);
        ticks.push({ t: ts(row.block_time), p, outlier: !!row.price_outlier, id: row.id });
      }
      if (!res.data || res.data.length < 1000) break;
      cursorId = res.data[res.data.length - 1].id;
      if (ticks.length >= MAX_TICK_ROWS) { truncated = true; break; }
    }
    // 稳定按时间排序（id 序≈到达序，同秒乱序以 block_time 为准）
    ticks.sort((a, b) => a.t - b.t || a.id - b.id);

    // 可靠价序列（outlier 剔除）用于价格点；空窗检测用全行
    const priced = ticks.filter(x => x.p != null && x.p > 0 && !x.outlier);
    if (priced.length < 2) { out.push({ ...r, noTicks: true }); continue; }

    const entryPrice = r.cost / (r.qty + r.events.filter(e => e.dir === 'sell').reduce((s, e) => s + e.tok, 0));
    const flat = r.qty <= 1e-12;
    const lastPr = flat ? r.events[r.events.length - 1].t : lastEvent.t; // 未平仓以末事件为界

    // ---- 空窗检测（全行口径）----
    let trigger = null;
    let i0 = 0;
    while (i0 < ticks.length && ticks[i0].t < t0 - 120e3) i0++;
    // 上一笔链上成交（<= 买入时刻）
    let prevIdx = -1;
    for (let i = 0; i < ticks.length; i++) { if (ticks[i].t <= t0) prevIdx = i; else break; }
    if (prevIdx === -1) { out.push({ ...r, noTicks: true }); continue; }
    // 买入时空窗已 >=10s → 立即触发
    if (t0 - ticks[prevIdx].t >= STALL_MS) {
      trigger = { at: t0, price: null /*entry*/, immediate: true };
    } else {
      for (let i = prevIdx + 1; i < ticks.length; i++) {
        if (ticks[i].t - ticks[i - 1].t > STALL_MS) {
          const at = ticks[i - 1].t + STALL_MS;
          if (at <= lastPr) {
            const px = (() => { // 空窗前最后一笔可靠价
              for (let j = i - 1; j >= 0; j--) { const q = ticks[j]; if (q.p != null && q.p > 0 && !q.outlier) return q.p; }
              return null;
            })();
            trigger = { at, price: px, immediate: false, resumeAt: ticks[i].t, resumePrice: (() => { for (let j = i; j < ticks.length; j++) { const q = ticks[j]; if (q.p != null && q.p > 0 && !q.outlier) return q.p; } return null; })() };
          }
          break; // 只看第一个空窗
        }
      }
    }

    // ---- 模拟盈亏 ----
    let cf = null, peakAfter = null;
    if (trigger) {
      // 触发前已发生的部分卖出
      let soldBnb = 0, soldTok = 0;
      for (const e of r.events) if (e.dir === 'sell' && e.t <= trigger.at) { soldBnb += e.bnb; soldTok += e.tok; }
      const remainTok = Math.max(0, (r.cost / entryPrice) - soldTok); // 买入总量-已卖
      const exitPx = trigger.immediate ? entryPrice : trigger.price;
      if (exitPx != null) {
        cf = {
          profitBnb: soldBnb + remainTok * exitPx - r.cost,
          profitPct: (soldBnb + remainTok * exitPx - r.cost) / r.cost * 100,
          exitPx, remainTok,
        };
        // 触发后到实际清仓+TAIL 的最高可靠价（错过面）
        let pk = 0;
        for (const q of priced) if (q.t > trigger.at && q.t <= lastPr + TAIL_MS) pk = Math.max(pk, q.p);
        peakAfter = pk > 0 ? pk : null;
      }
    }
    // 实际 round 盈亏（未平仓按最后可靠价 mark）
    let lastP = priced.length ? priced[priced.length - 1].p : null;
    let markQty = r.qty;
    const actualProfitBnb = r.proceeds + (flat ? 0 : markQty * (lastP || 0)) - r.cost;
    // 实际路径峰值（买入→清仓+TAIL 窗内最高价）——「这票实际吃到多少/本来能吃到多少」
    let pathPeak = 0;
    for (const q of priced) if (q.t >= t0 - 2000 && q.t <= lastPr + TAIL_MS) pathPeak = Math.max(pathPeak, q.p);
    out.push({
      ...r, flat, lastPr, entryPrice, actualProfitBnb,
      actualPct: actualProfitBnb / r.cost * 100,
      pathPeakPct: pathPeak > 0 ? (pathPeak / entryPrice - 1) * 100 : null,
      trigger, cf, peakAfter, peakAfterPct: (trigger && peakAfter && cf) ? (peakAfter / cf.exitPx - 1) * 100 : null,
      truncated, nTicks: ticks.length,
    });
  }

  // ---- 汇总 ----
  const valid = out.filter(r => !r.noTicks);
  const trig = valid.filter(r => r.trigger && r.cf);
  const noTrig = valid.filter(r => !r.trigger);
  const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);

  console.log('\n===== 总览 =====');
  console.log(`rounds 有效 ${valid.length}（无 tick 跳过 ${out.length - valid.length}，截断 ${valid.filter(r => r.truncated).length}）`);
  console.log(`触发 10s 空窗全清: ${trig.length} (${(trig.length / valid.length * 100).toFixed(1)}%)，未触发 ${noTrig.length}`);
  const imm = trig.filter(r => r.trigger.immediate);
  console.log(`  其中买入即触发（买入时空窗已>=10s）: ${imm.length}`);
  const tt = trig.map(r => (r.trigger.at - r.events[0].t) / 1000).sort((a, b) => a - b);
  const q = (p) => tt.length ? tt[Math.min(tt.length - 1, Math.floor(p * tt.length))].toFixed(1) : '-';
  console.log(`  触发时点（买入后秒）: p10=${q(0.1)} p25=${q(0.25)} p50=${q(0.5)} p75=${q(0.75)} p90=${q(0.9)}`);

  console.log('\n===== 盈亏对比（BNB） =====');
  console.log(`实际总盈亏: ${sum(valid, r => r.actualProfitBnb).toFixed(4)} BNB（round 均值 ${(sum(valid, r => r.actualProfitBnb) / valid.length).toFixed(5)}）`);
  const cfRounds = valid.map(r => r.trigger && r.cf ? r.cf.profitBnb : r.actualProfitBnb);
  console.log(`模拟总盈亏（触发 round 换 CF、未触发保持实际）: ${cfRounds.reduce((s, x) => s + x, 0).toFixed(4)} BNB`);
  const delta = trig.map(r => r.cf.profitBnb - r.actualProfitBnb).sort((a, b) => a - b);
  if (delta.length) console.log(`Δ(模拟-实际) per round: p10=${delta[Math.floor(0.1 * delta.length)].toFixed(5)} p50=${delta[Math.floor(0.5 * delta.length)].toFixed(5)} p90=${delta[Math.floor(0.9 * delta.length)].toFixed(5)}  合计=${delta.reduce((s, x) => s + x, 0).toFixed(4)}`);
  console.log(`模拟更优 round: ${trig.filter(r => r.cf.profitBnb > r.actualProfitBnb).length} / 更差: ${trig.filter(r => r.cf.profitBnb < r.actualProfitBnb).length}`);

  console.log('\n===== 大票错过面（round 实际峰值 >= +100%） =====');
  const big = valid.filter(r => r.pathPeakPct != null && r.pathPeakPct >= 100);
  const bigTrig = big.filter(r => r.trigger && r.cf);
  console.log(`峰值>=100% round: ${big.length}，其中会在到峰前触发: ${bigTrig.length}`);
  for (const r of bigTrig) {
    console.log(`  ${r.symbol || r.token.slice(0, 10)} [${(expName.get(r.exp) || r.exp.slice(0, 8))}] 入场后峰值 +${r.pathPeakPct.toFixed(0)}% 实际 ${r.actualPct.toFixed(1)}% → 模拟 ${r.cf.profitPct.toFixed(1)}% (触发于买入后 ${((r.trigger.at - r.events[0].t) / 1000).toFixed(0)}s${r.trigger.immediate ? ',即买即触发' : ''}; 触发后再涨空间 +${r.peakAfterPct != null ? r.peakAfterPct.toFixed(0) : '?'}%)`);
  }
  const big3 = valid.filter(r => r.pathPeakPct != null && r.pathPeakPct >= 200);
  console.log(`峰值>=200% round: ${big3.length}，触发 ${big3.filter(r => r.trigger && r.cf).length}`);

  console.log('\n===== 10s 空窗到底预示什么（触发 round 的空窗后续） =====');
  const resume = trig.filter(r => !r.trigger.immediate && r.trigger.resumePrice != null && r.cf);
  const upAfter = resume.filter(r => r.trigger.resumePrice > r.cf.exitPx);
  console.log(`可观测恢复成交的 ${resume.length} 个中，恢复价高于清仓价（空窗是假冷却）: ${upAfter.length} (${resume.length ? (upAfter.length / resume.length * 100).toFixed(0) : 0}%)`);
  const drift = resume.map(r => (r.trigger.resumePrice / r.cf.exitPx - 1) * 100).sort((a, b) => a - b);
  if (drift.length) console.log(`恢复价 vs 清仓价: p25=${drift[Math.floor(0.25 * drift.length)].toFixed(1)}% p50=${drift[Math.floor(0.5 * drift.length)].toFixed(1)}% p75=${drift[Math.floor(0.75 * drift.length)].toFixed(1)}%`);
  const lullDur = resume.map(r => (r.trigger.resumeAt - r.trigger.at) / 1000).sort((a, b) => a - b);
  if (lullDur.length) console.log(`空窗实际持续（到恢复成交）: p50=${lullDur[Math.floor(0.5 * lullDur.length)].toFixed(1)}s p90=${lullDur[Math.floor(0.9 * lullDur.length)].toFixed(1)}s`);

  console.log('\n===== 明细（全部触发 round，按 Δ 升序） =====');
  const details = trig.slice().sort((a, b) => (a.cf.profitBnb - a.actualProfitBnb) - (b.cf.profitBnb - b.actualProfitBnb));
  for (const r of details) {
    console.log(`${r.symbol || r.token.slice(0, 10)} [${(expName.get(r.exp) || r.exp.slice(0, 8))}]${r.virtual ? '' : ' LIVE'} 持仓${((r.lastPr - r.events[0].t) / 1000).toFixed(0)}s` +
      ` 实际${r.actualPct >= 0 ? '+' : ''}${r.actualPct.toFixed(1)}% → 模拟${r.cf.profitPct >= 0 ? '+' : ''}${r.cf.profitPct.toFixed(1)}%` +
      ` 触发@+${((r.trigger.at - r.events[0].t) / 1000).toFixed(0)}s${r.trigger.immediate ? '(即买)' : ''}` +
      ` 峰值+${r.pathPeakPct != null ? r.pathPeakPct.toFixed(0) : '?'}% 触发后空间${r.peakAfterPct != null ? (r.peakAfterPct >= 0 ? '+' : '') + r.peakAfterPct.toFixed(0) + '%' : '?'}`);
  }
  console.log('\n===== 未触发 round 明细 =====');
  for (const r of noTrig) {
    console.log(`${r.symbol || r.token.slice(0, 10)} [${(expName.get(r.exp) || r.exp.slice(0, 8))}]${r.virtual ? '' : ' LIVE'} 持仓${((r.lastPr - r.events[0].t) / 1000).toFixed(0)}s 实际${r.actualPct >= 0 ? '+' : ''}${r.actualPct.toFixed(1)}% 峰值+${r.pathPeakPct != null ? r.pathPeakPct.toFixed(0) : '?'}%`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
