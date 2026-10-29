#!/usr/bin/env node
// ============================================================================
// 建 v57 live both 实验（2026-10-29 T99 拱形回撤收紧 -25 下放低两档换车）
//   克隆 v56 4ac10e23（T97 高点停滞减仓版：T98/T97 同车，T96/T95/T94/
//   T93 全承继，2026-10-29 04:05 UTC 起跑）。
//   本批唯一 config 变量：卖腿 22→24，拱形 -35 低档（<8.1）腿前插两档
//   -25 全清臂（与既有 >=27 档 -25 合流=全市值段 -25 全清）：
//     { cards:'all', priority:11, maxExecutions:1,
//       condition:'peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -25 AND marketCap < 8.1' }
//     { cards:'all', priority:11, maxExecutions:1,
//       condition:'peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -25 AND marketCap >= 8.1 AND marketCap < 27' }
//   参数与拱形族（-35 两档 / >=27 档 -25）逐字同款（p11/all/max1/cd null/
//   bypass=false）；-35 两档保留=「-25 全清失败后的兜底重试层」（max1 无论
//   成败即耗，idx 0 止臂 -35 vs P0 -50 同构纵深）。
//   动机（SPERM 案 0x0590…7777，2026-10-29 05:03-05:05）：峰 +43.3% 回撤
//   -35% 首真 05:05:31 → 3.5s+5tick 确认窗走完 fire 时已 -41.1%、链上成交
//   成本口径 -29.3%（fire 名义腿=P4 地板 7.4 抢 priority）；-25 首真时刻
//   05:05:27（早 4s，价位高 ~25%）确认窗前移=少跌 6+ 点。
//   买腿（T98/T96/T95/T93）/T97 secSincePeak 腿/T80/其余 21 卖腿与 v56
//   逐字一致（不覆盖中途上的改进）。零代码改动纯 config（三因子全在 FA）。
// 防呆：源必须 stopped + 买腿 T98/T96/T95/T93 形状 + 卖 22 + 无 -25 低档
//   残留 + T97/T80/拱形三腿锚定；插后卖 24。
// 用法：node scripts/create-v57.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = '4ac10e23-83a7-4177-80f1-c3e7ed3bdddd'; // v56 live both（T98+T97 同车）

const T99_LEGS = [
  {
    cards: 'all',
    priority: 11,
    condition: 'peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -25 AND marketCap < 8.1',
    cooldownSec: null,
    description: 'T99 拱形回撤收紧·低市值档 -25（2026-10-29 用户指令「增加2个卖出臂 peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -25 AND marketCap >= 8.1 AND marketCap < 27 以及 peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -25 AND marketCap < 8.1」）：峰值利润 >=10% 武装 + 距峰回撤 25% 在低市值档（<8.1 BNB）全清。与既有 >=27 档 -25 合流=全市值段 -25 全清；-35 两档（同 priority 11 数组序在后）保留为 -25 全清失败后的兜底重试层（max1 无论成败即耗，止损臂 -35 vs P0 -50 同构纵深）。SPERM 案（0x0590…7777）动机：峰 +43.3% 回撤 -35 首真 05:05:31 → 3.5s+5tick 确认窗 fire 时已 -41.1%（名义腿=P4 地板 7.4 同刻双真抢 priority，本腿与 P4 均 all 全清实质无差）；-25 首真 05:05:27 早 4s=确认窗前移少跌 6+ 点。dd null（未武装/无峰）→ 恒 false fail-closed；marketCap=fire 时刻实时市值（BNB 域，刻意非 peakMarketCapSinceLastBuy）',
    bypassDebounce: false,
    maxExecutions: 1,
  },
  {
    cards: 'all',
    priority: 11,
    condition: 'peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -25 AND marketCap >= 8.1 AND marketCap < 27',
    cooldownSec: null,
    description: 'T99 拱形回撤收紧·中市值档 -25（2026-10-29 用户指令同批）：峰值利润 >=10% 武装 + 距峰回撤 25% 在中市值档（8.1-27 BNB）全清。本档与 T80 回撤锁盈减仓臂（-15 卖 1 卡 cd300，priority 10）成梯队：-15 先评减 1 卡保 V 反余仓，深跌 -25 由本腿全清兜底，-35（同档旧臂）保留为失败重试层。与 >=27 档 -25 合流=全市值段 -25 全清。dd null fail-closed；marketCap=fire 时刻实时市值（BNB 域）',
    bypassDebounce: false,
    maxExecutions: 1,
  },
];

