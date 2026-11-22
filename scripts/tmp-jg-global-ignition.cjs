#!/usr/bin/env node
// 一次性（全局 ex-ante）：w1003 全宇宙「休眠后大买点火」事件扫描——纯过去信息
// 定义事件（quiet≥60s ∧ buy≥0.1B ∧ age≥120s，无前瞻），事件时刻特征 + 前向 30min
// 结局；回答「点火能否前期判断」的基率与判别力。数据=bt-v164 的 BacktestTickCache
// 窗口缓存（182 本地文件零 DB）。182 跑。用后可删。
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CACHE = process.argv[2] || '/home/ubuntu/richer-js/data/tick-cache/backtest/win-20261003t000000000z_20261005t000000000z';
const OUT = process.argv[3] || '/tmp/jg-global-ignition-events.jsonl';
const QUIET_MS = 60 * 1000;
const AGE_MS = 120 * 1000;
const SUB_BNB = 0.05;    // 足额线（静默判定）
const IGN_BNB = 0.1;     // 点火买线
const FWD_MS = 30 * 60 * 1000;

// 金狗 7 票（对照定位）
const GOLD = new Set([
  '0x1a0810861af30ed2b85ec2c195f36fb58fc97777', '0xe83626c404ee63b68ae2a7cdb17fd7d4d2c77777',
  '0xac5055c15c1b4d166e60fefcdcbaf631a7d87777', '0xb71209cbe0ba47afdbc0201f2d2647e9919b7777',
  '0x898af40efeadb41fd0b6f8990dc44898266e7777', '0x2335bc4868817a216be949c545f9a7e550bf7777',
  '0x0bba00ba64c147a6477fd18720b782a6403577777',
]);

function* readTicks(file) {
  const lines = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').split('\n');
  for (const l of lines) {
    if (!l.trim()) continue;
    const r = JSON.parse(l);
    yield {
      ts: new Date(r.block_time).getTime(), side: r.trade_type,
      bnb: Number(r.bnb_amount || 0), tok: Number(r.token_amount || 0),
      px: Number(r.price_bnb || 0), out: !!r.price_outlier,
      w: ((r.sender_address || r.trader_address) || '?').toLowerCase(),
      bn: Number(r.block_number || 0), li: Number(r.log_index || 0),
    };
  }
}

