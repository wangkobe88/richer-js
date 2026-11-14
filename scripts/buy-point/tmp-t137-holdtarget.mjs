// T137 KOL HOLD：V108 实际卖出四张研究票的腿定位（182 跑）
// 目的=确认反事实 11 卡由哪些 strategyId 卖出 → HOLD 臂挂腿依据
import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const V108 = '8e2b37ac-d144-4de5-a0b0-d265f1585cb4';

const { data: exp } = await c.from('experiments').select('id,config').eq('id', V108).single();
const sellLegs = exp.config?.strategiesConfig?.sellStrategies || [];
console.log(`V108 sellStrategies ${sellLegs.length} 条（id → 条件摘要）：`);
const legMap = new Map();
sellLegs.forEach((l, i) => {
  const id = l.id || `idx${i}`;
  legMap.set(id, { i, cond: (l.condition || '').slice(0, 90), cards: l.cards, name: l.name });
  console.log(`  [${i}] ${id} cards=${l.cards} ${l.bypassDebounce ? 'bypass ' : ''}${(l.condition || '').slice(0, 90)}`);
});

async function pullSigs(eid) {
  const rows = []; let from = 0;
  while (true) {
    const { data, error } = await c.from('strategy_signals').select('id,token_address,action,metadata,created_at')
      .eq('experiment_id', eid).eq('action', 'sell').order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data); if (data.length < 1000) break; from += 1000;
  }
  return rows;
}
const s8 = await pullSigs(V108);

const TOKENS = [
  ['28ad', '0x28ad2c7d08d83a85467bd4afcfd673dfce564444'],
  ['来财', '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777'],
  ['ba5e', '0xba5ed45b42479e0a75316de7bf990ec90a3e4444'],
  ['谷谷', '0x32f18a98c0ad73887286c5a08170f8034ba07777'],
];
for (const [tag, addr] of TOKENS) {
  const sigs = s8.filter(s => s.token_address === addr);
  console.log(`\n=== ${tag} ${addr} 卖信号 ${sigs.length} 行 ===`);
  for (const s of sigs) {
    const m = s.metadata || {};
    const sid = m.strategyId || '?';
    const leg = legMap.get(sid);
    const legTag = leg ? `leg[${leg.i}]` : sid.slice(0, 12);
    const ct = m.cardTrade ? ` cards=${m.cardTrade.cards}(${m.cardTrade.before}->${m.cardTrade.after})` : '';
    const pp = m.profitPercent != null ? ` pp=${Number(m.profitPercent).toFixed(1)}` : '';
    const pk = m.peakProfitPct != null ? ` peak=${Number(m.peakProfitPct).toFixed(0)}` : '';
    const dd = m.drawdownFromHighestSinceLastBuy != null ? ` dd=${Number(m.drawdownFromHighestSinceLastBuy).toFixed(0)}` : '';
    const mc = m.marketCap != null ? ` mcap=${Number(m.marketCap).toFixed(1)}` : '';
    console.log(`  ${s.created_at.slice(11, 19)} ${legTag} ${m.strategyName || ''}${pp}${pk}${dd}${mc}${ct}`);
  }
}

// 全局：V108 全部卖信号按腿 id 分组计数（看哪些腿活跃）
const grp = new Map();
for (const s of s8) {
  const sid = s.metadata?.strategyId || '?';
  const leg = legMap.get(sid);
  const k = leg ? `leg[${leg.i}] ${sid.slice(0, 16)}` : `?${sid.slice(0, 16)}`;
  grp.set(k, (grp.get(k) || 0) + 1);
}
console.log(`\nV108 全部卖信号按腿分组（${s8.length} 行）：`);
for (const [k, n] of [...grp.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
process.exit(0);
