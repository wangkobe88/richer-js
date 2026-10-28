#!/usr/bin/env node
// ============================================================================
// 建 v46 live both 实验（2026-10-28 T84 早期叙事臂 + 市值量纲 BNB 切换；先 commit/pull）
//   克隆 v44 5be4c248-1fe3-423f-a26e-9383ae76e451（库 buy-v2 v41 快照）。三类变量：
//   ① 买腿重建（copy-in）：buy-v2 v43（BNB 带 4.7-27 + cards 3）+ 新库条目
//      buy-early-narrative v1（早期叙事臂：rating 2|3 + 600s 窗 + 6.0-6.7 BNB 带 +
//      承接门放松版 0.25/4 + 净买门 40 + 坏人门全保留 + cards 3）——两腿共 6 卡
//      （用户裁定）；发起门两腿同串共享 per-token 触发状态机（零双调）。
//   ② 卖腿 18→21（BNB 换算 + entryMarketCap 适配）：
//      换算（bnbUsd≈745）：P4 清仓带 3500-4000→4.7-5.4；<3500 地板→<4.7；
//      T80 三档 6000/20000→8.1/27、10000→13.4；T79 地板 5500→7.4；观察信号
//      marketCapThreshold 20000→27（显式值在场）。
//      豁免（早期仓防误杀）：T79 地板与衰竭腿加
//        AND (entryMarketCap >= 7.4 OR realHoldDuration > 1800)
//      ——早期臂入场即 <7.4，10s 冻结/120s 买量衰竭两腿会买完就卖；1800s 后地板
//      回归兜底。P4 清仓带（4.7-5.4）与 <4.7 地板刻意不豁免=深度坠落保护。
//      新增三条早期臂专属腿（entryMarketCap < 7.4 域限定，回放 e1 出场序）：
//        上位离场 marketCap >= 27（全清，mcap_exit 20000→27）
//        protect20 peakProfitPct >= 20 AND profitPercent <= 0（全清）
//        600s 止损 holdDuration > 600 AND profitPercent <= 0（全清，stop600>stop900 回放裁定）
//   ③ 其余（perCardBNB 0.002/钱包/graduation/RSI/rug-exit/-35/-50/+50/+100/1h 止损）
//      与 v44 逐字一致。
//   ⚠️ 前置：182 已跑 bump-buy-v2-v42/v43 --commit + create-buy-early-narrative-v1 --commit；
//      进程代码含 T84 commit（FA marketCap BNB 域 + entryMarketCap 键）。
//   ⚠️ copy-in：改库不影响在跑实验；停 v44 与启 v46 同批（单一实验纪律），
//      重启前持仓确认（卡账本净额口径）。
// 防呆：源必须 stopped；18 卖腿锚定+8 处换算子串各恰一次；买腿 v41 整串锚定；
//   库 v43 cards=3 + early v1 在场；obs 20000 锚定。
// 用法：node scripts/create-v46.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = '5be4c248-1fe3-423f-a26e-9383ae76e451'; // v44 live both（库 v41 快照）

// 顺序敏感：复合串先换；各子串在 18 卖腿全体内恰一次
const REPLACEMENTS = [
  ['marketCap >= 10000 AND marketCap < 20000', 'marketCap >= 13.4 AND marketCap < 27'],
  ['marketCap >= 6000 AND marketCap < 20000', 'marketCap >= 8.1 AND marketCap < 27'],
  ['marketCap >= 20000', 'marketCap >= 27'],
  ['marketCap > 3500 AND marketCap < 4000', 'marketCap > 4.7 AND marketCap < 5.4'],
  ['marketCap < 6000', 'marketCap < 8.1'],
  ['marketCap < 3500', 'marketCap < 4.7'],
  ['marketCap < 5500 AND realHoldDuration > 10',
    'marketCap < 7.4 AND realHoldDuration > 10 AND (entryMarketCap >= 7.4 OR realHoldDuration > 1800)'],
  ['holdDuration > 120 AND buyVolumeBnb < 2',
    'holdDuration > 120 AND buyVolumeBnb < 2 AND (entryMarketCap >= 7.4 OR realHoldDuration > 1800)'],
];
// v44 买腿锚定（整串，防源漂移）
const BUY_V41_ANCHOR_SEG = ['marketCap > 3500', 'marketCap < 20000', 'tradesNetBuyRatio >= 40',
  'top3BundleClusterHoldCircPct < 75', 'sybilClusterHolderCircPct < 35'];

