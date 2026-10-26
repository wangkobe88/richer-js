#!/usr/bin/env node
// ============================================================================
// 建 v40 live both 实验（2026-10-26 T70 智子/币安1986 案三裁定 + T71 early 族删除；先 commit/pull 本批）
//   克隆 v39 71f87b50-fe47-442a-8933-f22ea5d78d3d（库 buy-v2 v38 快照）：买腿整条
//   从库 buy-v2 v39 copy-in（= v38 四处替换——
//   ①净买比门 earlyTradesNetBuyRatio>=50 → tradesNetBuyRatio>=40：全史实时载体+放宽
//     （智子 0x4451f373…7777：90s 窗终值 49.8 差 0.2pp 拦掉 40 分钟后毕业票）
//   ②flap 路由门 earlyTradesRouterPct>=30 → tradesRouterPct>=30：实时载体
//     （币安1986 0xd6c7e7c9…7777：前 90s 仅 dev 自倒 2 笔冻结 0 恒拦，90-300s 散户
//     蜂拥 110 笔 77 钱包也改不了冻结快照）
//   ③慢热或臂去 600s 时间上限：tokenAgeSec<90 OR tradeCount>=25（流动性不足市场）。
//   ④删 earlyTradesPerWallet<4 臂（T71 用户裁定 earlyTrades* 族整族删除——FA 十键已
//     退役，已删键引用=loadStrategies fail-fast 拒启，必须同步剥除）。
//   preFilter age 包络随 ③ 无上界=不再裁剪慢热票（设计内）。
//   gmgnCheckCondition(65)/发起门/17 卖腿/钱包/观察信号/其余 config 不动。
//   libraryRefs buy-v2 38→39。
//   ⚠️ 进程代码须含 tradesNetBuyRatio/tradesRouterPct 且不含 earlyTrades*（T70+T71
//      commit），先 pull 再跑——否则 validateLegs 未知因子 400 拒绝（三层防线设计内）。
//   ⚠️ v39 71f87b50 拉新代码后重启会拒启（条件引用已删键）——停 v39 与建 v40 必须同批。
// 防呆：源必须 stopped 且 fire 为 v38 快照形状（early 冻结两键消费+perWallet 臂+600s 帽
//   在场）；库必须 v39（含 trades* 两键、不含任何 earlyTrades 子串、无 600s 帽）；库侧
//   gmgn/trigger 与实验侧逐字一致才允许 copy-in。
// 用法：node scripts/create-v40.cjs [--commit]   （在 182 跑；先跑 bump-buy-v2-v39.cjs --commit）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = '71f87b50-fe47-442a-8933-f22ea5d78d3d'; // v39 live both（库 v38 快照）

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
  // 源形状锁定：v39 实验 fire=v38 快照（T70 旧载体+perWallet 臂+600s 帽在场）
  if (buy.condition.split('earlyTradesNetBuyRatio >= 50').length !== 2) {
    throw new Error('源 fire 缺 earlyTradesNetBuyRatio>=50 臂（应=v38 快照）');
  }
  if (buy.condition.split('earlyTradesRouterPct >= 30').length !== 2) {
    throw new Error('源 fire 缺 earlyTradesRouterPct>=30 臂（应=v38 快照）');
  }
  if (buy.condition.split('earlyTradesPerWallet < 4').length !== 2) {
    throw new Error('源 fire 缺 perWallet 臂（应=v38 快照）');
  }
  if (buy.condition.split('tokenAgeSec < 600').length !== 2) {
    throw new Error('源 fire 缺 600s 慢热帽（应=v38 快照）');
  }
  if (buy.condition.includes('tradesNetBuyRatio') || buy.condition.includes('tradesRouterPct')) {
    throw new Error('源 fire 已含 trades* 两键（源应=v38 快照，若已混入先核对谱系）');
  }
  if (buy.condition.split('top3BundleClusterHoldCircPct < 75').length !== 2) {
    throw new Error('源 fire 缺 top3 门（应=v38 快照）');
  }
  if (buy.condition.split('marketCap < 20000').length !== 2) throw new Error('源 fire 非 20000 形状');
  if (!(cfg.positionManagement?.perCardBNB > 0)) throw new Error('源 perCardBNB 缺失');
  const sellLegs = cfg.strategiesConfig?.sellStrategies || [];
  if (sellLegs.length !== 17) throw new Error('源卖腿数=' + sellLegs.length + ' 期望 17（含 rug-exit 臂）');
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  if (!refs.find(r => r.name === 'rug-exit-account-arm')) throw new Error('libraryRefs 缺 rug-exit-account-arm');

  // ── v40 唯一变量：买腿整条取库 buy-v2 v39 copy-in ──
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry || entry.version !== 39) throw new Error('库 buy-v2 version=' + (entry && entry.version) + ' 期望 39（先跑 bump-buy-v2-v39.cjs --commit）');
  const full = await svc.getById(entry.id);
  const libLegs = full.legs.legs || full.legs;
  const libBuy = libLegs[0];
  if (!libBuy.condition.includes('tradesNetBuyRatio >= 40')) {
    throw new Error('库 v39 fire 缺 tradesNetBuyRatio>=40: ' + libBuy.condition);
  }
  if (!libBuy.condition.includes('tradesRouterPct >= 30')) {
    throw new Error('库 v39 fire 缺 tradesRouterPct>=30: ' + libBuy.condition);
  }
  if (!libBuy.condition.includes('(tokenAgeSec < 90 OR tradeCount >= 25)')) {
    throw new Error('库 v39 fire 缺无帽慢热或臂: ' + libBuy.condition);
  }
  if (libBuy.condition.includes('tokenAgeSec < 600')) {
    throw new Error('库 v39 fire 仍带 600s 帽（bump 未生效？）');
  }
  if (libBuy.condition.includes('earlyTradesNetBuyRatio') || libBuy.condition.includes('earlyTradesRouterPct')) {
    throw new Error('库 v39 fire 仍消费 early 冻结两键（bump 未生效？）');
  }
  if (libBuy.condition.includes('earlyTrades')) {
    throw new Error('库 v39 fire 仍含 earlyTrades 子串（T71 全族删除——已删键引用即拒启）');
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

  // ── libraryRefs buy-v2 38→39（纯 provenance；rug-exit 不动）──
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (buyRef) { buyRef.version = 39; buyRef.snapshotAt = new Date().toISOString(); }

  cfg.name = 'v40-实盘-both-实时净买路由门-1026';
  cfg.description = 'v39 + 买腿引用库 buy-v2 v39（T70 智子/币安1986 案三裁定+T71）：'
    + '①净买比门 earlyTradesNetBuyRatio>=50 → tradesNetBuyRatio>=40（全史实时载体+放宽'
    + '——智子 0x4451f373…7777：90s 窗终值 49.8 差 0.2pp 拦掉毕业票，买点时刻实时值随盘抬升）'
    + '②flap 路由门 earlyTradesRouterPct>=30 → tradesRouterPct>=30（实时载体——币安1986 '
    + '0xd6c7e7c9…7777：前 90s 仅 dev 自倒冻结 0 恒拦，90-300s 散户蜂拥 110 笔也改不了冻结快照）'
    + '③慢热或臂去 600s 上限：tokenAgeSec<90 OR tradeCount>=25（流动性不足市场）'
    + '④删 earlyTradesPerWallet<4 臂（T71 early 族整族删除）。'
    + 'preFilter age 无上界=不再裁剪慢热票（设计内）。earlyTrades* 十键已随 T71 退役。'
    + '代码须含 trades* 两键且不含 earlyTrades*（T70+T71 commit）。GMGN bundler65/发起门/'
    + '17 卖腿（含 rug-exit 臂）/观察信号/钱包/其余 config 与 v39 71f87b50 逐字一致。'
    + '源=v39 71f87b50（库 v38 快照）';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| sellLegs:', sellLegs.length);
  console.log('fire:', buy.condition);
  console.log('gmgn (不变):', buy.gmgnCheckCondition.slice(0, 40) + '…');
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V40_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
