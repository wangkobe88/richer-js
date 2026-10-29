#!/usr/bin/env node
// ============================================================================
// 建 v59 live both 实验（2026-10-29 T100 首买/再买分臂换车）
//   克隆 v58 12ef2c48（T99 拱形回撤版：buy-v2 v50 + early v10 + 24 卖腿快照）。
//   本批唯一 config 变量：买腿 2→3——
//     ①主腿（buy-v2）加 buyPhase:'first'（库 v51 同款，仅首买轮可见）
//     ②尾部 push 再买腿（buy-v2-repeat v1 快照：GMGN 删 issuer 分档臂 +
//       buyPhase:'repeat' + maxExecutions=1，priority=1 压过 early P2 防快票
//       再买轮被带 issuer 门的 early 臂遮蔽）
//   early 腿/24 卖腿（含 T99 拱形）/其余 config 与 v58 逐字一致（不覆盖
//   中途上的改进）。
//   ⚠️ 前置：create-buy-v2-repeat.cjs --commit 已跑（库 v51/v1 已存在）。
// 防呆：源必须 stopped + 买腿 T98/T96/T95/T93 形状 + 主腿无 buyPhase 残留 +
//   卖 24（T97/T80/T99 拱形腿在场）+ 再买腿五重锚定（gmgn 全串/buyPhase/
//   maxExecutions/priority/cards）+ 插后买 3 + refs v50→v51/v1。
// 用法：node scripts/create-v59.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = '12ef2c48-3bf5-45cb-a874-6b87f5433190'; // v58 live both（T99 拱形版）

const GMGN_REPEAT = '(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 100)';
const GMGN_V50 = "(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 100) AND ((narrativeCategory IS NULL OR (narrativeCategory != 'project' AND narrativeCategory != 'account_based_meme' AND narrativeCategory != 'web3_native_ip_early')) OR gmgnIssuerTokenCount <= 1)";

