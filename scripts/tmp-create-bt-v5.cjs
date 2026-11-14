#!/usr/bin/env node
// ============================================================================
// 一次性脚本：创建 ladder v5 九腿 + 门链真调（backtest.signalGateReal）回测实验
// （2026-11-07 用户裁定）——只建不跑，呈报 ID+config 供用户检查。
//
// 底稿：v74（7cb423af-9505-47c6-a200-79f77139908a）config 原样 + 四处差异：
//   1. backtest 段：源=v73（c6efed13，2026-11-05 11:31:27→13:45:10 UTC）+
//      signalGateReal:true（门链真调受控解禁——缺省 false=回测恒拒现状）
//   2. cheatCheck/buyPointCheck：gate.awaitMs 60000（Jev 秒级，竞速超时几乎不触发）
//      + settleDelayMs:0 + memSource.enabled:false（引擎构造另硬编码注入
//      persist:false+settleDelayMs:0——回测数据已在 DB 无 flush 边界、无 collector）
//   3. buyStrategies：库 signal-source-ladder-v1 最新版（v5 九腿：t0a/t0b+t1-t4+
//      N30/36/45，全腿 buyPhase:'first' 每代币只买一次）copy-in；buySignalMaxPerToken
//      13→9（九腿各 1 触发上限）
//   4. 删 wallet（回测无钱包；sim-8a51 先例同款）
//   其余（tradeAmount 0.1/卡牌 perCardBNB 0.001/stallClose/16 卖腿/节流段）原样保留。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const V74_ID = '7cb423af-9505-47c6-a200-79f77139908a';
const V73_ID = 'c6efed13-ce9d-41b0-89a5-8ca8b029a609';

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();

  // 1) v74 config 底稿
  const { data: v74, error: e1 } = await db.from('experiments').select('config').eq('id', V74_ID).limit(1);
  if (e1 || !v74?.length) throw new Error('v74 读取失败: ' + (e1?.message || 'not found'));
  const cfg = JSON.parse(JSON.stringify(v74[0].config));

  // 2) 库 ladder 最新版（v5 九腿）
  const { data: lib, error: e2 } = await db.from('strategy_library')
    .select('id,name,version,legs').eq('name', 'signal-source-ladder-v1')
    .order('version', { ascending: false }).limit(1);
  if (e2 || !lib?.length) throw new Error('库条目读取失败: ' + (e2?.message || 'not found'));
  const entry = lib[0];
  if (entry.legs.length !== 8 || !entry.legs.every((l) => l.buyPhase === 'first')
      || entry.legs.some((l) => l.condition.includes('tradeCount >= 6 '))) {
    throw new Error(`库最新版形状非预期（version=${entry.version} legs=${entry.legs.length}）——应为 v6 八腿全 buyPhase:first 且无 t0a 6 笔档`);
  }
  console.log(`[OK] 底稿 v74 + 库 ${entry.name} version=${entry.version}（${entry.legs.length} 腿）`);

  // 3) 组装差异
  delete cfg.wallet;
  cfg.name = 'bt-v76-门链真调-ladderV6八腿-c6efed13时段回测';
  cfg.description = 'v73（c6efed13，2026-11-05 11:31:27→13:45:10 UTC both）时段回测第二跑（对照 415749ba 九腿首跑）：'
    + 'ladder v6 八腿（t0a 6 笔档删除——用户裁定对照其边际影响；t0b 12 笔起步即最早臂+t1-t4+N30/36/45；全腿首买限定）'
    + '经 backtest.signalGateReal=true 真调门链（cheat 16 题+BP 题集 Jev，anchorMs 截窗防前视，persist:false 零写全局表）；'
    + '其余（资金 0.1/卡牌/stallClose/16 卖腿）抄 v74。';
  cfg.backtest = {
    sourceExperimentId: V73_ID,
    startTime: '2026-11-05T11:31:27Z',
    endTime: '2026-11-05T13:45:10Z',
    signalGateReal: true,
  };
  cfg.fourmemeWs.cheatCheck = { enabled: true, gate: { awaitMs: 60000 }, settleDelayMs: 0, memSource: { enabled: false } };
  cfg.fourmemeWs.buyPointCheck = { enabled: true, gate: { awaitMs: 60000 }, settleDelayMs: 0, memSource: { enabled: false } };
  cfg.fourmemeWs.buySignalMaxPerToken = 8;
  cfg.strategiesConfig.buyStrategies = JSON.parse(JSON.stringify(entry.legs));
  cfg.strategiesConfig.libraryRefs = [
    { name: entry.name, side: 'buy', libId: entry.id, version: entry.version, legCount: entry.legs.length, snapshotAt: new Date().toISOString() },
    ...(cfg.strategiesConfig.libraryRefs || []).filter((r) => r.side === 'sell'),
  ];

  // 4) 生产路径创建（ExperimentFactory.createFromConfig——与 web 同链路含校验）
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = new ExperimentFactory();
  const experiment = await factory.createFromConfig(cfg, 'backtest');

  console.log('\n========== 回测实验已创建（未运行） ==========');
  console.log('experiment_id:', experiment.id);
  console.log('name:', experiment.experimentName);
  console.log('trading_mode:', experiment.tradingMode, '| status:', experiment.status);
  console.log('买腿（8）:');
  for (const l of cfg.strategiesConfig.buyStrategies) {
    console.log(`  p${l.priority} ${l.condition}  buyPhase=${l.buyPhase} signalGate=${JSON.stringify(l.signalGate)}`);
  }
  console.log('卖腿:', cfg.strategiesConfig.sellStrategies.length, '条（抄 v74 原样）');
  console.log('backtest 段:', JSON.stringify(cfg.backtest));
  console.log('cheatCheck:', JSON.stringify(cfg.fourmemeWs.cheatCheck));
  console.log('buyPointCheck:', JSON.stringify(cfg.fourmemeWs.buyPointCheck));
  console.log('节流: cooldownMs=%s ticks=%s maxPerToken=%s',
    cfg.fourmemeWs.buySignalCooldownMs, cfg.fourmemeWs.buySignalCooldownTicks, cfg.fourmemeWs.buySignalMaxPerToken);
  console.log('tradeAmount:', cfg.tradeAmount, '| 卡牌:', JSON.stringify(cfg.positionManagement), '| stallClose:', JSON.stringify(cfg.stallClose));
  require('fs').writeFileSync('/tmp/bt-v75-config.json', JSON.stringify(cfg, null, 2));
  console.log('\n完整 config 已落 /tmp/bt-v75-config.json（本地）');
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
