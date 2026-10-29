#!/usr/bin/env node
// ============================================================================
// 建 v61 live both 实验（2026-10-29 T102 低评级强势独立臂换车）
//   克隆 v60 c53a703a（T101 再买腰斩门版：buy-v2 v51·first + early v10 +
//   buy-v2-repeat v2·repeat + 24 卖腿快照）。
//   本批唯一 config 变量：买腿 3→4——追加 buy-v2-momentum v1 腿（rating==1
//   强势票专用镜像臂：评级门换向 + buyWallets>=40 动量门 + tokenAgeSec<600
//   快窗 + maxEx 1；Ragu 0xf1dc…7777 案，用户裁定「给 rating==1 但强势的票
//   一个单独的买入臂」）。主腿/early/再买腿/24 卖腿/其余 config 与 v60 逐字
//   一致；momentum 腿与主臂 rating 门互斥=同票零竞争（buyPhase=first 同级）。
//   ⚠️ 前置：create-buy-v2-momentum.cjs --commit 已跑（库 v1 已存在）。
// 防呆：源必须 stopped + 买 3 腿形状（first/null/repeat·v2 区间段）+ 源无
//   momentum 腿 + 库 v1 七重锚定（version/buyPhase/maxEx/priority/cards/
//   评级段+动量段+快窗段在/gmgn 含 issuer 臂全串/trigger 串）+ 追加后源三腿
//   逐字不动 + refs 四条不动仅加 buy-v2-momentum:1。
// 用法：node scripts/create-v61.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = 'c53a703a-5b9a-4c03-a874-64e3f65fd6f8'; // v60 live both（T101 再买腰斩门版）

const GMGN_MOMENTUM = "(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 100) AND ((narrativeCategory IS NULL OR (narrativeCategory != 'project' AND narrativeCategory != 'account_based_meme' AND narrativeCategory != 'web3_native_ip_early')) OR gmgnIssuerTokenCount <= 1)";
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';
const NEW_DD_SEG = '(drawdownFromHighest > -70 AND drawdownFromHighest < -50)';

