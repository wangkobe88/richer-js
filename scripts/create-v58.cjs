#!/usr/bin/env node
// ============================================================================
// 建 v58 live both 实验（2026-10-29 T99 修正：-25 两档 all→1 卡）
//   克隆 v57 8774583d（T99 -25 两档版，06:32 UTC 起跑零成交零持仓）。
//   唯一变量：T99 双腿 cards 'all'→1（用户纠正「只是卖一个卡，不是全清」）
//   ——梯队形状修正为三层：
//     T80 -15 减 1 卡（13.4-27，p10）→ T99 -25 减 1 卡（<27 全域，p11）
//     → 拱形 -35 全清（<27 两档，p11 数组序在 T99 后）+ >=27 档 -25 全清
//   max1/cd null 不变（恰卖一次 1 卡，冷却无意义）；dd 回升再落 -25 不重卖
//   （max1 已耗，深跌 -35 全清接管）。其余 24 卖腿/买腿/refs 与 v57 逐字一致。
//   P4 交互更新：低档 <7.4 段 P4（p4 全清）同刻双真仍先评=直接全清，T99
//   减 1 卡在该段被压制（v57 版 all 无差、本版有差=少卖 2 卡，观察点）。
// 防呆：源卖 24 + T99 双腿 cards:'all' 形状反证（找到才能改）+ 改后恰两条
//   cards:1 的 -25 低/中档腿 + T97/T80/拱形/-35 锚定；改后卖仍 24。
// 用法：node scripts/create-v58.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = '8774583d-dd80-4226-9817-b16347245ee4'; // v57 live both（T99 -25 两档）

const T99_CONDS = [
  'peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -25 AND marketCap < 8.1',
  'peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -25 AND marketCap >= 8.1 AND marketCap < 27',
];
const T99_DESC = (band) => 'T99 拱形回撤收紧·' + band + ' -25（2026-10-29 用户指令加两臂+纠正「只是卖一个卡，不是全清」）'
  + '：峰值利润 >=10% 武装 + 距峰回撤 25% 卖 1 卡（cards=1 max1 恰一次，dd 回升再落不重卖）。'
  + '三层梯队：T80 -15 减 1 卡（13.4-27，p10 先评）→ 本腿 -25 减 1 卡（p11）→ 拱形 -35 全清'
  + '（同 priority 数组序在后=深跌兜底）+ >=27 档 -25 全清。SPERM 案（0x0590…7777）动机：'
  + '峰 +43.3% 回撤 -35 首真 05:05:31 → 3.5s+5tick 确认窗 fire 时已 -41.1%；-25 首真 05:05:27'
  + ' 早 4s=确认窗前移。低档 <7.4 段 P4 地板臂（p4 全清）同刻双真先评=直接全清，本腿在该段被压制'
  + '（少卖余 2 卡，观察点）。dd null（未武装/无峰）→ 恒 false fail-closed；'
  + 'marketCap=fire 时刻实时市值（BNB 域，刻意非 peakMarketCapSinceLastBuy）';

