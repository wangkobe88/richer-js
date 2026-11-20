/**
 * 「burst 前注意力存量」研究（2026-11-20，用户口径：盘面干净/没啥注意力→
 * 流量进来承接不足）。与 T199b 静默时长口径互补——本脚本按波窗前 30min 的
 * 参与者数（preWallets）/笔数/买额分桶，另拆新老票（token age）防开盘流量
 * 火龙混杂。crew 定位用 T199c 修复后 lib（0x4509 正确进 universe）。
 */
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const {
  BURST_COOLDOWN_DEFAULTS, locateBurstCrew, buildBurstCooldownView, evaluateBurstCooldown,
} = require('../src/trading-engine/core/burst-cooldown-exit.js');

const WINS = [
  { k: 'v140', id: '6e75ed6d-9d5a-48b4-9e72-0b3dfe00c22f' },
  { k: 'v145', id: '2448116a-bebe-457d-9d8a-b4556c9a8e0d' },
  { k: 'v155', id: 'dddbe79e-480a-402a-aa35-85a72d2f591e' },
  { k: 'v156', id: 'b8ae9f2e-832f-42db-bbda-8d8701aecb63' },
  { k: 'v163', id: '7d60bc05-8c4e-4f0d-993c-6f2d02428ea7' },
];
const WAVE_MIN_BNB = 0.29, WAVE_MIN_WALLETS = 2;
const ms = s => new Date(s).getTime();

async function pageAll(sb, table, eq, sel) {
  const out = []; let from = 0;
  for (;;) {
    let q = sb.from(table).select(sel).order('created_at', { ascending: true }).range(from, from + 999);
    for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) throw new Error(JSON.stringify(error));
    if (!data || !data.length) break;
    out.push(...data); from += 1000;
    if (data.length < 1000) break;
  }
  return out;
}

