import { dbManager } from '../../src/services/dbManager.js';
import fs from 'node:fs';

const TOK = '0x2692bcbc97dbf496ce4115b8191adb8347b27777';
const EXP = '5390bbfa-0c86-48a2-b9e1-94537c54ac17';
const roster = new Set(JSON.parse(fs.readFileSync('config/rosters/famous-copy-wallets.json', 'utf8')).wallets.map(w => w.toLowerCase()));
// kol-wallet-stats（roster v3 数据源）
let kol = {};
try { kol = JSON.parse(fs.readFileSync('data/kol-study/kol-wallet-stats.json', 'utf8')); } catch {}
const kolMap = new Map(Object.entries(kol).map(([k, v]) => [k.toLowerCase(), v]));

const c = await dbManager.getClient();
// 1) signals（ilike 防大小写）
const sig = await c.from('strategy_signals').select('id,created_at,action,status,metadata')
  .eq('experiment_id', EXP).ilike('token_address', TOK).order('created_at', { ascending: true });
for (const row of sig.data ?? []) {
  const m = row.metadata ?? {};
  console.log('=== signal', row.created_at, row.action, row.status);
  const cc = m.cheatCheck ?? {};
  if (Object.keys(cc).length) console.log('cheat:', JSON.stringify({ status: cc.status, grade: cc.grade, exempt: cc.exempt, reasons: (cc.reasons || []).map(r => r.code) }));
  const bp = m.buyPoint ?? {};
  if (Object.keys(bp).length) {
    const dims = bp.dimensions ? Object.fromEntries(Object.entries(bp.dimensions).map(([k, v]) => [k, `${v.bucket}/${v.prob}`])) : null;
    console.log('bp:', JSON.stringify({ status: bp.status, bucket: bp.assessment?.bucket ?? bp.bucket, rule: bp.assessment?.rule ?? bp.rule, dims }));
    const dg = bp.info?.digest ?? bp.digest ?? null;
    if (dg) console.log('bp digest keys:', Object.keys(dg).join(','));
  }
}
// 2) 锚窗 famous 命中明细 + top2 的 KOL 标记
const rows = []; let from = 0;
while (true) {
  const { data, error } = await c.from('wss_price_ticks')
    .select('id,block_time,block_number,log_index,trade_type,bnb_amount,sender_address,trader_address')
    .eq('token_address', TOK).order('id', { ascending: true }).range(from, from + 999);
  if (error) throw new Error(error.message);
  rows.push(...data); if (data.length < 1000) break; from += 1000;
}
const wallet = r => (r.sender_address || r.trader_address || '').toLowerCase();
const win = rows.filter(r => new Date(r.block_time).getTime() <= new Date('2026-11-03T13:12:42.798Z').getTime());
console.log('\nfamous roster 命中明细（锚窗）:');
const famDetail = new Map();
for (const r of win) { const w = wallet(r); if (roster.has(w)) { const d = famDetail.get(w) || { buy: 0, sell: 0, n: 0 }; if (r.trade_type === 'buy') d.buy += r.bnb_amount; else d.sell += r.bnb_amount; d.n++; famDetail.set(w, d); } }
if (!famDetail.size) console.log('  （roster 零命中——famBuy 0.7524 来自何方?）');
for (const [w, d] of famDetail) console.log('  ★', w, '买', d.buy.toFixed(4), '卖', d.sell.toFixed(4), '行数', d.n);
console.log('\ntop5 净持仓钱包 × KOL 库标记:');
const net = new Map();
for (const r of win) { const w = wallet(r); if (!w) continue; const cur = net.get(w) || { buy: 0, sell: 0 }; if (r.trade_type === 'buy') cur.buy += r.bnb_amount; else cur.sell += r.bnb_amount; net.set(w, cur); }
const pos = [...net.entries()].map(([w, v]) => ({ w, net: v.buy - v.sell, ...v })).filter(x => x.net > 0.005).sort((a, b) => b.net - a.net);
for (const p of pos.slice(0, 5)) {
  const k = kolMap.get(p.w);
  console.log(' ', p.w, '买', p.buy.toFixed(4), '卖', p.sell.toFixed(4), '净', p.net.toFixed(4), '| roster:', roster.has(p.w) ? 'FAMOUS' : '-', '| kol库:', k ? JSON.stringify(k).slice(0, 160) : '-');
}
console.log('\nkol 库文件键数:', Object.keys(kol).length);
await dbManager.destroy?.();
