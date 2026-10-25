#!/usr/bin/env node
// ============================================================================
// 建 v38 live both 实验（2026-10-25 T65 top2 存量门）
//   克隆 v37 ca8f9493-d6ea-4d97-9b3c-1470cbbafc88（库 buy-v2 v36 快照）：买腿整条
//   从库 buy-v2 v37 copy-in（= v36 存量 bundle 门 + 本批第二道门
//   top2BundleClusterHoldCircPct < 55——AIFLY 0x0bae…7777 案：fire 时 top1 34.8 擦线
//   放行、top2 57.2=最大两块买家并集持仓超五成，95 票阈值扫描 50 净负/55 甜点/60
//   漏 AIFLY，用户裁定 55）。gmgnCheckCondition(65)/发起门/17 卖腿/钱包/观察信号/
//   其余 config 不动。libraryRefs buy-v2 36→37。
//   ⚠️ 进程代码须含 top2BundleClusterHoldCircPct（24126eb），先 pull 再跑。
// 防呆：源必须 stopped 且 fire 为 v36 快照形状（无 top2 臂）；库必须 v37；
//   库侧 gmgn/trigger 与实验侧逐字一致才允许 copy-in（不一致=两谱系漂移，人工裁定）。
// 用法：node scripts/create-v38.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = 'ca8f9493-d6ea-4d97-9b3c-1470cbbafc88'; // v37 live both（库 v36 快照）

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
  // 源形状锁定：v37 实验 fire=v36 快照（存量 bundle 门 + T63 慢热或臂，无 top2）
  if (buy.condition.split('bundleClusterHoldCircPct < 35').length !== 2) {
    throw new Error('源 fire 非存量 bundle 门形状: ' + buy.condition);
  }
  if (buy.condition.includes('top2BundleClusterHoldCircPct')) {
    throw new Error('源 fire 已含 top2 臂（源应=v36 快照，若已混入先核对谱系）');
  }
  if (buy.condition.split('tradeCount >= 25').length !== 2) {
    throw new Error('源 fire 缺 T63 慢热或臂（v36 库快照应含）');
  }
  if (buy.condition.split('marketCap < 20000').length !== 2) throw new Error('源 fire 非 20000 形状（源应=v36 快照）');
  if (!(cfg.positionManagement?.perCardBNB > 0)) throw new Error('源 perCardBNB 缺失');
  const sellLegs = cfg.strategiesConfig?.sellStrategies || [];
  if (sellLegs.length !== 17) throw new Error('源卖腿数=' + sellLegs.length + ' 期望 17（含 rug-exit 臂）');
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  if (!refs.find(r => r.name === 'rug-exit-account-arm')) throw new Error('libraryRefs 缺 rug-exit-account-arm');

  // ── v38 唯一变量：买腿整条取库 buy-v2 v37 copy-in ──
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry || entry.version !== 37) throw new Error('库 buy-v2 version=' + (entry && entry.version) + ' 期望 37（先跑 bump 脚本 --commit）');
  const full = await svc.getById(entry.id);
  const libLegs = full.legs.legs || full.legs;
  const libBuy = libLegs[0];
  if (!libBuy.condition.includes('top2BundleClusterHoldCircPct < 55')) {
    throw new Error('库 v37 fire 缺 top2 门: ' + libBuy.condition);
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

  // ── libraryRefs buy-v2 36→37（纯 provenance；rug-exit 不动）──
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (buyRef) { buyRef.version = 37; buyRef.snapshotAt = new Date().toISOString(); }

  cfg.name = 'v38-实盘-both-top2存量门-1025';
  cfg.description = 'v37 + 买腿引用库 buy-v2 v37：第二道存量门 '
    + 'top2BundleClusterHoldCircPct < 55（最大两块买家集合并集去重正净持仓÷流通×100——'
    + 'T65 AIFLY 0x0bae…7777 案：fire 时 top1 34.8 擦线过 35 门、top2 57.2=bundler 剩仓'
    + '+囤筹块并集；95 票 fire 时刻重放阈值扫描：50 拦净赢家 +0.0068 误伤（62% 拦截率）、'
    + '55 拦 AIFLY 57.2 且仅漏 1 张 55.3 赢家、60 数据最优但漏 AIFLY——用户裁定 55）。'
    + '恒 ≥ top1；不足两块退化=top1 值。代码须含 top2BundleClusterHoldCircPct（24126eb）。'
    + 'GMGN bundler65/发起门/17 卖腿（含 rug-exit 臂）/观察信号/钱包/其余 config 与 v37 '
    + 'ca8f9493 逐字一致。源=v37 ca8f9493（库 v36 快照）';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| sellLegs:', sellLegs.length);
  console.log('fire:', buy.condition);
  console.log('gmgn (不变):', buy.gmgnCheckCondition.slice(0, 40) + '…');
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V38_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
