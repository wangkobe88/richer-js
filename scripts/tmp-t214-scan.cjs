#!/usr/bin/env node
/** T214 命中面扫描（182 跑）：强庄重启臂（除 firstBigBuyerHoldPct 线外全部条件）跨窗触发面
 *  + holdPct 分布 + 简版收益模拟（-40% 止损/毕业清仓/50s 停滞/窗尾强平）。
 *  用法：node scripts/tmp-t214-scan.cjs --start <ISO> --end <ISO> --name <w1> [--min-ticks 5]
 *  输出：/tmp/t214-<name>.jsonl（逐命中行）+ stdout 汇总。零 Jev 零网络 API（纯 DB ticks 重放）。 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');

// v35 强庄臂条件，③ firstBigBuyerHoldPct 线拆出（扫描时记录值、汇总时按线分组）
const LEG_BASE = "quietSpanMs >= 60000 AND quietSurgeBuyBnb >= 0.4 AND quietSurgeSec <= 30 AND quietExitVsLaunchPct >= 0 AND quietExitVsLaunchPct <= 28.5 AND currentVsLaunchPct > 0 AND currentVsLaunchPct <= 40 AND actTotalBnb >= 0.1 AND tokenAgeSec >= 15 AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0";
const MAX_TICKS_PER_TOKEN = 30000;
const BUY_BNB = 0.2, STOP_LOSS_PCT = -40, STALL_SEC = 50;

const argOf = (k) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : null; };
const argv = { start: argOf('start'), end: argOf('end'), name: argOf('name') };
if (!argv.start || !argv.end || !argv.name) { console.error('need --start --end --name'); process.exit(1); }
const START = argv.start, END = argv.end, NAME = argv.name;

async function fetchTokens(db) {
  const platforms = ['fourmeme', 'flap'];
  const out = new Map(); // addr -> {platform, createdAtMs, meta}
  for (const p of platforms) {
    let last = null;
    for (;;) {
      const q = db.from('wss_events').select('token_address, block_time, platform, payload')
        .eq('kind', 'token_create').eq('platform', p).gte('block_time', START).lt('block_time', END)
        .order('block_time', { ascending: true }).limit(1000);
      if (last) q.gt('block_time', last);
      const r = await q;
      if (r.error) throw new Error('token_create: ' + r.error.message);
      for (const row of r.data) {
        if (!out.has(row.token_address)) {
          out.set(row.token_address, { platform: p, createdAtMs: new Date(row.block_time).getTime(), payload: row.payload || {} });
        }
      }
      if (r.data.length < 1000) break;
      last = r.data[r.data.length - 1].block_time;
    }
  }
  return out;
}

async function main() {
  const db = dbManager.getClient();
  const tokens = await fetchTokens(db);
  console.log(`[${NAME}] tokens=${tokens.size} (${START} ~ ${END})`);
  // graduation 时间点（窗内）
  const grads = new Map();
  {
    let last = null;
    for (;;) {
      const q = db.from('wss_events').select('token_address, block_time')
        .eq('kind', 'graduation').gte('block_time', START).lt('block_time', END)
        .order('block_time', { ascending: true }).limit(1000);
      if (last) q.gt('block_time', last);
      const r = await q;
      if (r.error) throw new Error('graduation: ' + r.error.message);
      for (const row of r.data) grads.set(row.token_address, new Date(row.block_time).getTime());
      if (r.data.length < 1000) break;
      last = r.data[r.data.length - 1].block_time;
    }
  }
  console.log(`[${NAME}] graduations=${grads.size}`);

  const addrs = [...tokens.keys()];
  const fa = new FourMemeFactorAggregator({ logger: { info() {}, warn() {}, error() {} } });
  const ce = new ConditionEvaluator();
  const fs = require('fs');
  const outPath = `/tmp/t214-${NAME}.jsonl`;
  const out = fs.createWriteStream(outPath);
  const hits = []; let replayed = 0; let tickTotal = 0;
  const tStart = Date.now();

  for (let bi = 0; bi < addrs.length; bi += 50) {
    const batch = addrs.slice(bi, bi + 50);
    // 地址批 .in + platform 单值 .eq 循环（红线形状）；行数帽 per token
    const rowsByTok = new Map(batch.map(a => [a, []]));
    for (const p of ['fourmeme', 'flap']) {
      const pAddrs = batch.filter(a => tokens.get(a).platform === p);
      if (!pAddrs.length) continue;
      let fromId = 0;
      for (;;) {
        const r = await db.from('wss_price_ticks')
          .select('id, token_address, trade_type, trader_address, sender_address, price_bnb, bnb_amount, token_amount, block_number, block_time, log_index, price_outlier, platform, quote_token')
          .in('token_address', pAddrs).eq('platform', p).gt('id', fromId)
          .order('id', { ascending: true }).limit(1000);
        if (r.error) throw new Error('ticks: ' + r.error.message);
        for (const row of r.data) rowsByTok.get(row.token_address).push(row);
        if (r.data.length < 1000) break;
        fromId = r.data[r.data.length - 1].id;
        // 批内总行数帽（防爆）
        let tot = 0; for (const v of rowsByTok.values()) tot += v.length;
        if (tot > 50 * MAX_TICKS_PER_TOKEN) break;
      }
    }
    for (const addr of batch) {
      const info = tokens.get(addr);
      let rows = rowsByTok.get(addr) || [];
      if (rows.length < 6) continue; // 最低 6 笔（腿 actTotal 门之下必不触发，跳过省时）
      if (rows.length > MAX_TICKS_PER_TOKEN) rows = rows.slice(0, MAX_TICKS_PER_TOKEN);
      rows.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
      const ticks = rows.map(row => ({
        token_address: row.token_address, trade_type: row.trade_type,
        trader_address: row.trader_address, sender_address: row.sender_address || null,
        price_bnb: Number(row.price_bnb), price_usd: null,
        bnb_amount: Number(row.bnb_amount || 0), token_amount: Number(row.token_amount || 0),
        block_number: row.block_number, timestamp: new Date(row.block_time).getTime(),
        tx_hash: row.tx_hash || null, log_index: row.log_index, price_outlier: row.price_outlier || false,
        platform: row.platform, quote_token: row.quote_token || null,
      }));
      tickTotal += ticks.length;
      // 重放（单 FA 实例多 token）
      fa.registerToken(addr, {
        createdAtMs: info.createdAtMs, symbol: info.payload.symbol, name: info.payload.name,
        creatorAddress: info.payload.creator, platform: info.platform,
      });
      let cluster = null;
      let fired = 0;
      for (const t of ticks) {
        fa.processTick(t, { emitFactors: false });
        if (cluster === null || t.timestamp - cluster.lastTs > 1000) {
          if (cluster && fired < 2) {
            const f = fa.buildFactorMap(addr, cluster.lastTs + 200);
            if (f && ce.evaluate(LEG_BASE, f)) {
              fired++;
              // 收益模拟：fire 价买入，-40% 止损 / 毕业 / 50s 停滞 / 窗尾强平
              const firePx = f.currentPriceBnb;
              const gradMs = grads.get(addr) || null;
              let exit = null, exitWhy = null;
              let lastTs = cluster.lastTs;
              for (const t2 of ticks) {
                if (t2.timestamp <= cluster.lastTs) continue;
                const px = t2.price_bnb;
                if (px > 0) {
                  const pct = (px / firePx - 1) * 100;
                  if (pct <= STOP_LOSS_PCT) { exit = px; exitWhy = 'stop_loss'; break; }
                }
                if (t2.timestamp - lastTs > STALL_SEC * 1000) { exit = px; exitWhy = 'stall'; break; }
                lastTs = t2.timestamp;
                if (gradMs && t2.timestamp >= gradMs) { exit = px; exitWhy = 'graduation'; break; }
              }
              if (exit === null) { exit = (ticks[ticks.length - 1].price_bnb > 0 ? ticks[ticks.length - 1].price_bnb : firePx); exitWhy = 'window_end'; }
              const retPct = (exit / firePx - 1) * 100;
              const h = {
                token: addr, platform: info.platform, symbol: info.payload.symbol || '',
                fireAtMs: cluster.lastTs + 200, fireSec: Math.round((cluster.lastTs + 200 - info.createdAtMs) / 1000),
                firePx, curVs: f.currentVsLaunchPct, exitVs: f.quietExitVsLaunchPct,
                holdPct: f.firstBigBuyerHoldPct, spanMs: f.quietSpanMs, surgeBnb: f.quietSurgeBuyBnb,
                surgeSec: f.quietSurgeSec, retPct: Math.round(retPct * 100) / 100, exitWhy,
                grad: !!gradMs, bnbPnl: Math.round((BUY_BNB * (exit / firePx - 1)) * 10000) / 10000,
              };
              hits.push(h); out.write(JSON.stringify(h) + '\n');
            }
          }
          cluster = { lastTs: t.timestamp };
        } else {
          cluster.lastTs = Math.max(cluster.lastTs, t.timestamp);
        }
      }
      replayed++;
    }
    if ((bi / 50) % 4 === 0) console.log(`  批 ${bi / 50 + 1}/${Math.ceil(addrs.length / 50)} 已重放 ${replayed} 票 hits=${hits.length} (${((Date.now() - tStart) / 1000).toFixed(0)}s)`);
  }
  out.end();
  // 汇总：按 holdPct 线分组
  const lines = [30, 35, 40, 50, null]; // null=不设③
  console.log(`\n[${NAME}] 扫描完成：${replayed} 票重放，${hits.length} 处 fire（除③外全过）`);
  for (const L of lines) {
    const sel = L === null ? hits : hits.filter(h => typeof h.holdPct === 'number' && h.holdPct >= L);
    const pnl = sel.reduce((s, h) => s + h.bnbPnl, 0);
    const wins = sel.filter(h => h.bnbPnl > 0).length;
    console.log(`  ③线=${L === null ? '无' : '≥' + L}: n=${sel.length} 净=${pnl.toFixed(4)} BNB 胜率=${sel.length ? Math.round(wins / sel.length * 100) : '-'}%` +
      (sel.length ? ` | exits: ${JSON.stringify(sel.reduce((m, h) => (m[h.exitWhy] = (m[h.exitWhy] || 0) + 1, m), {}))}` : ''));
  }
  console.log(`明细: ${outPath}`);
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
