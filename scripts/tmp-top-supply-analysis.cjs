#!/usr/bin/env node
// top1/top2 持仓门分母口径分析（182 跑）：近 N 天 live 实验候选票（BUY+OBSERVE）逐票重放
// 早期窗（marketCap 6.0-6.7 BNB），双口径对照——
//   circ 口径 top1C/top2C（现行键分母 _circDen=max(circ,Σ正净)，FA 对拍）
//   supply 口径 top1S/top2S（分母 totalSupply，fourmeme 取 payload、flap 恒 1e9）
// 窗内每 tick 决策原料全量落 JSON（含 otherOk=早期臂剔 top1/top2 门后其余子句真值），
// 阈值网格在本地对 JSON 重放。结局=进窗价起 30min 价格轨迹 maxUp/maxDown + 实际 trades pnl。
// 用法：node scripts/tmp-top-supply-analysis.cjs [--days 3] [--out /tmp/top-supply.json]
require('/home/ubuntu/richer-js/node_modules/dotenv').config({ path: '/home/ubuntu/richer-js/config/.env' });
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');
const { ConditionEvaluator } = require('/home/ubuntu/richer-js/src/strategies/ConditionEvaluator');
const Mod = require('/home/ubuntu/richer-js/src/services/FourMemeFactorAggregator');
const FA = Mod.default || Mod;

const argv = process.argv.slice(2);
const argStr = (n) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
const DAYS = Number(argStr('--days') || 3);
const OUT = argStr('--out') || '/tmp/top-supply.json';
const V52 = 'bc77ac6c-f455-492a-9895-34e32581d57d';
const MIN_TICK_BNB = 0.001;
const WIN_LO = 6.0, WIN_HI = 6.7;
const REPLAY_MS = 720000;      // 早期臂 600s + 缓冲
const OUTCOME_MS = 2400000;    // 结局观察窗 40min

const ev = new ConditionEvaluator();
const c = dbManager.getClient();

function splitConjuncts(ast) {
  const out = [];
  (function walk(n) {
    if (n && n.type === 'AND') { walk(n.left); walk(n.right); }
    else out.push(n);
  })(ast);
  return out;
}

