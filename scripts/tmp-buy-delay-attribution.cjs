#!/usr/bin/env node
// 买腿因子条件迟滞归因（调研，182 跑）：近 N 天 live 实验成功 buy episode，
//   哪些条件子句不必要地拖慢了买入（binding 长杆 + 独拦时长 + 去臂反事实 ΔPnL）。
// 口径：
//   - fire 锚 = strategy_signals BUY created_at 真值（不重构 fire 时刻——debounce/GMGN
//     在信号之后，重放不必复现）；重放只为拿每子句 lastFalse/firstTrue 时间线
//   - 重放 = 真 FA 消费全量 ticks（尘门 0.001 对齐 live 因子域）+ narrative rounds
//     时间线覆盖 narrativeRating；roster 三 loader 必载（校准坑 memory）
//   - 子句 = 实验自身 condition（config 快照）顶层 AND 拆分；真评估器评估
//   - binding = at-fire 为真的子句里 lastFalse 距 fire 最近者（恒定 binder，无窗口——
//     binder 翻真到 fire 的余量单独报告为 engine 侧）；binder 不存在才看未知因子子句
//     （v38 前 earlyTrades* 断代）按消除法归因
//   - at-fire 为假 = 名单漂移/键断代 → 该子句该 episode 降级 unknown（自愈）
//   - ΔPnL 一阶 = 去臂后更早入场价 pCf：buyBnb×vpt×(1/pCf−1/pAct)（episode 整段口径）
//   - rating binding 分解：trigger 首真→首轮 started→rating completed（发起等待/分析时长）
//   - fire→exec 间隔单独统计（debounce+GMGN+链上，非条件串因素）
require('/home/ubuntu/richer-js/node_modules/dotenv').config({ path: '/home/ubuntu/richer-js/config/.env' });
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');
const { ConditionEvaluator } = require('/home/ubuntu/richer-js/src/strategies/ConditionEvaluator');
const Mod = require('/home/ubuntu/richer-js/src/services/FourMemeFactorAggregator');
const FA = Mod.default || Mod;

const argv = process.argv.slice(2);
const argStr = (n) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
const DAYS = Number(argStr('--days') || 5);
const TICK_CAP = Number(argStr('--tick-cap') || 40000);
const EXP_FILTER = argStr('--exp');
const TOKEN_FILTER = argStr('--token');
const OUT_JSON = argStr('--out') || '/tmp/buydelay-result.json';
const DEBUG_TAIL = Number(argStr('--debug-tail') || 0);   // 每 episode 尾部 N tick 的子句状态调试
const MIN_TICK_BNB = 0.001;   // live 因子域尘门
const PAGE = 1000;

const ev = new ConditionEvaluator();
const c = dbManager.getClient();

// ── AST 工具：顶层 AND 拆分 / 反解析 / 因子收集 ──
function splitConjuncts(ast) {
  const out = [];
  (function walk(n) {
    if (n && n.type === 'AND') { walk(n.left); walk(n.right); }
    else out.push(n);
  })(ast);
  return out;
}
function unparse(n) {
  if (!n || typeof n !== 'object') return '?';
  if (n.type === 'AND') return `(${unparse(n.left)} AND ${unparse(n.right)})`;
  if (n.type === 'OR') return `(${unparse(n.left)} OR ${unparse(n.right)})`;
  if (n.type === 'IS_NULL') return `${n.operand} IS NULL`;
  if (n.type === 'IS_NOT_NULL') return `${n.operand} IS NOT NULL`;
  if (n.type === 'COMPARISON') return `${n.left} ${n.operator} ${n.rightString ? `'${n.right}'` : n.right}`;
  return '?';
}
function factorsOf(n, out = new Set()) {
  if (!n || typeof n !== 'object') return out;
  if (n.type === 'AND' || n.type === 'OR') { factorsOf(n.left, out); factorsOf(n.right, out); }
  else if (n.type === 'IS_NULL' || n.type === 'IS_NOT_NULL') out.add(n.operand);
  else if (n.type === 'COMPARISON') {
    out.add(n.left);
    if (!n.rightString && !Number.isFinite(Number(n.right))) out.add(n.right);
  }
  return out;
}

