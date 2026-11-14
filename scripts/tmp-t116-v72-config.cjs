// 临时脚本：v72 config 接线 T116（gmgnEntryCheck.enabled + 第16卖腿 + libraryRefs）；dry-run 默认，--commit 执行
const path = require('path');
const { dbManager } = require(path.join(__dirname, '../src/services/dbManager.js'));

const EXPERIMENT_ID = 'edbd5b38-27db-4dd4-8205-4bebfa410ea6';
const COMMIT = process.argv.includes('--commit');

(async () => {
  const client = await dbManager.getClient();
  const { data, error } = await client.from('experiments').select('id,experiment_name,status,config').eq('id', EXPERIMENT_ID).single();
  if (error) throw new Error(JSON.stringify(error));
  console.log(`实验: ${data.experiment_name} status=${data.status}`);

  const config = data.config;
  const cfg = JSON.parse(JSON.stringify(config)); // deep copy
  const fw = cfg.fourmemeWs = cfg.fourmemeWs || {};

  // ① gmgnEntryCheck 段
  console.log('\n[现状] fourmemeWs.gmgnEntryCheck =', JSON.stringify(fw.gmgnEntryCheck));
  fw.gmgnEntryCheck = { enabled: true };

  // ② 卖腿（copy-in 快照——与库条目 legs 逐字一致）
  const { data: libRow } = await client.from('strategy_library').select('id,name,version,legs').eq('name', 'gmgn-entry-exit').eq('version', 1).single();
  if (!libRow) throw new Error('库条目 gmgn-entry-exit v1 不存在');
  const sc = cfg.strategiesConfig = cfg.strategiesConfig || {};
  const sell = sc.sellStrategies = sc.sellStrategies || [];
  console.log(`[现状] sellStrategies ${sell.length} 条`);
  if (sell.some(l => (l.description || '').includes('T116'))) throw new Error('已存在 T116 卖腿，防重复');
  // 插位：priority 6 排在 priority>6 的首条之前
  let insertAt = sell.length;
  for (let i = 0; i < sell.length; i++) { if ((sell[i].priority ?? 0) > 6) { insertAt = i; break; } }
  const leg = JSON.parse(JSON.stringify(libRow.legs[0]));
  sell.splice(insertAt, 0, leg);

  // ③ libraryRefs 追加
  sc.libraryRefs = sc.libraryRefs || [];
  if (!sc.libraryRefs.some(r => r.name === 'gmgn-entry-exit')) sc.libraryRefs.push({ name: libRow.name, version: libRow.version, id: libRow.id, side: 'sell' });

  // 防呆断言
  if (!fw.gmgnEntryCheck.enabled) throw new Error('断言失败: enabled');
  if (sell.length !== ((config.strategiesConfig || {}).sellStrategies || []).length + 1) throw new Error('断言失败: 卖腿数 +1');
  if (!sell.some(l => l.condition === 'realHoldDuration >= 180 AND gmgnEntryChecked == 1 AND gmgnEntryPresent == 0')) throw new Error('断言失败: T116 条件串缺失');
  console.log(`\n[将写入] gmgnEntryCheck=${JSON.stringify(fw.gmgnEntryCheck)} / sellStrategies=${sell.length} 条（T116 插位 index ${insertAt}，priority 顺序=${sell.map(l => l.priority).join(',')}）/ libraryRefs=${sc.libraryRefs.map(r => r.name + ':v' + r.version).join(',')}`);

  if (!COMMIT) { console.log('\n[dry] 未写库——加 --commit 执行 UPDATE'); process.exit(0); }
  const { error: updErr } = await client.from('experiments').update({ config: cfg }).eq('id', EXPERIMENT_ID);
  if (updErr) throw new Error(JSON.stringify(updErr));
  console.log('✅ v72 config 已更新');
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
