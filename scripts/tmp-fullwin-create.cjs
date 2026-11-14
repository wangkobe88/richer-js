// bt-v83：完整窗口（c6efed13 数据源 11-05 00:00→13:45）× ladder v12 十三腿 × 当前代码（CD383 二修 50/0.7/10 + BP46 ④高热近价豁免 + BP49）
// 基底=bt-v82 (d8d3f246)——窗口/src/maxTickRows/双门全对齐，仅换腿库 v9(10 腿)→v12(13 腿)+帽
const path = require('path'); require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();
const BASE = 'd8d3f246-6767-4192-804c-3dabdeb15baa';
const LIB = 'signal-source-ladder-v1';
const NAME = process.argv[2] || 'bt-v83-完整窗口-ladder-v12-CD383二修-BP49';
(async () => {
  const { data: base, error: e1 } = await db.from('experiments').select('id,experiment_name,config').eq('id', BASE).limit(1);
  if (e1 || !base?.length) throw new Error('基底不存在: ' + (e1?.message || ''));
  const cfg = JSON.parse(JSON.stringify(base[0].config));
  const bt = cfg.backtest || {};
  if (bt.signalGateReal !== true) throw new Error('基底非门链回测形状');
  if (bt.sourceExperimentId !== 'c6efed13-ce9d-41b0-89a5-8ca8b029a609') throw new Error('基底数据源非 c6efed13');
  delete bt.tokenAddresses; // 全量窗口回放（完整窗口先例 bt-v81/82 同款无此键）
  const { data: lib, error: e2 } = await db.from('strategy_library')
    .select('id,name,side,version,legs').eq('name', LIB).eq('side', 'buy')
    .order('version', { ascending: false }).limit(1);
  if (e2 || !lib?.length) throw new Error('库条目不存在');
  const buyLegs = JSON.parse(JSON.stringify(lib[0].legs)).map(l => { if (l.cards === undefined) l.cards = 4; return l; });
  cfg.strategiesConfig.buyStrategies = buyLegs;
  const refs = Array.isArray(cfg.strategiesConfig.libraryRefs) ? [...cfg.strategiesConfig.libraryRefs] : [];
  const ref = { name: LIB, side: 'buy', libId: lib[0].id, version: lib[0].version, legCount: buyLegs.length, snapshotAt: new Date().toISOString() };
  const i = refs.findIndex(r => r.name === LIB && r.side === 'buy');
  if (i >= 0) refs[i] = ref; else refs.push(ref);
  cfg.strategiesConfig.libraryRefs = refs;
  const cur = Number(cfg.fourmemeWs?.buySignalMaxPerToken || 0);
  if (cur < buyLegs.length) cfg.fourmemeWs = { ...cfg.fourmemeWs, buySignalMaxPerToken: buyLegs.length };
  cfg.name = NAME;
  cfg.description = `完整窗口门链回测：数据源 c6efed13（11-05 00:00→13:45:10）；ladder ${LIB} v${lib[0].version}（${buyLegs.length} 腿）×CD383 二修(50/0.7/10)×BP46 ④高热近价豁免×BP49；基底 bt-v82 ${BASE.slice(0, 8)}`;
  const DRY = process.argv.includes('--dry');
  console.log(`== 基底 == ${base[0].experiment_name} (${BASE.slice(0, 8)})`);
  console.log(`== 窗口 == ${bt.startTime} → ${bt.endTime} | src=c6efed13 | maxTickRows=${bt.maxTickRows} | tokenAddresses=无（全量）`);
  console.log(`== 买腿 == ${LIB} v${lib[0].version}（${buyLegs.length} 腿）| 帽=${cfg.fourmemeWs.buySignalMaxPerToken} | cheat/BP=${cfg.fourmemeWs?.cheatCheck?.enabled}/${cfg.fourmemeWs?.buyPointCheck?.enabled}`);
  if (DRY) { console.log('[dry-run] 未建'); process.exit(0); }
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const container = await ExperimentFactory.getInstance().createFromConfig(cfg, 'backtest');
  console.log('\nNEW_EXP_ID=' + container.id);
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
