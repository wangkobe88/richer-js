#!/usr/bin/env node
// 一次性（本地单票小读取，不进 git）：MAI/RAM 等额簇逐笔明细（生产口径复刻）
// 口径单点=直接调 buildSnapshotFromRows 对锚；等额带逐笔=同公式（±2% 对数带，尘门 0.001，带内 ≥3 钱包）
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const { buildSnapshotFromRows, walletOf, isRouterWallet, EQUAL_AMOUNT_MIN_BNB, EQUAL_BAND_PCT } = require_('../../src/market-analysis/cheat-snapshot.js');
const sb = dbManager.getClient();

const COLS = 'id,block_number,log_index,trade_type,bnb_amount,token_amount,trader_address,sender_address,block_time,tx_hash';
async function fetchAll(addr) {
  const out = []; let cursor = 0;
  for (;;) {
    const { data } = await sb.from('wss_price_ticks').select(COLS).eq('token_address', addr).gt('id', cursor).order('id', { ascending: true }).limit(1000);
    if (!data || !data.length) break;
    out.push(...data); cursor = data[data.length - 1].id;
    if (data.length < 1000) break;
  }
  return out;
}
const hh = (iso) => (iso ? iso.slice(11, 19) : '?');
const short = (w) => (w ? `${w.slice(0, 8)}…${w.slice(-4)}` : 'NULL');

function analyze({ name, addr, asofBlock, asofLog, anchorSb, anchorEq }) {
  return fetchAll(addr).then((all) => {
    const win = all.filter((r) => r.block_number < asofBlock || (r.block_number === asofBlock && r.log_index <= asofLog));
    // 生产口径对锚（锚=首析行存档值）
    const snap = buildSnapshotFromRows(win, { address: addr, totalSupply: 1e9 });
    const d = snap.derived;
    console.log(`\n########## ${name} ${addr}`);
    console.log(`首析 as-of 窗（block≤${asofBlock}:${asofLog}）=${win.length} 行（全票 ${all.length} 行）`);
    console.log(`锚对拍：sameBlockHoldPct 复算=${(d.sameBlockHoldPct ?? -1).toFixed(1)} vs 存档 ${anchorSb} | equalBandHoldPct 复算=${(d.equalBandHoldPct ?? -1).toFixed(1)} vs 存档 ${anchorEq}`);

    // 等额带逐笔（与生产同公式：BUY、≥0.001、k=round(log(bnb)/log(1.02))、带内 ≥3 不同钱包——含伪钱包计数）
    const bandBase = Math.log(1 + EQUAL_BAND_PCT);
    const bands = new Map(); // k -> Map(wallet -> rows)
    for (const r of win) {
      if (r.trade_type !== 'buy') continue;
      const bnb = r.bnb_amount || 0;
      if (bnb < EQUAL_AMOUNT_MIN_BNB) continue;
      const w = walletOf(r);
      const k = Math.round(Math.log(bnb) / bandBase);
      if (!bands.has(k)) bands.set(k, new Map());
      const m = bands.get(k);
      if (!m.has(w)) m.set(w, []);
      m.get(w).push(r);
    }
    const lo = (k) => Math.exp(k * bandBase), hi = (k) => Math.exp((k + 1) * bandBase);
    const eqMembers = new Set();
    for (const [k, m] of [...bands.entries()].sort((a, b) => b[1].size - a[1].size)) {
      if (m.size < 3) continue;
      for (const w of m.keys()) eqMembers.add(w);
      const rows = [...m.values()].flat().sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
      const sumBnb = rows.reduce((s, r) => s + (r.bnb_amount || 0), 0);
      const fake = [...m.keys()].filter((w) => isRouterWallet(w)).length;
      console.log(`\n-- 等额带 [${lo(k).toFixed(4)}, ${hi(k).toFixed(4)}) BNB：${m.size} 钱包 ${rows.length} 笔 合计 ${sumBnb.toFixed(3)} BNB${fake ? `（含 ${fake} 个 GMGN 路由伪钱包——sender 未解析行，计带不计持仓）` : ''}`);
      for (const r of rows) console.log(`   block ${r.block_number} log ${String(r.log_index).padStart(3)} ${hh(r.block_time)} ${short(walletOf(r)).padEnd(16)} 买 ${r.bnb_amount.toFixed(4)} BNB${isRouterWallet(walletOf(r)) ? ' [伪钱包]' : ''}`);
    }
    // eqMembers 持仓状态（BNB 域正净=生产锚分子；token 域净持仓附注）
    const agg = new Map();
    for (const r of win) {
      const w = walletOf(r);
      if (!w || isRouterWallet(w)) continue;
      const a = agg.get(w) ?? { buyBnb: 0, sellBnb: 0, buyTok: 0, sellTok: 0, buyN: 0, sellN: 0 };
      if (r.trade_type === 'buy') { a.buyBnb += r.bnb_amount || 0; a.buyTok += r.token_amount || 0; a.buyN++; }
      else { a.sellBnb += r.bnb_amount || 0; a.sellTok += r.token_amount || 0; a.sellN++; }
      agg.set(w, a);
    }
    const mem = [...eqMembers].filter((w) => !isRouterWallet(w)).map((w) => ({ w, ...(agg.get(w) ?? { buyBnb: 0, sellBnb: 0, buyTok: 0, sellTok: 0, buyN: 0, sellN: 0 }) }))
      .sort((a, b) => (b.buyBnb - b.sellBnb) - (a.buyBnb - a.sellBnb));
    console.log(`\neqMembers（真钱包 ${mem.length} 个）持仓状态（按 BNB 正净降序）：`);
    for (const x of mem) {
      const net = x.buyBnb - x.sellBnb, netTok = x.buyTok - x.sellTok;
      console.log(`   ${short(x.w)} 买 ${x.buyBnb.toFixed(4)}(${x.buyN}) 卖 ${x.sellBnb.toFixed(4)}(${x.sellN}) → BNB净 ${net.toFixed(4)} | tok净 ${netTok.toFixed(0)}${netTok <= 0 && x.buyN > 0 ? ' ←已清仓' : ''}`);
    }
    const soldOut = mem.filter((x) => x.buyTok - x.sellTok <= 0 && x.buyN > 0).length;
    const sumBuy = mem.reduce((s, x) => s + x.buyBnb, 0), sumSell = mem.reduce((s, x) => s + x.sellBnb, 0);
    console.log(`小结：eq 簇买入 ${sumBuy.toFixed(3)} BNB / 卖出 ${sumSell.toFixed(3)} BNB（回收 ${(sumBuy ? sumSell / sumBuy * 100 : 0).toFixed(1)}%）；token 域已清仓 ${soldOut}/${mem.length}`);
  });
}

await analyze({ name: 'MAI', addr: '0x732bd5190992ecb2365e080c2d3d37880cb17777', asofBlock: 131199416, asofLog: 43, anchorSb: 4.31, anchorEq: 67.59 });
await analyze({ name: 'RAM', addr: '0xec74ec6b297fbe318ff09da24023319a36737777', asofBlock: 131207966, asofLog: 410, anchorSb: 60.404, anchorEq: 24.790 });
process.exit(0);
