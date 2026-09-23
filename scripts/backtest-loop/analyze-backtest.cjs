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
//   4 出场路径分组（策略腿 vs 回放结束强平）——卖侧迭代的核心观察
//   5 冲高回落机会：未吃到止盈（pnl<15）的轮按持仓期峰值分桶，peak−final 差值
//     = 追踪止盈腿的理论捕获空间（卖点迭代依据）
//   6 持仓时长 / 最差最好轮
//
// 轮次口径：单仓语义 per token 按时序 buy→开 / sell→闭；轮 PnL% 含每腿 0.5%
// 模拟手续费（PortfolioManager.executeTrade 余额扣费、trades 金额为费前值——
// 买成本=buy×1.005、卖回收=sell×0.995，与实验最终余额对账用此口径）。
// 峰值重建：peak% = ((1+p/100)/(1+dd/100)−1)×100，p/dd 取自卖出信号
// metadata.trendFactors（profitPercent / drawdownFromHighestSinceLastBuy，信号时刻快照；
// peak 为 running max，卖出时刻的 peak≈该轮全程峰值）。
//
// 读取量：trades+signals 数千行——建议 182 跑；本地可容忍。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../..', 'config/.env') });

const FEE = 0.005; // 每腿模拟手续费（与 PortfolioManager.executeTrade 默认值一致）
const feePct = (exitPrice, anchor) => ((exitPrice * (1 - FEE)) / (anchor * (1 + FEE)) - 1) * 100; // 含费往返 PnL%

function pctile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
const fmt = v => (v == null || !Number.isFinite(v)) ? '  n/a ' : (v >= 1000 || (v !== 0 && Math.abs(v) < 0.001) ? v.toExponential(2) : String(Math.round(v * 1000) / 1000).padStart(7));

