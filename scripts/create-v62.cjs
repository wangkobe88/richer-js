#!/usr/bin/env node
// ============================================================================
// 建 v62 live both 实验（2026-10-29 T103 再买腰斩门放宽 -50→-40 换车）
//   克隆 v61 5298b7bd（T102 momentum 版：buy-v2 v51·first + early v10 +
//   buy-v2-repeat v2·repeat + buy-v2-momentum v1 + 24 卖腿快照）。
//   本批唯一 config 变量：再买腿 v2 → v3——区间 (drawdownFromHighest)
//   (-70,-50) → (-70,-40)（案由 날다람쥐 0x5ca9…7777：卖出后最深 -45.2%
//   未过 -50 门，随后 +230% 拉升零再买；用户裁定 2026-10-29 放宽）。
//   主腿/early/momentum/24 卖腿/其余 config 与 v61 逐字一致。
//   ⚠️ 前置：bump-t103-repeat-drawdown-40.cjs --commit 已跑（库 v3 已存在）。
// 防呆：源必须 stopped + 买 4 腿形状（first/null/repeat·v2 区间段/momentum）
//   + 库 v3 锚定（version/buyPhase/maxEx/新区间段在+旧段无/trigger/gmgn/
//   全门锚定）+ 除 condition 外库腿与源再买腿逐字一致（只许换条件串）
//   + 其余三腿逐字不动 + refs 四条仅 buy-v2-repeat 2→3。
// 用法：node scripts/create-v62.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = '5298b7bd-8374-458d-b9e3-c5fe581e681d'; // v61 live both（T102 momentum 版）

const OLD_DD_SEG = '(drawdownFromHighest > -70 AND drawdownFromHighest < -50)';
const NEW_DD_SEG = '(drawdownFromHighest > -70 AND drawdownFromHighest < -40)';
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';
const GMGN_EXPECT = '(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 100)';

// T100 移植的全门锚定（库 v3 腿上仍须恰一次）
const KEEPS = [
  '(tokenAgeSec < 90 OR tradeCount >= 25)',
  'marketCap > 4.7', 'marketCap < 27',
  '(narrativeRating == 2 OR narrativeRating == 3)', 'holderTrendSlope > 0',
  'top2HolderCircPct < 55', 'top1HolderCircPct < 35',
  'maxCopyWalletHolderCircPct < 20', 'famousCopyWalletCircPct < 15',
  '(buyVolumeBnb >= 1.25 AND holdersExDust >= 10)',
  '(tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40)',
  'crashSpeedPctPerSec > -10',
];

