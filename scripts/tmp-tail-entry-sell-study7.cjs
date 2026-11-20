#!/usr/bin/env node
// 尾部低位研究 第七段：起涨票 vs 死盘票 事前因子分离度扫描
// 层1=BUY 信号 trendFactors 全键 + 门链段（buyPoint/cheatCheck/actFront）
// 层2=买点前 300s ticks 盘面特征（价格动量/流量/断流/大单）
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');

const EXPS = [
  ['bt-v141', '3916fb15-66a1-45f0-bde1-1c145513817a'],
  ['bt-v142', '8a7b6b09-e2bc-4773-8393-a696821ff531'],
  ['bt-v144', 'a869d119-c389-47e0-89ce-89e86114ad0e'],
  ['bt-v145', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
  ['bt-v147', '9b31baf4-bdd3-4ebb-9031-2a1603f34633'],
];
function pctl(arr,p){if(!arr.length)return null;const a=[...arr].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.max(0,Math.ceil(p*a.length)-1))];}
function mean(a){return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;}
function auc(neg, pos) { // P(neg < pos) + 0.5*P(==) 方向：AUC>0.5 = pos 偏大
  let c = 0;
  for (const a of neg) for (const b of pos) c += a < b ? 1 : (a === b ? 0.5 : 0);
  return c / (neg.length * pos.length);
}

