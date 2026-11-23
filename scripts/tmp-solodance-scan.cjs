#!/usr/bin/env node
/** T224 独舞形态扫描（182 跑）：「一个钱包的独舞——独自持大仓不全卖出的强庄爆拉币」
 *  用户四要素：①前期大钱包抢筹码（首笔 ≥0.3B 大买 latch）②适当卖出不全清（holdPct>0）
 *  ③拉盘前大钱包持大比例（出口时刻 latch 钱包占流通 ≥X——脚本层算）④其它用户全部离场
 *  （出口时刻正净持仓钱包数少）+ 四件套保留（沉寂≥60s∧涌入≥0.4∧≤30s∧出口未破发∧现价域）。
 *  分组线扫描：latchCircPct∈{30,40,50} × 出口holders∈{≤2,≤3,不限}；LAB 自检必中。
 *  用法：node scripts/tmp-solodance-scan.cjs --start ISO --end ISO --name w1 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');

// FA 因子条件（四件套骨架；latch/占比/holders 三要素脚本层判——将来立法再进 FA）
const LEG_FA = "quietSpanMs >= 60000 AND quietSurgeBuyBnb >= 0.4 AND quietSurgeSec <= 30 AND quietExitVsLaunchPct >= 0 AND quietExitVsLaunchPct <= 28.5 AND currentVsLaunchPct > 0 AND currentVsLaunchPct <= 28.5 AND actTotalBnb >= 0.1 AND tokenAgeSec >= 15 AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0";
const MAX_TICKS_PER_TOKEN = 30000;
const BUY_BNB = 0.2, STOP_LOSS_PCT = -40, STALL_SEC = 50;

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
      if (r.error) throw new Error('token_create: ' + r.error.message);
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
  console.log(`[${NAME}] tokens=${tokens.size} grads=${grads.size} (${START}~${END})`);

  const addrs = [...tokens.keys()];
  const fa = new FourMemeFactorAggregator({ logger: { info() {}, warn() {}, error() {} } });
  const ce = new ConditionEvaluator();
  const fs = require('fs');
  const out = fs.createWriteStream(`/tmp/solodance-${NAME}.jsonl`);
  const hits = []; let replayed = 0;
  const t0 = Date.now();

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
          .in('token_address', pAddrs).eq('platform', p).gt('id', fromId)
          .order('id', { ascending: true }).limit(1000);
        if (r.error) throw new Error('ticks: ' + r.error.message);
        for (const row of r.data) rowsByTok.get(row.token_address).push(row);
        if (r.data.length < 1000) break;
        fromId = r.data[r.data.length - 1].id;
      }
    }
    for (const addr of batch) {
      const info = tokens.get(addr);
      let rows = rowsByTok.get(addr) || [];
      if (rows.length < 6) continue;
      if (rows.length > MAX_TICKS_PER_TOKEN) rows = rows.slice(0, MAX_TICKS_PER_TOKEN);
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
      // 脚本层钱包追踪：latch（首笔≥0.3 BUY）+ 净持仓 map（出口时刻占比/人数）
      const pos = new Map();
      let latch = null;
      const apply = (t) => {
        const w = t.sender_address || t.trader_address;
        if (!w || !(t.token_amount > 0)) return;
        const d = t.trade_type === 'buy' ? t.token_amount : -t.token_amount;
        pos.set(w, (pos.get(w) || 0) + d);
        if (t.trade_type === 'buy' && !latch && t.bnb_amount >= 0.3) latch = { wallet: w, tokens: t.token_amount };
      };
      fa.registerToken(addr, {
        createdAtMs: info.createdAtMs, symbol: info.payload.symbol, name: info.payload.name,
        creatorAddress: info.payload.creator, platform: info.platform,
      });
      let cluster = null;
      let lastTickTs = null;
      let exitSnap = null; // 最近一次静默定格时刻的快照{latchCircPct, holders, latchHoldPct, top1CircPct}
      let fired = 0;
      const snapshotAt = () => {
        if (!latch) return { latchCircPct: null, holders: 0, latchHoldPct: null, top1CircPct: null };
        let sumPos = 0, top1 = 0, latchPos = 0;
        for (const [w, v] of pos) { if (v > 0) { sumPos += v; if (v > top1) top1 = v; if (w === latch.wallet) latchPos = v; } }
        return {
          latchCircPct: sumPos > 0 ? Math.round(latchPos / sumPos * 10000) / 100 : null,
          holders: [...pos.values()].filter(v => v > 0).length,
          latchHoldPct: Math.round(latchPos / latch.tokens * 10000) / 100,
          top1CircPct: sumPos > 0 ? Math.round(top1 / sumPos * 10000) / 100 : null,
        };
      };
      for (const t of ticks) {
        // 静默定格点检测（对齐 FA：gap ≥ 60s 的苏醒首笔=出口行）→ 先快照再喂
        if (lastTickTs !== null && t.timestamp - lastTickTs >= 60000) exitSnap = snapshotAt();
        apply(t);
        fa.processTick(t, { emitFactors: false });
        lastTickTs = t.timestamp;
        if (cluster === null || t.timestamp - cluster.lastTs > 1000) {
          if (cluster && fired < 2) {
            const f = fa.buildFactorMap(addr, cluster.lastTs + 200);
            if (f && ce.evaluate(LEG_FA, f)) {
              fired++;
              // 独舞三要素（脚本层，出口快照）
              const s = exitSnap || {};
              const firePx = f.currentPriceBnb;
              const gradMs = grads.get(addr) || null;
              let exit = null, exitWhy = null, lt = cluster.lastTs;
              for (const t2 of ticks) {
                if (t2.timestamp <= cluster.lastTs) continue;
                if (t2.price_bnb > 0) {
                  const pct = (t2.price_bnb / firePx - 1) * 100;
                  if (pct <= STOP_LOSS_PCT) { exit = t2.price_bnb; exitWhy = 'stop_loss'; break; }
                }
                if (t2.timestamp - lt > STALL_SEC * 1000) { exit = t2.price_bnb; exitWhy = 'stall'; break; }
                lt = t2.timestamp;
                if (gradMs && t2.timestamp >= gradMs) { exit = t2.price_bnb; exitWhy = 'graduation'; break; }
              }
              if (exit === null) { exit = (ticks[ticks.length - 1].price_bnb > 0 ? ticks[ticks.length - 1].price_bnb : firePx); exitWhy = 'window_end'; }
              const h = {
                token: addr, platform: info.platform, symbol: info.payload.symbol || '',
                fireSec: Math.round((cluster.lastTs + 200 - info.createdAtMs) / 1000),
                curVs: f.currentVsLaunchPct, exitVs: f.quietExitVsLaunchPct,
                spanMs: f.quietSpanMs, surgeBnb: f.quietSurgeBuyBnb, surgeSec: f.quietSurgeSec,
                holdPctFA: f.firstBigBuyerHoldPct,
                latchCircPct: s.latchCircPct === undefined ? null : s.latchCircPct,
                exitHolders: s.holders === undefined ? null : s.holders,
                latchHoldPct: s.latchHoldPct === undefined ? null : s.latchHoldPct,
                top1CircPct: s.top1CircPct === undefined ? null : s.top1CircPct,
                retPct: Math.round((exit / firePx - 1) * 10000) / 100, exitWhy,
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
    if ((bi / 50) % 4 === 0) console.log(`  批 ${bi / 50 + 1}/${Math.ceil(addrs.length / 50)} 重放 ${replayed} hits=${hits.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  out.end();
  // 汇总：独舞要素分组
  const hasLatch = hits.filter(h => typeof h.latchCircPct === 'number');
  console.log(`\n[${NAME}] 完成：${replayed} 票，FA 四件套过 ${hits.length} fire，其中有 latch(前期大买抢筹) ${hasLatch.length}`);
  const grid = (sel, lab) => {
    const pnl = sel.reduce((s, h) => s + h.bnbPnl, 0);
    const wins = sel.filter(h => h.bnbPnl > 0).length;
    console.log(`  ${lab}: n=${sel.length} 净=${pnl.toFixed(4)} 胜率=${sel.length ? Math.round(wins / sel.length * 100) : '-'}%`);
  };
  grid(hasLatch.filter(h => h.latchHoldPct > 0), '①抢筹∧不全清(holdPct>0)');
  for (const X of [30, 40, 50]) {
    for (const H of [2, 3, 99]) {
      grid(hasLatch.filter(h => h.latchHoldPct > 0 && h.latchCircPct >= X && h.exitHolders <= H),
        `独舞 circ≥${X}∧holders≤${H === 99 ? '∞' : H}`);
    }
  }
  const lab = hits.find(h => h.token && h.token.toLowerCase().startsWith('0x1a081086'));
  if (lab) console.log('  LAB 自检:', JSON.stringify({ latchCircPct: lab.latchCircPct, exitHolders: lab.exitHolders, latchHoldPct: lab.latchHoldPct, pnl: lab.bnbPnl }));
  console.log(`明细: /tmp/solodance-${NAME}.jsonl`);
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
