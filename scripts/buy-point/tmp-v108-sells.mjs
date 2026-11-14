// bt-v108 卖侧行为归因：peak-protect 触发面 + 差异票双边交易序列对照（182 跑）
import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const V107 = '6b016c53-0c20-4a50-94c3-c2de2f205b79';
const V108 = '8e2b37ac-d144-4de5-a0b0-d265f1585cb4';

// 1) V108 config 最后一条卖腿形状（确认 name/id）
const { data: exp } = await c.from('experiments').select('id,config').eq('id', V108).single();
const legs = exp.config?.strategiesConfig?.sellStrategies || exp.config?.sellStrategies || [];
console.log(`V108 sellStrategies ${legs.length} 条`);
console.log('最后一条=', JSON.stringify(legs[legs.length - 1]).slice(0, 600));

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
const s7 = await pullSigs(V107), s8 = await pullSigs(V108);
const grp = new Map();
for (const s of s8) {
  const k = `${s.metadata?.strategyName || '?'}|${(s.metadata?.strategyId || '').slice(0, 8)}`;
  if (!grp.has(k)) grp.set(k, []);
  grp.get(k).push(s);
}
console.log(`\nV108 卖信号 ${s8.length} 行，按策略分组：`);
for (const [k, list] of [...grp.entries()].sort((a, b) => b[1].length - a[1].length))
  console.log(`  ${k}: ${list.length}`);

// peak-protect 候选：名字含 peak / priority 腿 id 等，直接打印全部不同名
const names7 = new Map();
for (const s of s7) {
  const k = s.metadata?.strategyName || '?';
  names7.set(k, (names7.get(k) || 0) + 1);
}
console.log(`\nV107 卖信号策略分布（对照）：`);
for (const [k, n] of [...names7.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);

async function pullTrades(eid) {
  const rows = []; let from = 0;
  while (true) {
    const { data, error } = await c.from('trades').select('token_address,trade_direction,input_amount,output_amount,created_at,signal_id')
      .eq('experiment_id', eid).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data); if (data.length < 1000) break; from += 1000;
  }
  return rows;
}
const t7 = await pullTrades(V107), t8 = await pullTrades(V108);
const sig7 = new Map(s7.map(s => [s.id, s])), sig8 = new Map(s8.map(s => [s.id, s]));
function fmtSeq(rows, sigs, addr) {
  const list = rows.filter(t => t.token_address === addr).sort((a, b) => a.created_at < b.created_at ? -1 : 1);
  if (!list.length) return ['    （无交易）'];
  return list.map(t => {
    const m = t.signal_id ? sigs.get(t.signal_id)?.metadata : null;
    const amt = t.trade_direction === 'buy' ? `-${Number(t.input_amount).toFixed(4)}B` : `+${Number(t.output_amount).toFixed(4)}B`;
    const pp = m?.profitPercent != null ? ` pp=${m.profitPercent}` : '';
    return `    ${t.created_at.slice(11, 19)} ${amt} ${m?.strategyName || ''}${pp}`;
  });
}
const DIFF = ['0xba5ed45b42479e0a75316de7bf990ec90a3e4444','0xb88113c98d5e33b15925edd635170e80a0fbffff','0x28ad2c7d08d83a85467bd4afcfd673dfce564444','0xc84a0ff2e7bab3d32cb6426f07855b70694f7777','0xf0576fc1267506123b0bb843b2a325e9010b4444','0xd92913a0956ec41bea37752365cc9d9b92587777','0xfc5d1a40d691f58a3b5cd37cd227dd0df4f47777','0x5c930974cc56f0f2a77bc0e52390c014f0874444','0x81ea78c13642362504618486158d07a5e0f24444','0x147d75f133130713c803d35a046da9b7c19effff','0x962ba5c2e9ff0edad32e336a956d4495d9f54444','0xc6abc6b66438e07fd1600c023ebfad0a09184444'];
console.log(`\n=== 差异票双边序列对照 ===`);
for (const a of DIFF) {
  console.log(`\n${a}`);
  console.log('  V107:'); for (const l of fmtSeq(t7, sig7, a)) console.log(l);
  console.log('  V108:'); for (const l of fmtSeq(t8, sig8, a)) console.log(l);
}
process.exit(0);
