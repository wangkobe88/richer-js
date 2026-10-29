#!/usr/bin/env node
// ============================================================================
// 建 v63 live both 实验（2026-10-29 T103 再买腰斩 -40 + T104 流动性止损 10s + 撤 T102 momentum 臂）
//   克隆 v61 5298b7bd（T102 momentum 版：buy-v2 v51·first + early v10 +
//   buy-v2-repeat v2·repeat + buy-v2-momentum v1 + 24 卖腿快照）。
//   本批三个 config 变量：
//   ① T103 再买腿 v2 → v3——区间 (drawdownFromHighest) (-70,-50) → (-70,-40)
//      （案由 날다람쥐 0x5ca9…7777：卖出后最深 -45.2% 未过 -50 门，随后 +230%
//      拉升零再买；用户裁定 2026-10-29 放宽）。
//   ② T104 stallClose 流动性止损：持仓票距上一笔链上成交（FA lastTickAt）
//      >10s 全部清仓（bypass 立即路径 + lockTokenAfterSell=false 放行再买臂
//      接回；近 8 天 199 live round 回放净 +0.077 BNB/8d；用户裁定「一个票
//      没流动性了就是要赶紧跑」）。
//   ③ 撤 T102 buy-v2-momentum 臂（4 买腿 → 3）：用户 2026-10-29 指令「帮忙把
//      叙事分析不通过的强势票臂给下了吧，看了一下新实验，亏的有点惨，再看看」。
//      v61 实跑核查（rating 归属）：momentum 臂 7 round +0.0106（docusaurus 两轮
//      +80%/+107% 贡献）、rated 臂 rating=3 的 7 笔全亏 -0.0107——亏损集中在
//      rated 臂；撤 momentum 臂按指令执行，库条目留档随时可复挂。
//   主腿/early/24 卖腿/其余 config 与 v61 逐字一致（唯再买腿换串+撤腿+新增 stallClose 段）。
//   ⚠️ 前置：bump-t103-repeat-drawdown-40.cjs --commit 已跑（库 v3 已存在）。
// 防呆：源必须 stopped + 买 4 腿形状（first/null/repeat·v2 区间段/momentum）
//   + 库 v3 锚定（version/buyPhase/maxEx/新区间段在+旧段无/trigger/gmgn/
//   全门锚定）+ 除 condition 外库腿与源再买腿逐字一致（只许换条件串）
//   + 主腿/early 两腿逐字不动 + momentum 腿恰被移除（新实验 3 买腿）
//   + refs 仅 buy-v2-repeat 2→3 且 momentum 条目移除（4→3）
//   + 源无 stallClose 段、新实验恰 { stallMs: 10000 }。
// 用法：node scripts/create-v63.cjs [--commit]   （在 182 跑）
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

  // ── 改装①：只换再买腿 condition（主腿/early 逐字不动）──
  const srcConds = buys.map((b) => JSON.stringify(b));
  buys[2].condition = repLeg.condition;
  if (!buys[2].condition.includes(NEW_DD_SEG)) throw new Error('改装后再买腿缺新区间段');
  if (JSON.stringify(buys[0]) !== srcConds[0]) throw new Error('主腿[0]被误改');
  if (JSON.stringify(buys[1]) !== srcConds[1]) throw new Error('早期腿[1]被误改');

  // ── 改装②：撤 T102 momentum 臂（用户 2026-10-29 指令；库条目留档随时可复挂）──
  if (buys[3].buyPhase !== 'first' || !buys[3].condition.includes('narrativeRating == 1')) {
    throw new Error('源腿[3]非 momentum 形状（rating==1 门缺失，源应是 v61）');
  }
  buys.splice(3, 1);
  if (buys.length !== 3) throw new Error('撤腿后买腿数=' + buys.length + ' 期望 3');

  // ── libraryRefs：仅 buy-v2-repeat 2→3 + momentum 条目移除（4→3）──
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  const v2ref = refs.find(r => r.name === 'buy-v2');
  if (!v2ref || v2ref.version !== 51) throw new Error('libraryRefs buy-v2 非 51');
  const repRef = refs.find(r => r.name === 'buy-v2-repeat');
  if (!repRef || repRef.version !== 2) throw new Error('libraryRefs buy-v2-repeat 非 2（源应是 v61）');
  const earlyRef = refs.find(r => r.name === 'buy-early-narrative');
  if (!earlyRef || earlyRef.version !== 10) throw new Error('libraryRefs buy-early-narrative 非 10');
  const momIdx = refs.findIndex(r => r.name === 'buy-v2-momentum');
  if (momIdx === -1 || refs[momIdx].version !== 1) throw new Error('libraryRefs buy-v2-momentum 非 1（源应是 v61）');
  refs.splice(momIdx, 1);
  if (refs.length !== 3) throw new Error('refs 移除 momentum 后条数=' + refs.length + ' 期望 3');
  repRef.version = 3;
  repRef.snapshotAt = new Date().toISOString();

  // ── T104 流动性止损：注入 stallClose 段（源 v61 无此段=机制关闭）──
  if (cfg.stallClose !== undefined) throw new Error('源已带 stallClose 段（源应是 v61=机制关闭）');
  cfg.stallClose = { stallMs: 10000 };

  cfg.name = 'v63-实盘-both-再买腰斩40-流动性止损10s-撤momentum-1029';
  cfg.description = 'v61 5298b7bd（T102 momentum 版）+ ①T103 再买腰斩门放宽：再买腿 buy-v2-repeat v2→v3'
    + '——drawdownFromHighest 区间 (-70,-50) → (-70,-40)，其余门逐字不动'
    + '（下界 -70 接刀门/口径=任意接受价轨全时峰回撤/清仓后可评估/无最高价 fail-closed 均不变）。'
    + '案由 날다람쥐 0x5ca91444…7777（v60 12:08:26 首买 3 卡 12:09:50 全清；卖出后最深回撤 -45.2% '
    + '未过 -50 门 → 12:10-12:23 拉升至全时峰 +230% 零再买；-40~-50 浅腰斩 rebound 形状实存）。'
    + '②T104 流动性止损 stallClose={stallMs:10000}：持仓票距上一笔链上成交（FA lastTickAt，'
    + '非尘 tick 口径）>10s 全部清仓（1s 扫描/bypass 立即路径/lockTokenAfterSell=false 放行再买臂接回）。'
    + '近 8 天 199 live round 回放：触发 66%、净 +0.077 BNB/8d（实际 -0.068 → 模拟 +0.009）；'
    + '代价=大票（峰值≥100%）利润 -21%（10s 空窗非预测信号，价值=截断左尾+资金周转）。'
    + '二次起飞接回面：触发后再涨≥30% 的 37 round 仅 6 个可被再买臂接回（24 个被 T96 净买双窗拦、'
    + '7 个 V 型不回头）。用户裁定 2026-10-29「可以，上吧」「一个票没流动性了就是要赶紧跑」。'
    + '③撤 T102 buy-v2-momentum 臂（4 买腿→3，refs 4→3）：用户指令「帮忙把叙事分析不通过的强势票臂'
    + '给下了吧，看了一下新实验，亏的有点惨」。v61 实跑核查（rating 归属）：momentum 臂 7 round '
    + '+0.0106 BNB（docusaurus 0xc26d…/0x5d9d… 两轮 +80%/+107% 贡献）vs rated 臂 rating=3 的 7 笔全亏 '
    + '-0.0107 BNB——亏损集中在 rated 臂；按指令撤 momentum（库条目留档可复挂）。'
    + '主腿 v51·first/early v10/24 卖腿/其余 config 与 v61 逐字一致（唯再买腿换串+撤腿+新增 stallClose 段）。'
    + '源=v61 5298b7bd。详档 docs/交易策略改进与Case台账.md T103/T104/T102';

  // 改装后终检：stallClose 恰为 10s 档
  if (JSON.stringify(cfg.stallClose) !== JSON.stringify({ stallMs: 10000 })) {
    throw new Error('stallClose 终检失败: ' + JSON.stringify(cfg.stallClose));
  }
  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| buys:', buys.length, '| sells:', sells.length);
  console.log('buy[2]: P' + buys[2].priority + ' buyPhase=' + buys[2].buyPhase + ' maxEx=' + buys[2].maxExecutions + ' 区间段: ' + (buys[2].condition.includes(NEW_DD_SEG) ? '(-70,-40) ✓' : '(MISS)'));
  console.log('stallClose: ' + JSON.stringify(cfg.stallClose) + '（T104 流动性止损 10s）');
  console.log('libraryRefs:', JSON.stringify(refs.map(r => r.name + ':' + r.version)));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V63_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