// ── episode：建仓→清零（同 mcap-floor-sell-replay）──
function buildEpisodes(trades) {
  const eps = [];
  let cur = null, qty = 0;
  for (const t of trades) {
    const ts = Date.parse(t.executed_at || t.created_at);
    const buy = t.trade_direction === 'buy';
    if (!cur) { cur = { trades: [], startTs: ts, endTs: ts, open: true }; qty = 0; }
    cur.trades.push(t); cur.endTs = ts;
    qty += buy ? Number(t.output_amount) : -Number(t.input_amount);
    if (qty <= 1e-9) { cur.open = false; eps.push(cur); cur = null; }
  }
  if (cur) eps.push(cur);
  return eps;
}

async function pullTicks(token, fromMs, toMs) {
  const rows = [];
  let anchor = 0;
  for (let p = 0; p < 80; p++) {
    const { data, error } = await c.from('wss_price_ticks')
      .select('id,block_time,block_number,log_index,trade_type,trader_address,sender_address,token_amount,bnb_amount,price_bnb,price_usd')
      .eq('token_address', token)
      .gte('block_time', new Date(fromMs).toISOString()).lte('block_time', new Date(toMs).toISOString())
      .gt('id', anchor).limit(4000);
    if (error) throw new Error(`ticks ${token}: ${error.message}`);
    rows.push(...data);
    if (data.length < 4000) return rows.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
    anchor = data[data.length - 1].id;
  }
  return rows.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
}

