#!/usr/bin/env node
// ============================================================================
// 建 v56 live both 实验（2026-10-29 T97 高点停滞减仓臂换车）
//   克隆 v55 7ab210a5（T98 剔尘埃人气键版：buy-v2 v50 + early v10 快照，
//   2026-10-29 03:49 UTC 起跑 15 分钟被本车替代）。
//   本批唯一 config 变量：卖腿 21→22，T80（idx 12）前插 T97 腿——
//     { cards:1, priority:10, cooldownSec:60, maxExecutions:2,
//       condition:'peakProfitPct >= 10 AND secSincePeak > 60' }
//   与 T80 回撤锁盈（幅度层 dd<=-15）同 priority 10、数组序在前=同 tick 双真
//   先评时间层；T97 冷却中 T80 可顶上。secSincePeak 因子已在 FA（9fa07aa，
//   v55 进程代码已含——本车零代码改动纯 config）。
//   买腿（T98 holdersExDust 双腿）/库 refs v50/v10/其余 21 卖腿与 v55 逐字一致
//   （用户裁定「中途上的其它改进不要覆盖」→ 克隆即保留）。
// 防呆：源必须 stopped + 买腿 T98/T96/T95/T93 形状 + 卖 21 + 无 secSincePeak
//   残留 + T80 腿三重锚定（drawdown<=-15 ∧ cards:1 ∧ prio:10）；插后卖 22。
// 用法：node scripts/create-v56.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = '7ab210a5-3133-4f58-90e4-5bceb23efbfa'; // v55 live both（T98 快照）

const T97_LEG = {
  cards: 1,
  priority: 10,
  condition: 'peakProfitPct >= 10 AND secSincePeak > 60',
  cooldownSec: 60,
  description: 'T97 高点停滞减仓臂（2026-10-29 用户拍板：峰值利润>=10% 且距峰 >60s → 卖 1 卡，冷却 60s，最多 2 张）。定位=盈转亏主通道（P13 全清）前的时间停滞层先手减仓，与 T80 回撤锁盈（幅度层）同 priority 10 数组序在前=同 tick 双真先评时间层。secSincePeak 峰推进走任意接受价轨（outlier 不推峰、尘 tick 不卡尘门）与武装门 peakProfitPct 可靠价轨分轨。定标：5 天 113 episode 反事实 N=60 最优 +0.0109 BNB。',
  bypassDebounce: false,
  maxExecutions: 2,
};