(async () => {
  await Promise.all([FA.loadSybilClusters(), FA.loadCopyWalletRoster(), FA.loadFamousCopyWallets()]);
  const cutoff = new Date(Date.now() - DAYS * 86400000).toISOString();

  // [1] live 实验
  const { data: expRows, error: e1 } = await c.from('experiments')
    .select('id,experiment_name').eq('trading_mode', 'live').gte('created_at', cutoff);
  if (e1) throw new Error('experiments: ' + e1.message);
  const expIds = expRows.map(e => e.id);
  console.log(`[1] live 实验 ${expIds.length} 个（${cutoff.slice(0, 16)} 起）: ${expRows.map(e => e.experiment_name).join(', ')}`);

  // [2] signals（BUY+OBSERVE，created_at 锚分页：id 是 uuid 无序，回退 2s 重叠窗 + id 去重）
  const sigs = []; const seenSig = new Set();
  let anchorTs = Date.parse(cutoff) - 86400000;
  for (let p = 0; p < 40; p++) {
    const { data, error } = await c.from('strategy_signals')
      .select('id,experiment_id,token_address,signal_type,created_at,metadata')
      .in('experiment_id', expIds).in('signal_type', ['BUY', 'OBSERVE'])
      .gt('created_at', new Date(anchorTs).toISOString()).order('created_at').limit(1000);
    if (error) throw new Error('signals: ' + error.message);
    for (const s of data) if (!seenSig.has(s.id)) { seenSig.add(s.id); sigs.push(s); }
    if (data.length < 1000) break;
    anchorTs = Date.parse(data[data.length - 1].created_at) - 2000;
  }
  const tokens = new Map(); // token -> {exps:Set, fires:[{ts,leg}], obs:[ts]}
  for (const s of sigs) {
    const t = tokens.get(s.token_address) || { exps: new Set(), fires: [], obs: [] };
    t.exps.add(s.experiment_id);
    if (s.signal_type === 'BUY') t.fires.push({ ts: Date.parse(s.created_at), leg: (s.metadata && s.metadata.strategyId) || '' });
    else t.obs.push(Date.parse(s.created_at));
    tokens.set(s.token_address, t);
  }
  for (const t of tokens.values()) { t.fires.sort((a, b) => a.ts - b.ts); t.obs.sort((a, b) => a.ts - b.ts); }
  console.log(`[2] signals=${sigs.length}（BUY=${sigs.filter(s => s.signal_type === 'BUY').length}/OBSERVE=${sigs.filter(s => s.signal_type === 'OBSERVE').length}）候选票=${tokens.size}`);

  // [3] trades pnl（per exp:token）
  const { data: tradeRows, error: e3 } = await c.from('trades')
    .select('experiment_id,token_address,trade_direction,input_amount,output_amount,created_at,executed_at,success')
    .in('experiment_id', expIds).eq('success', true).limit(5000);
  if (e3) throw new Error('trades: ' + e3.message);
  const pnlMap = new Map(); // token -> [{exp, pnlBnb, buyBnb, sellBnb, open, lastTs}]
  for (const [exp, grp] of Object.entries(tradeRows.reduce((m, t) => {
    (m[t.experiment_id + ':' + t.token_address] = m[t.experiment_id + ':' + t.token_address] || []).push(t); return m;
  }, {}))) {
    grp.sort((a, b) => Date.parse(a.executed_at || a.created_at) - Date.parse(b.executed_at || b.created_at));
    let buyBnb = 0, sellBnb = 0, qty = 0;
    for (const t of grp) {
      if (t.trade_direction === 'buy') { buyBnb += Number(t.input_amount); qty += Number(t.output_amount); }
      else { sellBnb += Number(t.output_amount); qty -= Number(t.input_amount); }
    }
    const tok = grp[0].token_address;
    const arr = pnlMap.get(tok) || [];
    arr.push({ exp, pnlBnb: sellBnb - buyBnb, buyBnb, sellBnb, open: qty > 1e-9, lastTs: Date.parse(grp[grp.length - 1].executed_at || grp[grp.length - 1].created_at) });
    pnlMap.set(tok, arr);
  }

  // [4] 早期臂条件（v52 buyStrategies[1]，剔 top1/top2 门 → otherOk）
  const { data: v52, error: e4 } = await c.from('experiments').select('config').eq('id', V52).single();
  if (e4) throw new Error('v52: ' + e4.message);
  const earlyCond = v52.config.strategiesConfig.buyStrategies[1].condition;
  const isTopGate = (ast) => ast && ast.type === 'COMPARISON' && (ast.left === 'top1HolderCircPct' || ast.left === 'top2HolderCircPct');
  const otherAsts = splitConjuncts(ev.parseCondition(earlyCond)).filter(ast => !isTopGate(ast));
  console.log(`[4] 早期臂子句（剔 top1/top2 后 otherOk 共 ${otherAsts.length} 个子句）`);

  // [5] 逐票重放
  const fa = new FA({});
  const out = []; let mismatch = 0, noAnchor = 0, noTicks = 0;
  for (const [token, info] of tokens.entries()) {
    const { data: evRows, error } = await c.from('wss_events')
      .select('token_address,platform,payload,block_time').eq('kind', 'token_create').eq('token_address', token).limit(5);
    if (error || !evRows.length) { noAnchor++; continue; }
    const a = evRows[0];
    const anchorMs = Number(a.payload && a.payload.blockTimeMs) || Date.parse(a.block_time);
    const supply = Number(a.payload && a.payload.totalSupply) || (a.platform === 'fourmeme' ? 0 : 1e9);
    if (!supply) { noAnchor++; continue; }

    const { data: rounds } = await c.from('narrative_analysis_rounds')
      .select('round_no,completed_at,rating').eq('token_address', token).order('completed_at').limit(30);
    const r1 = rounds && rounds.find(r => r.rating !== null && r.rating !== undefined);
    const ratingReadyMs = r1 ? Date.parse(r1.completed_at) : null;
    const rating = r1 ? r1.rating : null;

    // ticks：create-60s ~ create+40min（重放只喂前 720s；结局吃全程价格）
    const rows = [];
    let tid = 0;
    for (let p = 0; p < 80; p++) {
      const { data, error: te } = await c.from('wss_price_ticks')
        .select('id,block_time,block_number,log_index,trade_type,trader_address,sender_address,token_amount,bnb_amount,price_bnb')
        .eq('token_address', token)
        .gte('block_time', new Date(anchorMs - 60000).toISOString()).lte('block_time', new Date(anchorMs + OUTCOME_MS).toISOString())
        .gt('id', tid).limit(4000);
      if (te) throw new Error('ticks: ' + te.message);
      rows.push(...data);
      if (data.length < 4000) break;
      tid = data[data.length - 1].id;
    }
    if (!rows.length) { noTicks++; continue; }
    rows.sort((x, y) => x.block_number - y.block_number || x.log_index - y.log_index);

    // 重放：FA + 自维护 walletNet（wallet=sender||trader）
    fa.registerToken(token, { createdAtMs: anchorMs, totalSupply: supply, platform: a.platform });
    const nets = new Map(); let circ = 0, sumPos = 0;
    const winTicks = [];
    let fireFirst = info.fires[0] || null;
    let fireSnap = null;
    for (const t of rows) {
      const ts = Date.parse(t.block_time);
      if (ts > anchorMs + REPLAY_MS) break;
      const wallet = (t.sender_address || t.trader_address || '').toLowerCase();
      const amt = Number(t.token_amount) || 0;
      const isBuy = t.trade_type === 'buy';
      // 价格轨迹外的账本维护也吃尘门口径（与 FA 一致：尘 tick 不进因子）
      if (Number(t.bnb_amount) >= MIN_TICK_BNB) {
        const prev = nets.get(wallet) || 0;
        const next = prev + (isBuy ? amt : -amt);
        nets.set(wallet, next);
        if (prev > 0) sumPos -= prev;
        if (next > 0) sumPos += next;
        circ += isBuy ? amt : -amt;

        fa.processTick({ token_address: token, platform: a.platform, timestamp: ts, block_number: t.block_number, log_index: t.log_index,
          trader_address: t.trader_address, sender_address: t.sender_address, trade_type: t.trade_type,
          token_amount: amt, bnb_amount: Number(t.bnb_amount || 0), price_bnb: Number(t.price_bnb || 0) }, { emitFactors: false });
        const f = fa.buildFactorMap(token, ts) || {};
        let top1Net = 0, top2Net = 0;
        for (const v of nets.values()) { if (v > top1Net) { top2Net = top1Net; top1Net = v; } else if (v > top2Net) top2Net = v; }
        const circDen = Math.max(circ, sumPos);
        const myTop1C = circDen > 0 ? top1Net / circDen * 100 : 0;
        const myTop2C = circDen > 0 ? (top1Net + top2Net) / circDen * 100 : 0;
        const top1S = top1Net / supply * 100;
        const top2S = (top1Net + top2Net) / supply * 100;
        if (Math.abs((f.top1HolderCircPct || 0) - myTop1C) > 0.6) mismatch++;
        const f2 = { ...f, narrativeRating: (ratingReadyMs && ts >= ratingReadyMs) ? rating : null };
        let otherOk = true;
        for (const ast of otherAsts) { if (!ev.evaluate(ast, f2)) { otherOk = false; break; } }
        const inWin = f.marketCap > WIN_LO && f.marketCap < WIN_HI;
        if (inWin) winTicks.push({ ts, mc: f.marketCap, price: f.currentPriceBnb || Number(t.price_bnb) || 0,
          top1C: +f.top1HolderCircPct?.toFixed(1), top2C: +f.top2HolderCircPct?.toFixed(1),
          myT1C: +myTop1C.toFixed(1), myT2C: +myTop2C.toFixed(1),
          top1S: +top1S.toFixed(2), top2S: +top2S.toFixed(2),
          holders: f.holders, bvb: f.buyVolumeBnb, nbs: f.tradesNetBuyRatioShortWin, nbl: f.tradesNetBuyRatioLongWin, otherOk });
        if (fireFirst && !fireSnap && ts >= fireFirst.ts) {
          fireSnap = { ts, top1S: +top1S.toFixed(2), top2S: +top2S.toFixed(2), top1C: +f.top1HolderCircPct?.toFixed(1), top2C: +f.top2HolderCircPct?.toFixed(1), mc: f.marketCap, leg: fireFirst.leg };
        }
      }
    }

    // 结局：价格轨迹（全程含尘）
    const track = rows.filter(r => Number(r.price_bnb) > 0).map(r => ({ ts: Date.parse(r.block_time), p: Number(r.price_bnb) }));
    let outcome = null;
    const ref = winTicks.length ? winTicks[0] : null;
    if (ref && ref.price > 0) {
      const seg = track.filter(x => x.ts >= ref.ts && x.ts <= ref.ts + 1800000);
      if (seg.length) {
        const mx = Math.max(...seg.map(x => x.p)), mn = Math.min(...seg.map(x => x.p));
        outcome = { refPrice: ref.price, maxUpPct: +((mx / ref.price - 1) * 100).toFixed(1), maxDownPct: +((mn / ref.price - 1) * 100).toFixed(1) };
      }
    }

    out.push({
      token, platform: a.platform, symbol: (a.payload && a.payload.symbol) || '', create: anchorMs, supply,
      rating, ratingReadyMs, fires: info.fires, obsN: info.obs.length,
      pnl: (pnlMap.get(token) || []).map(x => ({ exp: x.exp.slice(0, 8), pnlBnb: +x.pnlBnb.toFixed(4), open: x.open })),
      neverInWin: winTicks.length === 0,
      winFirstTs: winTicks.length ? winTicks[0].ts : null, winLastTs: winTicks.length ? winTicks[winTicks.length - 1].ts : null,
      winTicks, fireSnap, outcome,
    });
  }

  // [6] 摘要输出
  console.log(`\n[6] 票=${out.length} 无锚=${noAnchor} 无tick=${noTicks} circ对拍偏差(>0.6pp)=${mismatch}`);
  console.log(`有窗票=${out.filter(t => !t.neverInWin).length} 从未进窗=${out.filter(t => t.neverInWin).length}`);
  const fmtTs = (ms) => ms ? new Date(ms).toISOString().slice(11, 19) : '-';
  console.log('\ntoken       plat rating pnl(open)         winN 窗首   minT1S minT2S maxT1S maxT2S fireT1S fireT2S  up%    dn%');
  for (const t of out.sort((a, b) => (a.neverInWin ? 1 : 0) - (b.neverInWin ? 1 : 0) || (b.winTicks.length || 0) - (a.winTicks.length || 0))) {
    const w = t.winTicks;
    if (!w.length) { console.log(`${t.token.slice(0, 10)} ${t.platform.slice(0, 4)} ${t.rating}      ${t.pnl.map(x => x.pnlBnb + (x.open ? '开' : '')).join('/') || '-'} 从未进窗`); continue; }
    const mn1 = Math.min(...w.map(x => x.top1S)), mx1 = Math.max(...w.map(x => x.top1S));
    const mn2 = Math.min(...w.map(x => x.top2S)), mx2 = Math.max(...w.map(x => x.top2S));
    console.log(`${t.token.slice(0, 10)} ${t.platform.slice(0, 4)} ${t.rating}    ${(t.pnl.map(x => x.pnlBnb + (x.open ? '开' : '')).join('/') || '-').padEnd(12)} ${String(w.length).padStart(3)} ${fmtTs(t.winFirstTs)} ${String(mn1).padStart(6)} ${String(mn2).padStart(6)} ${String(mx1).padStart(6)} ${String(mx2).padStart(6)} ${String(t.fireSnap ? t.fireSnap.top1S : '-').padStart(6)} ${String(t.fireSnap ? t.fireSnap.top2S : '-').padStart(6)} ${String(t.outcome ? t.outcome.maxUpPct : '-').padStart(6)} ${String(t.outcome ? t.outcome.maxDownPct : '-').padStart(6)}`);
  }
  require('fs').writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), days: DAYS, mismatch, out }));
  console.log(`\nJSON -> ${OUT}`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