function analyzeToken(ticks) {
  ticks.sort((a, b) => a.bn - b.bn || a.li - b.li);
  const t0 = ticks[0].ts;
  const events = [];
  // 单遍扫描：状态=持仓/价格史/静默锚；事件=quiet 后大买；前向结局二遍扫
  let lastSubTs = null;         // 最后足额成交
  let lastRelPx = null;         // 最后可靠价
  let minPx = Infinity, maxPx = 0;
  const pos = new Map();        // w -> netTok/buyBnb/sellBnb/firstTs
  const firstAction = new Map();// w -> ts
  const evIdx = [];             // 事件锚（本遍只记时刻+快照，前向另扫）

  for (const t of ticks) {
    const quiet = lastSubTs == null ? (t.ts - t0) : (t.ts - lastSubTs);
    if (t.side === 'buy' && t.bnb >= IGN_BNB && quiet >= QUIET_MS && (t.ts - t0) >= AGE_MS) {
      // 事件时刻快照（含本笔前的状态）
      const holders = [...pos.entries()].filter(([, a]) => a.netTok > 0)
        .map(([w, a]) => ({ w, val: a.netTok * (lastRelPx || t.px) }))
        .sort((x, y) => y.val - x.val);
      const totVal = holders.reduce((s, h) => s + h.val, 0) || 1;
      const top1 = holders[0];
      const ignOld = (pos.get(t.w) || { netTok: 0 }).netTok > 0;
      const fresh = !firstAction.has(t.w);
      const curVsFloor = (lastRelPx || t.px) / minPx;
      evIdx.push({
        ts: t.ts, px: lastRelPx || t.px, bnb: t.bnb, w: t.w, ignOld, fresh,
        quietSec: Math.round(quiet / 1000), ageSec: Math.round((t.ts - t0) / 1000),
        nHolders: holders.length, top1Share: top1 ? top1.val / totVal : 0,
        top3Share: holders.slice(0, 3).reduce((s, h) => s + h.val, 0) / totVal,
        top1Dump: top1 && pos.get(top1.w).buyBnb > 0 ? pos.get(top1.w).sellBnb / pos.get(top1.w).buyBnb : 0,
        curVsFloor, priorAthDrop: maxPx > 0 ? (lastRelPx || t.px) / maxPx : 1,
      });
    }
    // 状态推进（事件判定用推进前状态，此处起计本笔）
    if (t.bnb >= SUB_BNB) lastSubTs = t.ts;
    if (!t.out && t.px > 0) { lastRelPx = t.px; if (t.px < minPx) minPx = t.px; if (t.px > maxPx) maxPx = t.px; }
    if (!firstAction.has(t.w)) firstAction.set(t.w, t.ts);
    let a = pos.get(t.w);
    if (!a) { a = { netTok: 0, buyBnb: 0, sellBnb: 0 }; pos.set(t.w, a); }
    if (t.side === 'buy') { a.netTok += t.tok; a.buyBnb += t.bnb; } else { a.netTok -= t.tok; a.sellBnb += t.bnb; }
  }
  if (!evIdx.length) return events;
  // 前向结局：事件后 [ts, ts+30min] 可靠价 max / 末值
  let ei = 0;
  let rel = ticks.filter(t => !t.out && t.px > 0);
  for (const ev of evIdx) {
    let mx = ev.px, endPx = ev.px, endTs = ev.ts;
    for (const t of rel) {
      if (t.ts <= ev.ts) continue;
      if (t.ts > ev.ts + FWD_MS) break;
      if (t.px > mx) mx = t.px;
      endPx = t.px; endTs = t.ts;
    }
    ev.fwdMax = mx / ev.px; ev.fwdEnd = endPx / ev.px; ev.fwdSec = Math.round((endTs - ev.ts) / 1000);
    events.push(ev);
  }
  return events;
}

