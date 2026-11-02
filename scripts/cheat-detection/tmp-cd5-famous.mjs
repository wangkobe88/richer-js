// tmp-cd5-famous.mjs — CD5（JENNER flap 0x647f…7777）famous 主导时间线分析（批次六 review）
// 用户裁定待验形状：「前期持仓者基本都卖了，famous 过来买一下杀跟单」
// 口径对齐 cheat-snapshot.js：wallet=sender||trader；router 伪钱包剔聚合；posNet=buyBnb−sellBnb（>0 计）；
// 跟单=非 famous 钱包首 BUY 落在某笔 famous BUY 同秒或其后 ≤60s；锚=链上真序首 35 笔
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
require_('dotenv').config({ path: 'config/.env' });
const { dbManager } = require_('../../src/services/dbManager.js');
const { AGGREGATOR_ROUTER_ADDRS } = require_('../../src/trading-engine/pre-check/aggregator-routers.js');

const ADDR = '0x647f9dbf1cff892aee246fa50743ba8b98017777';
const ANCHOR_N = 35;
const FOLLOW_WIN_SEC = 60;
const FAMOUS = new Set(require_('../../config/rosters/famous-copy-wallets.json').wallets.map((w) => w.toLowerCase()));
const TICK_COLS = 'block_time,block_number,log_index,trade_type,bnb_amount,trader_address,sender_address';

const short = (w) => (w ? `${w.slice(0, 6)}…${w.slice(-4)}` : 'NULL');
const sb = dbManager.getClient();

const { data: raw, error } = await sb.from('wss_price_ticks')
  .select(TICK_COLS).eq('token_address', ADDR)
  .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(ANCHOR_N);
if (error) throw error;
if (!raw || raw.length < ANCHOR_N) throw new Error(`锚不足: ${raw?.length ?? 0}`);

const { data: ev, error: evErr } = await sb.from('wss_events')
  .select('platform,payload,block_time').eq('kind', 'token_create').eq('token_address', ADDR).limit(5);
if (evErr) throw evErr;
const hit = (ev ?? []).find((r) => r.payload && (r.payload.symbol || r.payload.creator));
const creator = (hit?.payload?.creator || '').toLowerCase();
console.log(`token=JENNER ${ADDR} platform=${hit?.platform ?? '?'} creator=${creator ? short(creator) : '?'} 锚=${ANCHOR_N} 笔`);

const t0 = Date.parse(raw[0].block_time);
const rows = raw.map((r, i) => {
  const wallet = (r.sender_address || r.trader_address || '').toLowerCase();
  return {
    i: i + 1, dt: (Date.parse(r.block_time) - t0) / 1000, side: r.trade_type,
    bnb: r.bnb_amount, wallet,
    famous: FAMOUS.has(wallet), isCreator: wallet === creator,
    router: AGGREGATOR_ROUTER_ADDRS.has(wallet),
  };
});

// ── 时间线 ──
console.log('\n── 时间线（dt=距首笔秒；F=famous C=创建者 R=路由伪钱包）──');
for (const t of rows) {
  const tag = [t.famous ? 'F' : '', t.isCreator ? 'C' : '', t.router ? 'R' : ''].join('');
  console.log(`#${String(t.i).padStart(2)} t+${String(t.dt).padStart(5)}s ${t.side === 'buy' ? '买' : '卖'} ${t.bnb.toFixed(4).padStart(8)} BNB ${short(t.wallet)}${tag ? ' [' + tag + ']' : ''}`);
}

// ── 钱包聚合（剔路由伪钱包，同 snapshot）──
const agg = new Map();
for (const t of rows) {
  if (t.router) continue;
  const e = agg.get(t.wallet) || { w: t.wallet, buy: 0, sell: 0, buyN: 0, sellN: 0, firstBuyDt: null };
  if (t.side === 'buy') { e.buy += t.bnb; e.buyN += 1; if (e.firstBuyDt === null) e.firstBuyDt = t.dt; }
  else { e.sell += t.bnb; e.sellN += 1; }
  agg.set(t.wallet, e);
}
const wallets = [...agg.values()].map((e) => ({ ...e, net: e.buy - e.sell }));