async function main() {
  const sb = dbManager.getClient();
  try {
    const { data: v158 } = await sb.from('experiments').select('id').ilike('experiment_name', 'bt-v158%').limit(1);
    if (v158 && v158[0]) WINS.push({ k: 'v158', id: v158[0].id });
  } catch (e) { /* 可选 */ }

  const cases = []; const seen = new Map();
  for (const w of WINS) {
    const sigs = await pageAll(sb, 'strategy_signals', { experiment_id: w.id, signal_type: 'BUY' }, 'id,token_address,created_at,metadata');
    const sigMap = new Map(sigs.map(s => [s.id, s]));
    const trades = await pageAll(sb, 'trades', { experiment_id: w.id }, 'token_address,trade_direction,trade_status,input_amount,output_amount,metadata,signal_id');
    const firstBuy = new Map(); const pnl = new Map();
    for (const t of trades) {
      if (t.trade_status !== 'success') continue;
      const o = pnl.get(t.token_address) || { b: 0, s: 0 };
      if (t.trade_direction === 'buy') o.b += Number(t.input_amount || 0); else o.s += Number(t.output_amount || 0);
      pnl.set(t.token_address, o);
      if (t.trade_direction !== 'buy') continue;
      const vt = (t.metadata && t.metadata.timestamp) || (t.signal_id && sigMap.get(t.signal_id) || {}).created_at;
      if (!vt) continue;
      const cur = firstBuy.get(t.token_address);
      if (!cur || ms(vt) < ms(cur.vt)) firstBuy.set(t.token_address, { vt, sigId: t.signal_id });
    }
    for (const [tok, fb] of firstBuy) {
      const dk = tok + '|' + fb.vt.slice(0, 13);
      if (seen.has(dk)) continue;
      seen.set(dk, 1);
      cases.push({ win: w.k, tok, t0Ms: ms(fb.vt), t0S: fb.vt, pnl: pnl.get(tok) || { b: 0, s: 0 } });
    }
  }
  console.log(`成交买点: ${cases.length}`);

  // token_create 批量锚（≤50/批，红线）
  const createMap = new Map();
  const toks = [...new Set(cases.map(c => c.tok))];
  for (let i = 0; i < toks.length; i += 50) {
    const { data: ev, error } = await sb.from('wss_events')
      .select('token_address,block_time').eq('kind', 'token_create').in('token_address', toks.slice(i, i + 50));
    if (error) throw new Error(JSON.stringify(error));
    for (const e of ev || []) if (!createMap.has(e.token_address)) createMap.set(e.token_address, e.block_time);
  }

  const rows = [];
  for (const c of cases) {
    const { data: ticks, error } = await sb.from('wss_price_ticks')
      .select('block_time,bnb_amount,price_bnb,trade_type,sender_address,trader_address')
      .eq('token_address', c.tok)
      .gte('block_time', new Date(c.t0Ms - 1800e3).toISOString())
      .lte('block_time', new Date(c.t0Ms + 960e3).toISOString())
      .order('block_time', { ascending: true }).limit(3000);
    if (error || !ticks || ticks.length < 3) continue;
    const arr = ticks.map(t => ({
      ms: ms(t.block_time), bnb: Number(t.bnb_amount), side: t.trade_type === 'sell' ? 'sell' : 'buy',
      p: Number(t.price_bnb), w: ((t.sender_address || t.trader_address) || '').toLowerCase(),
    }));
    const crew = locateBurstCrew(arr, c.t0Ms);
    if (!crew || crew.crewBnb < WAVE_MIN_BNB || crew.crewSet.size < WAVE_MIN_WALLETS) continue;
    // 波前 30min 注意力存量 + 波前 5min 近带
    const pre = arr.filter(t => t.ms < crew.winStartMs && t.ms >= crew.winStartMs - 1800e3);
    const pre5 = pre.filter(t => t.ms >= crew.winStartMs - 300e3);
    const preWallets = new Set(pre.map(t => t.w).filter(Boolean)).size;
    const preBuyBnb = pre.filter(t => t.side === 'buy').reduce((s, t) => s + t.bnb, 0);
    const created = createMap.get(c.tok);
    const ageSec = created ? Math.round((crew.winStartMs - ms(created)) / 1000) : null;
    // 静默（对照维）
    let prevMs = null;
    for (const t of arr) { if (t.ms < crew.winStartMs) prevMs = t.ms; else break; }
    const silenceSec = prevMs == null ? 1800 : Math.round((crew.winStartMs - prevMs) / 1000);
    // 承接 + 判定 + 前向（同 T199b 口径）
    const absorbers = arr.filter(t => t.side === 'buy' && t.ms >= c.t0Ms && t.w && !crew.crewSet.has(t.w));
    const firstAbsSec = absorbers.length ? (absorbers[0].ms - c.t0Ms) / 1000 : null;
    let verdict = null, sellMs = null;
    for (let g = c.t0Ms + 1000; g <= c.t0Ms + 60e3 && !verdict; g += 1000) {
      const asOf = arr.filter(t => t.ms <= g);
      const v = evaluateBurstCooldown(buildBurstCooldownView(asOf, { t0Ms: c.t0Ms, ownWallets: new Set() }, BURST_COOLDOWN_DEFAULTS), g, BURST_COOLDOWN_DEFAULTS);
      if (v && v.action === 'sell') { verdict = v.batch; sellMs = g; }
      else if (v && v.action === 'release') verdict = 'release';
    }
    const rel = arr.filter(t => t.p > 0);
    const sellPx = (verdict && verdict !== 'release' && sellMs) ? (rel.filter(t => t.ms <= sellMs).slice(-1)[0] || {}).p : null;
    let fwdRoi = null;
    if (sellPx) {
      const post = rel.filter(t => t.ms > sellMs && t.ms <= sellMs + 600e3);
      if (post.length) fwdRoi = +(Math.max(...post.map(t => t.p)) / sellPx - 1) * 100;
    }
    rows.push({
      win: c.win, tok: c.tok, t0: c.t0S, preWallets, preTicks: pre.length,
      preBuyBnb: +preBuyBnb.toFixed(2), pre5Ticks: pre5.length, ageSec, silenceSec,
      firstAbsSec: firstAbsSec == null ? null : +firstAbsSec.toFixed(0),
      verdict: verdict || 'none', fwdRoi: fwdRoi == null ? null : +fwdRoi.toFixed(1),
      realRoi: c.pnl.b > 0 ? +((c.pnl.s / c.pnl.b - 1) * 100).toFixed(1) : null,
    });
  }
  console.log(`mechanical burst（T199c 后 crew）: ${rows.length}`);

  const pct = (n, d) => d ? (100 * n / d).toFixed(0) + '%' : '-';
  const med = a => (a && a.length ? a.sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
  function bucketTable(title, keyFn) {
    console.log(`\n== ${title} ==`);
    const groups = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      if (k === null) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    for (const [k, g] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const late = g.filter(r => r.firstAbsSec == null).length;
      const slow = g.filter(r => r.firstAbsSec != null && r.firstAbsSec > 30).length;
      const fast_ = g.filter(r => r.firstAbsSec != null && r.firstAbsSec <= 15).length;
      const killed = g.filter(r => r.verdict.startsWith('w'));
      console.log(`${String(k).padEnd(14)} n=${String(g.length).padEnd(4)} 首承接≤15s=${pct(fast_, g.length).padEnd(4)} >30s=${pct(slow, g.length).padEnd(4)} 30s零=${pct(late, g.length).padEnd(4)}`
        + ` | 判定 w1/w-fast/w-final/rel = ${g.filter(r => r.verdict === 'w1').length}/${g.filter(r => r.verdict === 'w2-fast').length}/${g.filter(r => r.verdict === 'w2-final').length}/${g.filter(r => r.verdict === 'release').length}`
        + ` | 被杀票 fwd中位=${med(killed.map(r => r.fwdRoi).filter(v => v != null))}% 实际中位=${med(g.map(r => r.realRoi).filter(v => v != null))}%`);
    }
  }

  // 分布先行（定桶线）
  const ws = rows.map(r => r.preWallets).sort((a, b) => a - b);
  const q = p => ws[Math.floor(ws.length * p)];
  console.log(`\npreWallets 分布: min=${ws[0]} P25=${q(0.25)} 中位=${q(0.5)} P75=${q(0.75)} max=${ws[ws.length - 1]}`);
  const as = rows.map(r => r.ageSec).filter(v => v != null).sort((a, b) => a - b);
  console.log(`ageAtBurst 分布: min=${as[0]} P25=${as[Math.floor(as.length * 0.25)]} 中位=${as[Math.floor(as.length / 2)]} max=${as[as.length - 1]} n=${as.length}`);

  bucketTable('按波前 30min 参与者数（注意力存量）', r => r.preWallets < 5 ? 'a.<5户' : r.preWallets < 15 ? 'b.5-14户' : r.preWallets < 40 ? 'c.15-39户' : 'd.≥40户');
  bucketTable('按波前 30min 笔数', r => r.preTicks < 10 ? 'a.<10笔' : r.preTicks < 40 ? 'b.10-39笔' : r.preTicks < 120 ? 'c.40-119笔' : 'd.≥120笔');
  bucketTable('老票（age≥120s）内按 preWallets', r => (r.ageSec == null || r.ageSec < 120) ? null : (r.preWallets < 10 ? 'a.老+<10户' : r.preWallets < 40 ? 'b.老+10-39户' : 'c.老+≥40户'));
  bucketTable('新票（age<120s）内按 preWallets', r => (r.ageSec == null || r.ageSec >= 120) ? null : (r.preWallets < 10 ? 'a.新+<10户' : 'b.新+≥10户'));

  // 相关性速览：静默 vs 存量
  const lowSil = rows.filter(r => r.silenceSec < 60), hiSil = rows.filter(r => r.silenceSec >= 300);
  console.log(`\n[对照] 静默<60s 桶的 preWallets 中位=${med(lowSil.map(r => r.preWallets))}；静默≥300s 桶 preWallets 中位=${med(hiSil.map(r => r.preWallets))}（两维相关性速览）`);

  // 0x4509 定位
  const me = rows.find(r => r.tok.startsWith('0x4509204c'));
  if (me) console.log(`\n[0x4509 定位] preWallets=${me.preWallets} preTicks=${me.preTicks} preBuy=${me.preBuyBnb}B 波前5min=${me.pre5Ticks}笔 age=${me.ageSec}s 静默=${me.silenceSec}s 首承接=${me.firstAbsSec}s 判定=${me.verdict} fwd=${me.fwdRoi}% 实际=${me.realRoi}%`);
  // 低存量桶被杀票明细
  console.log('\n---- 波前<5户 桶被杀票明细 ----');
  for (const r of rows.filter(r => r.preWallets < 5 && r.verdict.startsWith('w'))) {
    console.log(`${r.win} ${r.tok.slice(0, 10)} pre=${r.preWallets}户/${r.preTicks}笔 age=${r.ageSec}s 静默=${r.silenceSec}s 首承接=${r.firstAbsSec} ${r.verdict} fwd=${r.fwdRoi == null ? '-' : r.fwdRoi + '%'} 实际=${r.realRoi == null ? '-' : r.realRoi + '%'}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
