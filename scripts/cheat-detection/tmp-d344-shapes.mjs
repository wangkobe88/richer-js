// 一次性（182 跑）：D3.44 三票形状探针——CD61 过高活跃度构成 / CD88 pump moderate 压制点 / CD137 单向 pump 形状
// 零 Jev 纯数据；钱包画像=wallet_offline_profiles.profile（tokenCount/tickCount/avgBnb）
import { createRequire } from 'module';
import { readFileSync } from 'fs';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const { AGGREGATOR_ROUTER_ADDRS } = require_('../../src/trading-engine/pre-check/aggregator-routers.js');
const sb = dbManager.getClient();
const cases = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8')).cases;
const IDS = ['CD61', 'CD88', 'CD137'];
const wallet = (r) => (r.sender_address || r.trader_address || '').toLowerCase();
for (const id of IDS) {
  const c = cases.find((x) => x.caseId === id);
  const addr = c.addr.toLowerCase();
  const n = c.anchor.tickCount;
  const { data: rows, error } = await sb.from('wss_price_ticks')
    .select('block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,price_bnb,price_outlier,trader_address,sender_address')
    .eq('token_address', addr)
    .order('block_number', { ascending: true }).order('log_index', { ascending: true })
    .limit(n);
  if (error) throw new Error(error.message);
  const t0 = new Date(rows[0].block_time).getTime();
  const tEnd = new Date(rows[rows.length - 1].block_time).getTime();
  const durMin = (tEnd - t0) / 60000;
  const buys = rows.filter((r) => r.trade_type === 'buy');
  const sells = rows.filter((r) => r.trade_type === 'sell');
  const wBuy = new Map(), wSell = new Map(), wCount = new Map();
  for (const r of rows) {
    const w = wallet(r);
    wCount.set(w, (wCount.get(w) ?? 0) + 1);
    if (r.trade_type === 'buy') wBuy.set(w, (wBuy.get(w) ?? 0) + 1); else wSell.set(w, (wSell.get(w) ?? 0) + 1);
  }
  const allW = [...new Set([...wBuy.keys(), ...wSell.keys()])];
  const churnW = allW.filter((w) => wBuy.has(w) && wSell.has(w));
  const onceW = allW.filter((w) => wCount.get(w) === 1);
  const ROUTERS = AGGREGATOR_ROUTER_ADDRS;
  const routedBuys = buys.filter((r) => ROUTERS.has((r.trader_address || '').toLowerCase()));
  const rel = rows.filter((r) => !r.price_outlier && Number(r.price_bnb) > 0).map((r) => ({ t: new Date(r.block_time).getTime(), p: Number(r.price_bnb) }));
  let peak = rel[0]?.p ?? 0, peakT = rel[0]?.t ?? t0, maxDD = 0;
  for (const x of rel) {
    if (x.p > peak) { peak = x.p; peakT = x.t; }
    const dd = (peak - x.p) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  const riseAll = rel.length ? (rel[rel.length - 1].p / rel[0].p - 1) * 100 : 0;
  const buckets = new Map();
  for (const r of rows) {
    const k = Math.floor((new Date(r.block_time).getTime() - t0) / 30000);
    const b = buckets.get(k) ?? { n: 0, buy: 0, sell: 0 };
    b.n++; r.trade_type === 'buy' ? b.buy++ : b.sell++;
    buckets.set(k, b);
  }
  const byBlock = new Map();
  for (const r of rows) {
    const b = byBlock.get(r.block_number) ?? { buy: 0, sell: 0 };
    r.trade_type === 'buy' ? b.buy++ : b.sell++;
    byBlock.set(r.block_number, b);
  }
  const bothBlocks = [...byBlock.values()].filter((b) => b.buy > 0 && b.sell > 0).length;
  const amtB = new Map(), amtS = new Map();
  for (const r of buys) { const k = Math.round(Number(r.bnb_amount) * 10000) / 10000; amtB.set(k, (amtB.get(k) ?? 0) + 1); }
  for (const r of sells) { const k = Math.round(Number(r.bnb_amount) * 10000) / 10000; amtS.set(k, (amtS.get(k) ?? 0) + 1); }
  const fmtAmt = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => k + '×' + n).join(', ');
  const dustBuys = buys.filter((r) => Number(r.bnb_amount) < 0.002);
  const { data: profs } = await sb.from('wallet_offline_profiles').select('address,profile').in('address', allW.slice(0, 200));
  const profList = (profs ?? []).filter((p) => p.profile);
  const singleToken = profList.filter((p) => (p.profile.tokenCount ?? 0) <= 1);
  console.log(`\n===== ${id} ${addr} @${n} =====`);
  console.log(`窗长 ${durMin.toFixed(1)}min | 笔 ${rows.length}（买 ${buys.length}/${buys.reduce((s, r) => s + Number(r.bnb_amount), 0).toFixed(2)} 卖 ${sells.length}/${sells.reduce((s, r) => s + Number(r.bnb_amount), 0).toFixed(2)}）| 笔/分钟 ${(rows.length / durMin).toFixed(1)}`);
  console.log(`钱包 ${allW.length} | 双向 churn ${churnW.length}（${((churnW.length / allW.length) * 100).toFixed(0)}%）| 一次性 ${onceW.length}（${((onceW.length / allW.length) * 100).toFixed(0)}%）| 复用 top5 ${[...wCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w, c]) => w.slice(0, 6) + '×' + c).join(' ')}`);
  console.log(`路由买 ${routedBuys.length}/${buys.length}（${((routedBuys.length / buys.length) * 100).toFixed(0)}%）| 买卖同块 ${bothBlocks}/${byBlock.size} 块`);
  console.log(`价格（可靠价）：全程 ${riseAll.toFixed(1)}% | 峰 ${(rel.length ? (peak / rel[0].p - 1) * 100 : 0).toFixed(1)}%（t+${((peakT - t0) / 1000).toFixed(0)}s）| 最大回撤 ${(maxDD * 100).toFixed(1)}%`);
  console.log(`30s 桶（分钟:笔[买b卖s]）：${[...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([k, b]) => `${(k * 0.5).toFixed(1)}m:${b.n}(${b.buy}b${b.sell}s)`).join(' ')}`);
  console.log(`买档位：${fmtAmt(amtB)}`);
  console.log(`卖档位：${fmtAmt(amtS)}`);
  console.log(`尘埃买(<0.002) ${dustBuys.length} 笔 合计 ${dustBuys.reduce((s, r) => s + Number(r.bnb_amount), 0).toFixed(4)}`);
  console.log(`画像命中 ${profList.length}/${Math.min(allW.length, 200)} | 其中单 token 钱包 ${singleToken.length}（${profList.length ? ((singleToken.length / profList.length) * 100).toFixed(0) : 0}%）`);
}
process.exit(0);
