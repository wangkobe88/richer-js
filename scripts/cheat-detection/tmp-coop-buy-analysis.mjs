#!/usr/bin/env node
// 一次性（182 跑）：「协同买入/交易额分布」锚设计前置分析——128 票锚窗全量拉取，
// 按 人工裁定 分组对比买入金额分布 + 单块冲击度 + 冷寂突发形状（用户 2026-11-02
// 指令：healthy 盘交易额分布基线 + CD6/CD7 同块协同形状量化）。纯 DB 读，零 Jev。
import { createRequire } from 'module';
import { readFileSync } from 'fs';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const sb = dbManager.getClient();

const CASES = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8')).cases;
const TICK_COLS = 'block_time,block_number,log_index,trade_type,bnb_amount,sender_address,trader_address';
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',').map(s=>s.trim()) : null;
// 明细打印票：首批 7 票 + 20 张人工cheat→机器healthy 放行票
const DETAIL = new Set(['CD4','CD5','CD6','CD7','CD8','CD9','CD10',
  'CD11','CD14','CD22','CD24','CD36','CD40','CD48','CD50','CD52','CD58','CD61','CD64','CD83','CD89','CD97','CD102','CD121']);

function quant(sorted, q) { if (!sorted.length) return null; const i = Math.min(sorted.length - 1, Math.floor(sorted.length * q)); return sorted[i]; }

const stats = [];
for (const c of CASES) {
  if (ONLY && !ONLY.includes(c.caseId)) continue;
  const n = c.anchor.tickCount;
  const { data: rows, error } = await sb.from('wss_price_ticks')
    .select(TICK_COLS).eq('token_address', c.addr)
    .order('block_number', { ascending: true }).order('log_index', { ascending: true })
    .limit(n);
  if (error) throw new Error(`${c.caseId}: ${error.message}`);
  const buys = (rows ?? []).filter(r => r.trade_type === 'buy');
  if (!buys.length) { stats.push({ id: c.caseId, verdict: c.expect.verdict, err: '无买行' }); continue; }
  const amounts = buys.map(r => Number(r.bnb_amount)).sort((a, b) => a - b);
  const totalBuy = amounts.reduce((s, v) => s + v, 0);
  const med = quant(amounts, 0.5), p90 = quant(amounts, 0.9), mx = amounts[amounts.length - 1];
  const mean = totalBuy / amounts.length;
  const cv = mean > 0 ? Math.sqrt(amounts.reduce((s, v) => s + (v - mean) ** 2, 0) / amounts.length) / mean : null;
  // 档位聚集：金额四位舍入桶 → 最大桶钱包数占比（同档≠同钱包，钱包去重后计）
  const walletOf = r => (r.sender_address || r.trader_address || '').toLowerCase();
  const bucketWallets = new Map(); // amountKey -> Set(wallet)
  for (const r of buys) {
    const k = (Number(r.bnb_amount)).toFixed(4);
    if (!bucketWallets.has(k)) bucketWallets.set(k, new Set());
    bucketWallets.get(k).add(walletOf(r));
  }
  let topBucketN = 0, topBucketAmt = '0.0000';
  for (const [k, s] of bucketWallets) if (s.size > topBucketN) { topBucketN = s.size; topBucketAmt = k; }
  const uniqWallets = new Set(buys.map(walletOf)).size;
  // 单块冲击：每块买入笔数/金额 → 最大块；该块与前一买块的时间间隔（冷寂前摇）
  const blocks = new Map(); // blockNumber -> {n, bnb, ts}
  for (const r of buys) {
    const b = blocks.get(r.block_number) || { n: 0, bnb: 0, ts: r.block_time };
    b.n += 1; b.bnb += Number(r.bnb_amount); blocks.set(r.block_number, b);
  }
  const bl = [...blocks.entries()].sort((a, b) => a[0] - b[0]);
  let maxBl = null;
  for (const [bn, b] of bl) if (!maxBl || b.n > maxBl.n || (b.n === maxBl.n && b.bnb > maxBl.bnb)) maxBl = { bn, ...b };
  const idx = bl.findIndex(([bn]) => bn === maxBl.bn);
  const preGap = idx > 0 ? (new Date(maxBl.ts) - new Date(bl[idx - 1][1].ts)) / 1000 : 0;
  const buysPerBlockMid = quant(bl.map(([, b]) => b.n).sort((a, b) => a - b), 0.5);
  stats.push({
    id: c.caseId, verdict: c.expect.verdict, buyN: buys.length, blkN: bl.length,
    med, p90r: p90 / med, maxR: mx / med, cv,
    topBucketPct: topBucketN / uniqWallets * 100, topBucketAmt,
    maxBlN: maxBl.n, maxBlBnb: maxBl.bnb, maxBlPct: totalBuy > 0 ? maxBl.bnb / totalBuy * 100 : null,
    preGap, buysPerBlockMid, walletN: uniqWallets,
  });
}

// 聚合：按人工裁定分组，各指标取组内中位数
console.log('== 组聚合（各指标=组内中位数）==');
console.log(['人工裁定','票数','买笔数','块数','中位金额','P90/中位','最大/中位','CV','同档钱包%','最大档额','最大块笔数','最大块占买%','最大块前静默s','块笔数中位'].join(' | '));
for (const v of ['healthy', 'unhealthy', 'cheat']) {
  const g = stats.filter(s => s.verdict === v && !s.err);
  if (!g.length) continue;
  const mid = key => { const a = g.map(s => s[key]).filter(x => x !== null && x !== undefined).sort((x, y) => x - y); return quant(a, 0.5); };
  console.log([v, g.length, mid('buyN'), mid('blkN'), mid('med').toFixed(4), mid('p90r').toFixed(1), mid('maxR').toFixed(1), mid('cv').toFixed(2), mid('topBucketPct').toFixed(1), g.map(s=>s.topBucketAmt).sort((a,b)=>g.filter(x=>x.topBucketAmt===a).length-g.filter(x=>x.topBucketAmt===b).length)[0], mid('maxBlN'), mid('maxBlPct').toFixed(1), mid('preGap').toFixed(1), mid('buysPerBlockMid')].join(' | '));
}
console.log('\n== 明细（首批 7 票 + 20 张人工cheat→机器healthy 放行票）==');
console.log(['案号','人工','买笔','块数','中位BNB','P90/中位','最大/中位','CV','同档钱包%','最大档','最大块笔','最大块BNB','最大块占买%','前静默s','块笔中位'].join(' | '));
for (const s of stats) {
  if (s.err) { console.log(`${s.id} ❌ ${s.err}`); continue; }
  if (DETAIL.has(s.id)) console.log([s.id, s.verdict, s.buyN, s.blkN, s.med.toFixed(4), s.p90r.toFixed(1), s.maxR.toFixed(1), s.cv.toFixed(2), s.topBucketPct.toFixed(1), s.topBucketAmt, s.maxBlN, s.maxBlBnb.toFixed(2), s.maxBlPct.toFixed(1), s.preGap.toFixed(1), s.buysPerBlockMid].join(' | '));
}
// 存全量明细供后续分析
const { writeFileSync } = await import('fs');
writeFileSync(new URL('./data/tmp-coop-buy-stats.json', import.meta.url), JSON.stringify(stats, null, 1));
console.log('\n全量明细已存 scripts/cheat-detection/data/tmp-coop-buy-stats.json');
process.exit(0);
