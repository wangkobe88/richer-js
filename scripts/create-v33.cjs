#!/usr/bin/env node
// ============================================================================
// 建 v33 live both 实验（2026-10-22 市值上限臂放宽 12000 → 15000）
//   克隆 v32 f04861ee-9549-4676-bb4b-ed812c9d84c5（1 买 + 17 卖含 rug-exit 臂）：
//   唯一变量=买腿 fire condition 换库 buy-v2 v32 逐字快照（marketCap < 12000 → < 15000）。
//   gmgnCheckCondition(65)/发起门/17 卖腿/钱包/其余 config 不动。libraryRefs buy-v2 31→32。
// 防呆：源必须 stopped；fire 恰一替换后与库 v32 逐字对拍；gmgn 65 形状锁定；
//   17 卖腿数断言。
// 用法：node scripts/create-v33.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = 'f04861ee-9549-4676-bb4b-ed812c9d84c5'; // v32 live both（库 v31 快照）

const OLD_SEG = 'marketCap < 12000';
const NEW_SEG = 'marketCap < 15000';
const GMGN_OLD = 'gmgnBundlerWalletRatio <= 65'; // v32 形状（本批不动）

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
  // 源形状锁定：fire 含 12000 恰一 + gmgn 65 形状 + trigger
  if (buy.condition.split(OLD_SEG).length !== 2) throw new Error('源 fire 非 12000 形状: ' + buy.condition);
  if (typeof buy.gmgnCheckCondition !== 'string' || buy.gmgnCheckCondition.split(GMGN_OLD).length !== 2) {
    throw new Error('源 gmgnCheckCondition 非 65 形状: ' + buy.gmgnCheckCondition);
  }
  if (buy.narrativeTriggerCondition !== 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1') {
    throw new Error('源 trigger 形状非 v32: ' + buy.narrativeTriggerCondition);
  }
  if (!(cfg.positionManagement?.perCardBNB > 0)) throw new Error('源 perCardBNB 缺失');
  const sellLegs = cfg.strategiesConfig?.sellStrategies || [];
  if (sellLegs.length !== 17) throw new Error('源卖腿数=' + sellLegs.length + ' 期望 17（含 rug-exit 臂）');
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  if (!refs.find(r => r.name === 'rug-exit-account-arm')) throw new Error('libraryRefs 缺 rug-exit-account-arm');

  // ── v33 唯一变量：市值上臂 12000→15000（与库 v32 逐字对拍）──
  buy.condition = buy.condition.replace(OLD_SEG, NEW_SEG);
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry || entry.version !== 32) throw new Error('库 buy-v2 version=' + (entry && entry.version) + ' 期望 32（先跑 bump-buy-v2-v32.cjs --commit）');
  const full = await svc.getById(entry.id);
  const libLegs = full.legs.legs || full.legs;
  if (libLegs[0].condition !== buy.condition) {
    throw new Error('替换后 condition 与库 v32 不逐字一致\nEXP: ' + buy.condition + '\nLIB: ' + libLegs[0].condition);
  }

  // ── libraryRefs buy-v2 31→32（纯 provenance；rug-exit 不动）──
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (buyRef) { buyRef.version = 32; buyRef.snapshotAt = new Date().toISOString(); }

  cfg.name = 'v33-实盘-both-mcap上限15000-1022';
  cfg.description = 'v32 + 市值上限臂放宽（单变量）：fire condition marketCap < 12000 → < 15000'
    + '（赵长鹏能飞 0x0d2cd4ec…7777 案：叙事 5s rating=3 时市值已 13.5K 全程不回落=结构性拒买；'
    + '15000 回 v11 15K 门刻度；下限 3500 不动）。GMGN bundler65/发起门/17 卖腿（含 rug-exit）/'
    + '钱包/其余 config 与 v32 f04861ee 逐字一致。源=v32 f04861ee';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| sellLegs:', sellLegs.length);
  console.log('fire:', buy.condition);
  console.log('gmgn (不变):', buy.gmgnCheckCondition.slice(0, 40) + '…');
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V33_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
