// 8aca25e2 top1 门污染面量化：被拦 457 票的首窗双口径 top1 对拍
'use strict';
require('dotenv').config({ path: '/home/ubuntu/richer-js/config/.env' });
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');

const EXP = '8aca25e2-7baf-421d-9a6a-6698d85d977d';
const ROUTER = '0x1de460';

async function main() {
  const c = dbManager.getClient();

  // 1) 被拦 signal（top1>=60）的 token + fire 时间
  const { data: sigs, error: sErr } = await c.from('strategy_signals')
    .select('token_address,created_at,metadata->preBuyCheckFactors->earlyTradesTop1BuySharePct')
    .eq('experiment_id', EXP)
    .eq('action', 'buy')
    .limit(2000);
  if (sErr) throw new Error(sErr.message);
  const blocked = sigs.filter(s => (s.earlyTradesTop1BuySharePct ?? -1) >= 60);
  const byToken = new Map();
  for (const s of blocked) {
    if (!byToken.has(s.token_address)) byToken.set(s.token_address, { firstFire: s.created_at, n: 0, oldTop1: s.earlyTradesTop1BuySharePct });
    byToken.get(s.token_address).n++;
    if (s.created_at < byToken.get(s.token_address).firstFire) {
      byToken.get(s.token_address).firstFire = s.created_at;
      byToken.get(s.token_address).oldTop1 = s.earlyTradesTop1BuySharePct;
    }
  }
  const tokens = [...byToken.keys()];
  console.log('被拦 signal:', blocked.length, '| distinct token:', tokens.length);

  // 2) token_create 锚（分批 in）
  const anchor = new Map(); // token -> {t, platform}
  for (let i = 0; i < tokens.length; i += 100) {
    const { data: evs, error } = await c.from('wss_events')
      .select('token_address,platform,block_time,payload')
      .eq('kind', 'token_create')
      .in('token_address', tokens.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const e of evs) {
      const prev = anchor.get(e.token_address);
      if (!prev || (e.block_time && e.block_time < prev.t)) {
        anchor.set(e.token_address, { t: e.block_time, platform: e.platform });
      }
    }
  }
  console.log('锚到 token_create:', anchor.size, '/', tokens.length);

  // 3) 每 token 首 90s 窗 buy 行双口径聚合
  let flipped = [], notFlipped = 0, nullRows = 0, totalRows = 0, rowsNoAnchor = 0, senderAvail = 0;
  for (const tok of tokens) {
    const a = anchor.get(tok);
    if (!a) { rowsNoAnchor++; continue; }
    const from = a.t;
    const to = new Date(new Date(from).getTime() + 90 * 1000).toISOString();
    const { data: rows, error } = await c.from('wss_price_ticks')
      .select('trader_address,sender_address,bnb_amount')
      .eq('token_address', tok)
      .eq('trade_type', 'buy')
      .gte('block_time', from)
      .lt('block_time', to)
      .limit(2000);
    if (error) throw new Error(error.message);
    if (!rows.length) continue;
    totalRows += rows.length;
    const aggTrader = new Map(), aggSender = new Map();
    let buyBnb = 0, routerBnb = 0, nullSenderRows = 0;
    for (const r of rows) {
      const v = r.bnb_amount || 0;
      buyBnb += v;
      if ((r.trader_address || '').startsWith(ROUTER)) routerBnb += v;
      aggTrader.set(r.trader_address, (aggTrader.get(r.trader_address) || 0) + v);
      const sender = r.sender_address || r.trader_address; // COALESCE 口径
      if (r.sender_address != null) senderAvail++; else nullSenderRows++;
      aggSender.set(sender, (aggSender.get(sender) || 0) + v);
    }
    nullRows += nullSenderRows;
    const top1Trader = Math.max(...aggTrader.values()) / buyBnb * 100;
    const top1Sender = Math.max(...aggSender.values()) / buyBnb * 100;
    const info = byToken.get(tok);
    if (top1Sender < 60 && top1Trader >= 60) {
      flipped.push({ tok, n: info.n, old: info.oldTop1, newTop1: +top1Sender.toFixed(1), routerPct: +(routerBnb / buyBnb * 100).toFixed(1), nullPct: +(nullSenderRows / rows.length * 100).toFixed(1), buyBnb: +buyBnb.toFixed(2), plat: a.platform });
    } else notFlipped++;
  }

  console.log('窗口行总数:', totalRows, '| sender 已有:', senderAvail, '| sender NULL(需回填):', nullRows, '| 无锚 token:', rowsNoAnchor);
  console.log('翻案 token(新口径<60):', flipped.length, '| 不翻案:', notFlipped);
  flipped.sort((a, b) => b.n - a.n);
  console.log('翻案明细(按被拦次数):');
  for (const f of flipped.slice(0, 12)) console.log(' ', f.tok.slice(0, 10), f.plat, '被拦' + f.n + '次 old=' + f.old?.toFixed(1) + ' → new=' + f.newTop1, 'router占' + f.routerPct + '%', 'null行' + f.nullPct + '%', '窗买' + f.buyBnb + 'BNB');
  const nullPcts = flipped.map(f => f.nullPct);
  if (flipped.length) console.log('翻案 token null 行占比: min', Math.min(...nullPcts)?.toFixed(0), 'max', Math.max(...nullPcts)?.toFixed(0));
  process.exit(0);
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
