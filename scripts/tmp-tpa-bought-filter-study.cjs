#!/usr/bin/env node
/**
 * tmp-tpa-bought-filter-study — bt-v134 实际买入 149 token 的画像过滤模拟（182 跑）
 * 课题：若买入决策参考「首买时刻 top20 持仓画像」（medHold 为主），实验盈亏会怎样变化。
 *
 * 口径：
 *   - 每票锚 = 实验首笔 buy 的 executed_at||created_at（buildTradePoints 同款成交时刻口径）
 *   - 重放 [token 首行, 首买时刻] 的 wss_price_ticks（尘 0.001 滤除）→ 净持仓 top20（sender||trader）
 *   - 画像 = wallet_offline_profiles（data_through 11-05 fresh 近似，同首份分析）
 *   - 盈亏 = 实验实际 per-token pnl（Σsell 得 BNB − Σbuy 花 BNB，未卖部分计入为负）
 *   - 对照组特征：medianHoldMed / tokenScore / 四桶占比（与 308 票分析同源）
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'config', '.env') });

const WINDOW_START = '2026-11-02T06:00:00Z';
const WINDOW_END = '2026-11-03T15:00:00Z';
const FWD_MS = 70 * 60 * 1000;
const DUST_BNB = 0.001;
const TOP_N = 20;
const EXPERIMENT_ID = '19ef6433-0c92-47ff-a6fd-9f6bea745b8d';
const TICK_COLS = 'id,token_address,trade_type,trader_address,sender_address,bnb_amount,token_amount,price_outlier,block_number,log_index,block_time';

const { dbManager } = require('../src/services/dbManager.js');
const { scoreTokenFromHolders, computeZhuangRetail } = require('../src/services/wallet-scorer.js');

function ms(iso) { return Date.parse(iso); }
const fmt = (x, d = 2) => (x == null || !Number.isFinite(x)) ? 'null' : x.toFixed(d);

async function main() {
  const sb = await dbManager.getClient();
  const startMs = ms(WINDOW_START), endMs = ms(WINDOW_END), fwdEndMs = endMs + FWD_MS;

  // ── 1. 实验买入票：首买时刻 + token 级 pnl ──
  const firstBuy = new Map(); // token -> {buyMs, pnl, buyBnb, rounds}
  {
    const { data, error } = await sb.from('trades').select('token_address,trade_direction,input_amount,output_amount,executed_at,created_at')
      .eq('experiment_id', EXPERIMENT_ID).limit(2000);
    if (error) throw new Error(error.message);
    for (const t of (data || [])) {
      const ta = (t.token_address || '').toLowerCase();
      if (!ta) continue;
      let e = firstBuy.get(ta);
      if (!e) { e = { buyMs: null, pnl: 0, buyBnb: 0, rounds: 0 }; firstBuy.set(ta, e); }
      if (t.trade_direction === 'buy') {
        e.buyBnb += Number(t.input_amount || 0);
        e.rounds++;
        // 回测实验 trades.executed_at=回测运行墙钟（窗口外），虚拟成交时刻=created_at：
        // 取「落在窗口内的那个」（live=executed_at 真实成交；回测=created_at 虚拟时刻）
        const exM = t.executed_at ? ms(t.executed_at) : null;
        const crM = t.created_at ? ms(t.created_at) : null;
        const inWin = (m) => m != null && m >= Date.parse(WINDOW_START) - 3600e3 && m <= Date.parse(WINDOW_END) + 3600e3;
        const tm = inWin(exM) ? exM : (inWin(crM) ? crM : (crM != null ? crM : exM));
        if (e.buyMs == null || tm < e.buyMs) e.buyMs = tm;
      } else if (t.trade_direction === 'sell') {
        e.pnl += Number(t.output_amount || 0);
      }
    }
    for (const [ta, e] of firstBuy) e.pnl = e.pnl - e.buyBnb; // pnl = Σsell − Σbuy
    console.log(`[1] 买入 token=${firstBuy.size}`);
  }

  // ── 2. token meta（creator/totalSupply）：拉窗口全量 token_create 内存匹配 ──
  const meta = new Map();
  {
    let lastId = null;
    for (;;) {
      let q = sb.from('wss_events').select('id,payload,platform,block_time')
        .eq('kind', 'token_create')
        .gte('block_time', WINDOW_START).lte('block_time', WINDOW_END)
        .order('id', { ascending: true }).limit(1000);
      if (lastId) q = q.gt('id', lastId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      lastId = data[data.length - 1].id;
      for (const r of data) {
        const p = r.payload || {};
        const ta = (p.token || '').toLowerCase();
        if (ta && firstBuy.has(ta) && !meta.has(ta)) {
          meta.set(ta, {
            platform: r.platform || 'fourmeme',
            creator: (p.creator || '').toLowerCase() || null,
            totalSupply: Number(p.totalSupply) > 0 ? Number(p.totalSupply) : 1e9,
          });
        }
      }
      if (data.length < 1000) break;
    }
    console.log(`[2] 买入票 meta 命中=${meta.size}/${firstBuy.size}`);
  }

  // ── 3. 窗口 ticks（id 区间二分锚 + 无序分页，同首份脚本）──
  async function idAtOrBefore(tsMs) {
    const { data: hm } = await sb.from('wss_price_ticks').select('id').order('id', { ascending: false }).limit(1);
    let lo = 0, hi = hm[0].id + 1;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      const { data, error } = await sb.from('wss_price_ticks').select('id,block_time')
        .lte('id', mid).order('id', { ascending: false }).limit(1);
      if (error) throw new Error(error.message);
      if (!data || !data.length || data[0].id <= lo) { hi = mid; continue; }
      if (Date.parse(data[0].block_time) <= tsMs) lo = data[0].id; else hi = data[0].id;
    }
    return lo;
  }
  async function idAtOrAfter(tsMs) {
    const { data: lm } = await sb.from('wss_price_ticks').select('id').order('id', { ascending: true }).limit(1);
    const { data: hm } = await sb.from('wss_price_ticks').select('id').order('id', { ascending: false }).limit(1);
    let lo = lm[0].id - 1, hi = hm[0].id + 1;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      const { data, error } = await sb.from('wss_price_ticks').select('id,block_time')
        .lte('id', mid).order('id', { ascending: false }).limit(1);
      if (error) throw new Error(error.message);
      if (!data || !data.length || data[0].id <= lo) { hi = mid; continue; }
      if (Date.parse(data[0].block_time) < tsMs) lo = data[0].id; else hi = data[0].id;
    }
    const { data: nx } = await sb.from('wss_price_ticks').select('id').gt('id', lo).order('id', { ascending: true }).limit(1);
    return (nx && nx.length) ? nx[0].id : hm[0].id + 1;
  }
  const byToken = new Map();
  {
    const t0 = Date.now();
    const tailId = (await idAtOrAfter(startMs)) - 1;
    const headId = await idAtOrBefore(fwdEndMs);
    let cursor = tailId, pages = 0, kept = 0;
    for (;;) {
      const { data, error } = await sb.from('wss_price_ticks').select(TICK_COLS)
        .gt('id', cursor).lte('id', headId).limit(1000);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      pages++;
      let mx = cursor;
      for (const r of data) {
        if (r.id > mx) mx = r.id;
        const bt = ms(r.block_time);
        if (bt < startMs || bt > fwdEndMs) continue;
        const ta = (r.token_address || '').toLowerCase();
        if (!firstBuy.has(ta)) continue;
        let arr = byToken.get(ta);
        if (!arr) { arr = []; byToken.set(ta, arr); }
        arr.push({ bt, wallet: (r.sender_address || r.trader_address || '').toLowerCase(), isBuy: r.trade_type === 'buy', bnb: Number(r.bnb_amount), qty: Number(r.token_amount || 0), bn: r.block_number });
      }
      cursor = mx;
      if (data.length < 1000) break;
      if (pages % 500 === 0) console.log(`    ... ${pages} 页 kept=${kept}`);
    }
    for (const arr of byToken.values()) arr.sort((a, b) => (a.bn - b.bn));
    console.log(`[3] ticks: ${pages} 页 / ${byToken.size} token / ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }

  // ── 4. 每票重放至首买时刻 → top20 ──
  const snapshots = [];
  let noTicks = 0, buyBeforeTicks = 0;
  for (const [ta, e] of firstBuy) {
    const ticks = byToken.get(ta) || [];
    const m = meta.get(ta) || { platform: '?', creator: null, totalSupply: 1e9 };
    if (!ticks.length) { noTicks++; continue; }
    const net = new Map();
    let relPrice = null;
    let anchorTc = 0, anchorBuyBnb = 0, anchorHolders = 0;
    if (e.buyMs != null && ticks[0].bt > e.buyMs) buyBeforeTicks++;
    for (const t of ticks) {
      if (e.buyMs != null && t.bt > e.buyMs) break;
      if (t.bnb < DUST_BNB) continue;
      anchorTc++;
      if (t.isBuy) anchorBuyBnb += t.bnb;
      if (t.wallet) net.set(t.wallet, (net.get(t.wallet) || 0) + (t.isBuy ? t.qty : -t.qty));
    }
    for (const v of net.values()) if (v > 0) anchorHolders++;
    const top = [...net.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, TOP_N);
    if (!top.length) continue;
    const floatTotal = top.reduce((s, [, v]) => s + v, 0);
    const anchorAgeSec = (e.buyMs - ticks[0].bt) / 1000;
    snapshots.push({ token: ta, platform: m.platform, creator: m.creator, buyMs: e.buyMs, pnl: e.pnl, buyBnb: e.buyBnb, rounds: e.rounds, top, floatTotal, anchorAgeSec, anchorTc, anchorBuyBnb, anchorHolders });
  }
  console.log(`[4] 首买时刻快照=${snapshots.length}（无 ticks=${noTicks}，买点早于首 tick=${buyBeforeTicks}）`);
  {
    const ages = snapshots.map(s => s.anchorAgeSec).sort((a, b) => a - b);
    console.log(`    锚点年龄(买点−首tick) sec: min=${ages[0].toFixed(0)} p25=${ages[Math.floor(ages.length * 0.25)].toFixed(0)} med=${ages[Math.floor(ages.length / 2)].toFixed(0)} p75=${ages[Math.floor(ages.length * 0.75)].toFixed(0)} max=${ages[ages.length - 1].toFixed(0)}（负值=买点早于窗口内首行,外部先行交易）`);
  }

  // ── 5. offline 画像批查 + 聚合 ──
  const offline = new Map();
  {
    const addrs = new Set();
    for (const s of snapshots) for (const [w] of s.top) addrs.add(w);
    const list = [...addrs];
    for (let i = 0; i < list.length; i += 100) {
      const { data, error } = await sb.from('wallet_offline_profiles').select('address,profile').in('address', list.slice(i, i + 100));
      if (error) throw new Error(error.message);
      for (const r of (data || [])) offline.set((r.address || '').toLowerCase(), r.profile || null);
    }
    console.log(`[5] 钱包=${list.length} offline 命中=${offline.size}`);
  }
  const missProfile = () => ({ source: 'realtime', tokenCount: 0, rawTotal: 0, buckets: null, lowTinyRatio: 0, badAction: false, totalBnb: 0, avgBnb: 0, buyCount: 0, sellCount: 0, earlyLargeBuyCount: 0, crashLargeSellCount: 0, badCount14d: 0, medianHoldSeconds: null, effectiveTradeCount: 0, tier2Ratio: null, avgHoldSeconds: 0 });
  const out = [];
  for (const s of snapshots) {
    const profiles = [];
    let miss = 0;
    for (const [w, v] of s.top) {
      const off = offline.get(w);
      const p = off ? { ...off, address: w, source: 'offline' } : Object.assign(missProfile(), { address: w });
      if (!off) miss++;
      p.netTokens = v;
      p.floatPct = s.floatTotal > 0 ? Number(((v / s.floatTotal) * 100).toFixed(2)) : 0;
      p.isCreator = !!(s.creator && s.creator === w);
      profiles.push(p);
    }
    const summary = scoreTokenFromHolders(profiles, { TPAPre_walletHoldingPct: null }, { enabled: true, strategy: 'v1', topN: TOP_N, topNMode: 'all' });
    const zr = computeZhuangRetail(profiles);
    const holds = profiles.map(p => p.medianHoldSeconds).filter(v => v != null).sort((a, b) => a - b);
    out.push({
      token: s.token, platform: s.platform, pnl: Number(s.pnl.toFixed(4)), buyBnb: Number(s.buyBnb.toFixed(2)), rounds: s.rounds, anchorAgeSec: Number((s.anchorAgeSec || 0).toFixed(1)),
      anchorTc: s.anchorTc, anchorBuyBnb: Number(s.anchorBuyBnb.toFixed(3)), anchorHolders: s.anchorHolders,
      tokenScore: summary?.totalScore ?? null,
      zhuangPct: zr?.zhuangPct ?? null, newWalletPct: zr?.newWalletPct ?? null, retailPct: zr?.retailPct ?? null,
      top1FloatPct: profiles[0]?.floatPct ?? null,
      medianHoldMed: holds.length ? holds[Math.floor(holds.length / 2)] : null,
      holderN: profiles.length, missN: miss,
    });
  }

  // ── 6. 过滤模拟 ──
  const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const total = sum(out.map(r => r.pnl));
  const wins = out.filter(r => r.pnl > 0).length;
  console.log(`\n═══ 基线（全部 ${out.length} 票）═══`);
  console.log(`总 pnl=${total.toFixed(4)} BNB | 胜率=${(wins / out.length * 100).toFixed(1)}% | 票均=${(total / out.length).toFixed(4)} | pnl 中位=${fmt(med(out.map(r => r.pnl)), 4)}`);

  console.log(`\n═══ 按 medianHoldMed 分档（首买时刻 top20 持仓历史中位时长）═══`);
  const bands = [[null, 'null(miss/新钱包)'], [30, '<30s'], [60, '30~60s'], [93, '60~93s'], [180, '93~180s'], [600, '180~600s'], [1e9, '>=600s']];
  for (let i = 0; i < bands.length; i++) {
    const [hi, label] = bands[i];
    const lo = i === 0 ? null : bands[i - 1][0];
    const sub = out.filter(r => (label === 'null(miss/新钱包)') ? r.medianHoldMed == null : (r.medianHoldMed != null && r.medianHoldMed >= lo && r.medianHoldMed < hi));
    if (!sub.length) { console.log(`${label.padEnd(16)} n=0`); continue; }
    const p = sub.map(r => r.pnl);
    console.log(`${label.padEnd(16)} n=${String(sub.length).padStart(3)} 胜率=${(sub.filter(r => r.pnl > 0).length / sub.length * 100).toFixed(0).padStart(3)}% 合计=${sum(p).toFixed(4).padStart(8)} 中位=${fmt(med(p), 4)} 均值=${(sum(p) / sub.length).toFixed(4)} score=${fmt(sub.reduce((s, r) => s + (r.tokenScore || 0), 0) / sub.length)}`);
  }

  console.log(`\n═══ 过滤模拟：只保留 medianHoldMed >= T（剔除其余）═══`);
  console.log('T 阈值   保留n  剔除n  保留合计   剔除合计   Δ总pnl   保留胜率  剔除票中被剔掉的正票数(合计)');
  for (const T of [30, 60, 93, 180, 600]) {
    const keep = out.filter(r => r.medianHoldMed != null && r.medianHoldMed >= T);
    const drop = out.filter(r => !(r.medianHoldMed != null && r.medianHoldMed >= T));
    const kp = sum(keep.map(r => r.pnl)), dp = sum(drop.map(r => r.pnl));
    const dropPos = drop.filter(r => r.pnl > 0);
    console.log(`>=${String(T).padStart(4)}s  ${String(keep.length).padStart(4)}  ${String(drop.length).padStart(4)}  ${kp.toFixed(4).padStart(8)}  ${dp.toFixed(4).padStart(8)}  ${(kp - total).toFixed(4).padStart(8)}  ${(keep.filter(r => r.pnl > 0).length / Math.max(keep.length, 1) * 100).toFixed(0).padStart(5)}%   ${dropPos.length}(${sum(dropPos.map(r => r.pnl)).toFixed(4)})`);
  }

  // 首买时刻盘面因子（无前视可得）分档 + 过滤模拟
  console.log(`\n═══ 首买时刻盘面因子分档（无前视：tc / buyBnb / holders）═══`);
  for (const [key, cuts, unit] of [
    ['anchorBuyBnb', [2, 4, 6, 10, 15], 'BNB'],
    ['anchorTc', [8, 12, 20, 35], '笔'],
    ['anchorHolders', [6, 9, 14], '人'],
  ]) {
    const vals = [0, ...cuts, 1e9];
    for (let i = 0; i < vals.length - 1; i++) {
      const sub = out.filter(r => r[key] >= vals[i] && r[key] < vals[i + 1]);
      if (!sub.length) { console.log(`${key} [${vals[i]},${vals[i + 1]}) n=0`); continue; }
      const p = sub.map(r => r.pnl);
      console.log(`${key.padEnd(13)} [${String(vals[i])},${String(vals[i + 1])})${unit}`.padEnd(34) + ` n=${String(sub.length).padStart(3)} 胜率=${(sub.filter(r => r.pnl > 0).length / sub.length * 100).toFixed(0).padStart(3)}% 合计=${sum(p).toFixed(4).padStart(8)} 中位=${fmt(med(p), 4)}`);
    }
  }
  console.log(`\n═══ 过滤模拟：只保留 anchorBuyBnb >= T / anchorTc >= T / anchorHolders >= T ═══`);
  console.log('因子/阈值      保留n  剔除n  保留合计   剔除合计   Δ总pnl   保留胜率');
  for (const [key, Ts] of [['anchorBuyBnb', [2, 3, 4, 6, 8, 10]], ['anchorTc', [8, 10, 12, 15, 20]], ['anchorHolders', [5, 6, 8, 10]]]) {
    for (const T of Ts) {
      const keep = out.filter(r => r[key] >= T), drop = out.filter(r => r[key] < T);
      if (!keep.length || !drop.length) continue;
      const kp = sum(keep.map(r => r.pnl)), dp = sum(drop.map(r => r.pnl));
      console.log(`${key.padEnd(12)} >=${String(T).padStart(3)}  ${String(keep.length).padStart(4)}  ${String(drop.length).padStart(4)}  ${kp.toFixed(4).padStart(8)}  ${dp.toFixed(4).padStart(8)}  ${(kp - total >= 0 ? '+' : '') + (kp - total).toFixed(4).padStart(7)}  ${(keep.filter(r => r.pnl > 0).length / keep.length * 100).toFixed(0).padStart(4)}%`);
    }
  }
  // 其它特征对照（供参考）
  console.log(`\n═══ 其它特征分档对照（同结构，供横向比较）═══`);
  for (const [key, cuts] of [
    ['tokenScore', [1.5, 2.2, 2.8]],
    ['zhuangPct', [10, 50]],
    ['newWalletPct', [20, 60]],
    ['retailPct', [5, 15]],
  ]) {
    const vals = [0, ...cuts, 1e9];
    for (let i = 0; i < vals.length - 1; i++) {
      const sub = out.filter(r => r[key] != null && r[key] >= vals[i] && r[key] < vals[i + 1]);
      if (!sub.length) { console.log(`${key} [${vals[i]},${vals[i + 1]}) n=0`); continue; }
      const p = sub.map(r => r.pnl);
      console.log(`${key.padEnd(13)} [${String(vals[i])},${String(vals[i + 1])})`.padEnd(30) + ` n=${String(sub.length).padStart(3)} 胜率=${(sub.filter(r => r.pnl > 0).length / sub.length * 100).toFixed(0).padStart(3)}% 合计=${sum(p).toFixed(4).padStart(8)} 中位=${fmt(med(p), 4)}`);
    }
  }

  // 明细落盘
  const fs = require('fs');
  const outFile = path.join(process.cwd(), 'data', 'tmp-tpa-bought-filter-study.json');
  fs.writeFileSync(outFile, JSON.stringify({ experimentId: EXPERIMENT_ID, n: out.length, baselinePnl: total, rows: out }));
  console.log(`\n[7] 明细已落盘 ${outFile}`);
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
