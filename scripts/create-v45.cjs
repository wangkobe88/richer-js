#!/usr/bin/env node
// ============================================================================
// 建 v45 live both 实验（2026-10-28 T82 mcap 早期豁免臂；先 commit/pull 本批）
//   克隆 v44 5be4c248-1fe3-423f-a26e-9383ae76e451（库 buy-v2 v41 快照）。唯一变量：
//   买腿 gmgnCheckCondition ← 库 buy-v2 v42 copy-in——
//     gmgnBundlerWalletRatio <= 65 AND (…)
//     → (marketCap < 8000 OR gmgnBundlerWalletRatio <= 65) AND (…)
//   （0xa44ef3ea…7777 案：GMGN wallet_tags_stat 分母个位数时 bundler ratio 是采样
//    噪声，同盘 3min 58.8→166.7 分母收缩出 >100 值；市值 <8K 豁免 bundler 门。
//    issuer 分档门/narrativeCategory 臂不动。）
//   fire condition / 发起门 / 18 卖腿 / perCardBNB / 钱包 / 观察信号 / 其余 config
//   与 v44 逐字一致。libraryRefs buy-v2 41→42。
//   ⚠️ 进程代码须含 T82 commit（GmgnRiskCheckService 键集+引擎/回测双向透传），先
//      pull 再跑——否则 validateLegs 未知因子 400 拒绝（三层防线设计内）。
//   ⚠️ 停 v44 与建 v45 必须同批（单一实验纪律）；重启前持仓确认（卡账本净额口径）。
// 防呆：源必须 stopped 且 gmgn=v41 整串形状；库必须 v42（豁免臂在场）；库/实验 fire
//   与 trigger 逐字一致才允许 copy-in；卖腿 18/买腿 1/perCardBNB 锚定。
// 用法：node scripts/create-v45.cjs [--commit]   （在 182 跑；先跑 bump-buy-v2-v42.cjs --commit）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = '5be4c248-1fe3-423f-a26e-9383ae76e451'; // v44 live both（库 v41 快照）

const GMGN_OLD = 'gmgnBundlerWalletRatio <= 65 AND ((narrativeCategory IS NULL OR '
  + "(narrativeCategory != 'project' AND narrativeCategory != 'account_based_meme' "
  + "AND narrativeCategory != 'web3_native_ip_early')) "
  + 'OR gmgnIssuerTokenCount <= 1)';
const GMGN_NEW = '(marketCap < 8000 OR gmgnBundlerWalletRatio <= 65) AND ((narrativeCategory IS NULL OR '
  + "(narrativeCategory != 'project' AND narrativeCategory != 'account_based_meme' "
  + "AND narrativeCategory != 'web3_native_ip_early')) "
  + 'OR gmgnIssuerTokenCount <= 1)';

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(SRC);
  if (!src) throw new Error('源实验不存在: ' + SRC);
  if (src.status !== 'stopped') throw new Error('源实验未停止: ' + src.status);
  const cfg = JSON.parse(JSON.stringify(src.config));
  if (cfg.platform !== 'both') throw new Error('源 platform != both: ' + cfg.platform);
  if (cfg.virtual !== undefined) throw new Error('源带 virtual 段（应为 live）');
  if (!cfg.wallet?.executorId) throw new Error('源 wallet.executorId 缺失');
  const buys = cfg.strategiesConfig?.buyStrategies || [];
  const sells = cfg.strategiesConfig?.sellStrategies || [];
  if (buys.length !== 1) throw new Error('源买腿数=' + buys.length + ' 期望 1');
  if (sells.length !== 18) throw new Error('源卖腿数=' + sells.length + ' 期望 18');
  if (!(cfg.positionManagement?.perCardBNB > 0)) throw new Error('源 perCardBNB 缺失');
  const buy = buys[0];
  if (buy.gmgnCheckCondition !== GMGN_OLD) {
    throw new Error('源 gmgnCheckCondition 非 v41 整串形状: ' + buy.gmgnCheckCondition);
  }

  // ── v45 唯一变量：gmgnCheckCondition ← 库 buy-v2 v42 copy-in ──
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry || entry.version !== 42) throw new Error('库 buy-v2 version=' + (entry && entry.version) + ' 期望 42（先跑 bump-buy-v2-v42.cjs --commit）');
  const full = await svc.getById(entry.id);
  const libLegs = full.legs.legs || full.legs;
  const libBuy = libLegs[0];
  if (libBuy.gmgnCheckCondition !== GMGN_NEW) {
    throw new Error('库 v42 gmgnCheckCondition 非豁免臂形状: ' + libBuy.gmgnCheckCondition);
  }
  // 库侧 fire/trigger 与实验侧逐字一致（两谱系防漂移；不一致=有人动了库的其他臂）
  if (libBuy.condition !== buy.condition) {
    throw new Error('库/实验 fire 漂移\nLIB: ' + libBuy.condition + '\nEXP: ' + buy.condition);
  }
  if (libBuy.narrativeTriggerCondition !== buy.narrativeTriggerCondition) {
    throw new Error('库/实验 narrativeTriggerCondition 漂移\nLIB: ' + libBuy.narrativeTriggerCondition + '\nEXP: ' + buy.narrativeTriggerCondition);
  }
  buy.gmgnCheckCondition = libBuy.gmgnCheckCondition;

  // ── libraryRefs buy-v2 41→42（纯 provenance；rug-exit 不动）──
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (!buyRef || buyRef.version !== 41) throw new Error('libraryRefs buy-v2 version=' + (buyRef && buyRef.version) + ' 期望 41');
  if (!refs.find(r => r.name === 'rug-exit-account-arm')) throw new Error('libraryRefs 缺 rug-exit-account-arm');
  buyRef.version = 42;
  buyRef.snapshotAt = new Date().toISOString();

  cfg.name = 'v45-实盘-both-gmgn-mcap8k豁免-1028';
  cfg.description = 'v44 + T82 mcap 早期豁免臂：gmgnCheckCondition 加 (marketCap < 8000 OR '
    + 'gmgnBundlerWalletRatio <= 65)——GMGN wallet_tags_stat 分母个位数的超早期盘 bundler '
    + 'ratio 是采样噪声（0xa44ef3ea…7777 案同盘 3min 58.8→166.7，反推 10/17→5/3 分母收缩出 '
    + '>100 值），市值 <8K USD 豁免 bundler 门放行；issuer 分档门/narrativeCategory 臂不动。'
    + 'fire/发起门/18 卖腿/perCardBNB 0.002/观察信号/钱包/其余 config 与 v44 5be4c248 逐字一致。'
    + '代码须含 T82 commit（键集+引擎/回测双向透传 marketCap）。源=v44 5be4c248（库 v41 快照）';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| sellLegs:', sells.length);
  console.log('gmgn (v42):', buy.gmgnCheckCondition);
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V45_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
