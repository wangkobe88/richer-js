#!/usr/bin/env node
// ============================================================================
// 建 v39 live both 实验（2026-10-26 T68 top3 门 75；commit 4ef5109）
//   克隆 v38 e5438645-e6df-4274-9424-72b3e5f8a922（库 buy-v2 v37 快照）：买腿整条
//   从库 buy-v2 v38 copy-in（= v37 + top3BundleClusterHoldCircPct < 75——邪恶卡皮
//   0x4e7e…7777 案：fire 时 top1=28.5/top2=53.4 均过门、top3=77.8=前三块买家并集
//   囤 3/4 流通，4 分钟即卖；重放 fire tick 与快照逐位一致；阈值 75 用户拍板）。
//   gmgnCheckCondition(65)/发起门/17 卖腿/钱包/观察信号/其余 config 不动。
//   libraryRefs buy-v2 37→38。
//   ⚠️ 进程代码须含 top3BundleClusterHoldCircPct（4ef5109），先 pull 再跑。
// 防呆：源必须 stopped 且 fire 为 v37 快照形状（含 top2 臂、无 top3 臂）；库必须 v38；
//   库侧 gmgn/trigger 与实验侧逐字一致才允许 copy-in（不一致=两谱系漂移，人工裁定）。
// 用法：node scripts/create-v39.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = 'e5438645-e6df-4274-9424-72b3e5f8a922'; // v38 live both（库 v37 快照）

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
  // 源形状锁定：v38 实验 fire=v37 快照（top2 门在场、无 top3 门）
  if (buy.condition.split('top2BundleClusterHoldCircPct < 55').length !== 2) {
    throw new Error('源 fire 缺 top2 门臂: ' + buy.condition);
  }
  if (buy.condition.includes('top3BundleClusterHoldCircPct')) {
    throw new Error('源 fire 已含 top3 臂（源应=v37 快照，若已混入先核对谱系）');
  }
  if (buy.condition.split('tradeCount >= 25').length !== 2) {
    throw new Error('源 fire 缺 T63 慢热或臂（v37 库快照应含）');
  }
  if (buy.condition.split('marketCap < 20000').length !== 2) throw new Error('源 fire 非 20000 形状（源应=v37 快照）');
  if (!(cfg.positionManagement?.perCardBNB > 0)) throw new Error('源 perCardBNB 缺失');
  const sellLegs = cfg.strategiesConfig?.sellStrategies || [];
  if (sellLegs.length !== 17) throw new Error('源卖腿数=' + sellLegs.length + ' 期望 17（含 rug-exit 臂）');
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  if (!refs.find(r => r.name === 'rug-exit-account-arm')) throw new Error('libraryRefs 缺 rug-exit-account-arm');

  // ── v39 唯一变量：买腿整条取库 buy-v2 v38 copy-in ──
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry || entry.version !== 38) throw new Error('库 buy-v2 version=' + (entry && entry.version) + ' 期望 38（先跑 bump 脚本 --commit）');
  const full = await svc.getById(entry.id);
  const libLegs = full.legs.legs || full.legs;
  const libBuy = libLegs[0];
  if (!libBuy.condition.includes('top3BundleClusterHoldCircPct < 75')) {
    throw new Error('库 v38 fire 缺 top3 门: ' + libBuy.condition);
  }
  // 库侧 gmgn/trigger 与实验侧逐字一致（两谱系防漂移；不一致=有人动了库的其他臂）
  if (libBuy.gmgnCheckCondition !== buy.gmgnCheckCondition) {
    throw new Error('库/实验 gmgnCheckCondition 漂移\nLIB: ' + libBuy.gmgnCheckCondition + '\nEXP: ' + buy.gmgnCheckCondition);
  }
  if (libBuy.narrativeTriggerCondition !== buy.narrativeTriggerCondition) {
    throw new Error('库/实验 narrativeTriggerCondition 漂移\nLIB: ' + libBuy.narrativeTriggerCondition + '\nEXP: ' + buy.narrativeTriggerCondition);
  }
  buy.condition = libBuy.condition;
  if (libBuy.gmgnCheckCondition) buy.gmgnCheckCondition = libBuy.gmgnCheckCondition;
  if (libBuy.narrativeTriggerCondition) buy.narrativeTriggerCondition = libBuy.narrativeTriggerCondition;

  // ── libraryRefs buy-v2 37→38（纯 provenance；rug-exit 不动）──
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (buyRef) { buyRef.version = 38; buyRef.snapshotAt = new Date().toISOString(); }

  cfg.name = 'v39-实盘-both-top3门75-1026';
  cfg.description = 'v38 + 买腿引用库 buy-v2 v38：top3 门 top3BundleClusterHoldCircPct < 75'
    + '（最大三块买家并集去重正净持仓÷流通×100；不足三块退化=top2；恒≥top2≥top1——'
    + 'T68 邪恶卡皮 0x4e7e…7777 案：fire 时 top1=28.5/top2=53.4 均过门、top3=77.8=前三块'
    + '囤 3/4 流通、4 分钟即卖；重放 fire tick t1/t2 与快照逐位一致；阈值 75 用户裁定'
    + '（拦 77.8、放 74 以下））。代码须含 top3BundleClusterHoldCircPct（4ef5109）。'
    + 'GMGN bundler65/发起门/17 卖腿（含 rug-exit 臂）/观察信号/钱包/其余 config 与 v38 '
    + 'e5438645 逐字一致。源=v38 e5438645（库 v37 快照）';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| sellLegs:', sellLegs.length);
  console.log('fire:', buy.condition);
  console.log('gmgn (不变):', buy.gmgnCheckCondition.slice(0, 40) + '…');
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V39_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