async function main() {
  const a = process.argv;
  let expId = null, badThr = -20, goodThr = 20, cfMode = 1;
  for (let i = 2; i < a.length; i++) {
    if (a[i] === '--experiment') expId = a[++i];
    else if (a[i] === '--bad') badThr = parseFloat(a[++i]);
    else if (a[i] === '--good') goodThr = parseFloat(a[++i]);
    else if (a[i] === '--cf') cfMode = parseInt(a[++i], 10);
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

  // ── 买卖 trade 关联信号（买点因子快照 + 卖点出场路径/峰值重建）──
  const sigIds = [...new Set(trades.filter(t => t.signal_id).map(t => t.signal_id))];
  const sigMeta = new Map(); // signal_id → row
  // 100/批：uuid .in() URL 长度护栏（400×36B≈15KB 会被网关掐成 fetch failed）
  for (let i = 0; i < sigIds.length; i += 100) {
    const { data, error } = await sb.from('strategy_signals')
      .select('id,metadata,created_at').in('id', sigIds.slice(i, i + 100));
    if (error) throw new Error('signals 查询失败: ' + error.message);
    for (const s of (data || [])) sigMeta.set(s.id, s);
  }

  // ── 轮次配对（单仓：buy 开轮 → 下一笔 sell 闭轮）+ 未配对诊断 ──
  const byToken = new Map();
  for (const t of trades) {
    if (!byToken.has(t.token_address)) byToken.set(t.token_address, []);
    byToken.get(t.token_address).push(t);
  }
  const rounds = []; // {token, symbol, buyBnb, sellBnb, pnlPct, holdMs, sigFactors, exitStrategy, exitProfit, peakPct}
  let orphanBuys = 0, orphanBuyBnb = 0, orphanSells = 0; // buy 后无 sell（余额只出不进）/ 无仓 sell
  for (const [tok, list] of byToken) {
    let open = null;
    for (const t of list) {
      if (t.trade_direction === 'buy') {
        if (open) { orphanBuys++; orphanBuyBnb += parseFloat(open.t.input_amount) || 0; } // 连续 buy 覆盖（单仓语义理论不可达）
        open = { t };
      } else if (t.trade_direction === 'sell') {
        if (!open) { orphanSells++; continue; }
        const buyBnb = parseFloat(open.t.input_amount);   // 买：input=BNB（费前）
        const sellBnb = parseFloat(t.output_amount);      // 卖：output=BNB（费前）
        if (Number.isFinite(buyBnb) && buyBnb > 0 && Number.isFinite(sellBnb)) {
          const buySig = open.t.signal_id ? sigMeta.get(open.t.signal_id) : null;
          const sellSig = t.signal_id ? sigMeta.get(t.signal_id) : null;
          const stf = (sellSig && sellSig.metadata && sellSig.metadata.trendFactors) || {};
          const p = Number(stf.profitPercent), dd = Number(stf.drawdownFromHighestSinceLastBuy);
          // 峰值重建：current=buy×(1+p/100)、peak=current/(1+dd/100) → peak 涨幅
          let peakPct = null;
          if (Number.isFinite(p) && Number.isFinite(dd) && dd > -100) {
            peakPct = ((1 + p / 100) / (1 + dd / 100) - 1) * 100;
          }
          rounds.push({
            token: tok, symbol: t.token_symbol || open.t.token_symbol || '',
            buyBnb, sellBnb,
            buyUnit: parseFloat(open.t.unit_price), // 买入成交价（USD/枚，引擎 signal.price）
            pnlPct: ((sellBnb * (1 - FEE)) / (buyBnb * (1 + FEE)) - 1) * 100, // 含每腿 0.5% 费
            holdMs: new Date(t.created_at) - new Date(open.t.created_at),
            buyAt: open.t.created_at,
            sigFactors: buySig && buySig.metadata ? (buySig.metadata.trendFactors || {}) : {},
            exitStrategy: (sellSig && sellSig.metadata && sellSig.metadata.strategyName) || '未知',
            exitProfit: Number.isFinite(p) ? p : null,
            peakPct,
          });
        }
        open = null;
      }
    }
    if (open) { orphanBuys++; orphanBuyBnb += parseFloat(open.t.input_amount) || 0; } // 持仓未闭（强平跳过等）
  }

  // ── 1 总览 ──
  const pnls = rounds.map(r => r.pnlPct).sort((x, y) => x - y);
  const wins = pnls.filter(v => v > 0).length;
  const sumBnb = rounds.reduce((s, r) => s + (r.sellBnb * (1 - FEE) - r.buyBnb * (1 + FEE)), 0);
  const spentBnb = rounds.reduce((s, r) => s + r.buyBnb, 0);
  console.log('═'.repeat(76));
  console.log(`回测分析 ${expId.slice(0, 8)} | trades=${trades.length}（buy ${trades.filter(t => t.trade_direction === 'buy').length} / sell ${trades.filter(t => t.trade_direction === 'sell').length}）`);
  console.log(`轮次 ${rounds.length} | 胜率 ${(rounds.length ? (wins / rounds.length * 100).toFixed(1) : 0)}% | ΣPnL(含费) ${sumBnb.toFixed(4)} BNB（投入 ${spentBnb.toFixed(2)}）`);
  if (orphanBuys || orphanSells) {
    console.log(`⚠ 未配对：buy 无后续 sell ${orphanBuys} 笔（${orphanBuyBnb.toFixed(2)} BNB 只出不进）/ 无仓 sell ${orphanSells} 笔`);
  }
  if (pnls.length) {
    console.log(`PnL% 分位（含费）：P05 ${fmt(pctile(pnls, 0.05))} | P25 ${fmt(pctile(pnls, 0.25))} | P50 ${fmt(pctile(pnls, 0.5))} | P75 ${fmt(pctile(pnls, 0.75))} | P95 ${fmt(pctile(pnls, 0.95))} | 最差 ${fmt(pnls[0])} | 最好 ${fmt(pnls[pnls.length - 1])}`);
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

  // ── 4 出场路径分组（卖侧迭代核心观察）──
  console.log('── 出场路径 ──');
  const byExit = new Map();
  for (const r of rounds) {
    if (!byExit.has(r.exitStrategy)) byExit.set(r.exitStrategy, []);
    byExit.get(r.exitStrategy).push(r);
  }
  for (const [name, rs] of [...byExit.entries()].sort((x, y) => y[1].length - x[1].length)) {
    const sum = rs.reduce((s, r) => s + (r.sellBnb * (1 - FEE) - r.buyBnb * (1 + FEE)), 0);
    const holdP50 = pctile(rs.map(r => r.holdMs / 1000).sort((x, y) => x - y), 0.5);
    const peakP50 = pctile(rs.map(r => r.peakPct).filter(Number.isFinite).sort((x, y) => x - y), 0.5);
    console.log(`  ${String(name).slice(0, 24).padEnd(26)} n=${String(rs.length).padStart(4)} | ΣPnL ${sum.toFixed(4)} | 均值 ${(sum / rs.length * 10).toFixed(2)}‰ | hold P50 ${(holdP50 || 0).toFixed(0)}s | 峰值 P50 ${fmt(peakP50)}%`);
  }

  // ── 5 冲高回落机会（未吃到 +15 止盈的轮，按持仓期峰值分桶）──
  const flatR = rounds.filter(r => r.pnlPct < 15 && Number.isFinite(r.peakPct));
  console.log(`── 冲高回落机会：pnl<15% 的轮 n=${flatR.length}，按峰值分桶（final=实际出场，差值=追踪止盈理论捕获）──`);
  const pkBuckets = [[-1e9, 4], [4, 8], [8, 12], [12, 15], [15, 1e9]];
  for (const [lo, hi] of pkBuckets) {
    const rs = flatR.filter(r => r.peakPct >= lo && r.peakPct < hi);
    if (!rs.length) { console.log(`  峰值[${hi === 1e9 ? '≥15' : lo + '~' + hi}]  0`); continue; }
    const avgPeak = rs.reduce((s, r) => s + r.peakPct, 0) / rs.length;
    const avgFinal = rs.reduce((s, r) => s + r.pnlPct, 0) / rs.length;
    const label = hi === 1e9 ? '≥15(漏止盈!)' : lo === -1e9 ? '<4' : `${lo}~${hi}`;
    console.log(`  峰值[${label.padEnd(11)}] n=${String(rs.length).padStart(4)} | 峰值均值 ${avgPeak.toFixed(1)}% → 出场均值 ${avgFinal.toFixed(1)}% | 理论捕获 Σ ${(rs.reduce((s, r) => s + (r.peakPct - r.pnlPct), 0) * 0.1 / 100).toFixed(4)} BNB`);
  }

  // ── 5.6 死票 vs 活票 买点对比（买侧门设计主数据；全量非尾巴）──
  // 死票=强平出场且峰值<4%（从没起来过）；活票=其余（含止盈/止损但冲过的）。
  // 尾部差票对比（≤-20 vs ≥+20）样本个位数易过拟合——轮2 教训。
  const deadR = rounds.filter(r => r.exitStrategy === '回放结束强平' && Number.isFinite(r.peakPct) && r.peakPct < 4);
  const aliveR = rounds.filter(r => !(r.exitStrategy === '回放结束强平' && Number.isFinite(r.peakPct) && r.peakPct < 4));
  const deadSum = deadR.reduce((s, r) => s + (r.sellBnb * (1 - FEE) - r.buyBnb * (1 + FEE)), 0);
  console.log(`── 死/活票买点对比：死票(强平且峰值<4%) n=${deadR.length} Σ${deadSum.toFixed(4)} vs 活票 n=${aliveR.length} ──`);
  if (deadR.length >= 10 && aliveR.length >= 10) {
    const keySet = new Set();
    for (const r of rounds) for (const k of Object.keys(r.sigFactors)) keySet.add(k);
    const rows = [];
    for (const k of keySet) {
      const d = deadR.map(r => Number(r.sigFactors[k])).filter(Number.isFinite).sort((x, y) => x - y);
      const a = aliveR.map(r => Number(r.sigFactors[k])).filter(Number.isFinite).sort((x, y) => x - y);
      if (!d.length || !a.length) continue;
      const d50 = pctile(d, 0.5), a50 = pctile(a, 0.5);
      const sep = Math.abs(d50 - a50) / (Math.abs(d50) + Math.abs(a50) + 1e-12);
      rows.push({ k, d25: pctile(d, 0.25), d50, d75: pctile(d, 0.75), a25: pctile(a, 0.25), a50, a75: pctile(a, 0.75), sep });
    }
    rows.sort((x, y) => y.sep - x.sep);
    console.log('  键'.padEnd(28) + '死票P25/P50/P75'.padEnd(30) + '活票P25/P50/P75'.padEnd(30) + '分离度');
    for (const r of rows.slice(0, 15)) {
      console.log('  ' + r.k.padEnd(26) +
        `${fmt(r.d25)}/${fmt(r.d50)}/${fmt(r.d75)}`.padEnd(30) +
        `${fmt(r.a25)}/${fmt(r.a50)}/${fmt(r.a75)}`.padEnd(30) +
        (r.sep * 100).toFixed(0) + '%');
    }
    // 单门预筛：按已录买点因子过滤轮次的存活 Σ（近似：忽略买入时点位移，
    // 方向性粗筛——正增益才值得回放验证）
    console.log('  ── 单门预筛（过滤后 ΣPnL，Δ=相对全量 Σ；近似忽略买入延迟效应）──');
    const fullSum = rounds.reduce((s, r) => s + (r.sellBnb * (1 - FEE) - r.buyBnb * (1 + FEE)), 0);
    const cands = [
      ['earlyReturn', '<', 20], ['earlyReturn', '<', 30], ['earlyReturn', '<', 40],
      ['earlyReturn', '>', 1], ['earlyReturn', '>', 2], ['earlyReturn', '>', 4],
      ['top3HolderShare', '<', 0.10], ['top3HolderShare', '<', 0.15], ['top3HolderShare', '>', 0.005],
      ['top5HolderShare', '<', 0.12],
      ['riseSpeed', '<', 30], ['riseSpeed', '<', 60], ['riseSpeed', '>', 0.5], ['riseSpeed', '>', 1],
      ['age', '>', 0.5], ['age', '>', 1], ['age', '>', 2],
      ['trendCV', '<', 0.08], ['trendCV', '<', 0.12], ['trendCV', '>', 0.01],
      ['txVolumeU24h', '>', 50], ['txVolumeU24h', '>', 100], ['txVolumeU24h', '>', 200],
      ['firstBlockBuyShare', '<', 0.5], ['firstBlockBuyShare', '<', 0.3],
      ['tradeCount', '>=', 5], ['tradeCount', '>=', 8],
      ['counterpartyOverlapRate', '<', 0.35],
      ['holders', '>=', 3], ['holders', '>=', 4], ['holders', '>=', 6],
      ['maxBlockDropPct', '<', 3],
      ['bigHolderTotal', '==', 0],
    ];
    const pass = (r, k, op, thr) => {
      const v = Number(r.sigFactors[k]);
      if (!Number.isFinite(v)) return false;
      return op === '<' ? v < thr : op === '>' ? v > thr : op === '>=' ? v >= thr : op === '==' ? v === thr : false;
    };
    for (const [k, op, thr] of cands) {
      const keep = rounds.filter(r => pass(r, k, op, thr));
      if (!keep.length) continue;
      const sum = keep.reduce((s, r) => s + (r.sellBnb * (1 - FEE) - r.buyBnb * (1 + FEE)), 0);
      const delta = sum - fullSum;
      const killed = rounds.length - keep.length;
      console.log(`    ${k} ${op} ${thr}`.padEnd(28) + `存 ${String(keep.length).padStart(4)}/${rounds.length} 删${String(killed).padStart(4)} | Σ ${sum.toFixed(4)} Δ ${(delta >= 0 ? '+' : '') + delta.toFixed(4)} | 死票余 ${keep.filter(r => deadR.includes(r)).length}`);
    }
    // 组合门预筛（语义互补方向的合取；两门/三门）
    const combos = [
      [['maxBlockDropPct', '<', 3], ['txVolumeU24h', '>', 100]],
      [['maxBlockDropPct', '<', 3], ['earlyReturn', '>', 1]],
      [['maxBlockDropPct', '<', 3], ['holders', '>=', 3]],
      [['txVolumeU24h', '>', 100], ['holders', '>=', 3]],
      [['txVolumeU24h', '>', 100], ['age', '>', 1]],
      [['maxBlockDropPct', '<', 3], ['txVolumeU24h', '>', 100], ['counterpartyOverlapRate', '<', 0.35]],
      [['maxBlockDropPct', '<', 3], ['txVolumeU24h', '>', 100], ['holders', '>=', 3]],
      [['maxBlockDropPct', '<', 3], ['earlyReturn', '>', 1], ['counterpartyOverlapRate', '<', 0.35]],
    ];
    console.log('  ── 组合门预筛 ──');
    for (const gates of combos) {
      const keep = rounds.filter(r => gates.every(([k, op, thr]) => pass(r, k, op, thr)));
      if (!keep.length) continue;
      const sum = keep.reduce((s, r) => s + (r.sellBnb * (1 - FEE) - r.buyBnb * (1 + FEE)), 0);
      const delta = sum - fullSum;
      console.log(`    ${gates.map(g => g.join(' ')).join(' AND ')}`.slice(0, 60).padEnd(62) +
        `存 ${String(keep.length).padStart(4)} | Σ ${sum.toFixed(4)} Δ ${(delta >= 0 ? '+' : '') + delta.toFixed(4)} | 死票余 ${keep.filter(r => deadR.includes(r)).length}`);
    }
  }

  // ── 6 卖点反事实模拟（tick 级；--cf 0 跳过）──
  // 对每轮用 wss_price_ticks 价格路径模拟候选卖腿组合，先跑"基线模拟"自校验
  // （Σ 应接近实际 ΣPnL——成交近似=tick 价、费 1% 往返），再网格对比增益。
  // 腿语义与引擎一致：profitPercent=价格比值；bailM=holdDuration>M 分钟且水下；
  // trail(P,D)=峰值涨超 P% 后从峰值价回撤 D%。
  if (cfMode) {
    const t0 = Date.now();
    const roundTokens = [...new Set(rounds.map(r => r.token))];
    const ticksByTok = new Map();
    let totalTicks = 0;
    for (let i = 0; i < roundTokens.length; i += 100) {
      const batch = roundTokens.slice(i, i + 100);
      // 批内 range 分页拉全（无分页默认截 1000 行=只覆盖最热 token，模拟失真）
      for (let off = 0; ; off += 1000) {
        const { data, error } = await sb.from('wss_price_ticks')
          .select('token_address,price_usd,block_time').in('token_address', batch)
          .order('block_time', { ascending: true }).range(off, off + 999);
        if (error) throw new Error('ticks 查询失败: ' + error.message);
        for (const tk of (data || [])) {
          if (!Number.isFinite(+tk.price_usd) || +tk.price_usd <= 0) continue;
          if (!ticksByTok.has(tk.token_address)) ticksByTok.set(tk.token_address, []);
          ticksByTok.get(tk.token_address).push({ u: +tk.price_usd, t: Date.parse(tk.block_time) });
          totalTicks++;
        }
        if (!data || data.length < 1000) break;
      }
    }
    for (const arr of ticksByTok.values()) arr.sort((x, y) => x.t - y.t);

    // 模拟一轮：legs={takeThr?, stopThr?, bailMin?, trailP?, trailDd?}；返回 {pnlPct, exitLeg}
    // 锚点=买入 trade 的 unit_price（引擎实际成交价，USD/枚）——消除 tick 锚定时误差；
    // 路径用 tick.price_usd（与锚同单位）。
    const simulate = (r, legs) => {
      const ticks = ticksByTok.get(r.token);
      if (!ticks || !ticks.length || !(r.buyUnit > 0)) return null;
      const buyT = Date.parse(r.buyAt), sellT = buyT + r.holdMs;
      const anchor = r.buyUnit;
      const take = legs.takeThr != null ? legs.takeThr : 15;
      const stop = legs.stopThr != null ? -legs.stopThr : -15;
      let peak = anchor;
      let last = null;
      for (const tk of ticks) {
        if (tk.t < buyT) continue;
        if (tk.t > sellT) break;
        last = tk;
        const p = (tk.u / anchor - 1) * 100;
        if (tk.u > peak) peak = tk.u;
        if (p >= take) return { pnlPct: feePct(tk.u, anchor), exitLeg: 'take' };
        if (p <= stop) return { pnlPct: feePct(tk.u, anchor), exitLeg: 'stop' };
        if (legs.bailMin != null && (tk.t - buyT) >= legs.bailMin * 60000 && p < 0) {
          return { pnlPct: feePct(tk.u, anchor), exitLeg: 'bail' };
        }
        if (legs.trailP != null && peak >= anchor * (1 + legs.trailP / 100) && tk.u <= peak * (1 - legs.trailDd / 100)) {
          return { pnlPct: feePct(tk.u, anchor), exitLeg: 'trail' };
        }
      }
      // 无触发 → 按末 tick 冻价强平
      return last ? { pnlPct: feePct(last.u, anchor), exitLeg: 'force' } : null;
    };

    const configs = [
      { name: '基线±15(自校验)', legs: {} },
      { name: 'bail3', legs: { bailMin: 3 } },
      { name: 'bail5', legs: { bailMin: 5 } },
      { name: 'bail8', legs: { bailMin: 8 } },
      { name: 'trail(6,6)', legs: { trailP: 6, trailDd: 6 } },
      { name: 'trail(8,6)', legs: { trailP: 8, trailDd: 6 } },
      { name: 'trail(10,8)', legs: { trailP: 10, trailDd: 8 } },
      { name: 'bail5+trail(6,6)', legs: { bailMin: 5, trailP: 6, trailDd: 6 } },
      { name: 'bail5+trail(8,6)', legs: { bailMin: 5, trailP: 8, trailDd: 6 } },
      { name: 'bail3+trail(8,6)', legs: { bailMin: 3, trailP: 8, trailDd: 6 } },
      // 阈值微调网格（轮5 候选；take/stop 可参变）
      { name: 'bail5·take12', legs: { bailMin: 5, takeThr: 12 } },
      { name: 'bail5·take18', legs: { bailMin: 5, takeThr: 18 } },
      { name: 'bail5·take20', legs: { bailMin: 5, takeThr: 20 } },
      { name: 'bail5·stop10', legs: { bailMin: 5, stopThr: 10 } },
      { name: 'bail5·stop12', legs: { bailMin: 5, stopThr: 12 } },
      { name: 'bail5·stop8', legs: { bailMin: 5, stopThr: 8 } },
      { name: 'bail2', legs: { bailMin: 2 } },
      { name: 'bail4', legs: { bailMin: 4 } },
      { name: 'bail7', legs: { bailMin: 7 } },
    ];
    const actualSumBnb = rounds.reduce((s, r) => s + (r.sellBnb * (1 - FEE) - r.buyBnb * (1 + FEE)), 0);
    console.log(`── 卖点反事实模拟（${ticksByTok.size}/${roundTokens.length} token ${totalTicks} ticks，${Date.now() - t0}ms；实际 Σ=${actualSumBnb.toFixed(4)} BNB）──`);
    console.log('  配置'.padEnd(20) + 'ΣPnL(BNB)'.padEnd(11) + 'Δ实际'.padEnd(10) + 'take/stop/bail/trail/强平');
    const baseRes = rounds.map(r => ({ r, sim: simulate(r, {}) }));
    for (const cfg of configs) {
      const res = rounds.map(r => simulate(r, cfg.legs)).filter(Boolean);
      const sum = res.reduce((s, x) => s + x.pnlPct / 100 * 0.1, 0); // 每轮投入 0.1 BNB
      const cnt = k => res.filter(x => x.exitLeg === k).length;
      const delta = sum - actualSumBnb;
      console.log('  ' + cfg.name.padEnd(18) + sum.toFixed(4).padEnd(11) + (delta >= 0 ? '+' : '') + delta.toFixed(4).padEnd(9) +
        `${cnt('take')}/${cnt('stop')}/${cnt('bail')}/${cnt('trail')}/${cnt('force')}`);
    }
    // 自校验失配 top（模拟基线 vs 实际逐轮差——成交近似系统性偏差定位）
    const diffs = baseRes.filter(x => x.sim).map(x => ({
      r: x.r, d: x.sim.pnlPct - x.r.pnlPct, sim: x.sim.pnlPct, act: x.r.pnlPct,
      leg: x.r.exitStrategy, hold: x.r.holdMs / 1000,
    })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    console.log('  ── 模拟 vs 实际 失配 top10（定位成交近似偏差）──');
    for (const x of diffs.slice(0, 10)) {
      console.log(`    diff ${x.d >= 0 ? '+' : ''}${x.d.toFixed(1).padStart(6)}pp  sim ${x.sim.toFixed(1).padStart(7)}% vs 实际 ${x.act.toFixed(1).padStart(7)}%  hold=${x.hold.toFixed(0)}s [${x.leg.slice(0, 10)}] ${x.r.symbol.slice(0, 10)} ${x.r.token.slice(0, 10)}`);
    }
  }

  // ── 7 持仓时长 / 极值轮 ──
  const holds = rounds.map(r => r.holdMs / 1000).sort((x, y) => x - y);
  if (holds.length) {
    console.log(`── 持仓时长(s)：P25 ${fmt(pctile(holds, 0.25))} | P50 ${fmt(pctile(holds, 0.5))} | P75 ${fmt(pctile(holds, 0.75))} | P95 ${fmt(pctile(holds, 0.95))}`);
  }
  const worst = rounds.slice().sort((x, y) => x.pnlPct - y.pnlPct).slice(0, 8);
  const best = rounds.slice().sort((x, y) => y.pnlPct - x.pnlPct).slice(0, 8);
  console.log('── 最差 8 轮 ──');
  for (const r of worst) console.log(`  ${r.pnlPct.toFixed(1).padStart(7)}%  ${String(r.symbol).slice(0, 12).padEnd(13)} hold=${(r.holdMs / 1000).toFixed(0)}s 峰值=${fmt(r.peakPct)}% [${r.exitStrategy.slice(0, 12)}]  ${r.token.slice(0, 10)}`);
  console.log('── 最好 8 轮 ──');
  for (const r of best) console.log(`  ${r.pnlPct.toFixed(1).padStart(7)}%  ${String(r.symbol).slice(0, 12).padEnd(13)} hold=${(r.holdMs / 1000).toFixed(0)}s 峰值=${fmt(r.peakPct)}% [${r.exitStrategy.slice(0, 12)}]  ${r.token.slice(0, 10)}`);
  console.log('═'.repeat(76));
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