(async () => {
  // 装载：两平台缓存全量 → 按 token_address 分组
  const perToken = new Map();
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(CACHE, 'flap.jsonl.gz'))).toString('utf8').split('\n');
  raw.push(...zlib.gunzipSync(fs.readFileSync(path.join(CACHE, 'fourmeme.jsonl.gz'))).toString('utf8').split('\n'));
  let nRows = 0;
  for (const l of raw) {
    if (!l.trim()) continue;
    nRows++;
    const r = JSON.parse(l);
    const key = r.token_address;
    let arr = perToken.get(key);
    if (!arr) { arr = []; perToken.set(key, arr); }
    arr.push({
      ts: new Date(r.block_time).getTime(), side: r.trade_type,
      bnb: Number(r.bnb_amount || 0), tok: Number(r.token_amount || 0),
      px: Number(r.price_bnb || 0), out: !!r.price_outlier,
      w: ((r.sender_address || r.trader_address) || '?').toLowerCase(),
      bn: Number(r.block_number || 0), li: Number(r.log_index || 0),
    });
  }
  console.error(`宇宙 ${perToken.size} tokens / ${nRows} rows`);

  const all = [];
  const goldEvents = [];
  for (const [addr, ticks] of perToken) {
    if (ticks.length < 10) continue;
    const evs = analyzeToken(ticks);
    for (const e of evs) { e.addr = addr; all.push(e); if (GOLD.has(addr)) { e.gold = true; goldEvents.push(e); } }
  }
  fs.writeFileSync(OUT, all.map(e => JSON.stringify(e)).join('\n'));
  console.error(`事件 ${all.length} 个（已写 ${OUT}），金狗 7 票事件 ${goldEvents.length} 个`);

  // ── 基率分布 ──
  const buckets = [1.2, 1.5, 2, 3, 5, 10];
  const dist = buckets.map(b => ({ b, n: all.filter(e => e.fwdMax >= b).length }));
  console.log('\n=== 前向 30min max 基率 ===');
  console.log('事件总数', all.length);
  for (const d of dist) console.log(`  fwdMax≥${d.b}x: ${d.n} (${(d.n / all.length * 100).toFixed(1)}%)`);
  const med = [...all.map(e => e.fwdMax)].sort((a, b) => a - b)[Math.floor(all.length / 2)];
  console.log('  中位 fwdMax =', med.toFixed(2));

  // ── 特征判别力：fwdMax≥2 vs <2 ──
  function sep(name, fn, fmt) {
    const win = all.filter(e => e.fwdMax >= 2).map(fn);
    const lose = all.filter(e => e.fwdMax < 2).map(fn);
    if (!win.length || !lose.length) return;
    const q = (arr, p) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length * p)];
    console.log(`${name.padEnd(12)} 赢组(n=${win.length}) p25=${fmt(q(win, .25))} p50=${fmt(q(win, .5))} p75=${fmt(q(win, .75))}  |  输组(n=${lose.length}) p25=${fmt(q(lose, .25))} p50=${fmt(q(lose, .5))} p75=${fmt(q(lose, .75))}`);
  }
  console.log('\n=== 事件时刻特征：fwdMax≥2x（赢） vs <2x（输） ===');
  sep('top1Share', e => e.top1Share, v => (v * 100).toFixed(0) + '%');
  sep('top3Share', e => e.top3Share, v => (v * 100).toFixed(0) + '%');
  sep('nHolders', e => e.nHolders, v => v.toFixed(0));
  sep('quietSec', e => e.quietSec, v => v.toFixed(0));
  sep('ageSec', e => e.ageSec, v => v.toFixed(0));
  sep('igniteBnb', e => e.bnb, v => v.toFixed(2));
  sep('curVsFloor', e => e.curVsFloor, v => v.toFixed(2));
  sep('priorAthDrop', e => e.priorAthDrop, v => v.toFixed(2));
  sep('top1Dump', e => e.top1Dump, v => v.toFixed(2));
  const oldWin = all.filter(e => e.fwdMax >= 2 && e.ignOld).length, oldAll = all.filter(e => e.ignOld).length;
  const newWin = all.filter(e => e.fwdMax >= 2 && !e.ignOld).length, newAll = all.filter(e => !e.ignOld).length;
  const freshWin = all.filter(e => e.fwdMax >= 2 && e.fresh).length, freshAll = all.filter(e => e.fresh).length;
  console.log(`ignOld: 老点火 ${oldAll} 个中赢 ${oldWin}（${(oldWin / Math.max(oldAll, 1) * 100).toFixed(0)}%） | 新点火 ${newAll} 个中赢 ${newWin}（${(newWin / Math.max(newAll, 1) * 100).toFixed(0)}%）`);
  console.log(`igniterFresh(票上首动作): ${freshAll} 个中赢 ${freshWin}（${(freshWin / Math.max(freshAll, 1) * 100).toFixed(0)}%）`);

  // ── 金狗 7 票事件定位 ──
  console.log('\n=== 金狗 7 票的全局事件 ===');
  for (const e of goldEvents) {
    console.log(`${e.addr.slice(0, 10)} t=${new Date(e.ts).toISOString().slice(11, 19)} bnb=${e.bnb.toFixed(2)} quiet=${e.quietSec}s top1=${(e.top1Share * 100).toFixed(0)}% hN=${e.nHolders} fresh=${e.fresh} fwdMax=${e.fwdMax.toFixed(1)} fwdEnd=${e.fwdEnd.toFixed(2)}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