async function main() {
  const argSrc = process.argv.find(a => a.startsWith('--src='));
  const srcId = argSrc ? argSrc.slice(6) : SRC;
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(srcId);
  if (!src) throw new Error('源实验不存在: ' + srcId);
  if (COMMIT && src.status !== 'stopped') {
    throw new Error('--commit 须先停 v56（单一实验纪律+停前持仓确认）；当前 status=' + src.status);
  }
  if (src.status === 'stopped') console.log('注: 源已 stopped');
  const cfg = JSON.parse(JSON.stringify(src.config));
  if (cfg.platform !== 'both') throw new Error('源 platform != both: ' + cfg.platform);
  if (cfg.virtual !== undefined) throw new Error('源带 virtual 段（应为 live）');
  if (!cfg.wallet?.executorId) throw new Error('源 wallet.executorId 缺失');
  const buys = cfg.strategiesConfig?.buyStrategies || [];
  const sells = cfg.strategiesConfig?.sellStrategies || [];
  if (buys.length !== 2) throw new Error('源买腿数=' + buys.length + ' 期望 2（主腿+早期臂）');
  if (sells.length !== 22) throw new Error('源卖腿数=' + sells.length + ' 期望 22');

  // ── 买腿形状锚定（v56=T98+T97 同车快照：holdersExDust 双腿 + T96 AND 净买门 + T95/T93 阈值）──
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

  // ── 承继机制腿锚定：T97 secSincePeak + T80 回撤锁盈 ──
  const t97 = sells.find(s => (s.condition || '').includes('secSincePeak > 60'));
  if (!t97) throw new Error('T97 secSincePeak 腿未找到（v56 应承继）');
  if (t97.cards !== 1 || t97.priority !== 10 || t97.cooldownSec !== 60 || t97.maxExecutions !== 2) {
    throw new Error('T97 腿形状漂移: ' + JSON.stringify({ cards: t97.cards, prio: t97.priority, cd: t97.cooldownSec, maxEx: t97.maxExecutions }));
  }
  const t80 = sells.find(s =>
    (s.condition || '').includes('drawdownFromHighestSinceLastBuy <= -15') && s.cards === 1 && s.priority === 10);
  if (!t80) throw new Error('T80 回撤锁盈腿未找到（drawdown<=-15 ∧ cards:1 ∧ prio:10）');
  if (t80.cooldownSec !== 300) throw new Error('T80 cooldownSec=' + t80.cooldownSec + ' 期望 300');

  // ── 拱形族锚定（-35 两档 + >=27 档 -25）+ 防 -25 低档重插 ──
  const arc35Low = sells.findIndex(s => (s.condition || '') === 'peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -35 AND marketCap < 8.1');
  const arc35Mid = sells.findIndex(s => (s.condition || '') === 'peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -35 AND marketCap >= 8.1 AND marketCap < 27');
  const arc25High = sells.findIndex(s => (s.condition || '') === 'peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -25 AND marketCap >= 27');
  if (arc35Low < 0 || arc35Mid < 0 || arc25High < 0) {
    throw new Error('拱形族锚定失败: -35低=' + arc35Low + ' -35中=' + arc35Mid + ' -25高=' + arc25High);
  }
  if (sells.some(s => /drawdownFromHighestSinceLastBuy <= -25 AND marketCap < 27$/.test(s.condition || '') ||
      (s.condition || '') === 'peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -25 AND marketCap < 8.1')) {
    throw new Error('源已有 -25 低/中档拱形腿（勿重复插）');
  }

  // ── 插入：-35 低档腿前（-25 两档聚齐在前、-35 殿后兜底；同 priority 11 数组序）──
  sells.splice(arc35Low, 0, ...JSON.parse(JSON.stringify(T99_LEGS)));
  if (sells.length !== 24) throw new Error('插后卖腿数=' + sells.length + ' 期望 24');

  cfg.name = 'v57-实盘-both-拱形回撤收紧25-1029';
  cfg.description = 'v56 4ac10e23（T98 剔尘埃人气键+T97 高点停滞减仓同车）+ T99 拱形回撤收紧'
    + '-25 下放低两档：卖腿 22→24，拱形 -35 低档腿前插两档 -25 全清臂'
    + '（<8.1 与 8.1-27 BNB；p11/all/max1 与拱形族逐字同款；与既有 >=27 档 -25 合流'
    + '=全市值段 -25 全清，-35 两档保留为全清失败兜底重试层）。SPERM 案'
    + '（0x0590…7777，峰 +43.3% 回撤 -41% 才 fire）动机：-25 首真比 -35 早 4s'
    + '=3.5s+5tick 确认窗前移少跌 6+ 点。买腿 T98/T96/T95/T93、T97 secSincePeak 腿、'
    + 'T80、其余 21 卖腿与 v56 逐字一致（不覆盖中途上的改进）。源=v56 4ac10e23'
    + '（换车时零持仓，6 票全平）。';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| buys:', buys.length, '| sells:', sells.length);
  console.log('T99 新腿 idx:', arc35Low, arc35Low + 1, '->', JSON.stringify(T99_LEGS.map(l => ({ cards: l.cards, prio: l.priority, maxEx: l.maxExecutions, cond: l.condition }))));
  console.log('拱形 -35 低档顺移 idx:', arc35Low + 2, '| -35 中档:', sells.findIndex(s => (s.condition || '').includes('<= -35 AND marketCap >= 8.1')), '| -25 高档:', sells.findIndex(s => (s.condition || '').includes('<= -25 AND marketCap >= 27')));
  console.log('T97 腿在:', !!t97, '| T80 腿在:', !!t80);
  console.log('buy[0]:', buys[0].condition.slice(0, 120) + '…');
  console.log('buy[1]:', buys[1].condition.slice(0, 120) + '…');
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs.map(r => r.name + ':' + r.version)));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V57_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
