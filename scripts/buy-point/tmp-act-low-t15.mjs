// 0x5910…7777 距买入 15s 时点锚窗复盘:逐笔时间线 + 各锚点 act 族指标
import { dbManager } from '../../src/services/dbManager.js';

const TOKEN = '0x591018ffb7de68d0047ce285a25a2f0142e87777';
const BUY_AT = Date.parse('2026-11-02T16:55:28Z'); // 买入信号时刻
const c = await dbManager.getClient();

const rows = []; let from = 0;
while (true) {
  const { data, error } = await c.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,price_bnb,sender_address,trader_address,block_number,price_outlier')
    .eq('token_address', TOKEN)
    .order('block_time', { ascending: true })
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  rows.push(...data); if (data.length < 1000) break; from += 1000;
}
const T = t => Date.parse(t);
const t0 = T(rows[0].block_time);
console.log(`总 ticks=${rows.length} 首=${rows[0].block_time} 末=${rows[rows.length - 1].block_time}`);

// ── 逐笔时间线(买点前后 ±40s) ──
console.log('\n=== 逐笔(首行起 +10s ~ 买后 60s)===');
for (const r of rows) {
  const dt = (T(r.block_time) - t0) / 1000;
  if (dt < 0 || dt > 110) continue;
  const w = (r.sender_address || r.trader_address || '').slice(0, 10);
  const mark = Math.abs(T(r.block_time) - BUY_AT) <= 1500 ? ' <<<' : '';
  console.log(`t+${dt.toFixed(1).padStart(6)}s ${(r.trade_type === 'buy' ? 'BUY ' : 'SELL')} ${Number(r.bnb_amount).toFixed(4)} @${Number(r.price_bnb).toExponential(2)} w=${w}${r.price_outlier ? '(out)' : ''}${mark}`);
}

// ── 各锚点锚窗指标 ──
function anchorStats(anchorMs, label) {
  const win = rows.filter(r => T(r.block_time) <= anchorMs && !r.price_outlier);
  const last = win[win.length - 1];
  const spanSec = Math.max(1, (T(last.block_time) - t0) / 1000);
  const totalBnb = win.reduce((s, r) => s + Number(r.bnb_amount || 0), 0);
  const end = T(last.block_time);
  const inSec = (a, b) => win.filter(r => { const t = T(r.block_time); return t > end - b * 1000 && t <= end - a * 1000; });
  const tail10 = inSec(0, 10), tail5 = inSec(0, 5), pre20 = inSec(10, 30);
  const buys = arr => arr.filter(r => r.trade_type === 'buy');
  const sellW = new Set(tail10.filter(r => r.trade_type === 'sell').map(r => (r.sender_address || r.trader_address || '')));
  const near30 = win.filter(r => T(r.block_time) > end - 30 * 1000);
  let maxGap = 0, prev = null;
  for (const r of near30) { if (prev !== null) maxGap = Math.max(maxGap, (T(r.block_time) - prev) / 1000); prev = T(r.block_time); }
  const sum = arr => arr.reduce((s, r) => s + Number(r.bnb_amount || 0), 0);
  console.log(`\n[锚 ${label}] 窗末=${last.block_time} span=${spanSec.toFixed(0)}s 笔=${win.length} 全窗吞吐=${(totalBnb / spanSec * 60).toFixed(2)} BNB/min`);
  console.log(`  尾10s: 笔=${tail10.length} 吞吐=${(sum(tail10) * 6).toFixed(2)} BNB/min 独立卖钱包=${sellW.size} | 尾5s: 笔=${tail5.length} 买笔=${buys(tail5).length} 买额=${sum(buys(tail5)).toFixed(4)} | 前20s(10-30): 吞吐=${(sum(pre20) * 3).toFixed(2)} BNB/min`);
  console.log(`  临近30s: 笔=${near30.length} 买${buys(near30).length}/卖${near30.length - buys(near30).length} 最大间隔=${maxGap.toFixed(1)}s 净流=${(sum(buys(near30)) - sum(near30.filter(r => r.trade_type === 'sell'))).toFixed(3)} BNB`);
}

anchorStats(Date.parse('2026-11-02T16:55:13Z'), '距买入15s (16:55:13)');
anchorStats(Date.parse('2026-11-02T16:55:15Z'), '信号#3 cheat拒 (16:55:15)');
anchorStats(Date.parse('2026-11-02T16:55:24Z'), '信号#5 cheat拒 (16:55:24)');
anchorStats(BUY_AT, '买入通过 (16:55:28)');
