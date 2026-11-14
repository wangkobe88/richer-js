// r6 收尾3：bt-v109 config 真实结构 + 全部卖腿 condition（定位 sell_16/sell_17 哪条是 low-zone）
import { dbManager } from '../../src/services/dbManager.js';

const EXP = '029bd863-55e5-4319-91d5-10803a6a9a82';
const c = await dbManager.getClient();
const { data: exp, error } = await c.from('experiments').select('id,config').eq('id', EXP);
if (error) throw new Error(error.message);
const cfg = exp[0].config;
console.log('config 顶层键:', Object.keys(cfg));
const sc = cfg.strategiesConfig || {};
console.log('strategiesConfig 键:', Object.keys(sc));
// 找腿数组
const candidates = ['strategies', 'legs', 'sellStrategies', 'buyStrategies'];
for (const k of candidates) {
  if (Array.isArray(sc[k])) console.log(`  strategiesConfig.${k}: 数组 ${sc[k].length} 项`);
}
if (Array.isArray(sc.strategies)) {
  sc.strategies.forEach((s, i) => {
    const legs = Array.isArray(s.legs) ? s.legs : [s];
    for (const l of legs) {
      if (l.action === 'sell' || s.side === 'sell' || l.side === 'sell') {
        console.log(`[${i}] ${s.name ?? s.id ?? '-'} 腿: name=${l.name ?? '-'} condition=${String(l.condition ?? l.triggerCondition ?? '?').slice(0, 200)}`);
      }
    }
  });
} else if (Array.isArray(sc.sellStrategies)) {
  console.log('\n[sellStrategies 全 18 条]');
  sc.sellStrategies.forEach((s, i) => {
    const legs = Array.isArray(s.legs) ? s.legs : [s];
    for (const l of legs) {
      console.log(`[${i}] ${s.name ?? '-'} 腿: name=${l.name ?? '-'} bypass=${l.bypassDebounce ?? '-'} condition=${String(l.condition ?? '?').slice(0, 190)}`);
    }
  });
} else {
  console.log('strategies 非数组，dump sc 前 600 字:', JSON.stringify(sc).slice(0, 600));
}
process.exit(0);
