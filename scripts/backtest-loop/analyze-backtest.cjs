#!/usr/bin/env node
// ============================================================================
// 回测迭代工作台——结果分析（轮次盈亏 + 差票/好票买点因子对比，2026-09-23）
//
// 输入：--experiment <回测实验id>
// 产出（控制台中文报告）：
//   1 总览：轮次/胜率/ΣPnL/最好最差/未平仓
//   2 盈亏分布直方
//   3 差票（轮 PnL% ≤ --bad 阈，默认 -20）vs 好票（≥ --good 阈，默认 +20）
//     买点信号 metadata.trendFactors 各数值键 P25/P50/P75 对比（找区分度=下一轮门槛候选）
//   4 卖点观察：持仓时长/卖点位置
//
// 轮次口径：单仓语义 per token 按时序 buy→开 / sell→闭；轮 PnL% =（卖出回收 BNB /
// 买入花费 BNB − 1）×100（模拟成交额已含 0.5% 手续费）。买点因子经 trade.signal_id
// 关联 BUY 信号 metadata（触发时刻快照，12+2 观察子集+旧趋势键）。
//
// 读取量：trades+signals 数千行——建议 182 跑；本地可容忍。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../..', 'config/.env') });

function pctile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
const fmt = v => (v == null || !Number.isFinite(v)) ? '  n/a ' : (v >= 1000 || (v !== 0 && Math.abs(v) < 0.001) ? v.toExponential(2) : String(Math.round(v * 1000) / 1000).padStart(7));

