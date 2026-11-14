// r6 收尾2：① bt-v109 config 里 sell_16_1 腿定义（确认=low-zone-stall-exit copy-in）② 该臂全程触发面统计
import { dbManager } from '../../src/services/dbManager.js';

const EXP = '029bd863-55e5-4319-91d5-10803a6a9a82';
const c = await dbManager.getClient();

const { data: exp, error } = await c.from('experiments').select('id,config').eq('id', EXP);
if (error) throw new Error(error.message);
const cfg = exp[0].config;
const legs = cfg?.strategiesConfig?.strategies || cfg?.strategies || [];
console.log(`实验: ${EXP} 腿数=${legs.length}`);
for (const l of legs) {
  if (l.action === 'sell') {
    console.log(`  [卖腿] name=${l.name ?? '-'} condition=${String(l.condition).slice(0, 160)}`);
  }
}

// 全部卖出信号按 strategyId 分组
const sells = []; let from = 0;
while (true) {
  const { data, error: e2 } = await c.from('strategy_signals')
    .select('id,token_address,executed,reason,created_at,metadata')
    .eq('experiment_id', EXP).eq('action', 'sell').order('id', { ascending: true }).range(from, from + 999);
  if (e2) throw new Error(e2.message);
  sells.push(...data); if (data.length < 1000) break; from += 1000;
}
console.log(`\n卖出信号总数=${sells.length}`);
const byStrategy = new Map();
for (const s of sells) {
  const sid = s.metadata?.strategyId || s.reason || '-';
  if (!byStrategy.has(sid)) byStrategy.set(sid, []);
  byStrategy.get(sid).push(s);
}
for (const [sid, list] of byStrategy) {
  const ex = list.filter(s => s.executed);
  console.log(`  ${sid}（reason=${list[0].reason}）: ${list.length} 条 / 成交 ${ex.length}`);
}
// sell_16_1 成交明细（profitPercent 全列）
const s16 = byStrategy.get('sell_16_1') || [];
console.log(`\nsell_16_1 成交明细（${s16.filter(s => s.executed).length} 笔）：`);
for (const s of s16.filter(x => x.executed)) {
  const md = s.metadata || {};
  console.log(`  ${s.created_at.slice(5, 19)} ${s.token_address.slice(0, 12)} hold=${md.holdDuration ?? md.trendFactors?.holdDuration ?? '-'}s profit=${(md.profitPercent ?? md.trendFactors?.profitPercent ?? '?')}% price=${(md.price ?? '?')}`);
}
process.exit(0);
