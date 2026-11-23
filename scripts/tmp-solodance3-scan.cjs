#!/usr/bin/env node
/** T225 三筛（用户时序版）：开盘大户小户买→大户小户卖→(大户留仓)死透沉寂→拉盘。
 *  「盘面干净」=卖出潮后无新买入跟进：出口前 180s 尾窗买入量/钱包数≈0。
 *  指标：唯一大户(活跃段累计买≥0.3B 钱包数=1，ZKind 切掉) ∧ holdPct>0(出口留仓)
 *  ∧ tailBuy≤线 ∧ 四件套。 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');
const LEG_FA = "quietSpanMs >= 60000 AND quietSurgeBuyBnb >= 0.4 AND quietSurgeSec <= 30 AND quietExitVsLaunchPct >= 0 AND quietExitVsLaunchPct <= 28.5 AND currentVsLaunchPct > 0 AND currentVsLaunchPct <= 28.5 AND actTotalBnb >= 0.1 AND tokenAgeSec >= 15 AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0";
const MAX_TICKS = 30000, BUY_BNB = 0.2, SL_PCT = -40, STALL_SEC = 50, TAIL_MS = 180000, ACT_WIN_MS = 600000;
const argOf = (k) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : null; };
const START = argOf('start'), END = argOf('end'), NAME = argOf('name');
if (!START || !END || !NAME) { console.error('need --start --end --name'); process.exit(1); }
async function main() {
  const db = dbManager.getClient();
  const tokens = new Map();
  for (const p of ['fourmeme', 'flap']) {
    let last = null;
    for (;;) {
      const q = db.from('wss_events').select('token_address, block_time, platform, payload')
        .eq('kind', 'token_create').eq('platform', p).gte('block_time', START).lt('block_time', END)
        .order('block_time', { ascending: true }).limit(1000);
      if (last) q.gt('block_time', last);
      const r = await q;
      if (r.error) throw new Error(r.error.message);
      for (const row of r.data) if (!tokens.has(row.token_address))
        tokens.set(row.token_address, { platform: p, createdAtMs: new Date(row.block_time).getTime(), payload: row.payload || {} });
      if (r.data.length < 1000) break;
      last = r.data[r.data.length - 1].block_time;
    }
  }
  const grads = new Map();
  { let last = null;
    for (;;) { const q = db.from('wss_events').select('token_address, block_time').eq('kind', 'graduation')
        .gte('block_time', START).lt('block_time', END).order('block_time', { ascending: true }).limit(1000);
      if (last) q.gt('block_time', last);
      const r = await q; if (r.error) throw new Error(r.error.message);
      for (const row of r.data) grads.set(row.token_address, new Date(row.block_time).getTime());
      if (r.data.length < 1000) break; last = r.data[r.data.length - 1].block_time; } }
  console.log(`[${NAME}] tokens=${tokens.size} grads=${grads.size}`);
  const addrs = [...tokens.keys()];
  const fa = new FourMemeFactorAggregator({ logger: { info() {}, warn() {}, error() {} } });
  const ce = new ConditionEvaluator();
  const fs = require('fs');
  const out = fs.createWriteStream(`/tmp/solodance3-${NAME}.jsonl`);
  const hits = []; let replayed = 0;
  for (let bi = 0; bi < addrs.length; bi += 50) {
    const batch = addrs.slice(bi, bi + 50);
    const rowsByTok = new Map(batch.map(a => [a, []]));
    for (const p of ['fourmeme', 'flap']) {
      const pAddrs = batch.filter(a => tokens.get(a).platform === p);
      if (!pAddrs.length) continue;
      let fromId = 0;
      for (;;) {
        const r = await db.from('wss_price_ticks')
          .select('id, token_address, trade_type, trader_address, sender_address, price_bnb, bnb_amount, token_amount, block_number, block_time, log_index, price_outlier, platform, quote_token')
          .in('token_address', pAddrs).eq('platform', p).gt('id', fromId).order('id', { ascending: true }).limit(1000);
        if (r.error) throw new Error(r.error.message);
        for (const row of r.data) rowsByTok.get(row.token_address).push(row);
        if (r.data.length < 1000) break;
        fromId = r.data[r.data.length - 1].id;
      }
    }
    for (const addr of batch) {
      const info = tokens.get(addr);
      let rows = rowsByTok.get(addr) || [];
      if (rows.length < 6) continue;
      if (rows.length > MAX_TICKS) rows = rows.slice(0, MAX_TICKS);
      rows.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
      const ticks = rows.map(row => ({
        token_address: row.token_address, trade_type: row.trade_type,
        trader_address: row.trader_address, sender_address: row.sender_address || null,
        price_bnb: Number(row.price_bnb), price_usd: null,
        bnb_amount: Number(row.bnb_amount || 0), token_amount: Number(row.token_amount || 0),
        block_number: row.block_number, timestamp: new Date(row.block_time).getTime(),
        tx_hash: null, log_index: row.log_index, price_outlier: row.price_outlier || false,
        platform: row.platform, quote_token: row.quote_token || null,
      }));
      // 全史事件：活跃段大户统计(出口前 600s) + 尾窗买入(出口前 180s)
      const events = [];
      let latch = null, lastTickTs = null, snap = null;
      const statAt = (ts) => {
        const actCut = ts - ACT_WIN_MS, tailCut = ts - TAIL_MS;
        const buyByW = new Map(); let tailBuy = 0, tailBuyW = new Set(), tailSell = 0, lastBuyTs = null, lastSellTs = null;
        for (const e of events) {
          if (e.ts >= actCut && e.buy) buyByW.set(e.w, (buyByW.get(e.w) || 0) + e.bnb);
          if (e.ts >= tailCut) { if (e.buy) { tailBuy += e.bnb; tailBuyW.add(e.w); } else tailSell += e.bnb; }
          if (e.buy) lastBuyTs = e.ts; else lastSellTs = e.ts;
        }
        let big = 0; for (const b of buyByW.values()) if (b >= 0.3) big++;
        return { big, tailBuy: Math.round(tailBuy * 1000) / 1000, tailBuyW: tailBuyW.size, tailSell: Math.round(tailSell * 1000) / 1000,
                 endWithSell: lastSellTs !== null && (lastBuyTs === null || lastSellTs > lastBuyTs) };
      };
      fa.registerToken(addr, { createdAtMs: info.createdAtMs, symbol: info.payload.symbol, name: info.payload.name, creatorAddress: info.payload.creator, platform: info.platform });
      let cluster = null, fired = 0;
      for (const t of ticks) {
        if (lastTickTs !== null && t.timestamp - lastTickTs >= 60000) snap = statAt(t.timestamp);
        const w = t.sender_address || t.trader_address;
        if (w && t.token_amount > 0) {
          events.push({ ts: t.timestamp, w, buy: t.trade_type === 'buy', bnb: t.bnb_amount });
          if (t.trade_type === 'buy' && !latch && t.bnb_amount >= 0.3) latch = { wallet: w };
        }
        fa.processTick(t, { emitFactors: false });
        lastTickTs = t.timestamp;
        if (cluster === null || t.timestamp - cluster.lastTs > 1000) {
          if (cluster && fired < 2) {
            const f = fa.buildFactorMap(addr, cluster.lastTs + 200);
            if (f && ce.evaluate(LEG_FA, f)) {
              fired++;
              const firePx = f.currentPriceBnb, gradMs = grads.get(addr) || null;
              let exit = null, exitWhy = null, lt = cluster.lastTs;
              for (const t2 of ticks) {
                if (t2.timestamp <= cluster.lastTs) continue;
                if (t2.price_bnb > 0 && (t2.price_bnb / firePx - 1) * 100 <= SL_PCT) { exit = t2.price_bnb; exitWhy = 'stop_loss'; break; }
                if (t2.timestamp - lt > STALL_SEC * 1000) { exit = t2.price_bnb; exitWhy = 'stall'; break; }
                lt = t2.timestamp;
                if (gradMs && t2.timestamp >= gradMs) { exit = t2.price_bnb; exitWhy = 'graduation'; break; }
              }
              if (exit === null) { exit = (ticks[ticks.length - 1].price_bnb > 0 ? ticks[ticks.length - 1].price_bnb : firePx); exitWhy = 'window_end'; }
              const s = snap || { big: null, tailBuy: null, tailBuyW: null, tailSell: null, endWithSell: null };
              hits.push({ token: addr, symbol: info.payload.symbol || '', fireSec: Math.round((cluster.lastTs + 200 - info.createdAtMs) / 1000),
                curVs: f.currentVsLaunchPct, exitVs: f.quietExitVsLaunchPct, holdPctFA: f.firstBigBuyerHoldPct,
                big: s.big, tailBuy: s.tailBuy, tailBuyW: s.tailBuyW, tailSell: s.tailSell, endSell: s.endWithSell,
                retPct: Math.round((exit / firePx - 1) * 10000) / 100, exitWhy, grad: !!gradMs,
                bnbPnl: Math.round((BUY_BNB * (exit / firePx - 1)) * 10000) / 10000 });
              out.write(JSON.stringify(hits[hits.length - 1]) + '\n');
            }
          }
          cluster = { lastTs: t.timestamp };
        } else cluster.lastTs = Math.max(cluster.lastTs, t.timestamp);
      }
      replayed++;
    }
  }
  out.end();
  console.log(`[${NAME}] 完成 ${replayed} 票，四件套过 ${hits.length} fire`);
  const grid = (sel, lab) => {
    const pnl = sel.reduce((s, h) => s + h.bnbPnl, 0);
    const wins = sel.filter(h => h.bnbPnl > 0).length;
    console.log(`  ${lab}: n=${sel.length} 净=${pnl.toFixed(4)} 胜率=${sel.length ? Math.round(wins / sel.length * 100) : '-'}%`);
  };
  const base = hits.filter(h => h.big === 1 && typeof h.holdPctFA === 'number' && h.holdPctFA > 0);
  grid(base, '唯一大户∧出口留仓');
  for (const TB of [0.0, 0.05, 0.1, 0.2]) {
    grid(base.filter(h => (h.tailBuy || 0) <= TB), `+尾窗(180s)新买≤${TB}`);
  }
  grid(base.filter(h => (h.tailBuy || 0) <= 0.1 && h.endSell), '+尾买≤0.1∧以卖收尾');
  console.log(`明细: /tmp/solodance3-${NAME}.jsonl`);
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
