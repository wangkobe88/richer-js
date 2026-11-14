// create-v72：克隆 v71 config（已含 T114 卖臂 15 腿+stallClose 30s / T115 发射帽 2）整行建新代
// 新吃到（代码侧，182 git pull 后生效）：D3.58/D3.59 题集、T109b 卖确认全窗去重、C269 引擎侧
const { dbManager } = require('../src/services/dbManager.js');
const V71 = '936e1bd9-630a-4f91-bb52-3f4afb1a27f4';
const COMMIT = process.argv.includes('--commit');
const NAME = 'v72-实盘-both-卖臂修剪15腿-stall30-发射帽2-1104';

async function main() {
  const c = await dbManager.getClient();
  const { data: exps, error } = await c.from('experiments').select('*').eq('id', V71).limit(1);
  if (error || !exps || !exps[0]) throw new Error('v71 读取失败: ' + (error?.message || 'no row'));
  const v71 = exps[0];
  const cfg = JSON.parse(JSON.stringify(v71.config));

  // 防呆：v71 config 必须已带 T114/T115（防错代克隆）
  const sell = cfg.strategiesConfig.sellStrategies;
  if (sell.length !== 15) throw new Error(`卖腿数 ${sell.length} ≠ 15（T114 未在？）`);
  if (!cfg.stallClose || cfg.stallClose.stallMs !== 30000) throw new Error('stallClose 30s 段缺失');
  if (cfg.fourmemeWs.buySignalMaxPerToken !== 2) throw new Error('发射帽 ≠ 2（T115 未在？）');
  if (!sell.some(l => l.condition === 'profitPercent <= -40')) throw new Error('-40 合并止损臂缺失');
  if (sell.some(l => l.condition === 'profitPercent <= -50' || l.condition === 'profitPercent <= -35')) throw new Error('旧止损臂仍在');
  if (sell.some(l => /issuerAccountState/.test(l.condition))) throw new Error('rug 臂仍在');

  cfg.name = NAME;
  cfg.description = 'v72 克隆 v71（both live、buy-v2 v56+T112 调参、cheatCheck 双开、卡牌/T110 节流不变）；本代吃到：T114 卖臂大修剪 26→15 腿（-40 合并止损/T99 两档 max4+cd60/拱形低档 -45/P4 地板族+rug+超买+T84 族退役）+ stallClose 30s 断流全清（T104 复活）+ T115 买信号发射帽 5→2 + 代码更新（D3.58/D3.59 题集、T109b 卖确认全窗去重、C269）';

  console.log(`✓ 防呆全过：15 卖腿 + stallClose 30s + 帽 2`);
  sell.forEach(l => console.log(`  p${l.priority} cards=${l.cards} :: ${l.condition.slice(0, 70)}`));
  console.log('买腿发射帽:', cfg.fourmemeWs.buySignalMaxPerToken, '| stallClose:', JSON.stringify(cfg.stallClose));
  console.log('libraryRefs:', cfg.strategiesConfig.libraryRefs.map(r => r.name + '@v' + r.version).join(', '));

  if (!COMMIT) { console.log('\n[dry] 未写库——加 --commit 执行 INSERT'); await dbManager.close?.(); return; }

  const id = require('crypto').randomUUID();
  const row = Object.assign({}, v71, { // 整行克隆保 NOT NULL 列（trading_mode 等）
    id, experiment_name: NAME, config: cfg,
    status: 'initializing',
    stats: null, started_at: null, stopped_at: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  const { error: insErr } = await c.from('experiments').insert(row);
  if (insErr) throw insErr;
  console.log(`\n✅ v72 已建: ${id}`);
  await dbManager.close?.();
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
