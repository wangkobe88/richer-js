#!/usr/bin/env node
/** v18 部署（用户 2026-10-15 裁定「新建实验跑起来，改进没带上的都带上」）：
 * v17 203570e3 整包克隆 → 买腿从库 buy-v2 v12 刷新快照（tpw 门+删 er 右支，猪五花案四裁定）。
 * 代码层改进（新进程自动带，无需 config）：WSS 快速回执/approve MaxUint256/记账精度钳制/
 * preFilter live 默认开/GMGN 真人标签四观测键/tpw 因子（引擎注入链）/act* 滑窗。
 * worker 层 gampsito 黑名单已随 worker 重启生效（与实验无关）。 */
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');

const LIB_ID = '57d0dd71-6bae-47bf-8b74-4cc0bc1084e4';
const V17 = '203570e3-6117-4841-bc50-936461e78a8a';

async function main() {
  const COMMIT = process.argv.includes('--commit');
  const sb = dbManager.getClient();

  // 1) 库 buy-v2 v12 完整 leg
  const { data: lib, error: e1 } = await sb.from('strategy_library').select('id,version,legs').eq('id', LIB_ID).single();
  if (e1) throw new Error('库行拉取失败: ' + e1.message);
  if (lib.version !== 12) throw new Error('库 version 预期 12 实际 ' + lib.version);
  const libLeg = lib.legs[0];
  console.log('[1] 库 buy-v2 v12 leg keys:', Object.keys(libLeg).join(','));
  console.log('    cards:', libLeg.cards, '| priority:', libLeg.priority, '| maxExecutions:', libLeg.maxExecutions);
  console.log('    condition: ' + libLeg.condition);
  console.log('    preBuy:    ' + libLeg.preBuyCheckCondition);
  if (libLeg.preBuyCheckCondition.includes('earlyReturn')) throw new Error('v12 preBuy 仍含 earlyReturn——库形状异常');
  if (!libLeg.preBuyCheckCondition.includes('earlyTradesPerWallet < 4')) throw new Error('v12 preBuy 缺 tpw 门');

  // 2) v17 config 克隆
  const { data: src, error: e2 } = await sb.from('experiments').select('id,experiment_name,config').eq('id', V17).single();
  if (e2) throw new Error('v17 拉取失败: ' + e2.message);
  console.log('[2] 源实验:', src.experiment_name);
  const cfg = JSON.parse(JSON.stringify(src.config));
  const buy = cfg.strategiesConfig.buyStrategies[0];

  // 自检：v17（v10 快照）fire condition 应与库 v12 逐字一致（v10→v12 只动 preBuy）
  if (buy.condition !== libLeg.condition) {
    throw new Error('fire condition 与库不一致:\n  v17: ' + buy.condition + '\n  lib: ' + libLeg.condition);
  }
  // 自检：v17 preBuy 应带 er 右支（被 v12 删除的差异面）
  if (!buy.preBuyCheckCondition.includes('OR earlyReturn >= 100')) throw new Error('v17 preBuy 无 er 右支——源形状异常');

  // 3) 买腿整腿替换为库 v12 快照（copy-in 语义）
  cfg.strategiesConfig.buyStrategies[0] = JSON.parse(JSON.stringify(libLeg));
  const ref = cfg.strategiesConfig.libraryRefs[0];
  ref.version = 12;
  ref.snapshotAt = new Date().toISOString();
  ref.legCount = lib.legs.length;

  // 4) 命名与描述
  cfg.name = 'v18-实盘-both-tpw门-1015';
  cfg.description = 'v17 + 猪五花案四裁定（buy-v2 v12 快照）：preBuy 删 (lag<300 OR er>=100) 右支（拉盘可制造 earlyReturn=结构性攻击面，118 票中位 -0.3% 中性）+ 加 earlyTradesPerWallet < 4（对倒摊薄攻击指纹：本案 7.63 笔/钱包 vs 散户 1~2，拦 8 票零正值误伤）+ earlyTradesUniqueWallets >= 15；fire 条件与其余 config 与 v17 逐字一致（卖腿 P0-P11 全保留，P7 已带 80s/maxExec2 修订）。代码层新吃：WSS 快速回执/approve MaxUint256 一次授权/记账精度钳制全 Decimal/preFilter live 默认开/GMGN 真人标签四观测键；worker 侧 gampsito 黑名单已生效。源=v17 203570e3（数据预取门/visionPrefetch/onlineProfile 钱包全部继承）';

  console.log('[3] v18 买腿（库 v12 快照）:');
  console.log('    preBuy: ' + cfg.strategiesConfig.buyStrategies[0].preBuyCheckCondition);
  console.log('    卖腿数:', cfg.strategiesConfig.sellStrategies.length, '| wallet executorId:', cfg.wallet?.executorId);
  console.log('    dataPrefetch:', JSON.stringify(cfg.fourmemeWs?.dataPrefetch), '| visionPrefetch:', JSON.stringify(cfg.fourmemeWs?.visionPrefetch), '| onlineProfile:', JSON.stringify(cfg.fourmemeWs?.onlineProfile));

  if (!COMMIT) { console.log('[dry-run] 未提交；加 --commit 真执行'); process.exit(0); }

  const exp = await ExperimentFactory.getInstance().createFromConfig(cfg, 'live');
  console.log('[4] CREATED_ID=' + exp.id);
  const { data: chk } = await sb.from('experiments').select('id,experiment_name,status,trading_mode').eq('id', exp.id).single();
  console.log('    回读:', JSON.stringify(chk));
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
