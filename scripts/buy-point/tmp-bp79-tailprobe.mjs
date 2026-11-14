// BP79 冲突取证：趋势打断轴 vs BP74 买入力豁免——四票尾 10s 买力对比
//   c84a（BP74 立法票=买力在场照放，BP79 后被摆点臂误伤）vs 蝴蝶人生路/苹果SI/币安之心（闪崩组=要拦）
//   锚=对拍同锚；尾 10s BUY 笔数/合计（尘门 0.001 BNB 计）+ 尾 5s + 摆高点前涨幅（先涨后崩 vs 阴跌确认）
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const sb = await dbManager.getClient();

const LIST = [
  ['c84a(BP74立法-应放)', '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', '2026-11-05T12:31:26'],
  ['蝴蝶人生路(闪崩-应拦)', '0xb359716d1affde1fb9d351fec71a0f2e79257777', '2026-11-05T12:43:10'],
  ['苹果SI(闪崩-应拦)', '0xc9bf4530033f6497002d228296fedb45036f7777', '2026-11-05T05:11:40'],
  ['币安之心(闪崩-应拦)', '0x08aa150d7d86c4a0dfa37f310c1380de9c187777', '2026-11-05T12:11:23'],
];

for (const [sym, tok, hint] of LIST) {
  const t0 = Date.parse(hint + 'Z');
  // id 探针窗：锚-20min 起的全 token 行（单 token 内存 filter——182 大表坑规避）
  const probe = await sb.from('wss_price_ticks').select('id')
    .gte('block_time', new Date(t0 - 20 * 60_000).toISOString()).lt('block_time', new Date(t0 + 60_000).toISOString())
    .eq('token_address', tok).order('id', { ascending: true }).limit(1);
  if (!probe.data || !probe.data.length) { console.log(`${sym} 无 ticks`); continue; }
  const anchorId = probe.data[0].id - 1;
  const { data, error } = await sb.from('wss_price_ticks')
    .select('block_time,bnb_amount,trade_type,price_bnb')
    .gt('id', anchorId).lt('block_time', new Date(t0 + 1000).toISOString())
    .eq('token_address', tok).order('id', { ascending: true }).limit(5000);
  if (error) throw new Error(error.message);
  const rows = (data || []).map((r) => ({ ts: Date.parse(r.block_time), bnb: Number(r.bnb_amount) || 0, side: r.trade_type, px: Number(r.price_bnb) || 0 }))
    .filter((r) => r.ts <= t0 && r.ts >= t0 - 15 * 60_000);
  // 尾 10s/5s 买力（尘门 0.001）
  const tail10 = rows.filter((r) => r.ts > t0 - 10_000 && r.side === 'BUY' && r.bnb >= 0.001);
  const tail5 = rows.filter((r) => r.ts > t0 - 5_000 && r.side === 'BUY' && r.bnb >= 0.001);
  const b10 = tail10.reduce((s, r) => s + r.bnb, 0), b5 = tail5.reduce((s, r) => s + r.bnb, 0);
  // 可靠价轨迹：摆高点前涨幅（先涨后崩 vs 阴跌）——锚前 15min 高点前的低点→高点涨幅
  const pxs = rows.filter((r) => r.px > 0);
  let hi = -1, hiTs = 0, lo = Infinity, loTs = 0;
  for (const r of pxs) if (r.px > hi) { hi = r.px; hiTs = r.ts; }
  for (const r of pxs) if (r.ts <= hiTs && r.px < lo) { lo = r.px; loTs = r.ts; }
  const risePct = lo < Infinity ? ((hi / lo - 1) * 100).toFixed(1) : '?';
  const curVsHi = pxs.length ? ((pxs[pxs.length - 1].px / hi - 1) * 100).toFixed(1) : '?';
  console.log(`${sym} 锚=${hint.slice(11)} 行=${rows.length} 尾10买=${tail10.length}笔/${b10.toFixed(3)}B 尾5买=${tail5.length}笔/${b5.toFixed(3)}B | 高点前拉起 ${risePct}%（低→高）、现价距高点 ${curVsHi}%`);
}
process.exit(0);