async function main() {
  const argSrc = process.argv.find(a => a.startsWith('--src='));
  const srcId = argSrc ? argSrc.slice(6) : SRC;
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(srcId);
  if (!src) throw new Error('源实验不存在: ' + srcId);
  if (COMMIT && src.status !== 'stopped') {
    throw new Error('--commit 须先停 v57；当前 status=' + src.status);
  }
  if (src.status === 'stopped') console.log('注: 源已 stopped');
  const cfg = JSON.parse(JSON.stringify(src.config));
  if (cfg.platform !== 'both') throw new Error('源 platform != both: ' + cfg.platform);
  if (cfg.virtual !== undefined) throw new Error('源带 virtual 段（应为 live）');
  if (!cfg.wallet?.executorId) throw new Error('源 wallet.executorId 缺失');
  const buys = cfg.strategiesConfig?.buyStrategies || [];
  const sells = cfg.strategiesConfig?.sellStrategies || [];
  if (buys.length !== 2) throw new Error('源买腿数=' + buys.length + ' 期望 2');
  if (sells.length !== 24) throw new Error('源卖腿数=' + sells.length + ' 期望 24');

  // ── 买腿形状锚定（T98/T96/T95/T93，与 create-v57 同套）──
  for (const [i, leg] of buys.entries()) {
    for (const bad of ['tradesRouterPct', 'sybilClusterHolderCircPct', 'top2BundleClusterHoldCircPct', 'bundleClusterHoldCircPct <', 'top3BundleClusterHoldCircPct', '(buyVolumeBnb >= 1.25 AND holders >= 10)', '(buyVolumeBnb >= 0.25 AND holders >= 5)']) {
      if (leg.condition.includes(bad)) throw new Error('买腿[' + i + '] 残留旧形状: ' + bad);
    }
    if (!leg.condition.includes('(tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40)')) {
      throw new Error('买腿[' + i + '] 缺 T96 AND 净买门');
    }
    if (!leg.condition.includes('holdersExDust')) throw new Error('买腿[' + i + '] 缺 T98 holdersExDust 人气段');
  }
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  const refMap = Object.fromEntries(refs.map(r => [r.name, r.version]));
  if (refMap['buy-v2'] !== 50 || refMap['buy-early-narrative'] !== 10) throw new Error('refs 形状漂移: ' + JSON.stringify(refMap));
  if (!('rug-exit-account-arm' in refMap)) throw new Error('libraryRefs 缺 rug-exit-account-arm');

  // ── T99 双腿形状反证（cards:'all' 才是 v57 原状）+ 改 1 卡 ──
  const fixed = [];
  for (const cond of T99_CONDS) {
    const idx = sells.findIndex(s => (s.condition || '') === cond);
    if (idx < 0) throw new Error('T99 腿未找到: ' + cond);
    if (sells[idx].cards !== 'all') throw new Error('T99 腿 cards=' + JSON.stringify(sells[idx].cards) + " 期望 'all'（v57 原状反证，防重复改）");
    if (sells[idx].maxExecutions !== 1 || sells[idx].priority !== 11) throw new Error('T99 腿参数漂移: ' + JSON.stringify({ p: sells[idx].priority, maxEx: sells[idx].maxExecutions }));
    sells[idx].cards = 1;
    const band = cond.includes('marketCap >= 8.1') ? '中市值档' : '低市值档';
    sells[idx].description = T99_DESC(band);
    fixed.push(idx);
  }
  if (sells.filter(s => T99_CONDS.includes(s.condition || '')).length !== 2) throw new Error('T99 -25 低/中档腿数 != 2');
  if (sells.filter(s => T99_CONDS.includes(s.condition || '') && s.cards === 1).length !== 2) throw new Error('改后 cards:1 的 T99 腿 != 2');

  // ── 承继锚定：T97/T80/拱形 -35 两档 + >=27 档 -25 ──
  if (!sells.some(s => (s.condition || '').includes('secSincePeak > 60') && s.cards === 1 && s.priority === 10)) throw new Error('T97 腿未找到');
  if (!sells.some(s => (s.condition || '').includes('drawdownFromHighestSinceLastBuy <= -15') && s.cards === 1 && s.priority === 10)) throw new Error('T80 腿未找到');
  if (sells.filter(s => (s.condition || '').includes('drawdownFromHighestSinceLastBuy <= -35')).length !== 2) throw new Error('拱形 -35 两档 != 2');
  if (!sells.some(s => (s.condition || '') === 'peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -25 AND marketCap >= 27')) throw new Error('>=27 档 -25 腿未找到');

  cfg.name = 'v58-实盘-both-拱形回撤减仓25-1029';
  cfg.description = 'v57 8774583d（T99 -25 两档版）修正：T99 双腿 cards all→1'
    + '（用户纠正「只是卖一个卡，不是全清」）——三层梯队：T80 -15 减 1 卡（13.4-27，p10）'
    + '→ T99 -25 减 1 卡（<27 全域，p11，max1 恰一次）→ 拱形 -35 全清（深跌兜底）'
    + '+ >=27 档 -25 全清。max1/cd null 不变。v57 零成交零持仓换车。'
    + '买腿 T98/T96/T95/T93、T97/T80、其余 22 卖腿与 v57 逐字一致。源=v57 8774583d。';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| buys:', buys.length, '| sells:', sells.length);
  console.log('T99 修正腿 idx:', fixed.join(','), '->', JSON.stringify(fixed.map(i => ({ cards: sells[i].cards, cond: sells[i].condition }))));
  console.log('T97/T80/拱形-35×2/-25高 锚定: OK');
  console.log('wallet:', JSON.stringify(cfg.wallet));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V58_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