async function main() {
  const argSrc = process.argv.find(a => a.startsWith('--src='));
  const srcId = argSrc ? argSrc.slice(6) : SRC;
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(srcId);
  if (!src) throw new Error('源实验不存在: ' + srcId);
  if (COMMIT && src.status !== 'stopped') {
    throw new Error('--commit 须先停 v61（单一实验纪律+停前持仓确认）；当前 status=' + src.status);
  }
  if (src.status === 'stopped') console.log('注: 源已 stopped');
  const cfg = JSON.parse(JSON.stringify(src.config));
  if (cfg.platform !== 'both') throw new Error('源 platform != both: ' + cfg.platform);
  if (cfg.virtual !== undefined) throw new Error('源带 virtual 段（应为 live）');
  if (!cfg.wallet?.executorId) throw new Error('源 wallet.executorId 缺失');
  const buys = cfg.strategiesConfig?.buyStrategies || [];
  const sells = cfg.strategiesConfig?.sellStrategies || [];
  if (buys.length !== 4) throw new Error('源买腿数=' + buys.length + ' 期望 4（v61=T102 四臂版）');
  if (sells.length !== 24) throw new Error('源卖腿数=' + sells.length + ' 期望 24');

  // ── 源四腿形状锚定（v61 快照）──
  if (buys[0].buyPhase !== 'first') throw new Error('主腿 buyPhase=' + JSON.stringify(buys[0].buyPhase) + " 期望 'first'");
  if (buys[0].priority !== 1) throw new Error('主腿 priority=' + buys[0].priority + ' 期望 1');
  if (buys[1].buyPhase != null) throw new Error('early 腿 buyPhase=' + JSON.stringify(buys[1].buyPhase) + ' 期望 null');
  if (buys[1].priority !== 2) throw new Error('早期腿 priority=' + buys[1].priority + ' 期望 2');
  if (buys[2].buyPhase !== 'repeat') throw new Error('再买腿 buyPhase=' + JSON.stringify(buys[2].buyPhase) + " 期望 'repeat'");
  if (buys[2].maxExecutions !== 1) throw new Error('再买腿 maxExecutions=' + buys[2].maxExecutions + ' 期望 1');
  if (!buys[2].condition.includes(OLD_DD_SEG)) throw new Error('源再买腿非 v2 区间段 (-70,-50)（源应是 v61）');
  if (buys[3].buyPhase !== 'first') throw new Error('momentum 腿 buyPhase=' + JSON.stringify(buys[3].buyPhase) + " 期望 'first'");
  if (!buys[3].condition.includes('narrativeRating == 1')) throw new Error('momentum 腿缺评级门 rating==1（源应是 v61）');

  // ── 卖腿锚定（T97+T80+T99 拱形在场，本批不动）──
  if (!sells.some(s => (s.condition || '').includes('secSincePeak > 60'))) throw new Error('T97 secSincePeak 卖腿不在场');
  if (!sells.some(s => (s.condition || '').includes('drawdownFromHighestSinceLastBuy <= -15'))) throw new Error('T80 回撤锁盈腿不在场');
  if (!sells.some(s => (s.condition || '').includes('drawdownFromHighestSinceLastBuy <= -25'))) throw new Error('T99 拱形 -25 卖腿不在场');

  // ── 从库拉 buy-v2-repeat v3 快照（copy-in 单一真相源）──
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const repEntry = list.find((e) => e.name === 'buy-v2-repeat');
  if (!repEntry) throw new Error('库中无 buy-v2-repeat（先跑 bump-t103-repeat-drawdown-40.cjs --commit）');
  if (repEntry.version !== 3) throw new Error('buy-v2-repeat version=' + repEntry.version + ' 期望 3');
  const repFull = await svc.getById(repEntry.id);
  const repLegs = repFull.legs.legs || repFull.legs;
  if (repLegs.length !== 1) throw new Error('buy-v2-repeat 腿数=' + repLegs.length + ' 期望 1');
  const repLeg = repLegs[0];
  // 锚定（库 v3 形状锁定）
  if (repLeg.buyPhase !== 'repeat') throw new Error('库 v3 buyPhase=' + JSON.stringify(repLeg.buyPhase) + " 期望 'repeat'");
  if (repLeg.maxExecutions !== 1) throw new Error('库 v3 maxExecutions=' + repLeg.maxExecutions + ' 期望 1');
  if (!repLeg.condition.includes(NEW_DD_SEG)) throw new Error('库 v3 缺新区间段 (-70,-40)');
  if (repLeg.condition.includes('-50')) throw new Error('库 v3 残留 -50 字样');
  if (repLeg.narrativeTriggerCondition !== TRIGGER_EXPECT) throw new Error('库 v3 trigger 形状非预期');
  if (repLeg.gmgnCheckCondition !== GMGN_EXPECT) throw new Error('库 v3 gmgn 非 T100 删 issuer 臂形状');
  for (const seg of KEEPS) {
    if (repLeg.condition.split(seg).length !== 2) throw new Error('库 v3 防误伤锚定子串非恰一次: ' + seg);
  }
  // 库腿除 condition 外与源再买腿逐字一致（本批只许换条件串）
  const srcRep = buys[2];
  const libStrip = { ...repLeg }; delete libStrip.condition;
  const srcStrip = { ...srcRep }; delete srcStrip.condition;
  if (JSON.stringify(libStrip) !== JSON.stringify(srcStrip)) {
    throw new Error('库 v3 腿除 condition 外与源再买腿不一致：lib=' + JSON.stringify(libStrip) + ' src=' + JSON.stringify(srcStrip));
  }

  // ── 改装：只换再买腿 condition（其余三腿逐字不动）──
  const srcConds = buys.map((b) => JSON.stringify(b));
  buys[2].condition = repLeg.condition;
  if (!buys[2].condition.includes(NEW_DD_SEG)) throw new Error('改装后再买腿缺新区间段');
  buys.forEach((b, i) => {
    if (i === 2) return;
    if (JSON.stringify(b) !== srcConds[i]) throw new Error('源腿[' + i + ']被误改');
  });

  // ── libraryRefs：四条仅 buy-v2-repeat 2→3 ──
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  const v2ref = refs.find(r => r.name === 'buy-v2');
  if (!v2ref || v2ref.version !== 51) throw new Error('libraryRefs buy-v2 非 51');
  const repRef = refs.find(r => r.name === 'buy-v2-repeat');
  if (!repRef || repRef.version !== 2) throw new Error('libraryRefs buy-v2-repeat 非 2（源应是 v61）');
  const earlyRef = refs.find(r => r.name === 'buy-early-narrative');
  if (!earlyRef || earlyRef.version !== 10) throw new Error('libraryRefs buy-early-narrative 非 10');
  const momRef = refs.find(r => r.name === 'buy-v2-momentum');
  if (!momRef || momRef.version !== 1) throw new Error('libraryRefs buy-v2-momentum 非 1');
  repRef.version = 3;
  repRef.snapshotAt = new Date().toISOString();

  cfg.name = 'v62-实盘-both-再买腰斩40-1029';
  cfg.description = 'v61 5298b7bd（T102 momentum 版）+ T103 再买腰斩门放宽：再买腿 buy-v2-repeat v2→v3'
    + '——drawdownFromHighest 区间 (-70,-50) → (-70,-40)，其余门逐字不动'
    + '（下界 -70 接刀门/口径=任意接受价轨全时峰回撤/清仓后可评估/无最高价 fail-closed 均不变）。'
    + '案由 날다람쥐 0x5ca91444…7777（v60 12:08:26 首买 3 卡 12:09:50 全清；卖出后最深回撤 -45.2% '
    + '未过 -50 门 → 12:10-12:23 拉升至全时峰 +230% 零再买；-40~-50 浅腰斩 rebound 形状实存）。'
    + '用户裁定 2026-10-29 放宽上界至 -40。'
    + '主腿 v51·first/early v10/momentum v1/24 卖腿/其余 config 与 v61 逐字一致。'
    + '源=v61 5298b7bd。详档 docs/交易策略改进与Case台账.md T103';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| buys:', buys.length, '| sells:', sells.length);
  console.log('buy[2]: P' + buys[2].priority + ' buyPhase=' + buys[2].buyPhase + ' maxEx=' + buys[2].maxExecutions + ' 区间段: ' + (buys[2].condition.includes(NEW_DD_SEG) ? '(-70,-40) ✓' : '(MISS)'));
  console.log('libraryRefs:', JSON.stringify(refs.map(r => r.name + ':' + r.version)));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V62_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
