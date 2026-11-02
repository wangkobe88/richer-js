// 组 13 归因补充探针②：①锚窗首行距 token_create 的秒数（开盘打新段假说）
// ②精确档位组（四位舍入金额分组）：区分「工具默认档多次重复」（散户/sniper 各自输入整数额）
//   vs「bot 精确等额阵列」（同额×多钱包×多轮节拍）
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
require_('dotenv').config({ path: 'config/.env' });
const { dbManager } = require_('../../src/services/dbManager.js');
const c = dbManager.getClient();

const TICKETS = [
  { id: 'CD62', addr: '0xc83fe64da5be4a5ac39e53ecadecdb32f2fa7777', anchor: 47 },
  { id: 'CD66', addr: '0xbdb9f5a1f610b421b76282b75a1444255bc77777', anchor: 77 },
  { id: 'CD67', addr: '0x63986ea6f6af2215c4be4cec606e10ef071f7777', anchor: 52 },
  // 组 12 对照：CD60 healthy（bw 曾 strong 后回落 moderate）——开盘段假说交叉验证
  { id: 'CD60', addr: '0x3dbf41d0abf4f791d57fb834395bb0ee96ce7777', anchor: 48 },
];
const W = (r) => (r.sender_address || r.trader_address || '').toLowerCase();

for (const tk of TICKETS) {
  const ev = await c.from('wss_events').select('block_time,payload')
    .eq('token_address', tk.addr).eq('kind', 'token_create').limit(1);
  const createT = ev.data?.[0]?.block_time ? Date.parse(ev.data[0].block_time) : null;

  const { data, error } = await c.from('wss_price_ticks')
    .select('block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,sender_address,trader_address')
    .eq('token_address', tk.addr)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(3000);
  if (error) throw new Error(error.message);
  const win = (data ?? []).slice(0, tk.anchor);
  const t0 = Date.parse(win[0].block_time);
  const buys = win.filter((r) => r.trade_type === 'buy');

  console.log(`\n===== ${tk.id} =====`);
  if (createT !== null) {
    console.log(`token_create → 锚窗首行 = ${((t0 - createT) / 1000).toFixed(1)}s（开盘打新段=${(t0 - createT) / 1000 < 60}）`);
  } else {
    console.log('token_create 行缺失');
  }

  // 精确档位组：四位舍入金额分组（对齐 equalBandHoldPct/T74 口径）
  const byAmt = new Map();
  for (const r of buys) {
    const k = Number(r.bnb_amount).toFixed(4);
    if (!byAmt.has(k)) byAmt.set(k, []);
    byAmt.get(k).push(r);
  }
  const groups = [...byAmt.entries()]
    .map(([amt, rows]) => ({ amt, rows, wallets: new Set(rows.map(W)).size }))
    .filter((g) => g.rows.length >= 2)
    .sort((a, b) => b.rows.length - a.rows.length);
  const totBuyN = buys.length;
  const dupN = groups.reduce((s, g) => s + g.rows.length, 0);
  console.log(`-- 精确档位组（同额 ≥2 笔）：${groups.length} 组，覆盖 ${dupN}/${totBuyN} 笔买入`);
  for (const g of groups.slice(0, 12)) {
    const ts = [...new Set(g.rows.map((r) => ((Date.parse(r.block_time) - t0) / 1000).toFixed(0)))];
    const txs = new Set(g.rows.map((r) => r.tx_hash));
    // 名义输入反推（flap 净入金≈0.98×名义）
    const nominal = (Number(g.amt) / 0.98).toFixed(4);
    console.log(`  ${g.amt}×${g.rows.length}笔/${g.wallets}钱包 t+[${ts.join(',')}] ${txs.size === g.rows.length ? '各自独立tx' : `⚠${txs.size}tx`} （≈名义${nominal}）`);
  }
  // 散布笔数（只出现一次的金额）
  const singles = [...byAmt.values()].filter((rows) => rows.length === 1).length;
  console.log(`  （唯一金额散布笔 ${singles} 笔/${totBuyN}）`);
}
process.exit(0);