async function main() {
  const argSrc = process.argv.find(a => a.startsWith('--src='));
  const srcId = argSrc ? argSrc.slice(6) : SRC;
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(srcId);
  if (!src) throw new Error('源实验不存在: ' + srcId);
  if (COMMIT && src.status !== 'stopped') {
    throw new Error('--commit 须先停 v60（单一实验纪律+停前持仓确认）；当前 status=' + src.status);
  }
  if (src.status === 'stopped') console.log('注: 源已 stopped');
  const cfg = JSON.parse(JSON.stringify(src.config));
  if (cfg.platform !== 'both') throw new Error('源 platform != both: ' + cfg.platform);
  if (cfg.virtual !== undefined) throw new Error('源带 virtual 段（应为 live）');
  if (!cfg.wallet?.executorId) throw new Error('源 wallet.executorId 缺失');
  const buys = cfg.strategiesConfig?.buyStrategies || [];
  const sells = cfg.strategiesConfig?.sellStrategies || [];
  if (buys.length !== 3) throw new Error('源买腿数=' + buys.length + ' 期望 3（v60=T100+T101 三臂版）');
  if (sells.length !== 24) throw new Error('源卖腿数=' + sells.length + ' 期望 24');
  if (buys.some(b => (b.condition || '').includes('narrativeRating == 1'))) {
    throw new Error('源已含 momentum 形状腿（rating==1）——勿重复追加');
  }

  // ── 源三腿形状锚定（v60 快照，本批逐字不动）──
  if (buys[0].buyPhase !== 'first') throw new Error('主腿 buyPhase=' + JSON.stringify(buys[0].buyPhase) + " 期望 'first'");
  if (buys[0].priority !== 1) throw new Error('主腿 priority=' + buys[0].priority + ' 期望 1');
  if (!buys[0].condition.includes('holdersExDust')) throw new Error('主腿缺 T98 holdersExDust 人气段');
  if (!buys[0].condition.includes('(tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40)')) {
    throw new Error('主腿缺 T96 AND 净买门');
  }
  if (buys[1].buyPhase != null) throw new Error('early 腿 buyPhase=' + JSON.stringify(buys[1].buyPhase) + ' 期望 null');
  if (buys[1].priority !== 2) throw new Error('早期腿 priority=' + buys[1].priority + ' 期望 2');
  if (!buys[1].condition.includes('tokenAgeSec < 600')) throw new Error('早期腿缺 600s 段');
  if (buys[2].buyPhase !== 'repeat') throw new Error('再买腿 buyPhase=' + JSON.stringify(buys[2].buyPhase) + " 期望 'repeat'");
  if (buys[2].maxExecutions !== 1) throw new Error('再买腿 maxExecutions=' + buys[2].maxExecutions + ' 期望 1');
  if (!buys[2].condition.includes(NEW_DD_SEG)) throw new Error('再买腿非 v2 区间段形状（源应是 v60）');

  // ── 卖腿锚定（T97+T80+T99 拱形在场，本批不动）──
  if (!sells.some(s => (s.condition || '').includes('secSincePeak > 60'))) throw new Error('T97 secSincePeak 卖腿不在场');
  if (!sells.some(s => (s.condition || '').includes('drawdownFromHighestSinceLastBuy <= -15'))) throw new Error('T80 回撤锁盈腿不在场');
  if (!sells.some(s => (s.condition || '').includes('drawdownFromHighestSinceLastBuy <= -25'))) throw new Error('T99 拱形 -25 卖腿不在场');

  // ── 从库拉 buy-v2-momentum v1 快照（copy-in 单一真相源）──
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const momEntry = list.find((e) => e.name === 'buy-v2-momentum');
  if (!momEntry) throw new Error('库中无 buy-v2-momentum（先跑 create-buy-v2-momentum.cjs --commit）');
  if (momEntry.version !== 1) throw new Error('buy-v2-momentum version=' + momEntry.version + ' 期望 1');
  const momFull = await svc.getById(momEntry.id);
  const momLegs = momFull.legs.legs || momFull.legs;
  if (momLegs.length !== 1) throw new Error('buy-v2-momentum 腿数=' + momLegs.length + ' 期望 1');
  const momLeg = momLegs[0];
  // 七重锚定（库 v1 形状锁定）
  if (momLeg.buyPhase !== 'first') throw new Error('momentum 腿 buyPhase=' + JSON.stringify(momLeg.buyPhase) + " 期望 'first'");
  if (momLeg.maxExecutions !== 1) throw new Error('momentum 腿 maxExecutions=' + momLeg.maxExecutions + ' 期望 1（快打一枪）');
  if (momLeg.priority !== 1) throw new Error('momentum 腿 priority=' + momLeg.priority + ' 期望 1');
  if (momLeg.cards !== 3) throw new Error('momentum 腿 cards=' + momLeg.cards + ' 期望 3');
  if (!momLeg.condition.includes('narrativeRating == 1')) throw new Error('momentum 腿缺评级门 rating==1');
  if (momLeg.condition.includes('(narrativeRating == 2 OR narrativeRating == 3)')) throw new Error('momentum 腿残留 rating 2|3 主臂段');
  if (!momLeg.condition.includes('buyWallets >= 40')) throw new Error('momentum 腿缺动量门 buyWallets>=40');
  if (!momLeg.condition.includes('tokenAgeSec < 600')) throw new Error('momentum 腿缺快窗上限 600s');
  if (momLeg.gmgnCheckCondition !== GMGN_MOMENTUM) throw new Error('momentum 腿 gmgn 非 v51 含 issuer 臂形状');
  if (momLeg.narrativeTriggerCondition !== TRIGGER_EXPECT) throw new Error('momentum 腿 trigger 形状非预期');

  // ── 改装：只追加 momentum 腿（源三腿逐字不动）──
  const srcConds = buys.map((b) => JSON.stringify(b));
  buys.push(JSON.parse(JSON.stringify(momLeg)));
  if (buys.length !== 4) throw new Error('改装后买腿数=' + buys.length + ' 期望 4');
  buys.slice(0, 3).forEach((b, i) => {
    if (JSON.stringify(b) !== srcConds[i]) throw new Error('源腿[' + i + ']被误改');
  });

  // ── libraryRefs：四条不动 + 加 buy-v2-momentum:1 ──
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  if (refs.some(r => r.name === 'buy-v2-momentum')) throw new Error('libraryRefs 已含 buy-v2-momentum（勿重复）');
  const v2ref = refs.find(r => r.name === 'buy-v2');
  if (!v2ref || v2ref.version !== 51) throw new Error('libraryRefs buy-v2 非 51');
  const repRef = refs.find(r => r.name === 'buy-v2-repeat');
  if (!repRef || repRef.version !== 2) throw new Error('libraryRefs buy-v2-repeat 非 2');
  const earlyRef = refs.find(r => r.name === 'buy-early-narrative');
  if (!earlyRef || earlyRef.version !== 10) throw new Error('libraryRefs buy-early-narrative 非 10');
  refs.push({ name: 'buy-v2-momentum', version: 1, snapshotAt: new Date().toISOString() });

  cfg.name = 'v61-实盘-both-低评级强势臂-1029';
  cfg.description = 'v60 c53a703a（T101 再买腰斩门版）+ T102 低评级强势独立臂：买腿 3→4'
    + '——追加 buy-v2-momentum v1（rating==1 强势票专用：评级门换向 narrativeRating == 1 '
    + '+ 动量门 buyWallets >= 40 + 快窗 tokenAgeSec < 600 + maxEx 1；与主臂 rating 2|3 '
    + '互斥=同票零竞争，集中度/人气/净买/崩盘/GMGN 含 issuer 臂逐字同 v51=作弊票防线不变）。'
    + '案由 Ragu 0xf1dc…7777（BNB Chain 员工蓝V gm 狗推 rating=1 被 web3FitMassBlock '
    + '品味否决，61s 6.7x、71 钱包/60s top1 8% 净买+51% 干净用户盘被拦）；7 天回放 8415 票'
    + '（182 跑）本臂形状 134 fire 峰30min ≥3x 13%/≥2x 31% 与 rating 2|3 对照同质。'
    + '用户裁定 2026-10-29：快速交易目标函数=非作弊+用户增长+峰值高。'
    + '主腿 v51·first/early v10/再买 v2·repeat/24 卖腿/其余 config 与 v60 逐字一致。'
    + '源=v60 c53a703a。详档 docs/交易策略改进与Case台账.md T102';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| buys:', buys.length, '| sells:', sells.length);
  console.log('buy[0]: P' + buys[0].priority + ' buyPhase=' + buys[0].buyPhase + '（first 不动）');
  console.log('buy[1]: P' + buys[1].priority + '（early 不动）');
  console.log('buy[2]: P' + buys[2].priority + ' buyPhase=' + buys[2].buyPhase + ' maxEx=' + buys[2].maxExecutions + '（repeat 不动）');
  console.log('buy[3]: P' + buys[3].priority + ' buyPhase=' + buys[3].buyPhase + ' maxEx=' + buys[3].maxExecutions + '（momentum 新增）');
  console.log('buy[3] 评级段:', buys[3].condition.includes('narrativeRating == 1') ? 'rating==1 ✓' : '(MISS)');
  console.log('libraryRefs:', JSON.stringify(refs.map(r => r.name + ':' + r.version)));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V61_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
