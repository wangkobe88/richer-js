#!/usr/bin/env node
// ============================================================================
// 建 v46 虚拟孪生实验（2026-10-28 T84 早期叙事臂 virtual 验证轮，先跑 create-v46.cjs）
//   从已建的 v46 live 行整包转换（腿零重复维护，单一真相源=v46 config）：
//     - 删 wallet 段；加 virtual 段 {tradeAmount:0.1, initialBalance:100}
//     - perCardBNB 0.002 / strategiesConfig（2 买腿 + 21 卖腿）/ fourmemeWs 原样
//   验证目标（对齐回放口径后再谈 live 换车）：
//     ① 两买腿零拒启、早期臂真实产生信号（BNB 带内 fire）
//     ② entryMarketCap 锚落库（signals metadata / 快照）
//     ③ 卖腿豁免/专属臂语义（早期仓不被 10s 冻结/120s 衰竭误杀）
//   ⚠️ 与 live v46 无资金关联；run-engine.js 单实验直跑（virtual 显式允许）。
// 防呆：源 v46 必须 stopped 且 2 买/21 卖/obs 27 锚定。
// 用法：node scripts/create-v46-virtual.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

async function main() {
  const { dbManager } = require('../src/services/dbManager.js');
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const db = dbManager.getClient();
  const { data, error } = await db.from('experiments').select('id,config,status')
    .eq('experiment_name', 'v46-实盘-both-早期叙事臂-BNB市值-1028').limit(1);
  if (error) throw new Error(error.message);
  if (!data.length) throw new Error('v46 live 未建（先跑 create-v46.cjs --commit）');
  const src = data[0];
  // initializing=新建即态（start-experiment 接受；stopped=跑过已停）。running=已启动拒绝克隆
  if (src.status === 'running') throw new Error('v46 状态=running（应先停再建孪生）');
  const cfg = JSON.parse(JSON.stringify(src.config));
  const buys = cfg.strategiesConfig?.buyStrategies || [];
  const sells = cfg.strategiesConfig?.sellStrategies || [];
  if (buys.length !== 2) throw new Error('v46 买腿数=' + buys.length + ' 期望 2');
  if (sells.length !== 21) throw new Error('v46 卖腿数=' + sells.length + ' 期望 21');
  const obs = cfg.fourmemeWs?.observationSignals;
  if (obs && obs.marketCapThreshold !== 27) throw new Error('v46 obs 阈值=' + obs.marketCapThreshold + ' 非 27');

  delete cfg.wallet;
  cfg.virtual = { tradeAmount: 0.1, initialBalance: 100 };
  cfg.name = 'v46-虚拟-早期叙事臂-BNB市值-1028';
  cfg.description = 'T84 virtual 验证孪生（源=v46 live 同腿）：①两买腿零拒启、早期臂 6.0-6.7 '
    + 'BNB 带真实 fire；②entryMarketCap 锚落库；③卖腿豁免/专属臂语义（早期仓不被 10s '
    + '冻结/120s 衰竭误杀）。跑法：node src/run-engine.js <id>（182）。';

  console.log('buys:', buys.length, '| sells:', sells.length, '| perCardBNB:', cfg.positionManagement?.perCardBNB);
  console.log('virtual:', JSON.stringify(cfg.virtual));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const factory = ExperimentFactory.getInstance();
  const c = await factory.createFromConfig(cfg, 'virtual');
  console.log('V46_VIRTUAL_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
