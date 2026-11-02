#!/usr/bin/env node
// v47（0b08a8d8）四票买腿迟滞归因（182 跑）：基于 tmp-buy-delay-attribution.cjs 改造——
//   ① 多买腿支持（v47 两腿：主腿 buy_0_* + 早期臂 buy_1_*，fire 信号 metadata.strategyId 定腿）
//   ② T88 键名断代映射：v47 条件串是 T88 改名前快照（tradesNetBuyRatio/Win），
//      当前 FA 只发 LongWin/ShortWin —— Win→ShortWin 语义全等（仅改名）、
//      全史→LongWin 在 n<100 笔时 bit 一致（四票 fire 时票龄 <600s，n 远小于 100）
//   ③ GMGN 拒绝窗口统计：firstFire→fire 之间 gmgn_check_failed 次数
//   ④ 延迟分解链：tokenCreate → condReady(binder) → firstFire → fire → exec
require('/home/ubuntu/richer-js/node_modules/dotenv').config({ path: '/home/ubuntu/richer-js/config/.env' });
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');
const { ConditionEvaluator } = require('/home/ubuntu/richer-js/src/strategies/ConditionEvaluator');
const Mod = require('/home/ubuntu/richer-js/src/services/FourMemeFactorAggregator');
const FA = Mod.default || Mod;

const argv = process.argv.slice(2);
const argStr = (n) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
const DAYS = Number(argStr('--days') || 2);
const TICK_CAP = Number(argStr('--tick-cap') || 40000);
const EXP_FILTER = argStr('--exp');
const OUT_JSON = argStr('--out') || '/tmp/buydelay-v47.json';
const DEBUG_TAIL = Number(argStr('--debug-tail') || 0);
const MIN_TICK_BNB = 0.001;

const ev = new ConditionEvaluator();
const c = dbManager.getClient();