const ARM_LEG_TMPL = {
  condition: '',
  cards: 'all',
  priority: 0,
  cooldownSec: null,
  bypassDebounce: false,
};

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(SRC);
  if (!src) throw new Error('源实验不存在: ' + SRC);
  if (src.status !== 'stopped') throw new Error('源实验未停止: ' + src.status + '（停 v44 与建 v46 同批）');
  const cfg = JSON.parse(JSON.stringify(src.config));
  if (cfg.platform !== 'both') throw new Error('源 platform != both: ' + cfg.platform);
  if (cfg.virtual !== undefined) throw new Error('源带 virtual 段（应为 live）');
  if (!cfg.wallet?.executorId) throw new Error('源 wallet.executorId 缺失');
  const buys = cfg.strategiesConfig?.buyStrategies || [];
  const sells = cfg.strategiesConfig?.sellStrategies || [];
  if (buys.length !== 1) throw new Error('源买腿数=' + buys.length + ' 期望 1');
  if (sells.length !== 18) throw new Error('源卖腿数=' + sells.length + ' 期望 18');
  if (!(cfg.positionManagement?.perCardBNB > 0)) throw new Error('源 perCardBNB 缺失');
  for (const seg of BUY_V41_ANCHOR_SEG) {
    if (!buys[0].condition.includes(seg)) throw new Error('源买腿缺锚定子串: ' + seg);
  }
  if (buys[0].cards !== 4) throw new Error('源买腿 cards=' + buys[0].cards + ' 期望 4');

  // ── ① 买腿重建 ← 库 v43 + early v1 copy-in ──
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const mainEntry = list.find(e => e.name === 'buy-v2');
  if (!mainEntry || mainEntry.version !== 43) throw new Error('库 buy-v2 version=' + (mainEntry && mainEntry.version) + ' 期望 43');
  const earlyEntry = list.find(e => e.name === 'buy-early-narrative');
  if (!earlyEntry || earlyEntry.version !== 1) throw new Error('库 buy-early-narrative 缺失/版本≠1（先跑 create-buy-early-narrative-v1.cjs --commit）');
  const mainFull = await svc.getById(mainEntry.id);
  const earlyFull = await svc.getById(earlyEntry.id);
  const mainLeg = (mainFull.legs.legs || mainFull.legs)[0];
  const earlyLeg = (earlyFull.legs.legs || earlyFull.legs)[0];
  if (mainLeg.cards !== 3 || earlyLeg.cards !== 3) throw new Error('库两买腿 cards 非 3+3（6 卡制未同批）');
  if (!mainLeg.condition.includes('marketCap > 4.7') || !mainLeg.condition.includes('marketCap < 27')) {
    throw new Error('库 v43 非 BNB 域形状: ' + mainLeg.condition);
  }
  if (!earlyLeg.condition.includes('marketCap > 6.0') || !earlyLeg.condition.includes('marketCap < 6.7')) {
    throw new Error('early v1 非 6.0-6.7 带: ' + earlyLeg.condition);
  }
  cfg.strategiesConfig.buyStrategies = [mainLeg, earlyLeg];

  // ── ② 卖腿换算 + 追加三条早期臂专属腿 ──
  const allCond = () => sells.map(l => l.condition).join('\n');
  for (const [oldS] of REPLACEMENTS) {
    const n = allCond().split(oldS).length - 1;
    if (n !== 1) throw new Error(`换算子串非恰一次(${n}): ${oldS}`);
  }
  for (const leg of sells) {
    for (const [oldS, newS] of REPLACEMENTS) {
      if (leg.condition.includes(oldS)) leg.condition = leg.condition.split(oldS).join(newS);
    }
  }
  // R7/R8 注入后恰 2 腿带豁免臂（T79 地板+衰竭）；多/少=源形状漂移
  const exemptN = sells.filter(l => l.condition.includes('entryMarketCap')).length;
  if (exemptN !== 2) throw new Error(`换算后带 entryMarketCap 的卖腿数=${exemptN}，期望 2（T79 地板+衰竭）`);
  sells.push(
    { ...JSON.parse(JSON.stringify(ARM_LEG_TMPL)), priority: 12,
      condition: 'entryMarketCap < 7.4 AND marketCap >= 27',
      description: 'T84 早期臂上位离场：入场市值 <7.4 的仓涨到 27 BNB 全清（回放 mcap_exit 20000 USD→27 BNB；4 票 +318~338% 全此出场）' },
    { ...JSON.parse(JSON.stringify(ARM_LEG_TMPL)), priority: 13,
      condition: 'entryMarketCap < 7.4 AND peakProfitPct >= 20 AND profitPercent <= 0',
      description: 'T84 早期臂 protect20：曾 +20% 回落到成本全清（回放 protect 截断阴跌，v1→v2 损耗 -0.0260→-0.0021）' },
    { ...JSON.parse(JSON.stringify(ARM_LEG_TMPL)), priority: 14,
      condition: 'entryMarketCap < 7.4 AND holdDuration > 600 AND profitPercent <= 0',
      description: 'T84 早期臂 600s 止损：10min 仍无利润全清（回放 stop600>stop900；41 票止损 -0.0139=最大可控损耗位）' },
  );

  // ── ③ libraryRefs：buy-v2 41→43 + 增 buy-early-narrative 1；rug-exit 不动 ──
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (!buyRef || buyRef.version !== 41) throw new Error('libraryRefs buy-v2 version=' + (buyRef && buyRef.version) + ' 期望 41');
  if (!refs.find(r => r.name === 'rug-exit-account-arm')) throw new Error('libraryRefs 缺 rug-exit-account-arm');
  buyRef.version = 43;
  buyRef.snapshotAt = new Date().toISOString();
  refs.push({ name: 'buy-early-narrative', side: 'buy', libId: earlyEntry.id, version: 1, legCount: 1, snapshotAt: new Date().toISOString() });

  // ── ④ 观察信号显式阈值换算（v44 带 20000 USD → 27 BNB）──
  const obs = cfg.fourmemeWs?.observationSignals;
  if (obs && obs.marketCapThreshold === 20000) obs.marketCapThreshold = 27;
  else if (obs && obs.marketCapThreshold != null) throw new Error('obs marketCapThreshold=' + obs.marketCapThreshold + ' 非 20000 锚定形状（先核对谱系）');

  cfg.name = 'v46-实盘-both-早期叙事臂-BNB市值-1028';
  cfg.description = 'T84 双臂+量纲切换（克隆 v44 5be4c248）：①买腿=buy-v2 v43（BNB 带 4.7-27，'
    + 'cards 4→3）+ buy-early-narrative v1（早期叙事臂 6.0-6.7 BNB 带+600s 窗+rating 2|3+承接门'
    + '放松版+净买门 40+坏人门全保留，cards 3；回放 8d 119 票 +0.0328 胜率 18%）共 6 卡；'
    + '②市值全域 USD→BNB（FA marketCap=priceBnb×totalSupply；bnbUsd≈745 换算）；③卖腿 18→21：'
    + 'T79 地板/衰竭腿加 entryMarketCap 豁免（早期仓免 10s 冻结/120s 误杀，1800s 地板回归）+'
    + '早期臂专属 27 上位离场/protect20/600s 止损三腿；④观察信号阈值 20000→27。'
    + '代码须含 T84 commit（FA BNB 域+entryMarketCap 键）。源=v44 5be4c248';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB,
    '| buys:', cfg.strategiesConfig.buyStrategies.length, '| sells:', sells.length);
  console.log('buy[0] (v43):', cfg.strategiesConfig.buyStrategies[0].condition.slice(0, 120) + '…');
  console.log('buy[1] (early):', cfg.strategiesConfig.buyStrategies[1].condition.slice(0, 120) + '…');
  console.log('--- 换算后含 marketCap/entryMarketCap 的卖腿:');
  for (const l of sells) {
    if (l.condition.includes('arketCap')) console.log(`    [prio ${l.priority}] ${l.condition}`);
  }
  console.log('libraryRefs:', JSON.stringify(refs));
  console.log('obs:', JSON.stringify(cfg.fourmemeWs?.observationSignals || null));
  console.log('wallet:', JSON.stringify(cfg.wallet));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V46_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
