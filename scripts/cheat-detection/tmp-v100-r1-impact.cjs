// 一次性（182 跑）：R1 线性反解 P0 影响面评估——bt-v100 全部 flap BUY 信号票
// 坑规避：wss_price_ticks token_address 无索引——.in() 多值超时，逐票单查 eq+order id+limit
// P0 = 2×(0.98×ΔB/ΔT) − postP（首笔线性反解；flap fee 0.98 入池口径）
// 旧锚 = min(FL常量, 首BUY行postP)（T130 现行）；新锚A = min(FL常量, P0)
// 信号价 = 信号 metadata.currentPriceBnb（BNB 域 fire 价）
const { dbManager } = require('../../src/services/dbManager.js');
const EXP = '11fc182a-b051-4665-857c-5c14e6713334';
const FL = 5.546e-9;
const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m) : (m || {}); } catch { return {}; } };

(async () => {
  const c = await dbManager.getClient();
  const { data: sigs, error: e1 } = await c.from('strategy_signals')
    .select('token_address,created_at,metadata')
    .eq('experiment_id', EXP).eq('signal_type', 'BUY').order('created_at');
  if (e1) throw new Error(e1.message);
  const byTok = new Map();
  for (const s of sigs || []) {
    if (!byTok.has(s.token_address)) byTok.set(s.token_address, s);
  }
  const toks = [...byTok.keys()];
  console.log(`BUY 信号 distinct token=${toks.length}`);
  const rows = [];
  for (let i = 0; i < toks.length; i++) {
    const addr = toks[i];
    let tk;
    try {
      ({ data: tk } = await c.from('wss_price_ticks')
        .select('block_time,trade_type,bnb_amount,token_amount,price_bnb,price_usd,quote_token')
        .eq('token_address', addr).order('id', { ascending: true }).limit(6));
    } catch (err) { console.log(`${addr.slice(0, 10)} ticks 查询失败跳过`); continue; }
    const list = tk || [];
    const first = list[0];
    const firstBuy = list.find((r) => r.trade_type === 'buy');
    if (!first || !firstBuy) continue;
    const b = Number(firstBuy.bnb_amount), t = Number(firstBuy.token_amount), p = Number(firstBuy.price_bnb);
    if (!(b > 0) || !(t > 0) || !(p > 0)) continue;
    const p0 = 2 * (0.98 * b / t) - p;
    const sig = byTok.get(addr);
    const m = parse(sig.metadata);
    // 信号 BNB 域价：metadata.price(USD 域) ÷ 首行隐含 rate(price_usd/price_bnb)
    const pu = Number(first.price_usd), pb = Number(first.price_bnb);
    const rate = pu > 0 && pb > 0 ? pu / pb : null;
    const sigPrice = rate && m.price ? Number(m.price) / rate : null;
    const oldAnchor = Math.min(FL, p);
    const newA = Math.min(FL, p0);
    const curVsOld = sigPrice ? (sigPrice / oldAnchor - 1) * 100 : null;
    const curVsNew = sigPrice ? (sigPrice / newA - 1) * 100 : null;
    rows.push({
      addr, quote: !!firstBuy.quote_token, p0, oldAnchor, newA, firstBuyBnb: b,
      firstBuyIsFirst: first === firstBuy,
      sigPrice, curVsOld, curVsNew,
    });
    if ((i + 1) % 50 === 0) console.log(`  …${i + 1}/${toks.length}`);
  }
  const bnb = rows.filter((r) => !r.quote), qt = rows.filter((r) => r.quote);
  console.log(`\n===== BNB 计价盘 ${bnb.length} 票：P0/FL 常量分布（首笔 ≥0.05 BNB 可信子集 / 尘埃子集）=====`);
  for (const [label, set] of [['全部', bnb], ['首笔≥0.05', bnb.filter((r) => r.firstBuyBnb >= 0.05)], ['首笔<0.05', bnb.filter((r) => r.firstBuyBnb < 0.05)]]) {
    const ratios = set.map((r) => r.p0 / FL).sort((a, b) => a - b);
    if (!ratios.length) continue;
    const q = (x) => ratios[Math.min(ratios.length - 1, Math.floor(x * ratios.length))];
    console.log(`${label} n=${ratios.length}: min=${ratios[0].toFixed(3)} p25=${q(0.25).toFixed(3)} 中位=${q(0.5).toFixed(3)} p75=${q(0.75).toFixed(3)} max=${ratios[ratios.length - 1].toFixed(3)}`);
  }
  const ratios = bnb.map((r) => r.p0 / FL).sort((a, b) => a - b);
  const q = (x) => ratios[Math.min(ratios.length - 1, Math.floor(x * ratios.length))];
  if (ratios.length) console.log(`P0/FL: min=${ratios[0].toFixed(4)} p25=${q(0.25).toFixed(4)} 中位=${q(0.5).toFixed(4)} p75=${q(0.75).toFixed(4)} max=${ratios[ratios.length - 1].toFixed(4)}`);
  console.log(`\n===== quote 盘 ${qt.length} 票：锚变化（新锚/旧锚−1）与 ΔcurVs =====`);
  const ds = qt.filter((r) => r.curVsNew !== null).map((r) => r.curVsNew - r.curVsOld).sort((a, b) => a - b);
  if (ds.length) console.log(`ΔcurVs pp: min=${ds[0].toFixed(1)} 中位=${ds[Math.floor(ds.length / 2)].toFixed(1)} max=${ds[ds.length - 1].toFixed(1)}`);
  const anch = qt.map((r) => r.newA / r.oldAnchor - 1).sort((a, b) => a - b);
  if (anch.length) console.log(`新锚/旧锚−1: min=${(anch[0] * 100).toFixed(1)}% 中位=${(anch[Math.floor(anch.length / 2)] * 100).toFixed(1)}% max=${(anch[anch.length - 1] * 100).toFixed(1)}%`);
  console.log(`\n===== 跨 28.5 门统计（首信号时刻）=====`);
  let oldPass = 0, newPass = 0, crossToReject = 0, crossToPass = 0, noPrice = 0;
  for (const r of rows) {
    if (r.curVsOld === null) { noPrice++; continue; }
    const o = r.curVsOld <= 28.5, n = r.curVsNew <= 28.5;
    if (o) oldPass++; if (n) newPass++;
    if (o && !n) crossToReject++; if (!o && n) crossToPass++;
  }
  console.log(`旧锚 ≤28.5（放行域）=${oldPass} 新锚A ≤28.5=${newPass} ；旧放→新拒=${crossToReject} 旧拒→新放=${crossToPass} 无信号价=${noPrice}`);
  console.log(`\n===== 明细（quote 盘全列 + BNB 盘抽查 12）=====`);
  for (const r of [...qt, ...bnb.slice(0, 12)]) {
    console.log(`${r.addr.slice(0, 10)} ${r.quote ? 'Q' : 'B'} ${r.firstBuyIsFirst ? '首✓' : '首✗'} P0=${r.p0.toExponential(4)} 旧=${r.oldAnchor.toExponential(4)} 新=${r.newA.toExponential(4)} curVs旧=${r.curVsOld === null ? '?' : r.curVsOld.toFixed(1)} 新=${r.curVsNew === null ? '?' : r.curVsNew.toFixed(1)}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