// T88 断代映射（v47 快照旧键 → 当前 FA 键）
const mapT88 = (s) => s
  .replace(/tradesNetBuyRatioWin/g, 'tradesNetBuyRatioShortWin')
  .replace(/tradesNetBuyRatio(?!LongWin|ShortWin)/g, 'tradesNetBuyRatioLongWin');

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

  // [1] live 实验 + 全部条件腿（多腿）
  const cutoff = new Date(Date.now() - DAYS * 86400000).toISOString();
  const { data: expRows, error: e1 } = await c.from('experiments')
    .select('id,experiment_name,config,created_at').eq('trading_mode', 'live').gte('created_at', cutoff);
  if (e1) throw new Error('experiments: ' + e1.message);
  const legs = [];   // {expId, expName, idPrefix, clauses, triggerAst, hasRepeatCond}
  for (const e of expRows) {
    if (EXP_FILTER && !e.id.startsWith(EXP_FILTER)) continue;
    const buyLegs = (e.config && e.config.strategiesConfig && e.config.strategiesConfig.buyStrategies) || [];
    buyLegs.forEach((leg, idx) => {
      if (!leg || !leg.condition) return;
      let conj;
      try { conj = splitConjuncts(ev.parseCondition(mapT88(leg.condition))); } catch (err) { console.log(`[skip] ${e.experiment_name} leg${idx} 解析失败 ${err.message}`); return; }
      const clauses = conj.map(ast => ({
        ast, label: unparse(ast),
        unknown: [...factorsOf(ast)].some(f => !knownKeys.has(f)),
        unknownFactors: [...factorsOf(ast)].filter(f => !knownKeys.has(f)),
      }));
      legs.push({
        expId: e.id, expName: e.experiment_name, idx, idPrefix: `buy_${idx}_`,
        desc: (leg.description || '').slice(0, 40), clauses,
        triggerAst: leg.narrativeTriggerCondition ? ev.parseCondition(leg.narrativeTriggerCondition) : null,
        hasRepeatCond: !!leg.repeatBuyCheckCondition,
      });
    });
  }
  console.log(`[1] live 实验窗 ${cutoff.slice(0, 16)} 起：${legs.length} 条件腿`);
  for (const l of legs) console.log(`    ${l.expName} leg${l.idx}(${l.idPrefix}${l.desc}) 子句=${l.clauses.length} 未知因子子句=${l.clauses.filter(k => k.unknown).map(k => k.label).join(' | ') || '无'}`);

  // [2] 成功 trades → episodes
  const expIds = [...new Set(legs.map(l => l.expId))];
  const { data: tradeRows, error: e2 } = await c.from('trades')
    .select('id,experiment_id,token_address,token_symbol,trade_direction,input_amount,output_amount,created_at,executed_at,success')
    .in('experiment_id', expIds).gte('created_at', cutoff).order('created_at').limit(5000);
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
    for (const [i, ep] of buildEpisodes(ts).entries()) episodes.push({ expId, token, symbol: ts[0].token_symbol, repeatIdx: i, ...ep });
  }
  console.log(`[2] episodes=${episodes.length}（open=${episodes.filter(e => e.open).length}）`);

  // [3] fire 锚 + 腿定位 + firstFire/GMGN 窗
  const { data: sigRows, error: e3 } = await c.from('strategy_signals')
    .select('id,experiment_id,token_address,created_at,metadata')
    .eq('signal_type', 'BUY').in('experiment_id', expIds)
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
      return ts <= ep.startTs + 2000 && ts >= ep.startTs - 1800000;
    });
    ep.fireSig = sigs.length ? sigs[sigs.length - 1] : null;
    ep.fireTs = ep.fireSig ? Date.parse(ep.fireSig.created_at) : null;
    // 腿定位：fire 信号 strategyId 前缀
    const sid = ep.fireSig && ep.fireSig.metadata && ep.fireSig.metadata.strategyId;
    ep.leg = sid ? legs.find(l => sid.startsWith(l.idPrefix)) : null;
    if (!ep.leg && legs.length) ep.leg = legs.find(l => l.expId === ep.expId && l.idx === 0) || null;
    // firstFire + GMGN 拒绝窗（同腿）
    const sameLeg = sigs.filter(s => (s.metadata && s.metadata.strategyId || sid || '').startsWith(ep.leg ? ep.leg.idPrefix : 'buy_'));
    ep.firstFireTs = sameLeg.length ? Date.parse(sameLeg[0].created_at) : null;
    ep.gmgnFails = sameLeg.filter(s => s.metadata && s.metadata.execution_reason && String(s.metadata.execution_reason).startsWith('gmgn_check_failed')).length;
    ep.gmgnFailWindowS = ep.firstFireTs && ep.fireTs && ep.gmgnFails ? +((ep.fireTs - ep.firstFireTs) / 1000).toFixed(1) : null;
  }
  const noSig = episodes.filter(e => !e.fireTs);
  if (noSig.length) console.log(`    无信号锚剔除 ${noSig.length}: ${noSig.map(e => e.symbol).join(',')}`);

  // [4] narrative rounds 时间线
  const roundsMap = new Map();
  const toks = [...new Set(episodes.filter(e => e.fireTs).map(e => e.token))];
  for (const expId of expIds) {
    const et = [...new Set(episodes.filter(e => e.fireTs && e.expId === expId).map(e => e.token))];
    for (let i = 0; i < et.length; i += 50) {
      const { data, error } = await c.from('narrative_analysis_rounds')
        .select('token_address,round_no,started_at,completed_at,rating,from_cache,error')
        .eq('experiment_id', expId).in('token_address', et.slice(i, i + 50)).order('started_at').limit(2000);
      if (error) throw new Error('rounds: ' + error.message);
      for (const r of data) {
        const k = expId + ':' + r.token_address;
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
  for (let i = 0; i < toks.length; i += 50) {
    const { data, error } = await c.from('wss_events')
      .select('token_address,platform,payload,block_time').eq('kind', 'token_create')
      .in('token_address', toks.slice(i, i + 50)).order('block_time').limit(1000);
    if (error) throw new Error('anchors: ' + error.message);
    for (const r of data) {
      if (anchors.has(r.token_address)) continue;
      const a = { anchorMs: Number(r.payload && r.payload.blockTimeMs) || Date.parse(r.block_time), platform: r.platform || 'fourmeme', supply: Number(r.payload && r.payload.totalSupply) || 0 };
      if (!a.supply) a.supply = a.platform === 'fourmeme' ? 0 : 1e9;
      anchors.set(r.token_address, a);
    }
  }

  // [6] 逐 token 重放
  for (const token of toks) {
    const a = anchors.get(token);
    const eps = episodes.filter(e => e.token === token && e.fireTs).sort((x, y) => x.fireTs - y.fireTs);
    if (!a || !a.anchorMs || !a.supply) { eps.forEach(e => e.noAnchor = true); continue; }
    const winEnd = Math.max(...eps.map(e => e.fireTs)) + 90000;
    let ticks = await pullTicks(token, a.anchorMs - 60000, winEnd);
    if (ticks.length > TICK_CAP) { console.log(`    WARN ${token} ticks>${TICK_CAP} 截断`); ticks = ticks.slice(0, TICK_CAP); }
    const fa = new FA({});
    fa.registerToken(token, { createdAtMs: a.anchorMs, totalSupply: a.supply, platform: a.platform });
    for (const ep of eps) ep._st = { ts: [], price: [], truth: ep.leg.clauses.map(() => []), replayAllTrue: null, triggerTrue: null };
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
        const st = ep._st;
        st.ts.push(ts); st.price.push(lastPrice);
        const f2 = { ...f, narrativeRating: ratingAt(ep, ts) };
        let all = true;
        ep.leg.clauses.forEach((cl, i) => { const v = !!ev.evaluate(cl.ast, f2); st.truth[i].push(v); if (!v) all = false; });
        if (all && !st.replayAllTrue) st.replayAllTrue = ts;
        if (ep.leg.triggerAst && !st.triggerTrue && ev.evaluate(ep.leg.triggerAst, f2)) st.triggerTrue = ts;
      }
    }
    console.log(`    重放 ${token.slice(0, 10)} ticks=${ticks.length}`);
  }

  // [7] 逐 episode 归因 + 延迟分解链
  const detail = [];
  let execLat = [];
  for (const ep of episodes.filter(e => e.fireTs)) {
    const a = anchors.get(ep.token);
    if (!a || !a.anchorMs || !a.supply) { detail.push({ exp: ep.leg.expName, token: ep.token, symbol: ep.symbol, bucket: 'no-anchor' }); continue; }
    const st = ep._st;
    const fireIdx = (() => { let i = st.ts.length - 1; while (i >= 0 && st.ts[i] > ep.fireTs) i--; return i; })();
    if (fireIdx < 0) { detail.push({ exp: ep.leg.expName, token: ep.token, symbol: ep.symbol, bucket: 'fire-前无ticks' }); continue; }
    if (DEBUG_TAIL > 0) {
      console.log(`\n[dbg] ${ep.symbol} fire=${new Date(ep.fireTs).toISOString().slice(5, 19)} fireIdx=${fireIdx}/${st.ts.length}`);
      for (let i = Math.max(0, fireIdx - DEBUG_TAIL + 1); i <= fireIdx; i++) {
        const falses = ep.leg.clauses.filter((cl, j) => !st.truth[j][i]).map(cl => cl.label);
        console.log(`  ${((st.ts[i] - ep.fireTs) / 1000).toFixed(1)}s price=${st.price[i]} ${falses.length ? 'FALSE:' + falses.join('|') : 'ALL-TRUE'}`);
      }
    }
    const demoted = [];
    const per = ep.leg.clauses.map((cl, i) => ({ cl, i, atFire: st.truth[i][fireIdx] === true }));
    for (const p of per) if (!p.atFire && !p.cl.unknown) demoted.push(p.cl.label);
    const replayable = per.filter(p => p.atFire && !p.cl.unknown);
    for (const p of replayable) {
      let lf = -1;
      for (let i = fireIdx; i >= 0; i--) if (!st.truth[p.i][i]) { lf = i; break; }
      p.lastFalseTs = lf >= 0 ? st.ts[lf] : null;
      let ft = -1;
      for (let i = 0; i <= fireIdx; i++) if (st.truth[p.i][i]) { ft = i; break; }
      p.firstTrueTs = ft >= 0 ? st.ts[ft] : null;
    }
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
      const unknowns = ep.leg.clauses.filter(cl => cl.unknown || demoted.includes(cl.label));
      if (unknowns.length === 1) { binderLabel = unknowns[0].label; binderKind = 'elimination'; }
      else if (unknowns.length > 1) { binderLabel = `unknown(${unknowns.length}臂)`; binderKind = 'elimination-multi'; }
      else { binderLabel = '(engine 侧延迟——全部子句重放窗内从未假)'; binderKind = 'none'; }
    }
    const others = replayable.filter(p => p !== binder);
    const secondLf = others.map(p => p.lastFalseTs).filter(v => v != null);
    const base = secondLf.length ? Math.max(...secondLf) : st.ts[0];
    const soleBlockSec = Math.max(0, (ep.fireTs - base) / 1000);
    let cfIdx = -1;
    for (let i = 0; i <= fireIdx; i++) {
      if (replayable.filter(p => p !== binder).every(p => st.truth[p.i][i])) { cfIdx = i; break; }
    }
    const pFire = st.price[fireIdx], pCf = cfIdx >= 0 ? st.price[cfIdx] : null;
    const cfDelaySec = cfIdx >= 0 ? (ep.fireTs - st.ts[cfIdx]) / 1000 : null;
    const driftPct = pCf > 0 ? (pFire - pCf) / pCf * 100 : null;
    let buyBnb = 0, tokens = 0, proceeds = 0, soldTokens = 0;
    for (const t of ep.trades) {
      if (t.trade_direction === 'buy') { buyBnb += Number(t.input_amount); tokens += Number(t.output_amount); }
      else { proceeds += Number(t.output_amount); soldTokens += Number(t.input_amount); }
    }
    const openQty = tokens - soldTokens;
    const lastP = st.price[st.price.length - 1] || pFire;
    let deltaFire = null;
    if (tokens > 0 && buyBnb > 0 && pCf > 0 && pFire > 0) {
      const vpt = (proceeds + openQty * lastP) / tokens;
      deltaFire = +(vpt * buyBnb * (1 / pCf - 1 / pFire)).toFixed(6);
    }
    const execGapSec = (ep.startTs - ep.fireTs) / 1000;
    execLat.push(execGapSec);
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
    detail.push({
      exp: ep.leg.expName, expId: ep.expId, leg: ep.leg.idPrefix, token: ep.token, symbol: ep.symbol,
      fire: new Date(ep.fireTs).toISOString().slice(5, 19), repeatIdx: ep.repeatIdx,
      buyBnb: +buyBnb.toFixed(4),
      // 延迟分解链
      createMs: a.anchorMs,
      condReadyOffS: st.replayAllTrue ? +((ep.fireTs - st.replayAllTrue) / 1000).toFixed(1) : 'never',
      firstFireOffS: ep.firstFireTs ? +((ep.fireTs - ep.firstFireTs) / 1000).toFixed(1) : null,
      gmgnFails: ep.gmgnFails, gmgnFailWindowS: ep.gmgnFailWindowS,
      binder: binderLabel, kind: binderKind, soleBlockSec: +soleBlockSec.toFixed(1),
      cfDelaySec: cfDelaySec != null ? +cfDelaySec.toFixed(1) : null,
      pFire, pCf, driftPct: driftPct != null ? +driftPct.toFixed(1) : null,
      deltaFire, execGapSec: +execGapSec.toFixed(1),
      clauseInfo: ep.leg.clauses.map((cl, i) => {
        const p = replayable.find(q => q.i === i);
        return { label: cl.label, atFire: st.truth[i][fireIdx] === true, lastFalseOffS: p && p.lastFalseTs != null ? +((ep.fireTs - p.lastFalseTs) / 1000).toFixed(1) : null };
      }),
      demoted: demoted.length ? demoted.join('|') : undefined,
      tie: tie.length > 1 ? tie.map(p => p.cl.label).join('|') : undefined,
      replayAllTrue: st.replayAllTrue ? new Date(st.replayAllTrue).toISOString().slice(5, 19) : 'never',
      ratingDecomp, open: ep.open,
    });
  }

  const med = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
  console.log(`\n═══ [B] fire→exec 延迟: 中位=${med(execLat)}s ═══`);
  console.log(`\n═══ [C] 明细（延迟分解链）═══`);
  for (const d of detail) {
    if (!d.fire) { console.log(`${d.symbol} bucket=${d.bucket}`); continue; }
    console.log(`\n${d.symbol} ${d.token.slice(0, 10)} leg=${d.leg} fire=${d.fire}`);
    console.log(`   binder=${d.binder}${d.tie ? ' (tie:' + d.tie + ')' : ''} [${d.kind}] 独拦=${d.soleBlockSec}s`);
    console.log(`   条件全真=fire−${d.condReadyOffS}s | firstFire=fire−${d.firstFireOffS}s | GMGN拒=${d.gmgnFails}次/窗${d.gmgnFailWindowS}s | 去臂可提早=${d.cfDelaySec}s`);
    console.log(`   价 pFire=${d.pFire} pCf=${d.pCf}(${d.driftPct ?? '?'}%) ΔF=${d.deltaFire} execGap=${d.execGapSec}s${d.demoted ? ' DEMOTED:' + d.demoted : ''}${d.ratingDecomp ? ' rating:' + JSON.stringify(d.ratingDecomp) : ''}`);
    const late = d.clauseInfo.filter(cl => cl.lastFalseOffS != null).sort((a, b) => a.lastFalseOffS - b.lastFalseOffS).slice(-6);
    for (const cl of late) console.log(`     翻真距fire ${String(cl.lastFalseOffS).padStart(7)}s  atFire=${cl.atFire ? 'Y' : 'N'}  ${cl.label}`);
  }
  require('fs').writeFileSync(OUT_JSON, JSON.stringify({ detail }, null, 1));
  console.log(`\n明细 JSON → ${OUT_JSON}`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
