#!/usr/bin/env node
// 0x5629 团队·第三步补查：整体盈亏方向 + 11月残余活跃 + 当天连发票协同 + 名单污染面
const { dbManager } = require('../src/services/dbManager');
const TEAM = JSON.parse(require('fs').readFileSync('/tmp/tmp-5629-team.json', 'utf8'));
const lc = s => (s || '').toLowerCase();

async function pull(sb) {
  const want = ['id', 'token_address', 'block_time', 'trade_type', 'bnb_amount', 'price_bnb', 'sender_address', 'trader_address'].join(',');
  const rows = [];
  const CHUNK = 7;
  for (let i = 0; i < TEAM.length; i += CHUNK) {
    const part = TEAM.slice(i, i + CHUNK);
    let cursor = 0;
    for (;;) {
      const { data, error } = await sb.from('wss_price_ticks').select(want).in('sender_address', part).gt('id', cursor).limit(1000);
      if (error) throw error;
      if (!data.length) break;
      rows.push(...data);
      for (const r of data) if (r.id > cursor) cursor = r.id;
      if (data.length < 1000) break;
    }
    console.log(`  [chunk ${i / CHUNK + 1}] 累计 ${rows.length} 行`);
  }
  // 去重（同钱包双列命中理论不重叠，但保险）
  const seen = new Set(); const out = [];
  for (const r of rows) if (!seen.has(r.id)) { seen.add(r.id); out.push(r); }
  return out;
}

async function main() {
  const sb = dbManager.getClient();
  const rows = await pull(sb);
  let buy = 0, sell = 0, buyN = 0, sellN = 0;
  const perW = new Map();
  for (const r of rows) {
    const w = lc(r.sender_address) || lc(r.trader_address);
    if (!TEAM.includes(w)) continue;
    const b = +r.bnb_amount || 0;
    if (r.trade_type === 'buy') buy += b, buyN++; else sell += b, sellN++;
    let o = perW.get(w); if (!o) { o = { w, buy: 0, sell: 0 }; perW.set(w, o); }
    if (r.trade_type === 'buy') o.buy += b; else o.sell += b;
  }
  console.log(`=== 团队全史合计（${TEAM.length} 钱包，${rows.length} 行）===`);
  console.log(`Σ买=${buy.toFixed(1)} BNB (${buyN}笔)  Σ卖=${sell.toFixed(1)} BNB (${sellN}笔)  净=${(sell - buy).toFixed(1)} BNB`);
  console.log(`\nper-wallet 净额（卖-买，正=收割方向）top:`);
  [...perW.values()].sort((a, b) => (b.sell - b.buy) - (a.sell - a.buy)).forEach(o => console.log(`${o.w} 买${o.buy.toFixed(1)} 卖${o.sell.toFixed(1)} 净${(o.sell - o.buy).toFixed(2)}`));

  // 11月活跃明细
  console.log(`\n=== 2026-11-01 之后活跃 ===`);
  const nov = rows.filter(r => r.block_time >= '2026-11-01');
  const nt = new Map();
  for (const r of nov) {
    const w = lc(r.sender_address) || lc(r.trader_address);
    const k = r.token_address;
    if (!nt.has(k)) nt.set(k, []);
    nt.get(k).push({ w, t: r.block_time, side: r.trade_type, bnb: +(+(r.bnb_amount || 0)).toFixed(3) });
  }
  for (const [k, arr] of nt) {
    console.log(`${k} ${arr[0].t.slice(0, 16)} 团队钱包=${new Set(arr.map(x => x.w)).size} 行=${arr.length}`);
    arr.slice(0, 6).forEach(x => console.log(`   ${x.w.slice(0, 12)} ${x.t.slice(11, 19)} ${x.side} ${x.bnb}B`));
  }

  // 当天 09:12-09:16 三连票协同（45d4a84f / 5629 / d1f0215b）
  console.log(`\n=== 2026-10-12 09:10-09:20 团队参与的票 ===`);
  const win = rows.filter(r => r.block_time >= '2026-10-12T09:10' && r.block_time <= '2026-10-12T09:20');
  const wt = new Map();
  for (const r of win) {
    const w = lc(r.sender_address) || lc(r.trader_address);
    if (!wt.has(r.token_address)) wt.set(r.token_address, new Set());
    wt.get(r.token_address).add(w);
  }
  for (const [t, ws] of wt) console.log(`${t} 团队钱包=${ws.size}: ${[...ws].map(x => x.slice(0, 8)).join(',')}`);

  // 名单污染面：smartmoney-accum / famous 里命中几个 + sybil 已收几个
  console.log(`\n=== 现行名单覆盖 vs 未覆盖 ===`);
  const fs = require('fs');
  const syb = JSON.stringify(JSON.parse(fs.readFileSync('config/rosters/sybil-clusters.json', 'utf8')));
  const cwr = JSON.stringify(JSON.parse(fs.readFileSync('config/rosters/copy-wallet-roster.json', 'utf8')));
  const sm = JSON.stringify(JSON.parse(fs.readFileSync('data/kol-study/smartmoney-accum.json', 'utf8')));
  for (const w of TEAM) {
    const inSyb = syb.includes(w), inCwr = cwr.includes(w), inSm = sm.includes(w);
    const o = perW.get(w);
    const tags = [inSyb && 'sybil', inCwr && 'copyRoster', inSm && '⚠smartmoney'].filter(Boolean).join('+') || '未收录';
    console.log(`${w} 净${(o ? (o.sell - o.buy).toFixed(2) : '0')}B 参与票量大 → ${tags}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
