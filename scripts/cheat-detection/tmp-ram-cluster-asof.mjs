#!/usr/bin/env node
// 一次性（本地单票小读取，不进 git）：RAM 捆绑簇（sb∪eq）首析时点 as-of 买卖/持仓状态
// as-of=首cheat行 08:20:59 水位 block 131207966:410（tickCount=41）；对照=全窗至今
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const { AGGREGATOR_ROUTER_ADDRS } = require_('../../src/trading-engine/pre-check/aggregator-routers.js');
const sb = dbManager.getClient();
const ADDR = '0xec74ec6b297fbe318ff09da24023319a36737777';
const ASOF_BLOCK = 131207966, ASOF_LOG = 410;
const DUST = 0.01; // earlyUniformDustBnb 尘门（等额簇同款）

const { data } = await sb.from('wss_price_ticks')
  .select('block_number,log_index,trade_type,bnb_amount,token_amount,trader_address,sender_address')
  .eq('token_address', ADDR).order('id', { ascending: true }).limit(5000);
const rows = (data ?? []).map((r) => ({
  ...r, wallet: (r.sender_address || r.trader_address || '').toLowerCase(),
  isRouter: AGGREGATOR_ROUTER_ADDRS.has((r.trader_address || '').toLowerCase()),
}));
console.log(`RAM 全窗行数=${rows.length}（含 router 行 ${rows.filter((r) => r.isRouter).length}——wallet 口径归 sender，不剔）`);

function analyze(tag, rs) {
  const buys = rs.filter((r) => r.trade_type === 'buy');
  // sb 簇：同块买入的不同钱包 ≥2 → 并集
  const byBlock = new Map();
  for (const r of buys) { if (!r.wallet) continue; const s = byBlock.get(r.block_number) ?? new Set(); s.add(r.wallet); byBlock.set(r.block_number, s); }
  const sbSet = new Set();
  for (const s of byBlock.values()) if (s.size >= 2) for (const w of s) sbSet.add(w);
  // eq 簇：买入额 round4 同额且 ≥3 钱包（尘门 0.01 以下不入桶）
  const byBand = new Map();
  for (const r of buys) {
    if (!r.wallet || r.bnb_amount < DUST) continue;
    const k = Math.round(r.bnb_amount * 10000) / 10000;
    const m = byBand.get(k) ?? new Map(); m.set(r.wallet, (m.get(r.wallet) ?? 0) + 1); byBand.set(k, m);
  }
  const eqSet = new Set(); const bands = [];
  for (const [k, m] of byBand) if (m.size >= 3) { for (const w of m.keys()) eqSet.add(w); bands.push([k, m.size]); }
  const cluster = new Set([...sbSet, ...eqSet]);
  // 全场钱包聚合（token 域净持仓）
  const agg = new Map();
  for (const r of rs) {
    if (!r.wallet) continue;
    const a = agg.get(r.wallet) ?? { buyBnb: 0, sellBnb: 0, buyTok: 0, sellTok: 0, buyN: 0, sellN: 0 };
    if (r.trade_type === 'buy') { a.buyBnb += r.bnb_amount; a.buyTok += r.token_amount; a.buyN++; }
    else { a.sellBnb += r.bnb_amount; a.sellTok += r.token_amount; a.sellN++; }
    agg.set(r.wallet, a);
  }
  for (const a of agg.values()) a.netTok = a.buyTok - a.sellTok;
  const sumPosNet = [...agg.values()].filter((a) => a.netTok > 0).reduce((s, a) => s + a.netTok, 0);
  // 簇聚合
  const cw = [...cluster].map((w) => ({ w, ...(agg.get(w) ?? { buyBnb: 0, sellBnb: 0, buyTok: 0, sellTok: 0, buyN: 0, sellN: 0, netTok: 0 }) }));
  const C = cw.reduce((s, x) => ({ buyBnb: s.buyBnb + x.buyBnb, sellBnb: s.sellBnb + x.sellBnb, buyTok: s.buyTok + x.buyTok, sellTok: s.sellTok + x.sellTok, buyN: s.buyN + x.buyN, sellN: s.sellN + x.sellN, netTok: s.netTok + x.netTok }), { buyBnb: 0, sellBnb: 0, buyTok: 0, sellTok: 0, buyN: 0, sellN: 0, netTok: 0 });
  const sbPos = [...sbSet].reduce((s, w) => s + Math.max(0, agg.get(w)?.netTok ?? 0), 0);
  const eqPos = [...eqSet].reduce((s, w) => s + Math.max(0, agg.get(w)?.netTok ?? 0), 0);
  console.log(`\n== ${tag} ==  行=${rs.length} 钱包=${agg.size}`);
  console.log(`sb 簇=${sbSet.size} 钱包 | eq 簇=${eqSet.size} 钱包（带：${bands.sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k}×${n}`).join(', ')}${bands.length > 6 ? ' …' : ''}）| sb∪eq 并集=${cluster.size}`);
  console.log(`簇成员：买 ${C.buyBnb.toFixed(3)} BNB（${C.buyN} 笔）/ 卖 ${C.sellBnb.toFixed(3)} BNB（${C.sellN} 笔）/ 卖出回收÷买入投入 = ${C.buyBnb ? (C.sellBnb / C.buyBnb * 100).toFixed(1) : '-'}%`);
  console.log(`簇净持仓 = ${C.netTok.toFixed(0)} token（买 ${C.buyTok.toFixed(0)} − 卖 ${C.sellTok.toFixed(0)}）= 总量 ${(C.netTok / 1e9 * 100).toFixed(1)}% | 全场正净 Σ=${sumPosNet.toFixed(0)} → 簇净持仓占正净 ${(sumPosNet ? C.netTok / sumPosNet * 100 : 0).toFixed(1)}%`);
  console.log(`锚复算对照：sbHold=${(sumPosNet ? sbPos / sumPosNet * 100 : 0).toFixed(1)}% eqHold=${(sumPosNet ? eqPos / sumPosNet * 100 : 0).toFixed(1)}%（簇成员正净合计口径，含跨簇钱包与锚口径差异）`);
  const still = cw.filter((x) => x.netTok > 0).sort((a, b) => b.netTok - a.netTok);
  const gone = cw.filter((x) => x.netTok <= 0 && x.buyN > 0);
  console.log(`簇内已清仓（净≤0 且有买入）=${gone.length} / 仍持仓=${still.length}（仍持合计 ${still.reduce((s, x) => s + x.netTok, 0).toFixed(0)} tok）`);
  console.log('簇内仍持仓 top8：');
  for (const x of still.slice(0, 8)) console.log(`   ${x.w} 买 ${x.buyBnb.toFixed(3)}(${x.buyN} 笔) 卖 ${x.sellBnb.toFixed(3)}(${x.sellN} 笔) 净持 ${x.netTok.toFixed(0)} tok`);
}

analyze('首析 as-of（block≤131207966:410）', rows.filter((r) => r.block_number < ASOF_BLOCK || (r.block_number === ASOF_BLOCK && r.log_index <= ASOF_LOG)));
analyze('全窗至今（全部 1598 行）', rows);
process.exit(0);
