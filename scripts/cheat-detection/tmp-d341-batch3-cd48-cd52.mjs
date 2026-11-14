// 一次性（182 跑）：批次三裁定配套分析——CD48 砸盘簇入场时间（前/后入场）+CD52 连续一致簇确认
// 零 Jev：纯 tick 重放按钱包聚合。
import { createRequire } from 'module';
import { readFileSync } from 'fs';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const sb = dbManager.getClient();
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address';
const cases = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8')).cases;
const wallet = (r) => (r.sender_address || r.trader_address || '').toLowerCase();

async function pull(token, n) {
  const { data, error } = await sb.from('wss_price_ticks').select(TICK_COLS).eq('token_address', token).order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(n);
  if (error) throw new Error(error.message);
  return data;
}

// ===== CD48：砸盘者入场时间分析 =====
{
  const c = cases.find((x) => x.caseId === 'CD48');
  const rows = await pull(c.addr.toLowerCase(), c.anchor.tickCount);
  const t0 = new Date(rows[0].block_time).getTime();
  const tEnd = new Date(rows[rows.length - 1].block_time).getTime();
  const midTs = (t0 + tEnd) / 2;
  const agg = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const w = wallet(r);
    if (!w) continue;
    const a = agg.get(w) ?? { buys: [], sells: [] };
    (r.trade_type === 'buy' ? a.buys : a.sells).push({ i, tOff: (new Date(r.block_time).getTime() - t0) / 1000, bnb: Number(r.bnb_amount), price: Number(r.price_bnb) });
    agg.set(w, a);
  }
  const prices = rows.map((r) => Number(r.price_bnb)).filter((x) => x > 0);
  const pMin = Math.min(...prices), pMax = Math.max(...prices);
  const sellers = [...agg.entries()].filter(([, a]) => a.sells.length).map(([w, a]) => ({ w, ...a, sellBnb: a.sells.reduce((s, x) => s + x.bnb, 0) })).sort((x, y) => y.sellBnb - x.sellBnb);
  console.log('===== CD48 PZ 锚' + c.anchor.tickCount + ' 笔 窗长 ' + ((tEnd - t0) / 1000).toFixed(0) + 's 价 ' + pMin.toExponential(2) + '~' + pMax.toExponential(2) + ' 卖出钱包 ' + sellers.length + '/' + agg.size);
  console.log('卖出额 top10（入场分析：首买偏移/买入均额/买入均额位置(0=最低价 1=最高价)/卖出均额/盈亏方向/买入分布前半vs后半）');
  for (const s of sellers.slice(0, 10)) {
    const buyBnb = s.buys.reduce((x, y) => x + y.bnb, 0);
    const buyAvg = s.buys.length ? s.buys.reduce((x, y) => x + y.bnb, 0) / s.buys.length : 0;
    const sellAvg = s.sells.reduce((x, y) => x + y.bnb, 0) / s.sells.length;
    const buyAvgPrice = s.buys.length ? s.buys.reduce((x, y) => x + y.price, 0) / s.buys.length : 0;
    const sellAvgPrice = s.sells.reduce((x, y) => x + y.price, 0) / s.sells.length;
    const pos = pMax > pMin ? (buyAvgPrice - pMin) / (pMax - pMin) : 0;
    const firstHalfBuyBnb = s.buys.filter((b) => new Date(rows[b.i].block_time).getTime() <= midTs).reduce((x, y) => x + y.bnb, 0);
    console.log('  ' + s.w.slice(0, 8) + '… 卖' + s.sellBnb.toFixed(3) + '×' + s.sells.length + ' | 首买 t+' + (s.buys.length ? s.buys[0].tOff.toFixed(0) : '-') + 's 买' + buyBnb.toFixed(3) + '×' + s.buys.length + ' 笔均' + buyAvg.toFixed(4) + ' 价位' + (pos * 100).toFixed(0) + '% | 卖出价/买入价 ' + sellAvgPrice.toExponential(2) + '/' + (buyAvgPrice || 0).toExponential(2) + ' ' + (sellAvgPrice >= buyAvgPrice ? '盈利方向' : '亏损方向') + ' | 前半买 ' + firstHalfBuyBnb.toFixed(3) + '/后半买 ' + (buyBnb - firstHalfBuyBnb).toFixed(3));
  }
  // 等额检查：卖出 top 钱包买入金额列表
  console.log('卖出 top10 买入金额明细（等额形状检查）：');
  for (const s of sellers.slice(0, 10)) console.log('  ' + s.w.slice(0, 8) + '… 买=[' + s.buys.map((b) => b.bnb.toFixed(4)).join(', ') + ']');
}

// ===== CD52：top 买家连续一致簇确认 =====
{
  const c = cases.find((x) => x.caseId === 'CD52');
  const rows = await pull(c.addr.toLowerCase(), c.anchor.tickCount);
  const t0 = new Date(rows[0].block_time).getTime();
  const agg = new Map();
  for (const r of rows) {
    const w = wallet(r);
    if (!w || r.trade_type !== 'buy') continue;
    const a = agg.get(w) ?? { bnb: 0, n: 0, list: [] };
    a.bnb += Number(r.bnb_amount); a.n++; a.list.push({ tOff: (new Date(r.block_time).getTime() - t0) / 1000, bnb: Number(r.bnb_amount), block: r.block_number, price: Number(r.price_bnb) });
    agg.set(w, a);
  }
  const top = [...agg.entries()].sort((x, y) => y[1].bnb - x[1].bnb).slice(0, 5);
  console.log('\n===== CD52 elun 锚' + c.anchor.tickCount + ' 笔 买入额 top5 钱包');
  for (const [w, a] of top) {
    console.log('  ' + w.slice(0, 8) + '… 合计' + a.bnb.toFixed(3) + ' BNB ×' + a.n + ' 笔');
    console.log('    逐笔: ' + a.list.map((b) => 't+' + b.tOff.toFixed(0) + 's ' + b.bnb.toFixed(4) + '(blk' + b.block + ')').join(' | '));
  }
  // 全窗买入金额排序看等额带
  const buys = rows.filter((r) => r.trade_type === 'buy').map((r) => ({ w: wallet(r), bnb: Number(r.bnb_amount), tOff: (new Date(r.block_time).getTime() - t0) / 1000, block: r.block_number })).filter((b) => b.w);
  const byAmt = new Map();
  for (const b of buys) { const k = Math.round(b.bnb * 10000) / 10000; byAmt.set(k, (byAmt.get(k) ?? 0) + 1); }
  console.log('  全窗买入金额分布（四位舍入同额 ≥2 笔）: ' + [...byAmt.entries()].filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1]).map(([k, n]) => k + '×' + n).join(', '));
}
process.exit(0);
