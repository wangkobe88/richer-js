#!/usr/bin/env node
// 尾部低位买入 × 卖出策略研究（用户直觉验证）
// 命题：活跃很久+深跌+低位（性价比位）买入的票 → 见好就收/不涨快卖/不宜久持
// 分组按 BUY 信号 trendFactors（fire 快照），前向按 wss_price_ticks 可靠价序列
const { dbManager } = require('../src/services/dbManager');

const EXPS = [
  ['bt-v141', '3916fb15-66a1-45f0-bde1-1c145513817a'],
  ['bt-v142', '8a7b6b09-e2bc-4773-8393-a696821ff531'],
  ['bt-v144', 'a869d119-c389-47e0-89ce-89e86114ad0e'],
  ['bt-v145', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
  ['bt-v147', '9b31baf4-bdd3-4ebb-9031-2a1603f34633'],
];

const HORIZONS = [15, 30, 60, 120, 300, 600, 900, 1800]; // 秒
const TP_LEVELS = [5, 8, 15]; // %
const TOS = [60, 120]; // timeout 秒
const TAIL_TC_VOL_BNB = 3;   // 活跃判据：buyVolumeBnb
const TAIL_TC_WALLETS = 40;  // 活跃判据：buyWallets
const LOW_CURVS = 20;        // 低位判据：curVs <= 20（含破发）
const FWD_WIN = 1800;        // 前向窗 30min

function pctl(arr, p) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const i = Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1));
  return a[i];
}
function mean(arr) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null; }

