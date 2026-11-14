// r6 收尾：① T087 卖出 signal 归因（strategyId/why）② 删 strategy_library low-zone-stall-exit（形状校验后删+复验）
import { dbManager } from '../../src/services/dbManager.js';

const c = await dbManager.getClient();

// ① T087 卖出/买入 signal 归因
for (const [tag, id] of [['卖出', 'd8a3eb36-af5c-4452-8582-9b815b9c2dd8'], ['买入', 'd0771f8c-e14a-4cfb-aa9f-823d98533089']]) {
  const { data, error } = await c.from('strategy_signals')
    .select('id,token_address,action,executed,reason,created_at,metadata').eq('id', id);
  if (error) { console.log(`${tag} signal 查询失败: ${error.message}`); continue; }
  if (!data?.length) { console.log(`${tag} signal ${id} 不存在`); continue; }
  const s = data[0];
  const md = s.metadata || {};
  console.log(`T087 ${tag} signal: ${s.created_at} action=${s.action} executed=${s.executed} reason=${s.reason}`);
  console.log(`  strategyId=${md.strategyId ?? '-'} strategyName=${md.strategyName ?? '-'} why=${md.why ?? '-'}`);
  const skip = new Set(['factors', 'preBuyCheckFactors', 'signalGate', 'cheatCheck', 'buyPoint', 'gmgnCheck', 'narrativeCall']);
  const rest = Object.entries(md).filter(([k]) => !skip.has(k)).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : String(v).slice(0, 120)}`);
  console.log(`  md 其余: ${rest.join(' ')}`);
}

// ② 删库（形状校验：side=sell ∧ legs 条件含 actTotalBnb，否则不删）
const { data: lib, error: libErr } = await c.from('strategy_library').select('*').eq('id', '071744ac-4305-4ce8-b5bf-e2df6c7641cb');
if (libErr) throw new Error('library: ' + libErr.message);
if (!lib?.length) {
  console.log('\n库条目 071744ac 不存在（可能已删）');
} else {
  const l = lib[0];
  console.log(`\n待删库条目: id=${l.id} name=${l.name} side=${l.side} version=${l.version} updated=${l.updated_at}`);
  console.log(`  legs=${JSON.stringify(l.legs).slice(0, 900)}`);
  const legsStr = JSON.stringify(l.legs);
  if (l.side === 'sell' && /actTotalBnb/.test(legsStr) && /currentVsLaunchPct/.test(legsStr)) {
    const { error: delErr } = await c.from('strategy_library').delete().eq('id', l.id);
    console.log(`删除结果: ${delErr ? '失败 ' + delErr.message : '已删除'}`);
    const { data: chk } = await c.from('strategy_library').select('id,name').eq('id', l.id);
    console.log(`复验: ${chk?.length ? '⚠️仍存在' : '✅确认已删'}`);
    // 同名残留检查
    const { data: same } = await c.from('strategy_library').select('id,name,side').ilike('name', `%low-zone%`);
    console.log(`同名 low-zone 残留: ${same?.length ? JSON.stringify(same) : '无'}`);
  } else {
    console.log('⚠️ 形状校验不通过（side/legs 不匹配 low-zone-stall-exit），未删除');
  }
}
process.exit(0);
