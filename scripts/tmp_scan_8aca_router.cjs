// 8aca25e2 补充：190 个被拦 token 的 router 占比分布（判别假性不翻案）+ 回填量估计
'use strict';
require('dotenv').config({ path: '/home/ubuntu/richer-js/config/.env' });
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');

const EXP = '8aca25e2-7baf-421d-9a6a-6698d85d977d';
const ROUTER = '0x1de460';

async function main() {
  const c = dbManager.getClient();
  const { data: sigs, error: sErr } = await c.from('strategy_signals')
    .select('token_address,created_at,metadata->preBuyCheckFactors->earlyTradesTop1BuySharePct')
    .eq('experiment_id', EXP)
    .eq('action', 'buy')
    .limit(2000);
  if (sErr) throw new Error(sErr.message);
  const blocked = sigs.filter(s => (s.earlyTradesTop1BuySharePct ?? -1) >= 60);
  const byToken = new Map();
  for (const s of blocked) {
    if (!byToken.has(s.token_address)) byToken.set(s.token_address, { n: 0, oldTop1: s.earlyTradesTop1BuySharePct });
    byToken.get(s.token_address).n++;
  }
  const tokens = [...byToken.keys()];

  const anchor = new Map();
  for (let i = 0; i < tokens.length; i += 100) {
    const { data: evs, error } = await c.from('wss_events')
      .select('token_address,platform,block_time')
      .eq('kind', 'token_create')
      .in('token_address', tokens.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const e of evs) {
      const prev = anchor.get(e.token_address);
      if (!prev || (e.block_time && e.block_time < prev.t)) anchor.set(e.token_address, { t: e.block_time, platform: e.platform });
    }
  }

  const buckets = { 'router>=70%': [], '60-70%': [], '40-60%': [], '<40%': [] };
  let totalNullRows = 0, potentialTokens = 0, potentialRows = 0, potentialBlockedSigs = 0;
  for (const tok of tokens) {
    const a = anchor.get(tok);
    if (!a) continue;
    const to = new Date(new Date(a.t).getTime() + 90 * 1000).toISOString();
    const { data: rows, error } = await c.from('wss_price_ticks')
      .select('trader_address,sender_address,bnb_amount')
      .eq('token_address', tok)
      .eq('trade_type', 'buy')
      .gte('block_time', a.t)
      .lt('block_time', to)
      .limit(2000);
    if (error) throw new Error(error.message);
    if (!rows.length) continue;
    let buyBnb = 0, routerBnb = 0, nullRows = 0;
    for (const r of rows) {
      const v = r.bnb_amount || 0;
      buyBnb += v;
      if ((r.trader_address || '').startsWith(ROUTER)) routerBnb += v;
      if (r.sender_address == null) nullRows++;
    }
    totalNullRows += nullRows;
    const rpct = buyBnb > 0 ? routerBnb / buyBnb * 100 : 0;
    const item = { tok: tok.slice(0, 10), plat: a.platform, n: byToken.get(tok).n, old: byToken.get(tok).oldTop1?.toFixed(0), routerPct: rpct.toFixed(1), nullRows, rows: rows.length, buyBnb: buyBnb.toFixed(1) };
    if (rpct >= 70) buckets['router>=70%'].push(item);
    else if (rpct >= 60) buckets['60-70%'].push(item);
    else if (rpct >= 40) buckets['40-60%'].push(item);
    else buckets['<40%'].push(item);
    // 潜在翻案：router 主导 + sender 全缺（老窗口假性不翻案）——已确认翻案的 7 个 sender 已有会排除
    const senderAvail = rows.some(r => r.sender_address != null);
    if (rpct >= 60 && !senderAvail) { potentialTokens++; potentialRows += nullRows; potentialBlockedSigs += byToken.get(tok).n; }
  }
  for (const [k, arr] of Object.entries(buckets)) {
    console.log(k + ':', arr.length, 'token,', arr.reduce((s, x) => s + x.n, 0), '个被拦 signal');
    arr.sort((a, b) => b.n - a.n);
    for (const x of arr.slice(0, 5)) console.log('   ', JSON.stringify(x));
  }
  console.log('窗口 sender NULL 行总数(全部 token):', totalNullRows);
  console.log('潜在翻案(router>=60% 且 sender 全缺·老窗口):', potentialTokens, 'token /', potentialBlockedSigs, '个被拦 signal / 需回填', potentialRows, '行');
  process.exit(0);
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
