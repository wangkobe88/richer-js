#!/usr/bin/env node
// ============================================================================
// 建 v32 live both 实验（2026-10-22 GMGN bundler 门收紧）
//   克隆 v31 8ddda72d-9fb7-4ac1-b1a5-75e6f8e3ca78（1 买 + 17 卖含 rug-exit 臂）：
//   唯一变量=买腿 gmgnCheckCondition 换库 buy-v2 v31 逐字快照
//   （gmgnBundlerWalletRatio 75 → 65；fire condition/发起门/17 卖腿/钱包/其余 config 不动）。
//   libraryRefs buy-v2 30→31。
// 防呆：源必须 stopped；gmgn 旧子串恰一替换后与库 v31 逐字对拍；fire condition
//   与 v31 逐字一致（确认零波及）；17 卖腿数断言。
// 用法：node scripts/create-v32.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = '8ddda72d-9fb7-4ac1-b1a5-75e6f8e3ca78'; // v31 live both（库 v30 快照）

const GMGN_OLD = 'gmgnBundlerWalletRatio <= 75';
const GMGN_NEW = 'gmgnBundlerWalletRatio <= 65';
const FIRE_EXPECT = 'tokenAgeSec < 90 AND marketCap > 3500 AND marketCap < 12000 AND (narrativeRating == 2 OR narrativeRating == 3) AND holderTrendSlope > 0 AND bundleClusterSharePct < 35 AND top1HolderCircPct < 35 AND maxCopyWalletHolderCircPct < 20 AND (platform != \'flap\' OR earlyTradesRouterPct >= 30) AND earlyTradesPerWallet < 4 AND famousCopyWalletCircPct < 15 AND (buyVolumeBnb >= 1.25 OR holders >= 10) AND earlyTradesNetBuyRatio >= 50 AND sybilClusterHolderCircPct < 35 AND drawdownFromHighest > -70 AND crashSpeedPctPerSec > -10';

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
  const buy = cfg.strategiesConfig?.buyStrategies?.[0];
  if (!buy) throw new Error('买腿缺失');
  // 源形状锁定：fire condition 必须逐字= v31（本批零波及）
  if (buy.condition !== FIRE_EXPECT) throw new Error('源 fire condition 非 v31 形状:\n' + buy.condition);
  if (buy.narrativeTriggerCondition !== 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1') {
    throw new Error('源 trigger 形状非 v31: ' + buy.narrativeTriggerCondition);
  }
  if (typeof buy.gmgnCheckCondition !== 'string' || buy.gmgnCheckCondition.split(GMGN_OLD).length !== 2) {
    throw new Error('源 gmgnCheckCondition 非 75 形状: ' + buy.gmgnCheckCondition);
  }
  if (!(cfg.positionManagement?.perCardBNB > 0)) throw new Error('源 perCardBNB 缺失');
  const sellLegs = cfg.strategiesConfig?.sellStrategies || [];
  if (sellLegs.length !== 17) throw new Error('源卖腿数=' + sellLegs.length + ' 期望 17（含 rug-exit 臂）');
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  if (!refs.find(r => r.name === 'rug-exit-account-arm')) throw new Error('libraryRefs 缺 rug-exit-account-arm');

  // ── v32 唯一变量：gmgn 门 75→65（与库 v31 逐字对拍）──
  buy.gmgnCheckCondition = buy.gmgnCheckCondition.replace(GMGN_OLD, GMGN_NEW);
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry || entry.version !== 31) throw new Error('库 buy-v2 version=' + (entry && entry.version) + ' 期望 31（先跑 bump-buy-v2-v31.cjs --commit）');
  const full = await svc.getById(entry.id);
  const libLegs = full.legs.legs || full.legs;
  if (libLegs[0].gmgnCheckCondition !== buy.gmgnCheckCondition) {
    throw new Error('替换后 gmgnCheckCondition 与库 v31 不逐字一致\nEXP: ' + buy.gmgnCheckCondition + '\nLIB: ' + libLegs[0].gmgnCheckCondition);
  }

  // ── libraryRefs buy-v2 30→31（纯 provenance；rug-exit 不动）──
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (buyRef) { buyRef.version = 31; buyRef.snapshotAt = new Date().toISOString(); }

  cfg.name = 'v32-实盘-both-gmgnBundler65-1022';
  cfg.description = 'v31 + GMGN bundler 门收紧（单变量）：gmgnCheckCondition '
    + 'gmgnBundlerWalletRatio <= 75 → <= 65（高 bundler 盘更早拒；narrativeCategory IS NULL '
    + '臂=字符串枚举 fail-open 语义不动）。fire condition/发起门/GMGN 其余臂/17 卖腿（含 '
    + 'rug-exit）/钱包/其余 config 与 v31 8ddda72d 逐字一致。源=v31 8ddda72d';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| sellLegs:', sellLegs.length);
  console.log('fire (不变):', buy.condition.slice(0, 80) + '…');
  console.log('gmgn:', buy.gmgnCheckCondition);
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V32_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