async function main() {
  const a = process.argv;
  let expId = null, badThr = -20, goodThr = 20;
  for (let i = 2; i < a.length; i++) {
    if (a[i] === '--experiment') expId = a[++i];
    else if (a[i] === '--bad') badThr = parseFloat(a[++i]);
    else if (a[i] === '--good') goodThr = parseFloat(a[++i]);
    else { console.error(`未知参数: ${a[i]}`); process.exit(1); }
  }
  if (!expId) { console.error('缺 --experiment <id>'); process.exit(1); }

  const { dbManager } = require('../../src/services/dbManager');
  const sb = dbManager.getClient();

  // ── 拉 trades（offset 分页，行数数千级）──
  const trades = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb.from('trades')
      .select('id,token_address,token_symbol,trade_direction,input_amount,output_amount,input_currency,output_currency,unit_price,signal_id,created_at,metadata')
      .eq('experiment_id', expId).order('created_at', { ascending: true }).range(off, off + 999);
    if (error) throw new Error('trades 查询失败: ' + error.message);
    trades.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  if (!trades.length) { console.log('无 trades 行——实验未跑或未产生交易'); process.exit(0); }

  // ── 买 trade 关联信号（买点因子快照）──
  const buySigIds = [...new Set(trades.filter(t => t.trade_direction === 'buy' && t.signal_id).map(t => t.signal_id))];
  const sigMeta = new Map(); // signal_id → {trendFactors, price, createdAt}
  // 100/批：uuid .in() URL 长度护栏（400×36B≈15KB 会被网关掐成 fetch failed）
  for (let i = 0; i < buySigIds.length; i += 100) {
    const { data, error } = await sb.from('strategy_signals')
      .select('id,metadata,created_at').in('id', buySigIds.slice(i, i + 100));
    if (error) throw new Error('signals 查询失败: ' + error.message);
    for (const s of (data || [])) sigMeta.set(s.id, s);
  }

  // ── 轮次配对（单仓：buy 开轮 → 下一笔 sell 闭轮）──
  const byToken = new Map();
  for (const t of trades) {
    if (!byToken.has(t.token_address)) byToken.set(t.token_address, []);
    byToken.get(t.token_address).push(t);
  }
  const rounds = []; // {token, symbol, buyBnb, sellBnb, pnlPct, holdMs, sigFactors, buyAt}
  let open = null;
  for (const [tok, list] of byToken) {
    open = null;
    for (const t of list) {
      if (t.trade_direction === 'buy') {
        open = { t };
      } else if (t.trade_direction === 'sell' && open) {
        const buyBnb = parseFloat(open.t.input_amount);   // 买：input=BNB
        const sellBnb = parseFloat(t.output_amount);      // 卖：output=BNB
        if (Number.isFinite(buyBnb) && buyBnb > 0 && Number.isFinite(sellBnb)) {
          const sig = open.t.signal_id ? sigMeta.get(open.t.signal_id) : null;
          rounds.push({
            token: tok, symbol: t.token_symbol || open.t.token_symbol || '',
            buyBnb, sellBnb,
            pnlPct: (sellBnb / buyBnb - 1) * 100,
            holdMs: new Date(t.created_at) - new Date(open.t.created_at),
            buyAt: open.t.created_at,
            sigFactors: sig && sig.metadata ? (sig.metadata.trendFactors || {}) : {},
          });
        }
        open = null;
      }
    }
  }
  const openCnt = 0; // 回放结束强平后应无持仓；byToken 循环里 open>0 计入（简化：强平=已卖）

  // ── 1 总览 ──
  const pnls = rounds.map(r => r.pnlPct).sort((x, y) => x - y);
  const wins = pnls.filter(v => v > 0).length;
  const sumBnb = rounds.reduce((s, r) => s + (r.sellBnb - r.buyBnb), 0);
  const spentBnb = rounds.reduce((s, r) => s + r.buyBnb, 0);
  console.log('═'.repeat(76));
  console.log(`回测分析 ${expId.slice(0, 8)} | trades=${trades.length}（buy ${trades.filter(t => t.trade_direction === 'buy').length} / sell ${trades.filter(t => t.trade_direction === 'sell').length}）`);
  console.log(`轮次 ${rounds.length} | 胜率 ${(rounds.length ? (wins / rounds.length * 100).toFixed(1) : 0)}% | ΣPnL ${sumBnb.toFixed(4)} BNB（投入 ${spentBnb.toFixed(2)}）`);
  if (pnls.length) {
    console.log(`PnL% 分位：P05 ${fmt(pctile(pnls, 0.05))} | P25 ${fmt(pctile(pnls, 0.25))} | P50 ${fmt(pctile(pnls, 0.5))} | P75 ${fmt(pctile(pnls, 0.75))} | P95 ${fmt(pctile(pnls, 0.95))} | 最差 ${fmt(pnls[0])} | 最好 ${fmt(pnls[pnls.length - 1])}`);
  }

  // ── 2 盈亏分布 ──
  const buckets = [[-1e9, -50], [-50, -20], [-20, 0], [0, 15], [15, 50], [50, 1e9]];
  console.log('── 盈亏分布 ──');
  for (const [lo, hi] of buckets) {
    const n = pnls.filter(v => v >= lo && v < hi).length;
    const label = hi === 1e9 ? `≥50%` : lo === -1e9 ? `<-50%` : `${lo}~${hi}%`;
    console.log(`  ${label.padEnd(9)} ${String(n).padStart(4)}  ${'█'.repeat(Math.round(n / Math.max(1, pnls.length) * 60))}`);
  }

  // ── 3 差票 vs 好票 买点因子对比 ──
  const badR = rounds.filter(r => r.pnlPct <= badThr);
  const goodR = rounds.filter(r => r.pnlPct >= goodThr);
  console.log(`── 买点因子对比：差票(≤${badThr}%) n=${badR.length} vs 好票(≥${goodThr}%) n=${goodR.length} ──`);
  if (badR.length >= 3 && goodR.length >= 3) {
    const keySet = new Set();
    for (const r of [...badR, ...goodR]) for (const k of Object.keys(r.sigFactors)) keySet.add(k);
    const rows = [];
    for (const k of keySet) {
      const b = badR.map(r => Number(r.sigFactors[k])).filter(Number.isFinite).sort((x, y) => x - y);
      const g = goodR.map(r => Number(r.sigFactors[k])).filter(Number.isFinite).sort((x, y) => x - y);
      if (!b.length || !g.length) continue;
      const b50 = pctile(b, 0.5), g50 = pctile(g, 0.5);
      const sep = Math.abs(b50 - g50) / (Math.abs(b50) + Math.abs(g50) + 1e-12); // 相对分离度
      rows.push({ k, b25: pctile(b, 0.25), b50, b75: pctile(b, 0.75), g25: pctile(g, 0.25), g50, g75: pctile(g, 0.75), sep, nb: b.length, ng: g.length });
    }
    rows.sort((x, y) => y.sep - x.sep);
    console.log('  键'.padEnd(28) + '差票P25/P50/P75'.padEnd(30) + '好票P25/P50/P75'.padEnd(30) + '分离度');
    for (const r of rows.slice(0, 18)) {
      console.log('  ' + r.k.padEnd(26) +
        `${fmt(r.b25)}/${fmt(r.b50)}/${fmt(r.b75)}`.padEnd(30) +
        `${fmt(r.g25)}/${fmt(r.g50)}/${fmt(r.g75)}`.padEnd(30) +
        (r.sep * 100).toFixed(0) + '%');
    }
  } else {
    console.log('  （差票或好票样本 <3，跳过因子对比）');
  }

  // ── 4 卖点观察 ──
  const holds = rounds.map(r => r.holdMs / 1000).sort((x, y) => x - y);
  if (holds.length) {
    console.log(`── 持仓时长(s)：P25 ${fmt(pctile(holds, 0.25))} | P50 ${fmt(pctile(holds, 0.5))} | P75 ${fmt(pctile(holds, 0.75))} | P95 ${fmt(pctile(holds, 0.95))}`);
  }
  const worst = rounds.slice().sort((x, y) => x.pnlPct - y.pnlPct).slice(0, 8);
  const best = rounds.slice().sort((x, y) => y.pnlPct - x.pnlPct).slice(0, 8);
  console.log('── 最差 8 轮 ──');
  for (const r of worst) console.log(`  ${r.pnlPct.toFixed(1).padStart(7)}%  ${String(r.symbol).slice(0, 12).padEnd(13)} hold=${(r.holdMs / 1000).toFixed(0)}s  ${r.token.slice(0, 10)}`);
  console.log('── 最好 8 轮 ──');
  for (const r of best) console.log(`  ${r.pnlPct.toFixed(1).padStart(7)}%  ${String(r.symbol).slice(0, 12).padEnd(13)} hold=${(r.holdMs / 1000).toFixed(0)}s  ${r.token.slice(0, 10)}`);
  console.log('═'.repeat(76));
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
