#!/usr/bin/env node
/** T225 二筛：用户精确版独舞——买入阶段(出口前 300s 窗)只有一个大户(累计买≥0.3B 钱包数=1)
 *  ∧ 交易少而浅(窗内笔数/除最大户外买入额) ∧ 卖一部分后死透(quietSpan≥60s)
 *  ∧ 四件套(surge≥0.4∧≤30s∧出口未破发∧现价≤28.5)。分组线扫描。 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');
const LEG_FA = "quietSpanMs >= 60000 AND quietSurgeBuyBnb >= 0.4 AND quietSurgeSec <= 30 AND quietExitVsLaunchPct >= 0 AND quietExitVsLaunchPct <= 28.5 AND currentVsLaunchPct > 0 AND currentVsLaunchPct <= 28.5 AND actTotalBnb >= 0.1 AND tokenAgeSec >= 15 AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0";
const MAX_TICKS = 30000, BUY_BNB = 0.2, SL_PCT = -40, STALL_SEC = 50, WIN_MS = 300000;
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
  {
    let last = null;
    for (;;) {
      const q = db.from('wss_events').select('token_address, block_time').eq('kind', 'graduation')
        .gte('block_time', START).lt('block_time', END).order('block_time', { ascending: true }).limit(1000);
      if (last) q.gt('block_time', last);
      const r = await q;
      if (r.error) throw new Error(r.error.message);
      for (const row of r.data) grads.set(row.token_address, new Date(row.block_time).getTime());
      if (r.data.length < 1000) break;
      last = r.data[r.data.length - 1].block_time;
    }
  }
  console.log(`[${NAME}] tokens=${tokens.size} grads=${grads.size}`);
  const addrs = [...tokens.keys()];
  const fa = new FourMemeFactorAggregator({ logger: { info() {}, warn() {}, error() {} } });
  const ce = new ConditionEvaluator();
  const fs = require('fs');
  const out = fs.createWriteStream(`/tmp/solodance2-${NAME}.jsonl`);
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
      // 窗口级钱包统计（滑窗：出口前 300s 的买入/卖出）
      let latch = null;
      const events = []; // {ts, w, buy, bnb}
      let lastTickTs = null, snap = null;
      const windowStat = (ts) => {
        const cut = ts - WIN_MS;
        const buyByW = new Map();
        let n = 0, sellBnb = 0;
        for (const e of events) {
          if (e.ts < cut) continue;
          n++;
          if (e.buy) buyByW.set(e.w, (buyByW.get(e.w) || 0) + e.bnb); else sellBnb += e.bnb;
        }
        let big = 0, topW = null, topB = 0, sumBuy = 0;
        for (const [w, b] of buyByW) { sumBuy += b; if (b >= 0.3) big++; if (b > topB) { topB = b; topW = w; } }
        return { big, n, othersBuy: sumBuy - topB, sellBnb, topW };
      };
      fa.registerToken(addr, { createdAtMs: info.createdAtMs, symbol: info.payload.symbol, name: info.payload.name, creatorAddress: info.payload.creator, platform: info.platform });
      let cluster = null, fired = 0;
      for (const t of ticks) {
        if (lastTickTs !== null && t.timestamp - lastTickTs >= 60000) snap = windowStat(t.timestamp);
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
              const s = snap || { big: null, n: null, othersBuy: null, sellBnb: null };
              hits.push({
                token: addr, symbol: info.payload.symbol || '', fireSec: Math.round((cluster.lastTs + 200 - info.createdAtMs) / 1000),
                curVs: f.currentVsLaunchPct, exitVs: f.quietExitVsLaunchPct, holdPctFA: f.firstBigBuyerHoldPct,
                big: s.big, preN: s.n, othersBuy: s.othersBuy === null ? null : Math.round(s.othersBuy * 1000) / 1000, preSell: s.sellBnb === null ? null : Math.round(s.sellBnb * 1000) / 1000,
                retPct: Math.round((exit / firePx - 1) * 10000) / 100, exitWhy, grad: !!gradMs,
                bnbPnl: Math.round((BUY_BNB * (exit / firePx - 1)) * 10000) / 10000,
              });
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
  const one = hits.filter(h => h.big === 1);
  grid(one, '唯一大户(big=1)');
  for (const N of [10, 20, 40]) {
    for (const OB of [0.3, 0.5]) {
      grid(one.filter(h => h.preN <= N && h.othersBuy <= OB), `唯一大户∧笔数≤${N}∧他人买≤${OB}`);
    }
  }
  console.log(`明细: /tmp/solodance2-${NAME}.jsonl`);
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
