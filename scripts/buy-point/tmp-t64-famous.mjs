import { dbManager } from '../../src/services/dbManager.js';
import fs from 'node:fs';

const TOK = '0x2692bcbc97dbf496ce4115b8191adb8347b27777';
const EXP = '5390bbfa-0c86-48a2-b9e1-94537c54ac17';
const ANCHOR = new Date('2026-11-03T13:12:42.798Z');

// famous roster v3
const roster = new Set(JSON.parse(fs.readFileSync('config/rosters/famous-copy-wallets.json', 'utf8')).wallets.map(w => (typeof w === 'string' ? w : w.address).toLowerCase()));

const c = await dbManager.getClient();

// 1) BUY 信号 metadata（生产 BP/cheat 判定细节）
const sig = await c.from('strategy_signals').select('id,created_at,action,status,metadata')
  .eq('experiment_id', EXP).eq('token_address', TOK).order('created_at', { ascending: true });
for (const row of sig.data ?? []) {
  const m = row.metadata ?? {};
  console.log('=== signal', row.created_at, row.action, row.status);
  const cc = m.cheatCheck ?? {};
  if (Object.keys(cc).length) {
    console.log('cheat:', JSON.stringify({ status: cc.status, grade: cc.grade, exempt: cc.exempt, reasons: cc.reasons, actLevel: cc.levels?.activityLevel, sbw: cc.levels?.stallBurstWave, bundleKeys: { max: cc.levels?.burstWaveBundleMaxWallets, adj: cc.levels?.burstWaveBundleAdjPairSum } }));
  }
  const bp = m.buyPoint ?? {};
  if (Object.keys(bp).length) {
    console.log('bp:', JSON.stringify({ status: bp.status, bucket: bp.assessment?.bucket ?? bp.bucket, rule: bp.assessment?.rule ?? bp.rule, dims: Object.fromEntries((bp.dimensions ? Object.entries(bp.dimensions).map(([k, v]) => [k, v.bucket + '/' + v.prob]) : [])), exempt: bp.assessment?.exempt }));
  }
}

// 2) 该票全量 ticks（小票本地直拉）
const rows = [];
{ let from = 0;
  while (true) {
    const { data, error } = await c.from('wss_price_ticks')
      .select('block_time,bnb_amount,trade_type,sender_address,trader_address,price_bnb,block_number')
      .eq('token_address', TOK).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data); if (data.length < 1000) break; from += 1000;
  }
}
console.log('ticks total', rows.length);

const wallet = r => (r.sender_address || r.trader_address || '').toLowerCase();
const anchorMs = ANCHOR.getTime();
const win = rows.filter(r => new Date(r.block_time).getTime() <= anchorMs);
const after = rows.filter(r => new Date(r.block_time).getTime() > anchorMs);

// 净持仓（锚时刻）
const net = new Map();
for (const r of win) {
  const w = wallet(r); if (!w) continue;
  const cur = net.get(w) || { buy: 0, sell: 0, buys: 0, sells: 0, fam: roster.has(w) };
  if (r.trade_type === 'buy') { cur.buy += r.bnb_amount; cur.buys++; } else { cur.sell += r.bnb_amount; cur.sells++; }
  net.set(w, cur);
}
const pos = [...net.entries()].map(([w, v]) => ({ w, ...v, net: v.buy - v.sell })).filter(x => x.net > 0.005).sort((a, b) => b.net - a.net);
const totBuy = win.filter(r => r.trade_type === 'buy').reduce((s, r) => s + r.bnb_amount, 0);
const famRows = win.filter(r => roster.has(wallet(r)));
const famBuy = famRows.filter(r => r.trade_type === 'buy').reduce((s, r) => s + r.bnb_amount, 0);
console.log('锚窗: ticks', win.length, '总买入', totBuy.toFixed(4), 'BNB; famous 买入', famBuy.toFixed(4), '(' + (100 * famBuy / totBuy).toFixed(1) + '%)');
console.log('正净持仓 top8 (锚时刻):');
for (const p of pos.slice(0, 8)) console.log(' ', p.fam ? '★FAMOUS' : '       ', p.w, '买', p.buy.toFixed(4), '卖', p.sell.toFixed(4), '净', p.net.toFixed(4), `(${(100 * p.net / pos.reduce((s, x) => s + x.net, 0)).toFixed(1)}% of 正净Σ)`);
// famous 锚后动作
const famAfter = after.filter(r => roster.has(wallet(r)));
console.log('锚后 famous 行:', famAfter.length, famAfter.map(r => `${r.block_time.slice(11, 19)} ${r.trade_type} ${r.bnb_amount.toFixed(4)}`).join(' | ') || '无');
await dbManager.close?.();