(async () => {
  await Promise.all([FA.loadSybilClusters(), FA.loadCopyWalletRoster(), FA.loadFamousCopyWallets()]);
  const knownKeys = new Set(new FA({}).getFactorKeys());
  ['platform', 'narrativeRating', 'narrativeRounds', 'narrativeRetryDue', 'narrativeCategory'].forEach(k => knownKeys.add(k));

  // [1] live 实验 + 自身 condition 快照
  const cutoff = new Date(Date.now() - DAYS * 86400000).toISOString();
  const { data: expRows, error: e1 } = await c.from('experiments')
    .select('id,experiment_name,config,created_at').eq('trading_mode', 'live').gte('created_at', cutoff);
  if (e1) throw new Error('experiments: ' + e1.message);
  const exps = [];
  for (const e of expRows) {
    if (EXP_FILTER && !e.id.startsWith(EXP_FILTER)) continue;
    const legs = (e.config && e.config.strategiesConfig && e.config.strategiesConfig.buyStrategies) || [];
    const condLegs = legs.filter(l => l && l.condition);
    if (condLegs.length !== 1) { console.log(`[skip] ${e.experiment_name} 买腿数=${condLegs.length}≠1`); continue; }
    const leg = condLegs[0];
    let conj;
    try { conj = splitConjuncts(ev.parseCondition(leg.condition)); } catch (err) { console.log(`[skip] ${e.experiment_name} condition 解析失败 ${err.message}`); continue; }
    if (conj.length < 2) { console.log(`[skip] ${e.experiment_name} 条件无可拆 AND`); continue; }
    const clauses = conj.map(ast => ({
      ast, label: unparse(ast),
      unknown: [...factorsOf(ast)].some(f => !knownKeys.has(f)),
      unknownFactors: [...factorsOf(ast)].filter(f => !knownKeys.has(f)),
    }));
    exps.push({
      id: e.id, name: e.experiment_name, clauses,
      triggerCond: leg.narrativeTriggerCondition || null,
      triggerAst: leg.narrativeTriggerCondition ? ev.parseCondition(leg.narrativeTriggerCondition) : null,
      hasRepeatCond: !!leg.repeatBuyCheckCondition,
    });
  }
  console.log(`[1] live 实验窗 ${cutoff.slice(0, 16)} 起：${exps.length} 个可归因（${expRows.length - exps.length} skip）`);
  for (const x of exps) console.log(`    ${x.name} 子句=${x.clauses.length} 未知因子子句=${x.clauses.filter(k => k.unknown).map(k => k.label).join(' | ') || '无'}`);

  // [2] 成功 trades → episodes
  const { data: tradeRows, error: e2 } = await c.from('trades')
    .select('id,experiment_id,token_address,token_symbol,trade_direction,input_amount,output_amount,created_at,executed_at,success')
    .in('experiment_id', exps.map(e => e.id)).gte('created_at', cutoff).order('created_at').limit(5000);
  if (e2) throw new Error('trades: ' + e2.message);
  const groups = new Map();
  for (const t of tradeRows.filter(t => t.success)) {
    const k = t.experiment_id + ':' + t.token_address;
    (groups.get(k) || groups.set(k, []).get(k)).push(t);
  }
  const episodes = [];
  for (const [k, ts] of groups) {
    ts.sort((a, b) => Date.parse(a.executed_at || a.created_at) - Date.parse(b.executed_at || b.created_at));
    const [expId, token] = k.split(':');
    if (TOKEN_FILTER && token !== TOKEN_FILTER) continue;
    for (const [i, ep] of buildEpisodes(ts).entries()) episodes.push({ expId, token, symbol: ts[0].token_symbol, repeatIdx: i, ...ep });
  }
  console.log(`[2] episodes=${episodes.length}（open=${episodes.filter(e => e.open).length}）`);

  // [3] fire 锚：每 episode 首笔 buy 前 10min 内最近 BUY 信号
  const { data: sigRows, error: e3 } = await c.from('strategy_signals')
    .select('id,experiment_id,token_address,created_at,metadata')
    .eq('signal_type', 'BUY').in('experiment_id', exps.map(e => e.id))
    .gte('created_at', new Date(Date.parse(cutoff) - 86400000).toISOString()).order('created_at').limit(20000);
  if (e3) throw new Error('signals: ' + e3.message);
  const sigMap = new Map();
  for (const s of sigRows) {
    const k = s.experiment_id + ':' + s.token_address;
    (sigMap.get(k) || sigMap.set(k, []).get(k)).push(s);
  }
  for (const ep of episodes) {
    const sigs = (sigMap.get(ep.expId + ':' + ep.token) || []).filter(s => {
      const ts = Date.parse(s.created_at);
      return ts <= ep.startTs + 2000 && ts >= ep.startTs - 600000;
    });
    ep.fireSig = sigs.length ? sigs[sigs.length - 1] : null;
    ep.fireTs = ep.fireSig ? Date.parse(ep.fireSig.created_at) : null;
  }
  // repeat 腿守卫：腿带 repeatBuyCheckCondition（PreBuy 键域，不可 FA 重放）→ 仅首 episode 可归因
  const repeatSkipped = [];
  for (const e of episodes) {
    const exp = exps.find(x => x.id === e.expId);
    if (e.repeatIdx > 0 && exp && exp.hasRepeatCond && e.fireTs) { repeatSkipped.push(e.symbol); e.fireTs = null; e.repeatSkipped = true; }
  }
  const noSig = episodes.filter(e => !e.fireTs && !e.repeatSkipped);
  if (noSig.length) console.log(`    无信号锚（手工买/外部）剔除 ${noSig.length}: ${noSig.map(e => e.symbol).join(',')}`);
  if (repeatSkipped.length) console.log(`    repeat 腿（repeatBuyCheckCondition 不可重放）剔除 ${repeatSkipped.length}: ${repeatSkipped.join(',')}`);

  // [4] narrative rounds 时间线（per experiment×token）
  const roundsMap = new Map();   // expId:token → rounds[]
  for (const exp of exps) {
    const toks = [...new Set(episodes.filter(e => e.expId === exp.id && e.fireTs).map(e => e.token))];
    for (let i = 0; i < toks.length; i += 50) {
      const { data, error } = await c.from('narrative_analysis_rounds')
        .select('token_address,round_no,started_at,completed_at,rating,from_cache,error')
        .eq('experiment_id', exp.id).in('token_address', toks.slice(i, i + 50)).order('started_at').limit(2000);
      if (error) throw new Error('rounds: ' + error.message);
      for (const r of data) {
        const k = exp.id + ':' + r.token_address;
        (roundsMap.get(k) || roundsMap.set(k, []).get(k)).push(r);
      }
    }
  }
  const ratingAt = (ep, ts) => {
    let out = null;
    for (const r of roundsMap.get(ep.expId + ':' + ep.token) || []) {
      if (r.completed_at && Date.parse(r.completed_at) <= ts && r.rating != null) out = r.rating;
    }
    return out;
  };

  // [5] token_create 锚
  const anchors = new Map();
  const allToks = [...new Set(episodes.filter(e => e.fireTs).map(e => e.token))];
  for (let i = 0; i < allToks.length; i += 50) {
    const { data, error } = await c.from('wss_events')
      .select('token_address,platform,payload,block_time').eq('kind', 'token_create')
      .in('token_address', allToks.slice(i, i + 50)).order('block_time').limit(1000);
    if (error) throw new Error('anchors: ' + error.message);
    for (const r of data) {
      if (anchors.has(r.token_address)) continue;
      const a = { anchorMs: Number(r.payload && r.payload.blockTimeMs) || Date.parse(r.block_time), platform: r.platform || 'fourmeme', supply: Number(r.payload && r.payload.totalSupply) || 0 };
      if (!a.supply) a.supply = a.platform === 'fourmeme' ? 0 : 1e9;
      anchors.set(r.token_address, a);
    }
  }

  // [6] 逐 token 重放
  let done = 0;
  for (const token of allToks) {
    const a = anchors.get(token);
    const eps = episodes.filter(e => e.token === token && e.fireTs).sort((x, y) => x.fireTs - y.fireTs);
    if (!a || !a.anchorMs || !a.supply) { done++; continue; }   // no-anchor 在 [7] 报告
    const winEnd = Math.max(...eps.map(e => e.fireTs)) + 90000;
    let ticks = await pullTicks(token, a.anchorMs - 60000, winEnd);
    if (ticks.length > TICK_CAP) { console.log(`    WARN ${token} ticks>${TICK_CAP} 截断`); ticks = ticks.slice(0, TICK_CAP); }
    const fa = new FA({});
    fa.registerToken(token, { createdAtMs: a.anchorMs, totalSupply: a.supply, platform: a.platform });
    for (const ep of eps) {
      const exp = exps.find(x => x.id === ep.expId);
      ep._st = { ts: [], price: [], truth: exp.clauses.map(() => []), replayAllTrue: null, triggerTrue: null };
    }
    let lastPrice = 0;
    for (const t of ticks) {
      const ts = Date.parse(t.block_time);
      if (Number(t.bnb_amount) < MIN_TICK_BNB) continue;
      fa.processTick({ token_address: token, platform: a.platform, timestamp: ts, block_number: t.block_number, log_index: t.log_index,
        trader_address: t.trader_address, sender_address: t.sender_address, trade_type: t.trade_type,
        token_amount: Number(t.token_amount), bnb_amount: Number(t.bnb_amount || 0),
        price_bnb: Number(t.price_bnb || 0), price_usd: Number(t.price_usd || 0) }, { emitFactors: false });
      const active = eps.filter(e => e._st.ts.length === 0 || e._st.ts[e._st.ts.length - 1] <= e.fireTs);
      if (!active.length) break;
      const f = fa.buildFactorMap(token, ts) || {};
      if (f.currentPriceBnb > 0) lastPrice = f.currentPriceBnb;
      for (const ep of active) {
        const exp = exps.find(x => x.id === ep.expId);
        const st = ep._st;
        st.ts.push(ts); st.price.push(lastPrice);
        const f2 = { ...f, narrativeRating: ratingAt(ep, ts) };
        let all = true;
        exp.clauses.forEach((cl, i) => { const v = !!ev.evaluate(cl.ast, f2); st.truth[i].push(v); if (!v) all = false; });
        if (all && !st.replayAllTrue) st.replayAllTrue = ts;
        if (exp.triggerAst && !st.triggerTrue && ev.evaluate(exp.triggerAst, f2)) st.triggerTrue = ts;
      }
    }
    done++;
    if (done % 10 === 0) console.log(`    重放 ${done}/${allToks.length} tokens`);
  }

  // [7] 逐 episode 归因
  const clauseAgg = new Map();   // label → {n, soleBlock[], delta[], drift[], cfDelay[]}
  const detail = [];
  let execLat = [];
  for (const ep of episodes.filter(e => e.fireTs)) {
    const exp = exps.find(x => x.id === ep.expId);
    const a = anchors.get(ep.token);
    if (!a || !a.anchorMs || !a.supply) { detail.push({ exp: exp.name, token: ep.token, symbol: ep.symbol, bucket: 'no-anchor' }); continue; }
    const st = ep._st;
    const fireIdx = (() => { let i = st.ts.length - 1; while (i >= 0 && st.ts[i] > ep.fireTs) i--; return i; })();
    if (fireIdx < 0) { detail.push({ exp: exp.name, token: ep.token, symbol: ep.symbol, bucket: 'fire-前无ticks' }); continue; }
    if (DEBUG_TAIL > 0) {
      console.log(`\n[dbg] ${ep.symbol} fire=${new Date(ep.fireTs).toISOString().slice(5, 19)} fireIdx=${fireIdx}/${st.ts.length}`);
      for (let i = Math.max(0, fireIdx - DEBUG_TAIL + 1); i <= fireIdx; i++) {
        const falses = exp.clauses.filter((cl, j) => !st.truth[j][i]).map(cl => cl.label);
        console.log(`  ${((st.ts[i] - ep.fireTs) / 1000).toFixed(1)}s price=${st.price[i]} ${falses.length ? 'FALSE:' + falses.join('|') : 'ALL-TRUE'}`);
      }
    }

    // at-fire 校验（false → 该子句本 episode 降级 unknown）
    const demoted = [];
    const per = exp.clauses.map((cl, i) => ({ cl, i, atFire: st.truth[i][fireIdx] === true }));
    for (const p of per) if (!p.atFire && !p.cl.unknown) demoted.push(p.cl.label);

    const replayable = per.filter(p => p.atFire && !p.cl.unknown);
    for (const p of replayable) {
      let lf = -1;
      for (let i = fireIdx; i >= 0; i--) if (!st.truth[p.i][i]) { lf = i; break; }
      p.lastFalseTs = lf >= 0 ? st.ts[lf] : null;   // null=从未假
      let ft = -1;
      for (let i = 0; i <= fireIdx; i++) if (st.truth[p.i][i]) { ft = i; break; }
      p.firstTrueTs = ft >= 0 ? st.ts[ft] : null;
    }
    // binding：lastFalse 最晚者恒为 binder；翻真→fire 余量=engine 侧（含 tick 空窗）
    const withLf = replayable.filter(p => p.lastFalseTs != null);
    let binder = null, tie = [];
    if (withLf.length) {
      const maxLf = Math.max(...withLf.map(p => p.lastFalseTs));
      tie = withLf.filter(p => p.lastFalseTs === maxLf);
      binder = tie[0];
    }
    let binderLabel, binderKind;
    if (binder) { binderLabel = binder.cl.label; binderKind = 'replay'; }
    else {
      const unknowns = exp.clauses.filter(cl => cl.unknown || demoted.includes(cl.label));
      if (unknowns.length === 1) { binderLabel = unknowns[0].label; binderKind = 'elimination'; }
      else if (unknowns.length > 1) { binderLabel = `unknown(${unknowns.length}臂)`; binderKind = 'elimination-multi'; }
      else { binderLabel = '(engine 侧延迟——全部子句重放窗内从未假)'; binderKind = 'none'; }
    }
    const postFlipGapS = binder ? +((ep.fireTs - binder.lastFalseTs) / 1000).toFixed(1) : null;
    // engine 侧形状补充：fire 前 1h BUY 信号重发（执行失败重试/重复 fire）
    let sigBurst = null;
    if (binderKind === 'none') {
      const sigs = (sigMap.get(ep.expId + ':' + ep.token) || []).filter(s => { const ts = Date.parse(s.created_at); return ts <= ep.fireTs && ts >= ep.fireTs - 3600000; });
      if (sigs.length > 1) sigBurst = { count: sigs.length, firstOffS: +((ep.fireTs - Date.parse(sigs[0].created_at)) / 1000).toFixed(1) };
    }
    // 独拦时长 = fire − 其余 replayable lastFalse 最大值
    const others = replayable.filter(p => p !== binder);
    const secondLf = others.map(p => p.lastFalseTs).filter(v => v != null);
    const base = secondLf.length ? Math.max(...secondLf) : st.ts[0];
    const soleBlockSec = Math.max(0, (ep.fireTs - base) / 1000);

    // 反事实：去掉 binder（tie 只去 tie[0]，保守）后全真首点
    let cfIdx = -1;
    for (let i = 0; i <= fireIdx; i++) {
      const ok = replayable.filter(p => p !== binder).every(p => st.truth[p.i][i]);
      if (ok) { cfIdx = i; break; }
    }
    const pFire = st.price[fireIdx], pCf = cfIdx >= 0 ? st.price[cfIdx] : null;
    const cfDelaySec = cfIdx >= 0 ? (ep.fireTs - st.ts[cfIdx]) / 1000 : null;
    const driftPct = pCf > 0 ? (pFire - pCf) / pCf * 100 : null;

    // ΔPnL 一阶（episode 整段）；双基准：pFire=纯等待期价差（主），pAct=含入场冲击（参考）
    let buyBnb = 0, tokens = 0, proceeds = 0, soldTokens = 0;
    for (const t of ep.trades) {
      if (t.trade_direction === 'buy') { buyBnb += Number(t.input_amount); tokens += Number(t.output_amount); }
      else { proceeds += Number(t.output_amount); soldTokens += Number(t.input_amount); }
    }
    const openQty = tokens - soldTokens;
    const lastP = st.price[st.price.length - 1] || pFire;
    let deltaFire = null, deltaAct = null, exitValue = null;
    if (tokens > 0 && buyBnb > 0) {
      const vpt = (proceeds + openQty * lastP) / tokens;
      exitValue = +(tokens * vpt).toFixed(6);
      if (pCf > 0 && pFire > 0) deltaFire = +(vpt * buyBnb * (1 / pCf - 1 / pFire)).toFixed(6);
      const pAct = buyBnb / tokens;
      if (pCf > 0) deltaAct = +(vpt * buyBnb * (1 / pCf - 1 / pAct)).toFixed(6);
    }
    const execGapSec = (ep.startTs - ep.fireTs) / 1000;
    execLat.push(execGapSec);

    // rating binding 分解
    let ratingDecomp = null;
    if (/narrativeRating/.test(binderLabel)) {
      const rounds = (roundsMap.get(ep.expId + ':' + ep.token) || []).slice().sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
      const firstStart = rounds.length ? Date.parse(rounds[0].started_at) : null;
      const ready = rounds.length ? Math.max(...rounds.filter(r => r.completed_at).map(r => Date.parse(r.completed_at))) : null;
      ratingDecomp = {
        triggerFirstTrue: st.triggerTrue, firstStart, ready,
        preTriggerWaitS: st.triggerTrue && firstStart ? +((firstStart - st.triggerTrue) / 1000).toFixed(1) : null,
        analysisDurS: firstStart && ready ? +((ready - firstStart) / 1000).toFixed(1) : null,
        postReadyWaitS: ready ? +((ep.fireTs - ready) / 1000).toFixed(1) : null,
      };
    }

    const agg = clauseAgg.get(binderLabel) || { n: 0, sole: [], delta: [], drift: [], cf: [] };
    agg.n++; agg.sole.push(+soleBlockSec.toFixed(1)); if (deltaFire != null) agg.delta.push(deltaFire);
    if (driftPct != null) agg.drift.push(+driftPct.toFixed(1)); if (cfDelaySec != null) agg.cf.push(+cfDelaySec.toFixed(1));
    clauseAgg.set(binderLabel, agg);

    detail.push({
      exp: exp.name, expId: ep.expId, token: ep.token, symbol: ep.symbol, fire: new Date(ep.fireTs).toISOString().slice(5, 19),
      repeatIdx: ep.repeatIdx, buyBnb: +buyBnb.toFixed(4), exitValue,
      binder: binderLabel, kind: binderKind, soleBlockSec: +soleBlockSec.toFixed(1), postFlipGapS,
      sigBurst,
      cfDelaySec: cfDelaySec != null ? +cfDelaySec.toFixed(1) : null, pFire, pCf,
      driftPct: driftPct != null ? +driftPct.toFixed(1) : null, deltaFire, deltaAct, execGapSec: +execGapSec.toFixed(1),
      clauseInfo: exp.clauses.map((cl, i) => {
        const p = replayable.find(q => q.i === i);
        return {
          label: cl.label,
          atFire: st.truth[i][fireIdx] === true,
          lastFalseOffS: p && p.lastFalseTs != null ? +((ep.fireTs - p.lastFalseTs) / 1000).toFixed(1) : null,
        };
      }),
      demoted: demoted.length ? demoted.join('|') : undefined, tie: tie.length > 1 ? tie.map(p => p.cl.label).join('|') : undefined,
      replayAllTrueDriftS: st.replayAllTrue ? +((ep.fireTs - st.replayAllTrue) / 1000).toFixed(1) : 'never',
      ratingDecomp, open: ep.open,
    });
  }

  // [8] 汇总（Δ>0 = 等待付出代价；Δ<0 = 等待省钱）
  const med = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
  const printAgg = (rows, title) => {
    console.log(`\n═══ ${title} ═══`);
    console.log('binding 子句 | n | 独拦中位/最大 s | 可提早中位 s | 等待期价涨中位% | ΣΔFire(BNB, 正=代价) | 代价票/省钱票');
    const entries = [...clauseAgg.entries()].filter(([l, a]) => rows.some(d => d.binder === l));
    for (const [label, a] of entries.sort((x, y) => (y[1].delta.reduce((s, v) => s + v, 0) || 0) - (x[1].delta.reduce((s, v) => s + v, 0) || 0))) {
      const sum = a.delta.reduce((s, v) => s + v, 0);
      console.log(`${label} | ${a.n} | ${med(a.sole)}/${Math.max(...a.sole, 0)} | ${med(a.cf) ?? '-'} | ${med(a.drift) ?? '-'}% | ${sum.toFixed(4)} | ${a.delta.filter(v => v > 0).length}/${a.delta.filter(v => v < 0).length}`);
    }
  };
  printAgg(detail.filter(d => /v4[0-3]-/.test(d.exp)), '[A1] binding 聚合——clean 子集 v40+（现行 roster，全部子句可重放）');
  printAgg(detail, '[A2] binding 聚合——全部 6 天');
  console.log(`\n═══ [B] fire→exec 延迟（debounce+GMGN+链上，条件串外）: 中位=${med(execLat)}s p90=${execLat.length ? execLat.slice().sort((a, b) => a - b)[Math.floor(execLat.length * 0.9)] : '-'}s`);
  console.log(`\n═══ [C] 明细（ΣΔFire 降序，正=等待代价大）═══`);
  for (const d of detail.slice().sort((a, b) => (b.deltaFire ?? 0) - (a.deltaFire ?? 0)))
    console.log(`${d.exp?.slice(0, 20)} ${d.symbol || (d.token || '').slice(0, 8)}${d.repeatIdx ? `(rep${d.repeatIdx})` : ''} fire=${d.fire || '-'} binder=${(d.binder || d.bucket || '')}${d.tie ? '(tie:' + d.tie + ')' : ''} 独拦=${d.soleBlockSec}s postFlip=${d.postFlipGapS ?? '?'}s${d.sigBurst ? ` sigBurst=${d.sigBurst.count}/${d.sigBurst.firstOffS}s` : ''} 可提早=${d.cfDelaySec}s 价${d.pFire ?? '?'}→${d.pCf ?? '?'}(${d.driftPct ?? '?'}%) ΔF=${d.deltaFire ?? '?'} ΔA=${d.deltaAct ?? '?'} execGap=${d.execGapSec ?? '?'}s${d.demoted ? ' DEMOTED:' + d.demoted : ''}${d.ratingDecomp ? ' rating分解:' + JSON.stringify(d.ratingDecomp) : ''}${d.open ? ' OPEN' : ''}`);
  require('fs').writeFileSync(OUT_JSON, JSON.stringify({ detail, clauseAgg: Object.fromEntries([...clauseAgg.entries()].map(([k, v]) => [k, v])) }, null, 1));
  console.log(`\n明细 JSON → ${OUT_JSON}`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
