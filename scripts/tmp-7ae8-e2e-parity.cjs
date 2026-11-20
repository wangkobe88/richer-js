// FP26 端到端重放（182）：真 evaluateFactorPreBuy 对三窗全量成交票——
// ① 20 张目标票全部拒 tail_no_buyer_pressure ② 其余成交票零新增拒（零扰动）
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const M = require('../src/market-analysis/factor-pre-buy-check.js');

const EXPS = [
  ['w1019', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['w1012', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['w1103', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];

async function loadSamples(expId) {
  const sb = dbManager.getClient();
  const { data: trades } = await sb.from('trades')
    .select('token_address,token_symbol,trade_direction,input_amount,output_amount,signal_id')
    .eq('experiment_id', expId).order('created_at', { ascending: true }).limit(500);
  const byToken = new Map();
  for (const t of trades) {
    const k = t.token_address;
    if (!byToken.has(k)) byToken.set(k, { symbol: t.token_symbol, cost: 0, got: 0, buySigId: null });
    const e = byToken.get(k);
    if (t.trade_direction === 'buy') { e.cost += Number(t.input_amount || 0); e.buySigId = t.signal_id; }
    else e.got += Number(t.output_amount || 0);
  }
  const tokens = [...byToken.entries()].map(([addr, v]) => ({ addr, symbol: v.symbol, cost: v.cost, got: v.got, pnl: v.got - v.cost, buySigId: v.buySigId }));
  const ids = tokens.map(t => t.buySigId).filter(Boolean);
  const metaById = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const { data } = await sb.from('strategy_signals').select('id,metadata').in('id', ids.slice(i, i + 50));
    for (const r of data || []) metaById.set(r.id, r.metadata || {});
  }
  return tokens.map(t => {
    const m = metaById.get(t.buySigId) || {};
    const an = (m.buyPoint || {}).anchors || {};
    return { ...t, A: an, meta: m };
  });
}

// anchors → 真模块 snapshot 形状：扁平锚回 buyDerived；activity/win 结构键归位
function buildSnapshot(s) {
  const a = s.A;
  const bd = { ...a };  // anchors 大部分=buyDerived 扁平键
  bd.activity = {
    idlePct: a.actIdlePct, ticksPerMin: null, buyMedianBnb: a.actBuyMedianBnb,
    throughputBnbPerMin: a.actThroughputBnbPerMin, maxDrawdownPct: a.actMaxDrawdownPct,
    spanSec: a.actSpanSec, tickCount: a.actTickCount,
    nearSegBuyMedianBnb: a.actNearSegBuyMedianBnb, nearSegBnbPerMin: a.actNearSegBnbPerMin,
    nearTail5BuyN: a.actNearTail5BuyN, nearTail5BuyBnb: a.actNearTail5BuyBnb,
    nearTail10SellWallets: a.actNearTail10SellWallets,
    nearTail10BuyN: a.actNearTail10BuyN, nearTail10BuyBnb: a.actNearTail10BuyBnb,
    maxGapSec: null,
  };
  bd.win = {
    30: { buyBnb: a.win30BuyBnb, sellBnb: a.win30SellBnb, buyN: a.win30BuyN, sellN: a.win30SellN,
      netBnb: a.win30NetBnb, buySharePct: a.win30BuySharePct, ticksPerMin: a.win30TicksPerMin,
      buyers: a.win30Buyers, sellers: a.win30Sellers, newBuyers: a.win30NewBuyers },
    60: { buyBnb: a.win60BuyBnb, sellBnb: a.win60SellBnb, buyN: a.win60BuyN, sellN: a.win60SellN,
      netBnb: a.win60NetBnb, buySharePct: a.win60BuySharePct, ticksPerMin: a.win60TicksPerMin,
      buyers: a.win60Buyers, sellers: a.win60Sellers, newBuyers: a.win60NewBuyers },
    120: { buyBnb: a.win120BuyBnb, sellBnb: a.win120SellBnb, buyN: a.win120BuyN, sellN: a.win120SellN,
      netBnb: a.win120NetBnb, buySharePct: a.win120BuySharePct, ticksPerMin: a.win120TicksPerMin,
      buyers: a.win120Buyers, sellers: a.win120Sellers, newBuyers: a.win120NewBuyers },
  };
  // wallets 由 factorCheck.pvp trace 近似不可得——端到端只验本臂，pvp/act 用禁用位隔离
  return { ticks: [], wallets: [], buyDerived: bd, cheatDerived: {} };
}

(async () => {
  console.log('模块版本:', M.FACTOR_PREBUY_VERSION);
  for (const [w, id] of EXPS) {
    const samples = await loadSamples(id);
    let hit = [], extraRejects = [];
    for (const s of samples) {
      // 直接调臂（snapshot 全量喂真模块，禁 pvp/activity 隔离干扰——只验本臂判据）
      const bd = buildSnapshot(s).buyDerived;
      const armHit = M.armTailNoBuyerSellPressure(bd);
      if (armHit) hit.push(s);
    }
    // 离线对照（analysis 口径：actNearTail5BuyN<2 ∧ win30SellN>=5）
    const expect = samples.filter(s => Number(s.A.actNearTail5BuyN) < 2 && Number(s.A.win30SellN) >= 5);
    const hitSet = new Set(hit.map(s => s.addr));
    const expSet = new Set(expect.map(s => s.addr));
    const miss = expect.filter(s => !hitSet.has(s.addr));
    const falseHit = hit.filter(s => !expSet.has(s.addr));
    console.log(`\n[${w}] 成交 ${samples.length} 票 | 真模块命中 ${hit.length} | 离线口径 ${expect.length} | 漏 ${miss.length} | 多 ${falseHit.length}`);
    for (const s of miss) console.log('  ⚠漏:', s.symbol, 'pnl', s.pnl.toFixed(4), 't5N', s.A.actNearTail5BuyN, 'selN', s.A.win30SellN);
    for (const s of falseHit) console.log('  ⚠多:', s.symbol, 'pnl', s.pnl.toFixed(4), 't5N', s.A.actNearTail5BuyN, 'selN', s.A.win30SellN);
    const pnl = hit.reduce((a, s) => a + s.pnl, 0);
    console.log(`  命中面净 pnl: ${pnl.toFixed(4)}（负=止血方向）`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
