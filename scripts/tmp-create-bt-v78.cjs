// 一次性：创建 bt-v78 完整时间窗口回测实验（ladder v8 十腿 + signalGateReal 门链真调
// + CD379 活跃度豁免显式留痕）——2026-11-07 用户裁定同轮两改：
//   ① cheat 门活跃度豁免（activityLevel ∈ high/ultra 不拦——config 显式留痕，缺省同值）
//   ② NL15/NL20/NL25 接近发行价三臂（buyVolumeBnb ≥1.5/2/2.5 AND currentVsLaunchPct <= 50）
// 窗口与 bt-v77 同（00:00:00Z→13:45:10Z）对照；缓存 (srcExp,platform) 粒度 bt77 跑完
// 已全量——删 forceRefreshCache 走状态机 FRESH/delta 复用，省全量重拉。
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const crypto = require('crypto');

(async () => {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();

  // ① 基座：bt77 config 深拷贝
  const { data: src, error: e1 } = await db.from('experiments').select('config')
    .eq('id', 'ff1c8725-e6dd-46fb-a877-43fb6f463098').limit(1);
  if (e1) throw new Error('读 bt77: ' + e1.message);
  const cfg = JSON.parse(JSON.stringify(src[0].config));

  // ② 库 version 9（ladder v8 十腿）copy-in
  const { data: lib, error: e2 } = await db.from('strategy_library')
    .select('id,name,version,legs').eq('name', 'signal-source-ladder-v1')
    .order('version', { ascending: false }).limit(1);
  if (e2) throw new Error('读库: ' + e2.message);
  const libRow = lib[0];
  if (libRow.version !== 9) throw new Error(`库版本预期 9 实得 ${libRow.version}`);
  const legs = typeof libRow.legs === 'string' ? JSON.parse(libRow.legs) : libRow.legs;
  if (legs.length !== 10) throw new Error(`腿数预期 10 实得 ${legs.length}`);
  const nlLegs = legs.filter((l) => l.condition.includes('currentVsLaunchPct <= 50'));
  if (nlLegs.length !== 3) throw new Error(`接近发行价臂预期 3 实得 ${nlLegs.length}`);

  cfg.strategiesConfig.buyStrategies = legs;
  const ref = cfg.strategiesConfig.libraryRefs.find((r) => r.name === 'signal-source-ladder-v1');
  ref.version = libRow.version; ref.legCount = legs.length;
  ref.snapshotAt = new Date().toISOString();

  // ③ 窗口同 bt-v77；缓存复用（删 forceRefreshCache——bt77 已全量建缓存）
  cfg.backtest.startTime = '2026-11-05T00:00:00Z';
  cfg.backtest.endTime = '2026-11-05T13:45:10Z';
  delete cfg.backtest.forceRefreshCache;
  cfg.backtest.maxTickRows = 3000000;

  // ④ 节流帽对齐十腿 + CD379 活跃度豁免显式留痕（缺省同值——显式写进 config 供审计）
  cfg.fourmemeWs.buySignalMaxPerToken = 10;
  cfg.fourmemeWs.cheatCheck = {
    ...cfg.fourmemeWs.cheatCheck,
    gate: { ...cfg.fourmemeWs.cheatCheck.gate, activityExemptLevels: ['high', 'ultra'] },
  };

  cfg.name = 'bt-v78-完整窗口-ladder-v8十腿-活跃度豁免-门链真调';
  cfg.description = 'T122/CD379：2026-11-05 完整窗口（00:00:00Z→13:45:10Z）回测（对照 bt-v77 七腿），'
    + '同轮两改：①ladder v8 十腿——NL15/NL20/NL25 接近发行价三臂新增（buyVolumeBnb ≥1.5/2/2.5 '
    + 'AND currentVsLaunchPct <= 50，T122 新 FA 键=现价较首可靠价涨幅，BP near_launch 同口径）；'
    + '②cheat 门 CD379 活跃度豁免（activityLevel high/ultra 判 cheat/unhealthy 也不拦，出口变换 '
    + 'healthy+exempt 留痕）；backtest.signalGateReal 门链真调；缓存复用 bt77 全量（无 forceRefresh）；'
    + '基座 config=ff1c8725（bt77）';

  const id = crypto.randomUUID();
  const { error: e3 } = await db.from('experiments').insert({
    id, experiment_name: cfg.name, experiment_description: cfg.description,
    trading_mode: 'backtest', status: 'created', config: cfg,
    blockchain: 'bsc', strategy_type: 'signal_gate',
  });
  if (e3) throw new Error('INSERT: ' + e3.message);
  console.log('INSERTED bt-v78:', id);
  console.log('buy legs:', legs.length, '| window:', cfg.backtest.startTime, '→', cfg.backtest.endTime);
  for (const l of legs) console.log(`  p${l.priority} ${l.condition}`);
  console.log('cheatCheck:', JSON.stringify(cfg.fourmemeWs.cheatCheck));
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
