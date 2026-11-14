// 一次性：创建 bt-v77 完整时间窗口回测实验（ladder v7 七腿 + signalGateReal 门链真调）
// 窗口 2026-11-05T00:00:00Z → 13:45:10Z（覆盖 BP 回归集全部通过锚时刻，最早锚 05:09:52）
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const crypto = require('crypto');

(async () => {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();

  // ① 基座：bt76 config 深拷贝
  const { data: src, error: e1 } = await db.from('experiments').select('config')
    .eq('id', 'b67513a8-a389-4297-86d0-868a5b8eab1a').limit(1);
  if (e1) throw new Error('读 bt76: ' + e1.message);
  const cfg = JSON.parse(JSON.stringify(src[0].config));

  // ② 库 version 8（ladder v7 七腿）copy-in
  const { data: lib, error: e2 } = await db.from('strategy_library')
    .select('id,name,version,legs').eq('name', 'signal-source-ladder-v1')
    .order('version', { ascending: false }).limit(1);
  if (e2) throw new Error('读库: ' + e2.message);
  const libRow = lib[0];
  if (libRow.version !== 8) throw new Error(`库版本预期 8 实得 ${libRow.version}`);
  const legs = typeof libRow.legs === 'string' ? JSON.parse(libRow.legs) : libRow.legs;
  if (legs.length !== 7) throw new Error(`腿数预期 7 实得 ${legs.length}`);
  if (legs.some(l => l.condition.includes('tradeCount >= 8 '))) throw new Error('t1 8 笔档未删净');

  cfg.strategiesConfig.buyStrategies = legs;
  const ref = cfg.strategiesConfig.libraryRefs.find(r => r.name === 'signal-source-ladder-v1');
  ref.version = libRow.version; ref.legCount = legs.length;
  ref.snapshotAt = new Date().toISOString();

  // ③ 完整窗口 + token 集变化防护（forceRefreshCache 防 STALE 增量静默缺新 token 旧行）
  cfg.backtest.startTime = '2026-11-05T00:00:00Z';
  cfg.backtest.endTime = '2026-11-05T13:45:10Z';
  cfg.backtest.forceRefreshCache = true;
  cfg.backtest.maxTickRows = 3000000;

  // ④ 节流帽对齐七腿
  cfg.fourmemeWs.buySignalMaxPerToken = 7;

  cfg.name = 'bt-v77-完整窗口-ladder-v7七腿-门链真调';
  cfg.description = 'T121/T119：2026-11-05 完整窗口（00:00:00Z→13:45:10Z）回测，ladder v7 七腿'
    + '（t1 8 笔档已删，2026-11-07 用户裁定）+ backtest.signalGateReal 门链真调（cheat 16 题+BP Jev）；'
    + '窗口覆盖 BP 回归集全部通过锚（最早 05:09:52）；forceRefreshCache=true（token 集变化全量重建缓存）；'
    + '基座 config=b67513a8（bt76）';

  const id = crypto.randomUUID();
  const { error: e3 } = await db.from('experiments').insert({
    id, experiment_name: cfg.name, experiment_description: cfg.description,
    trading_mode: 'backtest', status: 'created', config: cfg,
    blockchain: 'bsc', strategy_type: 'signal_gate',
  });
  if (e3) throw new Error('INSERT: ' + e3.message);
  console.log('INSERTED bt-v77:', id);
  console.log('buy legs:', legs.length, '| window:', cfg.backtest.startTime, '→', cfg.backtest.endTime);
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
