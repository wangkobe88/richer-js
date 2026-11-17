// 精确 diff：bt-v134 (19ef6433) 内嵌 ladder v17 快照 vs strategy_library 现行 signal-source-ladder-v1
const { dbManager } = require('../src/services/dbManager.js');
async function main() {
  const c = await dbManager.getClient();
  // 1) 实验 config 顶层键 → 找腿数组
  const { data: erow } = await c.from('experiments').select('config')
    .eq('id', '19ef6433-0c92-47ff-a6fd-9f6bea745b8d').limit(1);
  const cfg = (erow && erow[0] && erow[0].config) || {};
  console.log('config 顶层键:', Object.keys(cfg).join(','));
  // strategies 可能在 strategiesConfig 或别的键
  let oldLegs = null; let oldVer = null;
  const sc = cfg.strategiesConfig || {};
  console.log('strategiesConfig 键:', Object.keys(sc).join(','));
  if (Array.isArray(sc.buyStrategies) && sc.buyStrategies[0] && sc.buyStrategies[0].condition) {
    oldLegs = sc.buyStrategies; // buyStrategies 本身就是腿数组
    const m0 = (sc.buyStrategies[0].description || '').match(/v(\d+)/);
    oldVer = m0 ? m0[1] : '?';
  }
  if (!oldLegs) {
    // 递归找含 legs 的段
    const find = (o, path) => {
      if (!o || typeof o !== 'object' || oldLegs) return;
      if (Array.isArray(o.legs) && o.legs.length && o.legs[0] && (o.legs[0].condition || o.legs[0].signalGate)) { oldLegs = o.legs; console.log('找到 legs @', path, '键:', Object.keys(o).join(',')); return; }
      for (const k of Object.keys(o)) find(o[k], path + '.' + k);
    };
    find(cfg, 'cfg');
  }
  // 2) 现行库条目
  const { data: lib } = await c.from('strategy_library')
    .select('id,name,version,legs,updated_at')
    .eq('name', 'signal-source-ladder-v1').order('version', { ascending: false }).limit(2);
  const cur = lib && lib[0];
  console.log(`\n库现行: version=${cur.version} legs=${cur.legs.length} updated=${cur.updated_at}`);
  console.log(`实验快照: version=${oldVer} legs=${oldLegs.length}`);
  // 3) 逐腿对齐 diff（按 priority+名称）
  const norm = (l) => ({ id: l.id || l.name, pri: l.priority, cond: l.condition, gate: l.signalGate });
  const oldN = oldLegs.map(norm); const curN = cur.legs.map(norm);
  console.log('\n===== 逐腿 diff（旧 v17 → 新 v' + cur.version + '）=====');
  const max = Math.max(oldN.length, curN.length);
  for (let i = 0; i < max; i++) {
    const o = oldN[i], n = curN[i];
    const tag = o && n ? (o.cond === n.cond && JSON.stringify(o.gate) === JSON.stringify(n.gate) ? 'same' : 'DIFF') : (o ? 'DELETED(旧有新无)' : 'ADDED(新有旧无)');
    console.log(`\n[${i}] ${tag} pri=${(n || o).pri} id=${(n || o).id}`);
    if (tag === 'DIFF') {
      console.log(`  旧: ${o.cond}`);
      console.log(`  新: ${n.cond}`);
      if (JSON.stringify(o.gate) !== JSON.stringify(n.gate)) console.log(`  gate 旧:${JSON.stringify(o.gate)} 新:${JSON.stringify(n.gate)}`);
    } else if (tag !== 'same') {
      console.log(`  cond: ${((n || o)).cond}`);
      if ((n || o).gate) console.log(`  gate: ${JSON.stringify((n || o).gate)}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
