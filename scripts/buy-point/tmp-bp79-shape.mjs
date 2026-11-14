// BP79 摆点轴形态前提取证（182 跑）：c84a（阴跌反弹峰——形态不匹配）vs 闪崩票（涨着涨着打断）
//   复刻 detectSwings(20%) 找最近确认摆高，量化「摆高前涨段」：短窗拉起（120s/180s 内低→摆高）+
//   上升腿（此前全窗低点→摆高）+ 腿时长；chg5/chg10 核对。探针窗=锚前 15min 全行（锚窗近似）。
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const sb = await dbManager.getClient();

const LIST = [
  ['c84a-阴跌反弹(BP74立法)', '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', '2026-11-05T12:31:26'],
  ['蝴蝶人生路-闪崩', '0xb359716d1affde1fb9d351fec71a0f2e79257777', '2026-11-05T12:43:10'],
  ['苹果SI-闪崩', '0xc9bf4530033f6497002d228296fedb45036f7777', '2026-11-05T05:11:40'],
  ['币安之心-闪崩', '0x08aa150d7d86c4a0dfa37f310c1380de9c187777', '2026-11-05T12:11:23'],
  ['赵公主-闪崩(chg同深判例)', '0x258e485725b8d799b885b9f079241e2c812d7777', '2026-11-05T07:55:00'],
  ['屎壳郎-闪崩(BP59锚)', '0x2ef6c0e630d34b78ad36aabe04cd90f57e3c7777', '2026-11-05T06:16:00'],
];

function detectSwings(rel, thrPct) {
  if (rel.length < 2) return { points: [], lastDir: null };
  const points = [];
  let dir = 0, ext = rel[0], runMax = rel[0], runMin = rel[0];
  for (let i = 1; i < rel.length; i++) {
    const t = rel[i];
    if (dir === 0) {
      if (t.px >= runMax.px) { runMax = t; ext = t; }
      else if (t.px <= runMin.px) { runMin = t; ext = t; }
      else {
        if ((t.px / runMax.px - 1) * 100 <= -thrPct) { points.push({ dt: runMax.dt, px: runMax.px, kind: 'high' }); dir = -1; ext = t; }
        else if ((t.px / runMin.px - 1) * 100 >= thrPct) { points.push({ dt: runMin.dt, px: runMin.px, kind: 'low' }); dir = 1; ext = t; }
      }
    } else if (dir === 1) {
      if (t.px >= ext.px) ext = t;
      else if ((t.px / ext.px - 1) * 100 <= -thrPct) { points.push({ dt: ext.dt, px: ext.px, kind: 'high' }); dir = -1; ext = t; }
    } else {
      if (t.px <= ext.px) ext = t;
      else if ((t.px / ext.px - 1) * 100 >= thrPct) { points.push({ dt: ext.dt, px: ext.px, kind: 'low' }); dir = 1; ext = t; }
    }
  }
  return { points, lastDir: dir };
}

for (const [sym, tok, hint] of LIST) {
  const t0 = Date.parse(hint + 'Z');
  const probe = await sb.from('wss_price_ticks').select('id')
    .gte('block_time', new Date(t0 - 20 * 60_000).toISOString()).lt('block_time', new Date(t0 + 60_000).toISOString())
    .eq('token_address', tok).order('id', { ascending: true }).limit(1);
  if (!probe.data || !probe.data.length) { console.log(`${sym} 无 ticks`); continue; }
  const anchorId = probe.data[0].id - 1;
  const { data, error } = await sb.from('wss_price_ticks')
    .select('block_time,bnb_amount,trade_type,price_bnb,price_outlier')
    .gt('id', anchorId).lt('block_time', new Date(t0 + 1000).toISOString())
    .eq('token_address', tok).order('id', { ascending: true }).limit(6000);
  if (error) throw new Error(error.message);
  const rows = (data || []).map((r) => ({ ts: Date.parse(r.block_time), px: Number(r.price_bnb) || 0, out: !!r.price_outlier }))
    .filter((r) => r.ts <= t0 && r.ts >= t0 - 15 * 60_000);
  const rel = rows.filter((r) => !r.out && r.px > 0).map((r) => ({ dt: r.ts, px: r.px }));
  if (rel.length < 2) { console.log(`${sym} 可靠价不足`); continue; }
  const tEnd = rel[rel.length - 1].dt, cur = rel[rel.length - 1].px;
  // chg5/chg10（口径同 snapshot：短窗内无更早价自可得最早价起算）
  const chgOf = (W) => {
    const from = tEnd - W; let base = null;
    for (const r of rel) if (r.dt > from) { base = r; break; }
    if (!base || base.dt >= tEnd) return null;
    return +((cur / base.px - 1) * 100).toFixed(1);
  };
  const { points } = detectSwings(rel, 20);
  const highs = points.filter((p) => p.kind === 'high');
  const lastHigh = highs.length ? highs[highs.length - 1] : null;
  let line = `${sym} 可靠价=${rel.length} 窗=${((tEnd - rel[0].dt) / 1000).toFixed(0)}s chg5=${chgOf(5000)} chg10=${chgOf(10000)} chg30=${chgOf(30000)}`;
  if (!lastHigh) { console.log(line + ' | 无确认摆高'); continue; }
  const hi = lastHigh.px, hiDt = lastHigh.dt;
  const vsHi = +((cur / hi - 1) * 100).toFixed(1);
  // 涨段前提候选：摆高前短窗（120s/180s）最低→摆高；摆高前全窗最低→摆高（上升腿）
  const pre = rel.filter((r) => r.dt < hiDt);
  const riseOf = (W) => {
    const from = hiDt - W; let lo = Infinity;
    for (const r of pre) if (r.dt >= from && r.px < lo) lo = r.px;
    return lo === Infinity ? null : +((hi / lo - 1) * 100).toFixed(1);
  };
  let legLo = Infinity, legLoDt = null;
  for (const r of pre) if (r.px < legLo) { legLo = r.px; legLoDt = r.dt; }
  const legRise = +((hi / legLo - 1) * 100).toFixed(1);
  const legSec = ((hiDt - legLoDt) / 1000).toFixed(0);
  console.log(line + ` | 摆高距今=${((tEnd - hiDt) / 1000).toFixed(0)}s 距摆高=${vsHi}% | 涨段:前120s拉起=${riseOf(120_000)}% 前180s拉起=${riseOf(180_000)}% 上升腿=${legRise}%/${legSec}s`);
}
process.exit(0);
