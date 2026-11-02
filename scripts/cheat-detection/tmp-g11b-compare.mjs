// D3.15 校准防误伤对照：CD53/CD54（爆发抢筹应保持 none）/CD44（全程缓推应保持 strong）/CD46（反例应保持 none）
// 每票锚窗手算：失衡比、单调性、尘买（<0.001）分布与后半程占比、大额簇占比
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
require_('dotenv').config({ path: 'config/.env' });
const { dbManager } = require_('../../src/services/dbManager.js');
const c = dbManager.getClient();

const CASES = [
  ['CD44', '0x13326823759c702e6ac478e3901b05c195307777', 39],
  ['CD46', '0x2e1319d91ea6c583dc93440fd0416c66bf3c7777', 24],
  ['CD53', '0x19ad4a2cb4ad2c2f359af1de17a3336adc147777', 19],
  ['CD54', '0xef7754dc86cff33e19e50dc66d1a66d0b9d27777', 20],
];

for (const [cid, addr, n] of CASES) {
  const { data, error } = await c.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb')
    .eq('token_address', addr)
    .gte('block_number', 0)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(4000);
  if (error) throw new Error(error.message);
  const win = (data ?? []).slice(0, n);
  const buys = win.filter((r) => r.trade_type === 'buy');
  const sells = win.filter((r) => r.trade_type === 'sell');
  const bB = buys.reduce((a, r) => a + r.bnb_amount, 0);
  const sB = sells.reduce((a, r) => a + r.bnb_amount, 0);
  const span = (Date.parse(win[win.length - 1].block_time) - Date.parse(win[0].block_time)) / 1000;
  // 单调性
  let peak = -1, maxDd = 0, newHighs = 0, first = null, last = null;
  for (const r of win) {
    if (!r.price_bnb || r.price_bnb <= 0) continue;
    if (first === null) first = r.price_bnb;
    last = r.price_bnb;
    if (r.price_bnb > peak) { peak = r.price_bnb; newHighs++; }
    else maxDd = Math.max(maxDd, (peak - r.price_bnb) / peak);
  }
  // 尘买分布：前半 vs 后半
  const half = Math.floor(win.length / 2);
  const dustAll = buys.filter((r) => r.bnb_amount < 0.001).length;
  const dust2h = win.slice(half).filter((r) => r.trade_type === 'buy' && r.bnb_amount < 0.001).length;
  // 大额簇（单块 ≥3 笔买入）
  const byBlk = {};
  for (const r of buys) { (byBlk[r.block_number] = byBlk[r.block_number] || []).push(r); }
  let clusterBuy = 0, clusterN = 0;
  for (const rs of Object.values(byBlk)) if (rs.length >= 3) { clusterBuy += rs.reduce((a, r) => a + r.bnb_amount, 0); clusterN += rs.length; }
  // 大单（≥0.15）
  const bigN = buys.filter((r) => r.bnb_amount >= 0.15).length;
  console.log(`${cid} 锚窗 ${n} 行跨 ${Math.round(span)}s：买${buys.length}/${bB.toFixed(3)} 卖${sells.length}/${sB.toFixed(3)}（额比 ${(bB / Math.max(sB, 1e-9)).toFixed(1)}:1）`);
  console.log(`  价 ${first.toExponential(2)}→${last.toExponential(2)} 新高${newHighs} 回撤${(maxDd * 100).toFixed(1)}%｜尘买<0.001 全窗${dustAll}笔/后半${dust2h}笔｜同块簇${clusterN}笔=${(clusterBuy / bB * 100).toFixed(0)}%买入｜≥0.15 大单${bigN}笔`);
}
process.exit(0);