// 跟单集：非 famous 首买落在 famous 买 dt 后 ≤60s
const famousBuyDts = rows.filter((t) => t.side === 'buy' && t.famous).map((t) => t.dt);
console.log(`\nfamous 买入 dt 序列: [${famousBuyDts.map((d) => d + 's').join(', ')}]`);
const followers = new Set();
for (const e of wallets) {
  if (FAMOUS.has(e.w) || e.firstBuyDt === null) continue;
  if (famousBuyDts.some((fd) => e.firstBuyDt >= fd && e.firstBuyDt - fd <= FOLLOW_WIN_SEC)) followers.add(e.w);
}

const posNet = new Map(wallets.filter((e) => e.net > 0).map((e) => [e.w, e.net]));
const posTotal = [...posNet.values()].reduce((s, v) => s + v, 0);
const totalBuy = wallets.reduce((s, e) => s + e.buy, 0);
const grp = { fam: 0, fol: 0, oth: 0 };
for (const e of wallets) {
  if (e.net <= 0) continue;
  if (FAMOUS.has(e.w)) grp.fam += e.net; else if (followers.has(e.w)) grp.fol += e.net; else grp.oth += e.net;
}
console.log(`\n── 终态三分（BNB 正净口径，posTotal=${posTotal.toFixed(3)}）──`);
console.log(`famous Σ=${grp.fam.toFixed(3)} (${(grp.fam / posTotal * 100).toFixed(1)}%)  跟单 Σ=${grp.fol.toFixed(3)} (${(grp.fol / posTotal * 100).toFixed(1)}%)  其他 Σ=${grp.oth.toFixed(3)} (${(grp.oth / posTotal * 100).toFixed(1)}%)`);
console.log(`famous∪跟单 dominance=${((grp.fam + grp.fol) / posTotal * 100).toFixed(1)}%（D 通道 high 线=50）`);

console.log('\n── famous 钱包全程行为 ──');
for (const e of wallets.filter((e) => FAMOUS.has(e.w))) {
  console.log(`${short(e.w)} 买 ${e.buy.toFixed(3)}×${e.buyN} 卖 ${e.sell.toFixed(3)}×${e.sellN} 净 ${e.net.toFixed(3)} (${(e.net > 0 ? e.net / posTotal * 100 : 0).toFixed(1)}% 持仓)`);
}
console.log('\n── 跟单集成员（首买贴 famous ≤60s）──');
for (const e of wallets.filter((e) => followers.has(e.w)).sort((a, b) => b.net - a.net)) {
  console.log(`${short(e.w)} 首买 t+${e.firstBuyDt}s 买 ${e.buy.toFixed(3)} 卖 ${e.sell.toFixed(3)} 净 ${e.net.toFixed(3)}${e.net > 0 ? ` (${(e.net / posTotal * 100).toFixed(1)}% 持仓)` : '（已跑）'}`);
}
console.log('\n── 卖出大户（前期持仓者出货形状验证）──');
for (const e of wallets.filter((e) => e.sell > 0).sort((a, b) => b.sell - a.sell).slice(0, 8)) {
  console.log(`${short(e.w)}${e.w === creator ? '[C]' : ''}${FAMOUS.has(e.w) ? '[F]' : ''} 买 ${e.buy.toFixed(3)} 卖 ${e.sell.toFixed(3)} 净 ${e.net.toFixed(3)}${e.net > 0 ? ` (${(e.net / posTotal * 100).toFixed(1)}% 持仓)` : ''} 首买 t+${e.firstBuyDt ?? '-'}s`);
}
console.log(`\n组织买入占比（famous∪跟单 买 ÷ 总买 ${(totalBuy).toFixed(3)}）= ${((wallets.filter((e) => FAMOUS.has(e.w) || followers.has(e.w)).reduce((s, e) => s + e.buy, 0)) / totalBuy * 100).toFixed(1)}%`);
