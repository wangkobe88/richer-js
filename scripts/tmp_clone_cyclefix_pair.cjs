#!/usr/bin/env node
// ============================================================================
// 0xce8cd114 晚发案部署配套（2026-10-04，一次性脚本）：
//   ① 虚拟克隆：6f92e2f9（buy-v2 v6+hg55 门，旧代码 aeed236 实跑中，不重启留作
//      对照臂）config 整包克隆 → 新虚拟实验（新进程跑 04f135b：tps 分母按存活
//      归一 + cycleEarlySec 早期升档免驻留 earlyUp）
//   ② 回测：6f92e2f9 实跑窗（created_at → now）整窗回放，同 config 同源
//      （sourceExperimentId=6f92e2f9），新代码跑 → 与旧代码实跑买点时刻对拍
//      （重点票 0xce8cd1141f08bd31c833fd1228f76053fc237777 实跑 fire age=51.8s）
// 叙事直调吃 6f92e2f9 实跑已落缓存（同窗同源，评级对齐；miss 就地重析）
// 用法：node scripts/tmp_clone_cyclefix_pair.cjs [--commit]（默认 dry-run）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const SRC = '6f92e2f9-1b21-4ea6-b6a1-2e8dc70090e3';
const FOCUS_TOKEN = '0xce8cd1141f08bd31c833fd1228f76053fc237777';
const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const db = dbManager.getClient();

  const src = await factory.load(SRC);
  if (!src) throw new Error('源实验不存在: ' + SRC);
  const { data: row, error } = await db.from('experiments')
    .select('id, created_at, status').eq('id', SRC).single();
  if (error) throw error;
  const winStart = row.created_at;
  const winEnd = new Date().toISOString();
  console.log('源实验:', SRC, src.config.name, '| status:', row.status, '| created_at:', winStart);

  // ── ① 虚拟克隆（config 整包，只改 name/description）──
  const vCfg = JSON.parse(JSON.stringify(src.config));
  vCfg.name = '12-双平台虚拟-V2v6+hg55门-1004早升档';
  vCfg.description = `克隆自 6f92e2f9（${src.config.name}）config 整包，零策略改动；新进程跑 04f135b`
    + `（周期判定修正：tps 分母按存活归一 + cycleEarlySec 早期升档免驻留 earlyUp）；`
    + `旧实验 6f92e2f9 不重启留作旧代码对照臂（0xce8cd114 案：冷档门 upDwell 驻留 30s 致 BUY 晚发，`
    + `fire age=51.8s → 修正后预期 ~31s）`;

  // ── ② 回测（同 config 同窗同源，新代码回放）──
  const bCfg = JSON.parse(JSON.stringify(src.config));
  const vInit = (src.config.virtual && src.config.virtual.initialBalance) || 100;
  delete bCfg.virtual;
  bCfg.backtest = {
    initialBalance: vInit,
    sourceExperimentId: SRC,
    startTime: winStart,
    endTime: winEnd,
    minMaxChangePercent: 0,
  };
  bCfg.name = '回测-V2v6+hg55门-1003-1004实跑窗-周期修正对拍';
  bCfg.description = `基于 6f92e2f9 实跑窗回放（${winStart} → ${winEnd}），config 整包同源、`
    + `sourceExperimentId=6f92e2f9（experiment_tokens 即实跑覆盖集）；新代码 04f135b`
    + `（earlyUp + tps 分母归一）与 6f92e2f9 旧代码实跑对拍买点时刻`
    + `（重点票 ${FOCUS_TOKEN}：实跑 fire age=51.8s/成交 72.2s）；叙事直调吃实跑已落缓存`;

  // ── dry-run 预览 ──
  const buy = vCfg.strategiesConfig.buyStrategies[0];
  console.log('\n===== ① 虚拟克隆 =====');
  console.log('  name:', vCfg.name);
  console.log('  买腿 condition:', buy.condition);
  console.log('  preBuy:', buy.preBuyCheckCondition);
  console.log('  卖腿数:', vCfg.strategiesConfig.sellStrategies.length,
    '| PM:', JSON.stringify(vCfg.positionManagement),
    '| tokenCycle:', JSON.stringify(vCfg.tokenCycle),
    '| stopLoss:', JSON.stringify(vCfg.stopLoss));
  console.log('  TPA:', JSON.stringify(vCfg.tokenPositionAnalyzer));
  console.log('  platform:', vCfg.platform, '| virtual:', JSON.stringify(vCfg.virtual));
  console.log('\n===== ② 回测 =====');
  console.log('  name:', bCfg.name);
  console.log('  backtest:', JSON.stringify(bCfg.backtest));
  console.log('  买腿/卖腿/机制段与 ① 完全同源（差异仅 virtual→backtest 段 + 窗口）');

  // 保真断言：两臂策略零 diff
  if (JSON.stringify(vCfg.strategiesConfig) !== JSON.stringify(bCfg.strategiesConfig)) {
    throw new Error('两臂 strategiesConfig 意外不同');
  }
  if (!COMMIT) { console.log('\n[dry-run] 未建；加 --commit 真建（虚拟克隆 + 回测各一）'); process.exit(0); }

  const v = await factory.createFromConfig(vCfg, 'virtual');
  const b = await factory.createFromConfig(bCfg, 'backtest');
  console.log('\n========================================');
  console.log('VIRTUAL_ID=' + v.id);
  console.log('BACKTEST_ID=' + b.id);
  console.log('========================================');
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
