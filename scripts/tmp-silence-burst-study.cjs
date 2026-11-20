/**
 * 「burst 波窗前长静默死票复活」形状研究（2026-11-20，0x4509 案引出）
 *
 * 问题：burst 买点前代币长静默（死票复活）时，承接（非波成员买）到达是否系统性更晚
 * （落在 T189 批2 快线 23s 之后）→ 快线是否在无注意力沉淀票上系统性抢跑？
 *
 * 方法：多窗成交买点全量 → 机械判 burst（locateBurstCrew 同款波定位 + CD402/423
 * 量级线 波买额≥0.29B ∧ ≥2 钱包）→ 波前静默分桶 → 逐秒重放 T189 状态机
 * （buildBurstCooldownView/evaluateBurstCooldown 源码级重放）→ 分桶统计：
 * 承接到达分布 / 判定分布 / 快线卖出后 +10min 前向最大涨幅。
 */
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const {
  BURST_COOLDOWN_DEFAULTS,
  locateBurstCrew, buildBurstCooldownView, evaluateBurstCooldown,
} = require('../src/trading-engine/core/burst-cooldown-exit.js');

const WINS = [
  { k: 'v140', id: '6e75ed6d-9d5a-48b4-9e72-0b3dfe00c22f' },
  { k: 'v145', id: '2448116a-bebe-457d-9d8a-b4556c9a8e0d' },
  { k: 'v155', id: 'dddbe79e-480a-402a-aa35-85a72d2f591e' },
  { k: 'v156', id: 'b8ae9f2e-832f-42db-bbda-8d8701aecb63' },
  { k: 'v163', id: '7d60bc05-8c4e-4f0d-993c-6f2d02428ea7' },
];
// 机械 burst 量级线（CD402/CD423 现行：净额 0.29 / ≥2 钱包）
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
  // v158 按名解析（存在才纳入）
  try {
    const { data: v158 } = await sb.from('experiments').select('id,experiment_name')
      .ilike('experiment_name', 'bt-v158%').limit(1);
    if (v158 && v158[0]) WINS.push({ k: 'v158', id: v158[0].id });
  } catch (e) { /* 名列缺失则跳过 */ }

  const cases = [];
  const seen = new Map(); // tok|t0小时 跨窗去重
  for (const w of WINS) {
    const sigs = await pageAll(sb, 'strategy_signals', { experiment_id: w.id, signal_type: 'BUY' },
      'id,token_address,created_at,metadata');
    const sigMap = new Map(sigs.map(s => [s.id, s]));
    const trades = await pageAll(sb, 'trades', { experiment_id: w.id },
      'token_address,trade_direction,trade_status,input_amount,output_amount,metadata,signal_id');
    // 首 success 买 per token（虚拟时间锚=metadata.timestamp，缺则 signal created_at）
    const firstBuy = new Map();
    for (const t of trades) {
      if (t.trade_direction !== 'buy' || t.trade_status !== 'success') continue;
      const vt = (t.metadata && t.metadata.timestamp) || (t.signal_id && sigMap.get(t.signal_id) || {}).created_at;
      if (!vt) continue;
      const cur = firstBuy.get(t.token_address);
      if (!cur || ms(vt) < ms(cur.vt)) firstBuy.set(t.token_address, { vt, sigId: t.signal_id });
    }
    // token 级实际盈亏（对照）
    const pnl = new Map();
    for (const t of trades) {
      if (t.trade_status !== 'success') continue;
      const o = pnl.get(t.token_address) || { b: 0, s: 0 };
      if (t.trade_direction === 'buy') o.b += Number(t.input_amount || 0);
      else o.s += Number(t.output_amount || 0);
      pnl.set(t.token_address, o);
    }
    for (const [tok, fb] of firstBuy) {
      const dk = tok + '|' + fb.vt.slice(0, 13);
      if (seen.has(dk)) continue;
      seen.set(dk, 1);
      const sig = fb.sigId ? sigMap.get(fb.sigId) : null;
      const md = (sig && sig.metadata) || {};
      const sbwMeta = (md.actFrontGate && md.actFrontGate.sbw)
        || (md.cheatCheck && md.cheatCheck.levels && md.cheatCheck.levels.stallBurstWave === 1 ? 'burst' : null);
      cases.push({ win: w.k, tok, t0Ms: ms(fb.vt), t0S: fb.vt, sbwMeta, pnl: pnl.get(tok) || { b: 0, s: 0 } });
    }
  }
  console.log(`成交买点（跨窗去重后）: ${cases.length}`);

  const rows = [];
  for (const c of cases) {
    const from = new Date(c.t0Ms - 1800e3).toISOString();
    const to = new Date(c.t0Ms + 960e3).toISOString();
    const { data: ticks, error } = await sb.from('wss_price_ticks')
      .select('block_time,bnb_amount,price_bnb,trade_type,sender_address,trader_address')
      .eq('token_address', c.tok).gte('block_time', from).lte('block_time', to)
      .order('block_time', { ascending: true }).limit(3000);
    if (error || !ticks || ticks.length < 3) continue;
    const arr = ticks.map(t => ({
      ms: ms(t.block_time), bnb: Number(t.bnb_amount),
      side: t.trade_type === 'sell' ? 'sell' : 'buy',
      p: Number(t.price_bnb), w: ((t.sender_address || t.trader_address) || '').toLowerCase(),
    }));
    const crew = locateBurstCrew(arr, c.t0Ms);
    if (!crew || crew.crewBnb < WAVE_MIN_BNB || crew.crewSet.size < WAVE_MIN_WALLETS) continue; // 非 mechanical burst
    // 波前静默：波窗首行之前最后一笔 tick（任意方向）距今
    let prevMs = null;
    for (const t of arr) { if (t.ms < crew.winStartMs) prevMs = t.ms; else break; }
    const silenceSec = prevMs == null ? 1800 : (crew.winStartMs - prevMs) / 1000;
    // 承接序列（非波成员买，≥t0）
    const absorbers = arr.filter(t => t.side === 'buy' && t.ms >= c.t0Ms && t.w && !crew.crewSet.has(t.w));
    const firstAbsSec = absorbers.length ? (absorbers[0].ms - c.t0Ms) / 1000 : null;
    // T189 状态机逐秒重放（源码级：as-of ring 增量 + DEFAULTS 线值）
    let verdict = null, sellMs = null;
    for (let g = c.t0Ms + 1000; g <= c.t0Ms + 60e3 && !verdict; g += 1000) {
      const asOf = arr.filter(t => t.ms <= g);
      const view = buildBurstCooldownView(asOf, { t0Ms: c.t0Ms, ownWallets: new Set() }, BURST_COOLDOWN_DEFAULTS);
      const v = evaluateBurstCooldown(view, g, BURST_COOLDOWN_DEFAULTS);
      if (v && v.action === 'sell') { verdict = v.batch; sellMs = g; }
      else if (v && v.action === 'release') { verdict = 'release'; }
    }
    if (!verdict) verdict = 'no-verdict(>60s)';
    // 卖出后前向（可靠价 p>0）
    const rel = arr.filter(t => t.p > 0);
    const sellPx = verdict.startsWith('w') && sellMs
      ? (rel.filter(t => t.ms <= sellMs).slice(-1)[0] || {}).p : null;
    let fwdMax = null, fwdMaxSec = null;
    if (sellPx) {
      const post = rel.filter(t => t.ms > sellMs && t.ms <= sellMs + 600e3);
      if (post.length) {
        fwdMax = Math.max(...post.map(t => t.p));
        fwdMaxSec = (post.find(t => t.p === fwdMax).ms - sellMs) / 1000;
      }
    }
    const fwdRoi = (sellPx && fwdMax) ? (fwdMax / sellPx - 1) * 100 : null;
    rows.push({
      win: c.win, tok: c.tok.slice(0, 10), t0: c.t0S, sbwMeta: c.sbwMeta || '',
      silenceSec: Math.round(silenceSec), crewN: crew.crewSet.size, crewBnb: +crew.crewBnb.toFixed(2),
      firstAbsSec: firstAbsSec == null ? null : +firstAbsSec.toFixed(1),
      absIn23_30: absorbers.some(a => (a.ms - c.t0Ms) > 23e3 && (a.ms - c.t0Ms) <= 30e3),
      absIn30_60: absorbers.some(a => (a.ms - c.t0Ms) > 30e3 && (a.ms - c.t0Ms) <= 60e3),
      verdict, sellOff: sellMs ? Math.round((sellMs - c.t0Ms) / 1000) : null,
      fwdRoi: fwdRoi == null ? null : +fwdRoi.toFixed(1), fwdMaxSec,
      realRoi: c.pnl.b > 0 ? +((c.pnl.s / c.pnl.b - 1) * 100).toFixed(1) : null,
    });
  }
  console.log(`mechanical burst 买点: ${rows.length}\n`);

  // 分桶
  const buckets = [
    ['A <10s（连续交易盘）', r => r.silenceSec < 10],
    ['B 10-60s', r => r.silenceSec >= 10 && r.silenceSec < 60],
    ['C 60-300s', r => r.silenceSec >= 60 && r.silenceSec < 300],
    ['D >300s（死票复活）', r => r.silenceSec >= 300],
  ];
  const pct = (n, d) => d ? (100 * n / d).toFixed(0) + '%' : '-';
  for (const [name, f] of buckets) {
    const g = rows.filter(f);
    if (!g.length) { console.log(`\n== ${name}: n=0`); continue; }
    const absBuckets = {
      '<=15s': g.filter(r => r.firstAbsSec != null && r.firstAbsSec <= 15).length,
      '15-23s': g.filter(r => r.firstAbsSec != null && r.firstAbsSec > 15 && r.firstAbsSec <= 23).length,
      '23-30s（快线后兜底前）': g.filter(r => r.firstAbsSec != null && r.firstAbsSec > 23 && r.firstAbsSec <= 30).length,
      '>30s': g.filter(r => r.firstAbsSec != null && r.firstAbsSec > 30).length,
      '30s 内无承接': g.filter(r => r.firstAbsSec == null).length,
    };
    const verdicts = {
      w1: g.filter(r => r.verdict === 'w1').length,
      'w2-fast': g.filter(r => r.verdict === 'w2-fast').length,
      'w2-final': g.filter(r => r.verdict === 'w2-final').length,
      release: g.filter(r => r.verdict === 'release').length,
    };
    const fast = g.filter(r => r.verdict === 'w2-fast');
    const fastFwd = fast.filter(r => r.fwdRoi != null).map(r => r.fwdRoi).sort((a, b) => a - b);
    const med = a => (a && a.length ? a[Math.floor(a.length / 2)] : null);
    console.log(`\n== ${name}: n=${g.length}`);
    console.log(`   首笔承接到达: ` + Object.entries(absBuckets).map(([k, v]) => `${k}=${v}(${pct(v, g.length)})`).join(' '));
    console.log(`   T189 重放判定: ` + Object.entries(verdicts).map(([k, v]) => `${k}=${v}`).join(' ')
      + ` | 承接落在(23,30]s=${g.filter(r => r.absIn23_30).length} 票（快线杀、兜底会放）`
      + ` | (30,60]s=${g.filter(r => r.absIn30_60).length} 票`);
    if (fast.length) {
      console.log(`   快线卖出后 +10min 前向: n=${fast.filter(r => r.fwdRoi != null).length} 中位=${med(fastFwd)}%`
        + ` >+50%=${fast.filter(r => r.fwdRoi != null && r.fwdRoi > 50).length} 票`
        + ` ≤0%=${fast.filter(r => r.fwdRoi != null && r.fwdRoi <= 0).length} 票`
        + ` | 实际整轮 ROI 中位=${med(g.filter(r => r.realRoi != null).map(r => r.realRoi).sort((a, b) => a - b))}%`);
    }
  }

  // 明细：D 桶 + 快线大错过票
  console.log('\n---- D 桶（>300s 死票复活）明细 ----');
  for (const r of rows.filter(r => r.silenceSec >= 300)) {
    console.log(`${r.win} ${r.tok} t0=${r.t0.slice(11, 19)} 静默=${r.silenceSec}s 波=${r.crewN}户/${r.crewBnb}B 首承接=${r.firstAbsSec}s 判定=${r.verdict}@${r.sellOff}s 前向=${r.fwdRoi == null ? '-' : r.fwdRoi + '%'} 实际=${r.realRoi == null ? '-' : r.realRoi + '%'} sbw=${r.sbwMeta}`);
  }
  console.log('\n---- 全部快线卖出且前向 >+50% 的票（跨桶） ----');
  for (const r of rows.filter(r => r.verdict === 'w2-fast' && r.fwdRoi != null && r.fwdRoi > 50)) {
    console.log(`${r.win} ${r.tok} t0=${r.t0.slice(11, 19)} 静默=${r.silenceSec}s 首承接=${r.firstAbsSec}s 卖@${r.sellOff}s 前向+10min=${r.fwdRoi}% 实际=${r.realRoi == null ? '-' : r.realRoi + '%'} sbw=${r.sbwMeta}`);
  }
  console.log('\n---- C 桶（60-300s）明细 ----');
  for (const r of rows.filter(r => r.silenceSec >= 60 && r.silenceSec < 300)) {
    console.log(`${r.win} ${r.tok} 静默=${r.silenceSec}s 波=${r.crewN}/${r.crewBnb}B 首承接=${r.firstAbsSec}s ${r.verdict}@${r.sellOff}s 前向=${r.fwdRoi == null ? '-' : r.fwdRoi + '%'} 实际=${r.realRoi == null ? '-' : r.realRoi + '%'}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