async function main() {
  const argSrc = process.argv.find(a => a.startsWith('--src='));
  const srcId = argSrc ? argSrc.slice(6) : SRC;
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(srcId);
  if (!src) throw new Error('源实验不存在: ' + srcId);
  if (COMMIT && src.status !== 'stopped') {
    throw new Error('--commit 须先停 v58（单一实验纪律+停前持仓确认）；当前 status=' + src.status);
  }
  if (src.status === 'stopped') console.log('注: 源已 stopped');
  const cfg = JSON.parse(JSON.stringify(src.config));
  if (cfg.platform !== 'both') throw new Error('源 platform != both: ' + cfg.platform);
  if (cfg.virtual !== undefined) throw new Error('源带 virtual 段（应为 live）');
  if (!cfg.wallet?.executorId) throw new Error('源 wallet.executorId 缺失');
  const buys = cfg.strategiesConfig?.buyStrategies || [];
  const sells = cfg.strategiesConfig?.sellStrategies || [];
  if (buys.length !== 2) throw new Error('源买腿数=' + buys.length + ' 期望 2（主腿+早期臂）');
  if (sells.length !== 24) throw new Error('源卖腿数=' + sells.length + ' 期望 24（T99 拱形版）');

  // ── 买腿形状锚定（v58=T99 拱形版快照，买腿与 v56 逐字一致）──
  for (const [i, leg] of buys.entries()) {
    if (leg.buyPhase != null) throw new Error('买腿[' + i + '] 已带 buyPhase=' + JSON.stringify(leg.buyPhase) + '（勿重复分臂）');
    if (leg.maxExecutions !== 2) throw new Error('买腿[' + i + '] maxExecutions=' + JSON.stringify(leg.maxExecutions) + ' 期望 2');
    if (!leg.condition.includes('holdersExDust')) throw new Error('买腿[' + i + '] 缺 T98 holdersExDust 人气段');
    if (!leg.condition.includes('(tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40)')) {
      throw new Error('买腿[' + i + '] 缺 T96 AND 净买门');
    }
  }
  if (buys[0].priority !== 1) throw new Error('主腿 priority=' + buys[0].priority + ' 期望 1');
  if (buys[0].gmgnCheckCondition !== GMGN_V50) throw new Error('主腿 gmgn 非 v50 全串形状');
  if (buys[0].condition.includes('marketCap > 4.7') !== true) throw new Error('主腿非 v50 BNB 形状');
  if (buys[0].condition.includes('(buyVolumeBnb >= 1.25 AND holdersExDust >= 10)') !== true) throw new Error('主腿缺 T98 人气段 1.25/10');
  if (buys[1].priority !== 2) throw new Error('早期腿 priority=' + buys[1].priority + ' 期望 2');
  if (!buys[1].condition.includes('tokenAgeSec < 600')) throw new Error('早期腿缺 600s 段');

  // ── 卖腿锚定（T97+T80+T99 拱形在场，本批不动）──
  if (!sells.some(s => (s.condition || '').includes('secSincePeak > 60'))) throw new Error('T97 secSincePeak 卖腿不在场');
  if (!sells.some(s => (s.condition || '').includes('drawdownFromHighestSinceLastBuy <= -15'))) throw new Error('T80 回撤锁盈腿不在场');
  if (!sells.some(s => (s.condition || '').includes('drawdownFromHighestSinceLastBuy <= -25'))) throw new Error('T99 拱形 -25 卖腿不在场');

  // ── 从库拉 buy-v2-repeat v1 快照（copy-in 单一真相源）──
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const repEntry = list.find((e) => e.name === 'buy-v2-repeat');
  if (!repEntry) throw new Error('库中无 buy-v2-repeat（先跑 create-buy-v2-repeat.cjs --commit）');
  if (repEntry.version !== 1) throw new Error('buy-v2-repeat version=' + repEntry.version + ' 期望 1');
  const repFull = await svc.getById(repEntry.id);
  const repLegs = repFull.legs.legs || repFull.legs;
  if (repLegs.length !== 1) throw new Error('buy-v2-repeat 腿数=' + repLegs.length + ' 期望 1');
  const repLeg = repLegs[0];
  // 五重锚定（库快照形状锁定）
  if (repLeg.gmgnCheckCondition !== GMGN_REPEAT) throw new Error('再买腿 gmgn 非删臂版全串');
  if (repLeg.gmgnCheckCondition.includes('gmgnIssuerTokenCount')) throw new Error('再买腿 gmgn 残留 issuer 门');
  if (repLeg.buyPhase !== 'repeat') throw new Error('再买腿 buyPhase=' + JSON.stringify(repLeg.buyPhase) + " 期望 'repeat'");
  if (repLeg.maxExecutions !== 1) throw new Error('再买腿 maxExecutions=' + JSON.stringify(repLeg.maxExecutions) + ' 期望 1');
  if (repLeg.priority !== 1) throw new Error('再买腿 priority=' + repLeg.priority + ' 期望 1（压过 early P2 防快票遮蔽）');
  if (repLeg.cards !== 3) throw new Error('再买腿 cards=' + repLeg.cards + ' 期望 3');
  if (repLeg.condition !== buys[0].condition) throw new Error('再买腿主 condition 与首买臂不一致（用户裁定表达式跟首买一致）');
  if (repLeg.narrativeTriggerCondition !== buys[0].narrativeTriggerCondition) throw new Error('再买腿 trigger 与首买臂不一致');

  // ── 改装：主腿加 first 标记 + 尾插再买腿 ──
  buys[0].buyPhase = 'first';
  buys.push(JSON.parse(JSON.stringify(repLeg)));
  if (buys.length !== 3) throw new Error('改装后买腿数=' + buys.length + ' 期望 3');
  if (buys[1].buyPhase != null) throw new Error('early 腿被误改（应无 buyPhase）');

  // ── libraryRefs：buy-v2 50→51 + 追加 buy-v2-repeat:1 ──
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  const v2ref = refs.find(r => r.name === 'buy-v2');
  if (!v2ref) throw new Error('libraryRefs 缺 buy-v2');
  if (v2ref.version !== 50) throw new Error('libraryRefs buy-v2 version=' + v2ref.version + ' 期望 50');
  v2ref.version = 51;
  v2ref.snapshotAt = new Date().toISOString();
  refs.push({ libId: repEntry.id, name: 'buy-v2-repeat', side: 'buy', version: 1, legCount: 1, snapshotAt: new Date().toISOString() });

  cfg.name = 'v59-实盘-both-首买再买分臂-1029';
  cfg.description = 'v58 12ef2c48（T99 拱形回撤版）+ T100 首买/再买分臂：主腿 buy-v2 v51 加'
    + " buyPhase:'first'（仅首买轮可见，issuer 分档门保留——该时点 GMGN 计数干净）；"
    + '尾插 buy-v2-repeat v1（buyPhase:\'repeat\' 仅全清后可见，GMGN 删 issuer 分档臂'
    + ' + maxExecutions=1，priority=1 压过 early P2 防快票再买轮被遮蔽）。案件=Sprout '
    + '0x3319…7777 借壳案（借壳者 13 秒 4 钱包同 meta CID 连环发币污染推特维度发币计数，'
    + '二次入场误拦；用户裁定首买过滤保留、再买轮删该臂）。early v10/24 卖腿（含 T99 '
    + '拱形）/其余 config 与 v58 逐字一致。源=v58 12ef2c48。详档 docs/交易策略改进与Case台账.md T100';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| buys:', buys.length, '| sells:', sells.length);
  console.log('buy[0]: P' + buys[0].priority + ' buyPhase=' + buys[0].buyPhase + ' maxEx=' + buys[0].maxExecutions + ' cond=' + buys[0].condition.slice(0, 60) + '…');
  console.log('buy[1]: P' + buys[1].priority + ' buyPhase=' + buys[1].buyPhase + '（early 不动）');
  console.log('buy[2]: P' + buys[2].priority + ' buyPhase=' + buys[2].buyPhase + ' maxEx=' + buys[2].maxExecutions + ' gmgn=' + buys[2].gmgnCheckCondition);
  console.log('libraryRefs:', JSON.stringify(refs.map(r => r.name + ':' + r.version)));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V59_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