async function main() {
  const argSrc = process.argv.find(a => a.startsWith('--src='));
  const srcId = argSrc ? argSrc.slice(6) : SRC;
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(srcId);
  if (!src) throw new Error('源实验不存在: ' + srcId);
  if (COMMIT && src.status !== 'stopped') {
    throw new Error('--commit 须先停 v55（单一实验纪律+停前持仓确认）；当前 status=' + src.status);
  }
  if (src.status === 'stopped') console.log('注: 源已 stopped');
  const cfg = JSON.parse(JSON.stringify(src.config));
  if (cfg.platform !== 'both') throw new Error('源 platform != both: ' + cfg.platform);
  if (cfg.virtual !== undefined) throw new Error('源带 virtual 段（应为 live）');
  if (!cfg.wallet?.executorId) throw new Error('源 wallet.executorId 缺失');
  const buys = cfg.strategiesConfig?.buyStrategies || [];
  const sells = cfg.strategiesConfig?.sellStrategies || [];
  if (buys.length !== 2) throw new Error('源买腿数=' + buys.length + ' 期望 2（主腿+早期臂）');
  if (sells.length !== 21) throw new Error('源卖腿数=' + sells.length + ' 期望 21');
  if (sells.some(s => (s.condition || '').includes('secSincePeak'))) throw new Error('源已有 secSincePeak 卖腿（勿重复插）');

  // ── 买腿形状锚定（v55=T98 快照：holdersExDust 双腿 + T96 AND 净买门 + T95/T93 阈值）──
  for (const [i, leg] of buys.entries()) {
    for (const bad of ['tradesRouterPct', 'sybilClusterHolderCircPct', 'top2BundleClusterHoldCircPct', 'bundleClusterHoldCircPct <', 'top3BundleClusterHoldCircPct', '(buyVolumeBnb >= 1.25 AND holders >= 10)', '(buyVolumeBnb >= 0.25 AND holders >= 5)']) {
      if (leg.condition.includes(bad)) throw new Error('买腿[' + i + '] 残留旧形状: ' + bad);
    }
    if (leg.maxExecutions !== 2) throw new Error('买腿[' + i + '] maxExecutions=' + JSON.stringify(leg.maxExecutions) + ' 期望 2');
    if (leg.cards !== 3) throw new Error('买腿[' + i + '] cards=' + leg.cards + ' 期望 3');
    if (!leg.condition.includes('(tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40)')) {
      throw new Error('买腿[' + i + '] 缺 T96 AND 净买门');
    }
    if (!leg.condition.includes('holdersExDust')) throw new Error('买腿[' + i + '] 缺 T98 holdersExDust 人气段');
  }
  if (!buys[0].condition.includes('marketCap > 4.7')) throw new Error('主腿非 v50 BNB 形状');
  if (!buys[0].condition.includes('(buyVolumeBnb >= 1.25 AND holdersExDust >= 10)')) throw new Error('主腿缺 T98 人气段 1.25/10');
  if (!buys[0].condition.includes('top2HolderCircPct < 55')) throw new Error('主腿缺 T93 top2 持有人门 55');
  if (!buys[0].condition.includes('top1HolderCircPct < 35')) throw new Error('主腿缺 top1 门 35');
  if (!buys[1].condition.includes('tokenAgeSec < 600')) throw new Error('早期腿缺 600s 段');
  if (!buys[1].condition.includes('(buyVolumeBnb >= 0.25 AND holdersExDust >= 5)')) throw new Error('早期腿缺 T98 人气段 0.25/5');
  if (!buys[1].condition.includes('top1HolderCircPct < 45')) throw new Error('早期腿缺 T95 top1 门 45');
  if (!buys[1].condition.includes('top2HolderCircPct < 75')) throw new Error('早期腿缺 T95 top2 门 75');

  // ── libraryRefs 锚定（T98 v50/v10 + rug-exit 不动）──
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  const refMap = Object.fromEntries(refs.map(r => [r.name, r.version]));
  if (refMap['buy-v2'] !== 50) throw new Error('libraryRefs buy-v2 version=' + refMap['buy-v2'] + ' 期望 50');
  if (refMap['buy-early-narrative'] !== 10) throw new Error('libraryRefs early version=' + refMap['buy-early-narrative'] + ' 期望 10');
  if (!('rug-exit-account-arm' in refMap)) throw new Error('libraryRefs 缺 rug-exit-account-arm');

  // ── T80 腿三重锚定 + 插 T97 于其前（同 prio 数组序在前=时间层先评）──
  const t80Idx = sells.findIndex(s =>
    (s.condition || '').includes('drawdownFromHighestSinceLastBuy <= -15') && s.cards === 1 && s.priority === 10);
  if (t80Idx < 0) throw new Error('T80 回撤锁盈腿未找到（drawdown<=-15 ∧ cards:1 ∧ prio:10）');
  if (sells[t80Idx].cooldownSec !== 300) throw new Error('T80 cooldownSec=' + sells[t80Idx].cooldownSec + ' 期望 300');
  sells.splice(t80Idx, 0, JSON.parse(JSON.stringify(T97_LEG)));
  if (sells.length !== 22) throw new Error('插后卖腿数=' + sells.length + ' 期望 22');

  cfg.name = 'v56-实盘-both-高点停滞减仓-1029';
  cfg.description = 'v55 7ab210a5（T98 剔尘埃人气键版）+ T97 高点停滞减仓臂：卖腿 21→22，'
    + 'T80 前插 peakProfitPct >= 10 AND secSincePeak > 60 卖 1 卡 cd60 maxExecutions=2'
    + '（用户拍板 2026-10-29；与 T80 同 priority 10 数组序在前=同 tick 双真先评时间层，'
    + '冷却中 T80 可顶上）。secSincePeak 因子在 FA 9fa07aa（v55 进程代码已含）。'
    + '买腿 T98 holdersExDust/库 refs v50/v10/其余 21 卖腿与 v55 逐字一致（不覆盖'
    + '中途上的改进）。源=v55 7ab210a5。v55 持仓遗留：币安圣子 2×0.006 BNB'
    + '（同 v52 弃管先例，可手动处置）。';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| buys:', buys.length, '| sells:', sells.length);
  console.log('T97 新腿 idx:', t80Idx, '->', JSON.stringify({ cards: T97_LEG.cards, prio: T97_LEG.priority, cd: T97_LEG.cooldownSec, maxEx: T97_LEG.maxExecutions, cond: T97_LEG.condition }));
  console.log('T80 顺移 idx:', t80Idx + 1);
  console.log('buy[0]:', buys[0].condition.slice(0, 120) + '…');
  console.log('buy[1]:', buys[1].condition.slice(0, 120) + '…');
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs.map(r => r.name + ':' + r.version)));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V56_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