async function main() {
  const sb = dbManager.getClient();
  const buys = []; // {exp,name,token,buyTs,bnb,unit,tf,leg}

  for (const [nm, id] of EXPS) {
    const { data: tr, error } = await sb.from('trades')
      .select('id,token_address,trade_direction,trade_status,input_amount,input_currency,output_amount,unit_price,executed_at,created_at,signal_id')
      .eq('experiment_id', id).order('created_at', { ascending: true }).limit(3000);
    if (error) throw new Error(nm + ': ' + error.message);
    const buyTr = tr.filter((x) => x.trade_direction === 'buy' && x.trade_status === 'success');
    const sellTr = tr.filter((x) => x.trade_direction === 'sell' && x.trade_status === 'success');
    console.log(`${nm}: trades=${tr.length} buys=${buyTr.length} sells=${sellTr.length}`);

    // 信号批量拉（按 signal_id）
    const sigIds = [...new Set(buyTr.map((x) => x.signal_id).filter(Boolean))];
    const sigMap = new Map();
    for (let i = 0; i < sigIds.length; i += 50) {
      const { data: sgs, error: e2 } = await sb.from('strategy_signals')
        .select('id,token_address,created_at,metadata')
        .in('id', sigIds.slice(i, i + 50));
      if (e2) throw new Error(e2.message);
      for (const s of sgs) sigMap.set(s.id, s);
    }

    for (const b of buyTr) {
      const sig = sigMap.get(b.signal_id);
      const tf = (sig && sig.metadata && sig.metadata.trendFactors) || null;
      const leg = sig && sig.metadata && sig.metadata.signalGate ? sig.metadata.signalGate.legId : (sig && sig.metadata && sig.metadata.strategyId) || '?';
      buys.push({
        exp: nm, token: b.token_address,
        // 回测 trades：created_at=虚拟时钟（与 ticks 同域）；executed_at=墙钟（跑回测当天）不可用
        buyTs: new Date(b.created_at).getTime(),
        bnb: b.input_currency === 'BNB' ? Number(b.input_amount) : null,
        unit: Number(b.unit_price),
        tf, leg,
      });
    }
    // episode 实际盈亏（BNB 口径，per token）
    // 存到全局 map 稍后用
    for (const t of [buyTr, sellTr]) { /* placeholder */ }
    episodeCalc(tr, nm);
  }

  // 分组
  function grpOf(b) {
    const tf = b.tf || {};
    const lp = Number(tf.launchPrice) || null;
    const cur = Number(tf.currentPrice) || null;
    const hi = Number(tf.highestPrice) || null;
    const curVs = lp && cur ? (cur / lp - 1) * 100 : null;
    const athVs = lp && hi ? (hi / lp - 1) * 100 : null;
    const vol = Number(tf.buyVolumeBnb) || 0;
    const wals = Number(tf.buyWallets) || 0;
    const active = vol >= TAIL_TC_VOL_BNB && wals >= TAIL_TC_WALLETS;
    b.curVs = curVs; b.athVs = athVs; b.vol = vol; b.wals = wals;
    b.ageSec = tf.tokenAgeSec != null ? Number(tf.tokenAgeSec) : (tf.age != null ? Number(tf.age) * 60 : null);
    if (curVs == null) return 'no_data';
    if (active && curVs <= 10) return 'A_tail_deep';   // 尾部·深度低位（含破发）
    if (active && curVs <= 20) return 'B_tail_low';    // 尾部·低位
    if (active && curVs <= 28.5) return 'C_tail_mid';  // 尾部·中位（触发线内）
    if (active) return 'D_tail_high';                  // 尾部·高位（>28.5 少见）
    return 'E_early_thin';                             // 早期/薄量票
  }
  for (const b of buys) b.grp = grpOf(b);

  const grpCount = {};
  for (const b of buys) grpCount[b.grp] = (grpCount[b.grp] || 0) + 1;
  console.log('\n=== 分组票数', JSON.stringify(grpCount));

  // 逐票拉 ticks（±30min 窗）
  const byToken = new Map();
  for (const b of buys) {
    if (!byToken.has(b.token)) byToken.set(b.token, []);
    byToken.get(b.token).push(b);
  }
  console.log(`待拉 ticks 的 token 数=${byToken.size}`);

  const tokens = [...byToken.keys()];
  let done = 0;
  const tickCache = new Map();
  async function pullToken(tok) {
    const bl = byToken.get(tok);
    const t0 = Math.min(...bl.map((b) => b.buyTs)) - FWD_WIN * 1000;
    const t1 = Math.max(...bl.map((b) => b.buyTs)) + (FWD_WIN + 60) * 1000;
    const rows = [];
    let from = new Date(t0).toISOString();
    for (let page = 0; page < 20; page++) {
      const { data, error } = await sb.from('wss_price_ticks')
        .select('block_time,price_usd,price_outlier,bnb_amount,trade_type')
        .eq('token_address', tok)
        .gte('block_time', from).lt('block_time', new Date(t1).toISOString())
        .order('block_time', { ascending: true }).limit(1000);
      if (error) throw new Error(tok + ': ' + error.message);
      rows.push(...data);
      if (!data || data.length < 1000) break;
      from = data[data.length - 1].block_time; // 继续翻页（同 block_time 边界略重叠，去重在后面）
    }
    const seen = new Set();
    const clean = [];
    for (const r of rows) {
      const k = r.block_time;
      if (seen.has(k)) continue;
      seen.add(k);
      if (r.price_outlier) continue;
      const p = Number(r.price_usd);
      if (!p || !isFinite(p)) continue;
      clean.push({ ts: new Date(r.block_time).getTime(), p, bnb: Number(r.bnb_amount) || 0 });
    }
    tickCache.set(tok, clean);
    done++;
    if (done % 40 === 0) console.log(`  ticks 拉取进度 ${done}/${tokens.length}`);
  }
  // pool 4
  const queue = [...tokens];
  async function worker() {
    while (queue.length) {
      const tok = queue.shift();
      try { await pullToken(tok); } catch (e) { console.log('  pull fail', tok.slice(0, 10), e.message); }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);

  // 前向指标 + 模拟
  const results = [];
  for (const b of buys) {
    const ticks = tickCache.get(b.token) || [];
    // P0：买点前后 3s 最后可靠价
    let P0 = null;
    for (const t of ticks) {
      if (t.ts <= b.buyTs + 3000) P0 = t.p; else break;
    }
    if (!P0 || b.curVs == null) { b.skip = P0 ? 'no_tf' : 'no_p0'; continue; }
    const fwd = ticks.filter((t) => t.ts >= b.buyTs);
    if (!fwd.length) { b.skip = 'no_fwd'; continue; }

    const ret = (p) => (p / P0 - 1) * 100;
    // r(h)
    const rh = {};
    for (const h of HORIZONS) {
      const cut = b.buyTs + h * 1000;
      let last = null;
      for (const t of fwd) { if (t.ts <= cut) last = t; else break; }
      rh[h] = last ? ret(last.p) : null;
    }
    // hold_end：1800s 末价或末 tick（票死也算）
    const lastTick = fwd[fwd.length - 1];
    const holdEnd = ret(lastTick.p);
    const lastAge = Math.round((lastTick.ts - b.buyTs) / 1000);

    // maxRise 与 argmax（30min 窗）
    let mx = -1e9, mxT = null;
    for (const t of fwd) { const r = ret(t.p); if (r > mx) { mx = r; mxT = Math.round((t.ts - b.buyTs) / 1000); } }
    // 首达 TP
    const tpHit = {};
    for (const lv of TP_LEVELS) {
      const t = fwd.find((x) => ret(x.p) >= lv);
      tpHit[lv] = t ? Math.round((t.ts - b.buyTs) / 1000) : null;
    }
    // timeout 时点价
    const toPx = {};
    for (const s of TOS) {
      const cut = b.buyTs + s * 1000;
      let last = null;
      for (const t of fwd) { if (t.ts <= cut) last = t; else break; }
      toPx[s] = last ? ret(last.p) : null;
    }
    // maxRise within first TOS
    const maxRiseIn = {};
    for (const s of TOS) {
      let m = -1e9;
      for (const t of fwd) { if (t.ts <= b.buyTs + s * 1000) { m = Math.max(m, ret(t.p)); } else break; }
      maxRiseIn[s] = m === -1e9 ? null : m;
    }
    // 活跃度：买后 300s tick 数、尾 60s tick 数（240~300s 段）
    const n300 = fwd.filter((t) => t.ts <= b.buyTs + 300000).length;
    const nTail60 = fwd.filter((t) => t.ts > b.buyTs + 240000 && t.ts <= b.buyTs + 300000).length;

    // ---- 模拟 ----
    const sim = {};
    sim.HOLD = holdEnd;
    for (const lv of TP_LEVELS) sim['TP' + lv] = tpHit[lv] != null ? lv : holdEnd;
    for (const s of TOS) {
      sim['TO' + s + '_flat'] = (maxRiseIn[s] != null && maxRiseIn[s] < 3 && toPx[s] != null) ? toPx[s] : holdEnd;
    }
    // 组合：TP8 或 TO120_flat
    {
      const a = sim['TP8'], c = sim['TO120_flat'];
      const tpT = tpHit[8], toAct = (maxRiseIn[120] != null && maxRiseIn[120] < 3 && toPx[120] != null);
      if (tpT != null && (!toAct || tpT <= 120)) sim['TP8_or_TO120'] = 8;
      else if (toAct) sim['TP8_or_TO120'] = toPx[120];
      else sim['TP8_or_TO120'] = holdEnd;
      void a; void c;
    }
    // 峰值回撤 30% 移动止盈（min hold 15s）
    {
      let peak = P0, out = null;
      for (const t of fwd) {
        const age = (t.ts - b.buyTs) / 1000;
        if (ret(t.p) > ret(peak)) peak = t.p;
        if (age >= 15 && t.p < peak * 0.7) { out = ret(t.p); break; }
      }
      sim['PB70'] = out != null ? out : holdEnd;
    }

    results.push({
      exp: b.exp, token: b.token, grp: b.grp, leg: b.leg, buyTs: b.buyTs,
      curVs: b.curVs, athVs: b.athVs, vol: b.vol, wals: b.wals, ageSec: b.ageSec,
      rh, holdEnd, lastAge, mx, mxT, tpHit, n300, nTail60, sim,
    });
  }

  // ===== 聚合输出 =====
  const groups = ['A_tail_deep', 'B_tail_low', 'C_tail_mid', 'D_tail_high', 'E_early_thin'];
  console.log(`\n有效买点=${results.length}（skip 统计见下）`);
  const skips = {};
  for (const b of buys) if (b.skip) skips[b.skip] = (skips[b.skip] || 0) + 1;
  console.log('skips:', JSON.stringify(skips));

  for (const g of groups) {
    const rs = results.filter((r) => r.grp === g);
    if (!rs.length) continue;
    console.log(`\n===== 分组 ${g} n=${rs.length}`);
    console.log(`  特征: curVs p50=${pctl(rs.map(r=>r.curVs),0.5)?.toFixed(1)} athVs p50=${pctl(rs.map(r=>r.athVs),0.5)?.toFixed(0)} vol p50=${pctl(rs.map(r=>r.vol),0.5)?.toFixed(1)} age p50=${pctl(rs.map(r=>r.ageSec||0),0.5)?.toFixed(0)}s`);
    // 前向曲线
    let line = '  r(t)%:  ';
    for (const h of HORIZONS) {
      const v = mean(rs.map((r) => r.rh[h]).filter((x) => x != null));
      line += ` ${h}s=${v != null ? v.toFixed(2) : '—'}`;
    }
    console.log(line);
    // maxRise 时间分布
    const mxTb = rs.map((r) => r.mxT);
    const within = (s) => mxTb.filter((t) => t != null && t <= s).length;
    console.log(`  maxRise: mean=${mean(rs.map(r=>r.mx))?.toFixed(2)}% p50=${pctl(rs.map(r=>r.mx),0.5)?.toFixed(2)}% argmaxT p50=${pctl(mxTb,0.5)}s | 峰在前60s=${within(60)}/${rs.length} 前120s=${within(120)}/${rs.length} 前300s=${within(300)}/${rs.length} >600s=${mxTb.filter(t=>t>600).length}`);
    // TP 可达率
    for (const lv of TP_LEVELS) {
      const hit = rs.filter((r) => r.tpHit[lv] != null).length;
      console.log(`  TP+${lv}% 可达 ${hit}/${rs.length}=${(hit / rs.length * 100).toFixed(0)}%`);
    }
    // 死盘
    const dead300 = rs.filter((r) => r.n300 <= 3).length;
    const deadTail = rs.filter((r) => r.nTail60 === 0).length;
    console.log(`  死盘: 买后300s ticks<=3 占 ${dead300}/${rs.length}=${(dead300/rs.length*100).toFixed(0)}%；240~300s 段零tick ${deadTail}/${rs.length}`);
    // 模拟
    for (const k of ['HOLD', 'TP5', 'TP8', 'TP15', 'TO60_flat', 'TO120_flat', 'TP8_or_TO120', 'PB70']) {
      const arr = rs.map((r) => r.sim[k]).filter((x) => x != null);
      const win = arr.filter((x) => x > 0).length;
      console.log(`  sim ${k.padEnd(12)} mean=${mean(arr)?.toFixed(2)}% p50=${pctl(arr,0.5)?.toFixed(2)}% 胜率=${(win/arr.length*100).toFixed(0)}% (>0: ${win}/${arr.length})`);
    }
  }

  // 明细 dump（尾部组）供个案回看
  const dump = results.filter((r) => r.grp.startsWith('A') || r.grp.startsWith('B') || r.grp === 'D_tail_high');
  dump.sort((a, b) => a.sim.HOLD - b.sim.HOLD);
  console.log('\n=== 尾部低位组明细（HOLD 升序，前 40）');
  for (const r of dump.slice(0, 40)) {
    console.log(`${r.exp} ${r.token.slice(0, 10)} ${r.grp} curVs=${r.curVs?.toFixed(1)} ath=${r.athVs?.toFixed(0)} vol=${r.vol.toFixed(1)} n300=${r.n300} | HOLD=${r.sim.HOLD?.toFixed(1)} mx=${r.mx?.toFixed(1)}@${r.mxT}s TP8=${r.tpHit[8]}@s simTP8=${r.sim.TP8?.toFixed(1)} TO120=${r.sim.TO120_flat?.toFixed(1)}`);
  }
  console.log('\n=== 尾部组 HOLD 最好的 20（检查是否误杀长尾）');
  for (const r of dump.slice(-20).reverse()) {
    console.log(`${r.exp} ${r.token.slice(0, 10)} ${r.grp} curVs=${r.curVs?.toFixed(1)} ath=${r.athVs?.toFixed(0)} vol=${r.vol.toFixed(1)} n300=${r.n300} | HOLD=${r.sim.HOLD?.toFixed(1)} mx=${r.mx?.toFixed(1)}@${r.mxT}s simTP8=${r.sim.TP8?.toFixed(1)}`);
  }

  require('fs').writeFileSync('/tmp/tail-entry-study.json', JSON.stringify(results));
  console.log('\n全量明细已存 /tmp/tail-entry-study.json');
}

// episode 实际盈亏占位（第一版先用模拟口径对比，不阻塞）
function episodeCalc(tr, nm) { void tr; void nm; }

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
