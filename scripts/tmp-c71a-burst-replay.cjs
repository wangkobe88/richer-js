#!/usr/bin/env node
// 0xc71a sbw=burst 判据重放——锚=信号2 12:55:23；展示时间线/最后≥30s静默段/出口波簇（CD402 量级线对照）
const { dbManager } = require('../src/services/dbManager');
const { AGGREGATOR_ROUTER_ADDRS } = require('../src/trading-engine/pre-check/aggregator-routers');

const TOKEN = '0xc71a685b7ccb5dcd119ddc889f78f048e4e37777';
const ANCHOR = Date.parse('2026-10-04T12:55:23+00:00');
const AGG = new Set([...AGGREGATOR_ROUTER_ADDRS].map(a => a.toLowerCase()));
const lc = s => (s || '').toLowerCase();

(async () => {
  const c = dbManager.getClient();
  const ev = await c.from('wss_events').select('block_time,payload,kind')
    .eq('token_address', TOKEN).eq('kind', 'token_create').limit(1);
  if (ev.data && ev.data[0]) console.log('token_create:', ev.data[0].block_time, JSON.stringify(ev.data[0].payload).slice(0, 160));

  const r = await c.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,sender_address,trader_address')
    .eq('token_address', TOKEN)
    .lte('block_time', '2026-10-04T12:55:23.999+00:00')
    .order('block_time', { ascending: true })
    .limit(4000);
  if (r.error) throw r.error;
  const rows = r.data.map(x => ({
    ts: Date.parse(x.block_time), bn: x.block_number, li: x.log_index,
    isBuy: x.trade_type === 'buy', bnb: Number(x.bnb_amount),
    w: lc(x.sender_address || x.trader_address),
  }));
  console.log(`锚前行数=${rows.length}  首=${new Date(rows[0].ts).toISOString()}  尾=${new Date(rows[rows.length - 1].ts).toISOString()}`);

  // 时间线：每 30s 桶 行数/买额
  const t0 = rows[0].ts;
  const buckets = new Map();
  for (const x of rows) {
    const b = Math.floor((x.ts - t0) / 30000);
    const o = buckets.get(b) || { n: 0, buyB: 0, sellB: 0 };
    o.n++; if (x.isBuy) o.buyB += x.bnb; else o.sellB += x.bnb;
    buckets.set(b, o);
  }
  console.log('\n== 时间线（30s 桶）==');
  for (const [b, o] of [...buckets].sort((a, b) => a[0] - b[0])) {
    const sec = b * 30;
    console.log(`t+${String(sec).padStart(5)}s~  ${String(o.n).padStart(3)}行  买${o.buyB.toFixed(3)} 卖${o.sellB.toFixed(3)}${sec >= (ANCHOR - t0 - 60000) ? '  ←近锚' : ''}`);
  }

  // 最后一个 ≥30s 静默段
  let stall = null;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].ts - rows[i - 1].ts >= 30000) stall = { from: rows[i - 1], to: rows[i], gapSec: (rows[i].ts - rows[i - 1].ts) / 1000 };
  }
  console.log('\n== 最后 ≥30s 静默段 ==');
  if (!stall) console.log('无');
  else {
    console.log(`gap=${stall.gapSec.toFixed(1)}s  段前末行=${new Date(stall.from.ts).toISOString()}  出口行=${new Date(stall.to.ts).toISOString()}（锚前 ${((ANCHOR - stall.to.ts) / 1000).toFixed(1)}s）`);
    // 出口波簇：出口行起 gap<5s 连续（CD407 口径），截止锚
    const exitIdx = rows.indexOf(stall.to);
    const cluster = [rows[exitIdx]];
    for (let i = exitIdx + 1; i < rows.length; i++) {
      if (rows[i].ts - rows[i - 1].ts >= 5000) break;
      cluster.push(rows[i]);
    }
    const buy = cluster.filter(x => x.isBuy);
    const sell = cluster.filter(x => !x.isBuy);
    const buyBnb = buy.reduce((s, x) => s + x.bnb, 0);
    const sellBnb = sell.reduce((s, x) => s + x.bnb, 0);
    const wallets = new Set(buy.map(x => x.w).filter(w => w && !AGG.has(w)));
    console.log(`burst 流量簇（gap<5s 连续）=${cluster.length} 行，跨度 ${((cluster[cluster.length - 1].ts - cluster[0].ts) / 1000).toFixed(1)}s`);
    console.log(`簇内 买=${buy.length} 笔 ${buyBnb.toFixed(4)} BNB / 卖=${sell.length} 笔 ${sellBnb.toFixed(4)} BNB / 去路由买入钱包=${wallets.size} 个  ←CD402 量级线(≥0.3B)/资格线(≥2钱包)`);
    console.log('\n簇内明细：');
    for (const x of cluster) {
      console.log(`  ${new Date(x.ts).toISOString().slice(11, 23)}  ${x.isBuy ? 'BUY ' : 'SELL'} ${x.bnb.toFixed(4)}  ${x.w} ${AGG.has(x.w) ? '[router]' : ''}`);
    }
    // 锚与簇的关系
    const lastInCluster = cluster[cluster.length - 1];
    console.log(`\n簇末→锚 距离=${((ANCHOR - lastInCluster.ts) / 1000).toFixed(1)}s；锚=信号2 fire`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
