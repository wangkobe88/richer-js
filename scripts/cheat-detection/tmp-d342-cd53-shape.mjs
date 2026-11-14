// 一次性（182 跑）：D3.42 CD53 锚窗 19 笔明细——确认 0.6 大单身份/时间位/0.1×10 簇节拍，归因 pump=moderate 未达 strong
import { createRequire } from 'module';
import { readFileSync } from 'fs';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const sb = dbManager.getClient();
const cases = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8')).cases;
const wallet = (r) => (r.sender_address || r.trader_address || '').toLowerCase();

const c = cases.find((x) => x.caseId === 'CD53');
const { data: rows, error } = await sb.from('wss_price_ticks')
  .select('block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,price_bnb,trader_address,sender_address')
  .eq('token_address', c.addr.toLowerCase())
  .order('block_number', { ascending: true }).order('log_index', { ascending: true })
  .limit(c.anchor.tickCount);
if (error) throw new Error(error.message);
const t0 = new Date(rows[0].block_time).getTime();
// 创建者
const { data: ev } = await sb.from('wss_events').select('payload').eq('kind', 'token_create').eq('token_address', c.addr.toLowerCase()).limit(1);
const creator = (ev?.[0]?.payload?.creator || '').toLowerCase();
console.log('creator=' + creator);
const wCount = new Map();
for (const r of rows) { const w = wallet(r); wCount.set(w, (wCount.get(w) ?? 0) + 1); }
let prevP = null;
for (const r of rows) {
  const w = wallet(r);
  const tOff = (new Date(r.block_time).getTime() - t0) / 1000;
  const p = Number(r.price_bnb);
  const pChg = prevP ? ((p / prevP - 1) * 100).toFixed(1) + '%' : '-';
  prevP = p;
  console.log(`t+${tOff.toFixed(1)}s blk${r.block_number}:${r.log_index} ${r.trade_type === 'buy' ? '买' : '卖'} ${Number(r.bnb_amount).toFixed(4)} p=${p.toExponential(2)}(${pChg}) w=${w.slice(0, 8)}…${w === creator ? '[CREATOR]' : ''}${(wCount.get(w) ?? 0) > 1 ? '×' + wCount.get(w) : '·一次性'} tx=${r.tx_hash.slice(0, 10)}`);
}
// 金额档位分布
const byAmt = new Map();
for (const r of rows) if (r.trade_type === 'buy') { const k = Math.round(Number(r.bnb_amount) * 10000) / 10000; byAmt.set(k, (byAmt.get(k) ?? 0) + 1); }
console.log('买入档位分布: ' + [...byAmt.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => k + '×' + n).join(', '));
process.exit(0);
