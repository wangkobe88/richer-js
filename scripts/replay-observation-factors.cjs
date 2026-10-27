#!/usr/bin/env node
/**
 * T74/T76 观察键历史回放——fire 票池 as-of 快照值与分布（2026-10-27 用户裁定
 * 「增加的特征，可以利用历史数据算一下值」；阈值定标前置）。
 *
 * 回放口径（与 FA live 读数对齐，源码口径逐条对 FourMemeFactorAggregator）：
 *   - 尘 tick：bnb_amount >= 0.001（collector minTickBnb 默认，<门不进因子域——
 *     本脚本对齐 live 引擎读数；回测原样喂的 ~+0.2% 偏差不适用）
 *   - wallet = sender_address || trader_address || null（null 行计量不计人）
 *   - buyWallets = K 组 _buyerAddresses 全史 Set size（曾买入即计入、清仓不回退）
 *   - buyVolumeBnb = totalBuyBnb（Σ买腿 bnb；quote 盘 bnb_amount 已是 BNB 域）
 *   - circTokens = Σ买 token − Σ卖 token（全量行——价格段累计，与 wallet 有无无关）
 *   - evenCluster 三键（T74/T78）：合格桶=同额桶（amountKey=四位舍入 0.0001 BNB——
 *     T78 回放反证 6 位严格键对微差规避形状恒 0）size>=3；
 *     尘门 earlyUniformDustBnb=0.01；分子=并集钱包当前正净持仓合计
 *     （_walletNetTokens 仅 wallet 非空行累计）；round1
 *   - gmgnVisitorsPerBuyer/PerBuyBnb（T76）：signal metadata.gmgnCheck.factors 的
 *     visitingCount ÷ fire 时刻 buyWallets/buyVolumeBnb——比值语义直接复用
 *     GmgnRiskCheckService.computeGmgnAttentionFactors（单一真相源，round1/零值
 *     语义/covered 门全同源）
 *   - 盈亏 = trades per (experiment, token) 净额 BNB：Σ(sell output)−Σ(buy input)
 *
 * 输出：per-signal CSV（--out 缺省打印表头+行到 stdout）+ 分布汇总
 * （各键分位数 + 比值/evenCluster 盈亏分桶对照——阈值定标依据）。
 * 在 182 跑（红线：重查询不去本地）：
 *   node scripts/replay-observation-factors.cjs [--since 2026-10-01] [--out <csv>]
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env') });
const path = require('path');
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');
const { GmgnRiskCheckService } = require('../src/trading-engine/pre-check/GmgnRiskCheckService');

// ── 参数 ──
const argv = process.argv.slice(2);
const argStr = (name) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
const SINCE = argStr('--since');                       // ISO 日期，signal created_at 下界
const OUT = argStr('--out');                           // CSV 输出文件（缺省 stdout）
const MIN_TICK_BNB = 0.001;                            // collector 尘 tick 门（live 因子域）
const DUST_BNB = 0.01;                                 // earlyUniformDustBnb（等额桶尘门，FA _fp 默认）
const PAGE = 1000;                                     // PostgREST max-rows 上限

let db;                                                // main 内初始化（被单测 require 时不碰 DB）

// ── 分页拉取（range 循环）──
async function fetchAll(table, select, extra, orderCol = 'id') {
  const rows = [];
  for (;;) {
    let q = db.from(table).select(select).order(orderCol, { ascending: true }).range(rows.length, rows.length + PAGE - 1);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} 拉取失败: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

// ── per-token 回放器：ticks 按 block_time 升序一次扫描，signal 截断点出快照 ──
// （累计量（Σ/Set/净持仓 map）全部交换律 → 与链上真序等价；_buyerAddresses/
//   evenBuyBuckets 的 Set.add 幂等 → defer 乱序回推收敛，同 FA 注释口径）
function replayToken(ticks, signals) {
  // signals: 按 firedMs 升序；tick 全量已含该 token（块过滤按 firedMs 截断）
  const st = {
    buyWallets: new Set(),
    buyVolumeBnb: 0,
    circTokens: 0,
    netTokens: new Map(),      // wallet → Σ买 token − Σ卖 token
    evenBuckets: new Map(),    // amountKey → Set(wallet)
  };
  const out = [];
  let ti = 0;
  for (const sig of signals) {
    for (; ti < ticks.length; ti++) {
      const t = ticks[ti];
      const ts = new Date(t.block_time).getTime();
      if (ts > sig.firedMs) break;
      const bnb = Number(t.bnb_amount) || 0;
      if (bnb < MIN_TICK_BNB) continue;                      // 尘 tick：live 因子域外
      const isBuy = t.trade_type === 'buy';
      const tok = Number(t.token_amount) || 0;
      const wallet = t.sender_address || t.trader_address || null;
      if (isBuy) {
        st.buyVolumeBnb += bnb;
        st.circTokens += tok;
        if (wallet) {
          st.buyWallets.add(wallet);
          if (bnb >= DUST_BNB) {
            // T78 四位舍入键（微差规避形状反证，与 FA 同改）
            const k = (Math.round(bnb * 1e4) / 1e4).toFixed(4);
            let s = st.evenBuckets.get(k);
            if (!s) { s = new Set(); st.evenBuckets.set(k, s); }
            s.add(wallet);
          }
        }
      } else {
        st.circTokens -= tok;
      }
      if (wallet && tok > 0) {
        st.netTokens.set(wallet, (st.netTokens.get(wallet) || 0) + (isBuy ? tok : -tok));
      }
    }
    // evenCluster 三键（读点口径照抄 _bundleClusterFactors 尾段）
    let evenUnion = null, evenGroups = 0;
    for (const ws of st.evenBuckets.values()) {
      if (ws.size < 3) continue;
      evenGroups++;
      if (!evenUnion) evenUnion = new Set();
      for (const w of ws) evenUnion.add(w);
    }
    let evenHold = 0;
    if (evenUnion) for (const w of evenUnion) { const v = st.netTokens.get(w); if (v > 0) evenHold += v; }
    const evenPct = evenHold > 0 && st.circTokens > 0 ? evenHold / st.circTokens * 100 : 0;

    // gmgn 比值（T76 单一真相源；covered≠1 形状内函数自处理）
    const g = sig.vc != null
      ? GmgnRiskCheckService.computeGmgnAttentionFactors(
          { gmgnRiskCovered: sig.vcCovered, gmgnVisitingCount: sig.vc }, st.buyWallets.size, st.buyVolumeBnb)
      : null;

    out.push({
      ...sig.row,
      buyWallets: st.buyWallets.size,
      buyVolumeBnb: Math.round(st.buyVolumeBnb * 1e6) / 1e6,
      circTokens: st.circTokens,
      evenClusterHoldCircPct: Math.round(evenPct * 10) / 10,
      evenClusterWallets: evenUnion ? evenUnion.size : 0,
      evenClusterGroups: evenGroups,
      vc: sig.vc,
      vcCovered: sig.vcCovered,
      visitorsPerBuyer: g ? g.gmgnVisitorsPerBuyer : null,
      visitorsPerBuyBnb: g ? g.gmgnVisitorsPerBuyBnb : null,
    });
  }
  return out;
}

// ── 分位数/分桶工具 ──
function quantiles(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const q = (p) => s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null;
  return { n: s.length, p25: q(0.25), p50: q(0.50), p75: q(0.75), p90: q(0.90), p95: q(0.95), max: s.length ? s[s.length - 1] : null };
}
function bucketStats(rows, keyFn, label) {
  const buckets = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null) continue;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }
  const lines = [];
  for (const [k, rs] of buckets) {
    const pnls = rs.map(r => r.pnl_bnb).filter(v => v != null);
    if (pnls.length === 0) continue;
    const wins = pnls.filter(v => v > 0).length;
    const sum = pnls.reduce((a, b) => a + b, 0);
    lines.push(`    ${label}=${k}: n=${rs.length} 有盈亏=${pnls.length} 胜率=${(wins / pnls.length * 100).toFixed(0)}% 净额合计=${sum.toFixed(3)} BNB 均值=${(sum / pnls.length).toFixed(4)}`);
  }
  return lines;
}

async function main() {
  db = dbManager.getClient();
  console.log(`[1/3] 拉 BUY 信号${SINCE ? `（since ${SINCE}）` : ''}…`);
  const sigFilter = (q) => {
    q = q.eq('signal_type', 'BUY');
    if (SINCE) q = q.gte('created_at', SINCE);
    return q;
  };
  const signals = await fetchAll('strategy_signals',
    'id,experiment_id,token_address,created_at,metadata', sigFilter, 'id');
  console.log(`  ${signals.length} 条`);

  // metadata 取 vc（gmgnCheck 审计两路径都落 factors；covered=0 行为 fail-open 形状）
  const sigList = signals.map(s => {
    const f = s.metadata && s.metadata.gmgnCheck && s.metadata.gmgnCheck.factors;
    const vc = f && typeof f.gmgnVisitingCount === 'number' ? f.gmgnVisitingCount : null;
    const vcCovered = f ? f.gmgnRiskCovered : null;
    return {
      row: { id: s.id, experiment_id: s.experiment_id, token: s.token_address, fired_at: s.created_at },
      firedMs: new Date(s.created_at).getTime(),
      vc, vcCovered: typeof vcCovered === 'number' ? vcCovered : null,
    };
  });
  const tokens = new Map();   // token → signals（firedMs 升序）
  for (const s of sigList) {
    if (!tokens.has(s.row.token)) tokens.set(s.row.token, []);
    tokens.get(s.row.token).push(s);
  }
  for (const arr of tokens.values()) arr.sort((a, b) => a.firedMs - b.firedMs);
  console.log(`  ${tokens.size} 个 distinct token`);

  console.log('[2/3] 拉 trades 聚合 per (experiment, token) 净额…');
  const trades = await fetchAll('trades',
    'experiment_id,token_address,trade_direction,input_amount,output_amount,success', null, 'id');
  const pnlMap = new Map();
  for (const t of trades) {
    if (t.success === false) continue;                       // 失败行不进净额
    const k = `${t.experiment_id}|${t.token_address}`;
    const inA = parseFloat(t.input_amount) || 0, outA = parseFloat(t.output_amount) || 0;
    const isBuy = t.trade_direction === 'buy' || t.trade_direction === 'BUY';
    const delta = isBuy ? -inA : outA;   // buy 花 BNB / sell 得 BNB
    pnlMap.set(k, (pnlMap.get(k) || 0) + delta);
  }
  console.log(`  ${trades.length} 行 trades`);

  console.log('[3/3] 逐 token 回放 ticks…');
  const results = [];
  let done = 0;
  for (const [token, sigs] of tokens) {
    const ticks = await fetchAll('wss_price_ticks',
      'trade_type,sender_address,trader_address,bnb_amount,token_amount,block_time',
      (q) => q.eq('token_address', token).order('id', { ascending: true }), 'block_time');
    for (const r of replayToken(ticks, sigs)) {
      r.pnl_bnb = pnlMap.has(`${r.experiment_id}|${r.token}`)
        ? Math.round(pnlMap.get(`${r.experiment_id}|${r.token}`) * 1e6) / 1e6 : null;
      results.push(r);
    }
    done++;
    if (done % 50 === 0) console.log(`  ${done}/${tokens.size} tokens…`);
  }
  results.sort((a, b) => new Date(a.fired_at) - new Date(b.fired_at));

  // ── CSV 输出 ──
  const cols = ['id', 'experiment_id', 'token', 'fired_at', 'buyWallets', 'buyVolumeBnb', 'circTokens',
    'evenClusterHoldCircPct', 'evenClusterWallets', 'evenClusterGroups',
    'vc', 'vcCovered', 'visitorsPerBuyer', 'visitorsPerBuyBnb', 'pnl_bnb'];
  const csv = [cols.join(',')].concat(results.map(r => cols.map(c => r[c] != null ? r[c] : '').join(','))).join('\n') + '\n';
  if (OUT) {
    fs.writeFileSync(path.resolve(OUT), csv);
    console.log(`\nCSV → ${path.resolve(OUT)}（${results.length} 行）`);
  } else {
    console.log('\n' + csv);
  }

  // ── 分布汇总 ──
  console.log('\n═══ 分布汇总（fire 票池 as-of 快照）═══');
  const fmt = (name, q) => console.log(`  ${name}: n=${q.n} p25=${q.p25} p50=${q.p50} p75=${q.p75} p90=${q.p90} p95=${q.p95} max=${q.max}`);
  fmt('buyWallets        ', quantiles(results.map(r => r.buyWallets)));
  fmt('buyVolumeBnb      ', quantiles(results.map(r => r.buyVolumeBnb)));
  fmt('evenClusterHoldPct', quantiles(results.map(r => r.evenClusterHoldCircPct)));
  fmt('evenClusterWallets', quantiles(results.map(r => r.evenClusterWallets).filter(v => v > 0)));
  const vcRows = results.filter(r => r.vc != null && r.vcCovered === 1);
  console.log(`  gmgn 快照票（covered=1）: ${vcRows.length}/${results.length}`);
  if (vcRows.length) {
    fmt('visitorsPerBuyer  ', quantiles(vcRows.map(r => r.visitorsPerBuyer)));
    fmt('visitorsPerBuyBnb ', quantiles(vcRows.map(r => r.visitorsPerBuyBnb)));
  }

  console.log('\n── 盈亏分桶对照（阈值定标依据；pnl=实验域内该 token trades 净额 BNB）──');
  const withPnl = results.filter(r => r.pnl_bnb != null);
  console.log(`  有盈亏关联: ${withPnl.length}/${results.length}`);
  for (const l of bucketStats(withPnl, r => {
    const v = r.visitorsPerBuyer;
    if (v == null) return null;
    if (v === 0) return 'vc0';
    if (v <= 10) return '(0,10]';
    if (v <= 30) return '(10,30]';
    if (v <= 60) return '(30,60]';
    return '>60';
  }, 'perBuyer')) console.log(l);
  for (const l of bucketStats(withPnl, r => {
    const v = r.visitorsPerBuyBnb;
    if (v == null) return null;
    if (v === 0) return 'vc0';
    if (v <= 10) return '(0,10]';
    if (v <= 30) return '(10,30]';
    if (v <= 60) return '(30,60]';
    return '>60';
  }, 'perBuyBnb')) console.log(l);
  for (const l of bucketStats(withPnl, r => {
    const v = r.evenClusterHoldCircPct;
    if (v === 0) return '0';
    if (v <= 20) return '(0,20]';
    if (v <= 40) return '(20,40]';
    if (v <= 60) return '(40,60]';
    return '>60';
  }, 'evenPct')) console.log(l);
  for (const l of bucketStats(withPnl, r => {
    const v = r.evenClusterWallets;
    if (v === 0) return '0';
    if (v <= 5) return '(0,5]';
    if (v <= 15) return '(5,15]';
    return '>15';
  }, 'evenWallets')) console.log(l);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error('[fatal]', e); process.exit(1); });
}
module.exports = { replayToken };   // 零 DB 口径自测消费（scripts/_test_replay_observation_factors.cjs）