async function main() {
  const sb = dbManager.getClient();
  const results = JSON.parse(fs.readFileSync('/tmp/tail-entry-study.json', 'utf8'));
  // 只要尾部组
  const pool = results.filter(r => ['A_tail_deep','B_tail_low','C_tail_mid'].includes(r.grp));

  // ---- 层1：拉 BUY 信号完整 metadata ----
  const sigMap = new Map(); // exp|token|buyTs -> metadata
  for (const [nm, id] of EXPS) {
    const { data: tr, error } = await sb.from('trades')
      .select('token_address,trade_direction,trade_status,input_currency,created_at,signal_id')
      .eq('experiment_id', id).limit(3000);
    if (error) throw new Error(error.message);
    const pairs = tr.filter(t => t.trade_direction === 'buy' && t.signal_id);
    const ids = [...new Set(pairs.map(t => t.signal_id))];
    const m = new Map();
    for (let i = 0; i < ids.length; i += 50) {
      const { data: sgs, error: e2 } = await sb.from('strategy_signals').select('id,token_address,created_at,metadata').in('id', ids.slice(i, i + 50));
      if (e2) throw new Error(e2.message);
      for (const s of sgs) m.set(s.id, s);
    }
    for (const t of pairs) {
      const s = m.get(t.signal_id);
      if (s) sigMap.set(nm + '|' + t.token_address + '|' + new Date(t.created_at).getTime(), s);
    }
  }

  // ---- 层2：拉买点前 300s ticks（含 wallet/量列）----
  const byToken = new Map();
  for (const r of pool) {
    if (!byToken.has(r.token)) byToken.set(r.token, []);
    byToken.get(r.token).push(r);
  }
  const tickCache = new Map();
  const toks = [...byToken.keys()];
  let done = 0;
  async function pull(tok) {
    const bl = byToken.get(tok);
    const t0 = Math.min(...bl.map(b => b.buyTs)) - 300000;
    const t1 = Math.max(...bl.map(b => b.buyTs)) + 1000;
    const { data, error } = await sb.from('wss_price_ticks')
      .select('block_time,price_usd,price_outlier,bnb_amount,trade_type,trader_address,sender_address')
      .eq('token_address', tok)
      .gte('block_time', new Date(t0).toISOString()).lt('block_time', new Date(t1).toISOString())
      .order('block_time', { ascending: true }).limit(3000);
    if (error) throw new Error(error.message);
    const rows = (data || []).map(r => ({
      ts: new Date(r.block_time).getTime(),
      p: r.price_outlier ? null : Number(r.price_usd),
      bnb: Number(r.bnb_amount) || 0,
      side: r.trade_type,
      w: (r.sender_address || r.trader_address || '').toLowerCase(),
    }));
    tickCache.set(tok, rows);
    if (++done % 20 === 0) console.log(`  pre-ticks ${done}/${toks.length}`);
  }
  const q = [...toks];
  async function w() { while (q.length) { const t = q.shift(); try { await pull(t); } catch (e) { console.log('fail', t.slice(0, 8), e.message); } } }
  await Promise.all([w(), w(), w(), w()]);

  // ---- 特征组装 ----
  const feats = [];
  for (const r of pool) {
    const sig = sigMap.get(r.exp + '|' + r.token + '|' + r.buyTs);
    const tf = (sig && sig.metadata && sig.metadata.trendFactors) || {};
    const md = (sig && sig.metadata) || {};
    const bp = md.buyPoint || {}, cc = md.cheatCheck || {}, af = md.actFrontGate || {};
    const ticks = tickCache.get(r.token) || [];
    // P0 与买前序列
    const pre = ticks.filter(t => t.ts <= r.buyTs);
    let P0 = null;
    for (const t of pre) if (t.p != null) P0 = t.p;
    const f = {
      token: r.token, exp: r.exp, grp: r.grp, mx: r.mx, mxT: r.mxT, epPnl: r.epPnl,
      // —— 层1：快照因子（全数值键自动收集）——
    };
    for (const [k, v] of Object.entries(tf)) {
      if (typeof v === 'number' && isFinite(v)) f['tf_' + k] = v;
    }
    // 门链档位（转数值编码）
    if (bp.market_pattern) f.bp_pattern = bp.market_pattern;
    if (bp.entry_shape) f.bp_entry = bp.entry_shape;
    if (bp.activity_level) f.bp_act = bp.activity_level;
    if (bp.holder_concentration) f.bp_holder = bp.holder_concentration;
    if (cc.levels && cc.levels.activityLevel) f.cc_act = cc.levels.activityLevel;
    if (af.levels && af.levels.activityLevel) f.af_act = af.levels.activityLevel;
    if (af.levels && af.levels.stallBurstWave != null) f.af_sbw = af.levels.stallBurstWave;

    // —— 层2：买前盘面 ——
    if (P0 != null && pre.length) {
      const px = pre.filter(t => t.p != null);
      const chg = (sec) => {
        const cut = r.buyTs - sec * 1000;
        const seg = px.filter(t => t.ts >= cut);
        const ref = seg.length ? seg[0].p : px[0].p;
        return (P0 / ref - 1) * 100;
      };
      f.pre_chg5 = chg(5); f.pre_chg30 = chg(30); f.pre_chg120 = chg(120); f.pre_chg300 = chg(300);
      const win = (sec) => pre.filter(t => t.ts > r.buyTs - sec * 1000);
      for (const sec of [30, 60, 120]) {
        const w60 = win(sec);
        const buys = w60.filter(t => t.side === 'buy'), sells = w60.filter(t => t.side === 'sell');
        f[`pre${sec}_buyBnb`] = buys.reduce((s, t) => s + t.bnb, 0);
        f[`pre${sec}_sellBnb`] = sells.reduce((s, t) => s + t.bnb, 0);
        f[`pre${sec}_ratio`] = f[`pre${sec}_sellBnb`] > 0 ? f[`pre${sec}_buyBnb`] / f[`pre${sec}_sellBnb`] : null;
        f[`pre${sec}_buyers`] = new Set(buys.map(t => t.w).filter(Boolean)).size;
        f[`pre${sec}_sellers`] = new Set(sells.map(t => t.w).filter(Boolean)).size;
        f[`pre${sec}_bigBuy`] = buys.filter(t => t.bnb >= 0.2).reduce((s, t) => s + t.bnb, 0);
        f[`pre${sec}_bigSell`] = sells.filter(t => t.bnb >= 0.2).reduce((s, t) => s + t.bnb, 0);
        f[`pre${sec}_tickn`] = w60.length;
      }
      // 断流：锚前 300s 内最大 tick 间隔
      let gap = 0, last = null;
      for (const t of pre) { if (last != null) gap = Math.max(gap, (t.ts - last) / 1000); last = t.ts; }
      f.pre_gapMax300 = gap;
      const gapBefLast = pre.length >= 2 ? (r.buyTs - pre[pre.length - 2].ts) / 1000 : null;
      f.pre_gapLast = gapBefLast; // 最后一笔距买点
    }
    feats.push(f);
  }

  // ---- 标签 ----
  const neg = feats.filter(f => f.mx < 3);
  const pos = feats.filter(f => f.mx >= 10);
  const mid = feats.filter(f => f.mx >= 3 && f.mx < 10);
  console.log(`\n尾部组=${feats.length} 死盘(mx<3)=${neg.length} 起涨(mx>=10)=${pos.length} 中间=${mid.length}`);
  console.log(`死盘 ep mean=${mean(neg.map(f=>f.epPnl).filter(x=>x!=null))?.toFixed(1)} 起涨 ep mean=${mean(pos.map(f=>f.epPnl).filter(x=>x!=null))?.toFixed(1)}`);

  // ---- 数值因子 AUC 扫描 ----
  const keys = [...new Set(feats.flatMap(f => Object.keys(f).filter(k => k.startsWith('tf_') || k.startsWith('pre'))))];
  const rows = [];
  for (const k of keys) {
    const nv = neg.map(f => f[k]).filter(v => typeof v === 'number' && isFinite(v));
    const pv = pos.map(f => f[k]).filter(v => typeof v === 'number' && isFinite(v));
    if (nv.length < neg.length * 0.6 || pv.length < pos.length * 0.6) continue; // 覆盖率
    if (new Set([...nv, ...pv]).size < 3) continue; // 常数因子无意义
    const a = auc(nv, pv);
    rows.push({ k, auc: a, nNegP50: pctl(nv, .5), pPosP50: pctl(pv, .5) });
  }
  rows.sort((x, y) => Math.abs(y.auc - 0.5) - Math.abs(x.auc - 0.5));
  console.log('\n=== 数值因子 AUC 排序（|AUC-0.5| 降序，前 35）');
  console.log('因子 | AUC | 死盘p50 | 起涨p50');
  for (const r of rows.slice(0, 35)) {
    console.log(`${r.k.padEnd(34)} ${r.auc.toFixed(3)}  ${fmt(r.nNegP50)}  ${fmt(r.pPosP50)}`);
  }
  function fmt(v) { return v == null ? '—' : (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(2)); }

  // ---- 档位因子交叉表 ----
  console.log('\n=== 档位因子交叉表（行=档位，列=死盘/起涨/中间）');
  for (const k of ['bp_pattern', 'bp_entry', 'bp_act', 'bp_holder', 'cc_act', 'af_act', 'af_sbw', 'grp']) {
    const vals = [...new Set(feats.map(f => f[k]).filter(v => v != null))];
    if (vals.length < 2 || vals.length > 12) continue;
    console.log(`\n[${k}]`);
    for (const v of vals) {
      const n = feats.filter(f => f[k] === v);
      const nn = n.filter(f => f.mx < 3).length, np_ = n.filter(f => f.mx >= 10).length, nm = n.length - nn - np_;
      console.log(`  ${String(v).padEnd(22)} 死盘=${nn} 起涨=${np_} 中间=${nm} (n=${n.length})`);
    }
  }

  // ---- Top 因子候选判据混淆矩阵（示例线）----
  console.log('\n=== Top 因子候选线（在全部尾部组上）');
  for (const r of rows.slice(0, 8)) {
    const all = feats.map(f => f[r.k]).filter(v => typeof v === 'number' && isFinite(v));
    for (const thr of [pctl(all, .33), pctl(all, .5), pctl(all, .67)]) {
      const dir = r.auc >= 0.5 ? '>=' : '<';
      const hit = feats.filter(f => typeof f[r.k] === 'number' && (dir === '>=' ? f[r.k] >= thr : f[r.k] <= thr));
      const hn = hit.filter(f => f.mx < 3).length, hp = hit.filter(f => f.mx >= 10).length, hm = hit.length - hn - hp;
      console.log(`  ${r.k}${dir}${fmt(thr)}: 命中${hit.length} 其中死盘${hn} 起涨${hp} 中间${hm}`);
    }
  }

  fs.writeFileSync('/tmp/tail-entry-study3.json', JSON.stringify(feats));
  console.log('\nsaved /tmp/tail-entry-study3.json');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
