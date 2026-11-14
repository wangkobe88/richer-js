import { dbManager } from '../../src/services/dbManager.js';
import fs from 'node:fs';
const TOK = '0x2692bcbc97dbf496ce4115b8191adb8347b27777';
const roster = new Set(JSON.parse(fs.readFileSync('config/rosters/famous-copy-wallets.json','utf8')).wallets.map(w=>w.toLowerCase()));
const c = await dbManager.getClient();
const rows = []; let from = 0;
while (true) {
  const { data } = await c.from('wss_price_ticks')
    .select('id,block_time,trade_type,bnb_amount,trader_address,sender_address')
    .eq('token_address', TOK).order('id',{ascending:true}).range(from, from+499);
  rows.push(...data); if (data.length < 500) break; from += 500;
}
const w = t => (t.sender_address || t.trader_address || '').toLowerCase();
const agg = new Map();
for (const t of rows) {
  const k = w(t); if (!k) continue;
  const o = agg.get(k) || { buy: 0, sell: 0, firstBuy: null };
  if (t.trade_type?.toUpperCase() === 'BUY') { o.buy += t.bnb_amount; if (!o.firstBuy) o.firstBuy = t.block_time; }
  else o.sell += t.bnb_amount;
  agg.set(k, o);
}
const F = '0xa83b73f5644cde337b61da79589f10ea15548811';
const fam = agg.get(F);
console.log('roster famous 0xa83b73f5:', JSON.stringify(fam), 'in roster:', roster.has(F));
const anchor = Date.parse('2026-11-03T13:12:42.798Z');
const inWin = rows.filter(t => Date.parse(t.block_time) <= anchor);
console.log('锚前 ticks:', inWin.length, '首 tick:', inWin[0]?.block_time, '锚:', '2026-11-03T13:12:42.798Z');
// 跟单集（CD 口径：非名单钱包首买落在 famous BUY 后 ≤60s）
const famBuyDts = inWin.filter(t=>t.trade_type?.toUpperCase()==='BUY' && w(t)===F).map(t=>Date.parse(t.block_time));
console.log('famous BUY 时刻:', famBuyDts.map(d=>new Date(d).toISOString()));
const followers = [];
for (const [k,o] of agg) {
  if (roster.has(k) || !o.firstBuy) continue;
  const fd = Date.parse(o.firstBuy);
  if (fd <= anchor && famBuyDts.some(d => fd >= d && fd - d <= 60000)) followers.push(k);
}
const posNet = k => Math.max((agg.get(k)?.buy||0)-(agg.get(k)?.sell||0),0);
const folPos = followers.map(k=>[k,posNet(k)]).sort((a,b)=>b[1]-a[1]);
const folSum = folPos.reduce((s,x)=>s+x[1],0);
console.log('跟单集正净Σ=',folSum.toFixed(4),' top5:',folPos.slice(0,5).map(x=>`${x[0].slice(0,10)}=${x[1].toFixed(3)}`).join(' '));
console.log('跟单top3占比=', folSum>0?(folPos.slice(0,3).reduce((s,x)=>s+x[1],0)/folSum*100).toFixed(1):'n/a');
const allPos=[...agg.keys()].map(k=>[k,posNet(k)]).sort((a,b)=>b[1]-a[1]);
const posTotal=allPos.reduce((s,x)=>s+x[1],0);
console.log('全场正净Σ=',posTotal.toFixed(4),'famous本人净=',posNet(F).toFixed(4));
console.log('top1/top2 首买时刻:', allPos.slice(0,2).map(x=>`${x[0].slice(0,10)} 净${x[1].toFixed(3)} 首买${agg.get(x[0]).firstBuy}`).join(' | '));
await dbManager.close?.();
