#!/usr/bin/env node
// ============================================================================
// 建 v55 live both 实验（2026-10-29 T97 高点停滞减仓臂换车）
//   克隆 v54 0007ff5a（buy-v2 v49 + buy-early-narrative v9 快照，T96 净买换轨）。
//   本批唯一 config 变量：卖腿 21→22——T80 回撤锁盈腿（priority 10）前插
//   T97 高点停滞减仓臂（用户拍板「peakProfitPct >= 10 AND secSincePeak > 60
//   → 卖 1 卡，冷却 60s，最多卖 2 张」）：
//     cards=1 / priority=10（与 T80 同号，数组序在前=同 tick 双真先评——时间
//     停滞层先于幅度回撤层）/ cooldownSec=60 / maxExecutions=2 / bypass=false
//   secSincePeak 载体=FA 新键（本 commit）；定标=tmp-since-high-arm-scan 5 天
//   113 episode 反事实（N=60/mf=2/peak≥10 最优 +0.0109 BNB，盈转亏子集贡献≈全部）。
//   买腿 2 条/gmgn/libraryRefs/perCardBNB/钱包/其余 config 与 v54 逐字一致。
//   已知口径差异（扫描近似）：扫描 maxFires=min(2, nCards−1) 保 1 卡，引擎
//   maxExecutions=2 不保——2-3 卡票（部分成交形状，少数）停滞可全清，接受。
//   ⚠️ copy-in：停 v54 与建 v55 同批（单一实验纪律）；停前持仓确认（live 重启红线）。
// 防呆：源必须 stopped + 买腿 2 条 T96 形状逐字不动 + 卖腿 21→22 + T80 腿恰一次
//   + 新腿恰一次且插在 T80 前 + T96 净买段恰两次 + libraryRefs 49/9 不动。
// 用法：node scripts/create-v55.cjs [--commit]   （在 182 跑；代码含 secSincePeak）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = '0007ff5a-8a17-4e31-928f-53af7e3f2d2e'; // v54 live both（T96 净买换轨快照）

const T96_NETBUY = '(tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40)';
const T80_COND = 'peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -15 AND marketCap >= 13.4 AND marketCap < 27';
const T97_LEG = {
  cards: 1,
  priority: 10,
  condition: 'peakProfitPct >= 10 AND secSincePeak > 60',
  cooldownSec: 60,
  description: 'T97 高点停滞减仓臂（2026-10-29 用户拍板「peakProfitPct >= 10 AND secSincePeak > 60 → 卖 1 卡，冷却 60s，最多卖 2 张」）：峰值利润 >=10% 武装 ∧ 距持仓期峰值 >60s 未创新高 → 先减 1 卡，冷却 60s，maxExecutions=2 上限两卡（多数票 6 卡制剩 4 张由现行栈兜底；已知口径差异：扫描定标 maxFires=min(2,nCards−1) 保 1 卡，2-3 卡票本腿可全清，接受）；与 T80 回撤锁盈（同 priority 10、数组序在本腿后=同 tick 双真时本腿先评）成「时间×幅度」双层减仓——本臂打峰后停滞（横盘阴跌未触 -15 回撤、盈转亏主通道 P13 之前减仓），T80 打幅度回撤；secSincePeak=任意接受价轨峰推进时刻起算（outlier 不推峰、创新高归零重计；尘 tick 不卡尘门可重置计时但不可武装——与 peakProfitPct 可靠价轨分轨，单测锁定）；null（未持仓/无峰）→ 恒 false fail-closed；bypass=false 走 3.5s+5tick 双门。定标（tmp-since-high-arm-scan 5 天 113 episode 反事实）：N=60/mf=2/peak≥10 最优 +0.0109 BNB、盈转亏子集（n=29）贡献 +0.0107≈全部；双阈值 N2 长窗与 profitGate>0 均被数据否决；误杀面=二次腾飞票（佩狗/创业时代/OST 单票 -0.0015~-0.0022）',
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
    throw new Error('--commit 须先停 v54（单一实验纪律+停前持仓确认）；当前 status=' + src.status);
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

  // ── 源形状锚定（v54 快照：T96 净买段 ×2 + T80 腿恰一次 + 无 secSincePeak 残留）──
  let netbuyCnt = 0;
  for (const [i, leg] of buys.entries()) {
    netbuyCnt += leg.condition.split(T96_NETBUY).length - 1;
    for (const bad of ['tradesNetBuyRatioLongWin >= 40 OR', 'sybilClusterHolderCircPct', 'top2BundleClusterHoldCircPct']) {
      if (leg.condition.includes(bad)) throw new Error('买腿[' + i + '] 残留已删形状: ' + bad);
    }
    if (leg.maxExecutions !== 2) throw new Error('买腿[' + i + '] maxExecutions=' + JSON.stringify(leg.maxExecutions) + ' 期望 2');
  }
  if (netbuyCnt !== 2) throw new Error('T96 净买段出现 ' + netbuyCnt + ' 次期望恰 2（两买腿各一）');
  const t80Idx = sells.findIndex(s => s.condition === T80_COND);
  if (t80Idx < 0) throw new Error('T80 腿未找到（T97 须插其前）');
  if (sells.filter(s => s.condition === T80_COND).length !== 1) throw new Error('T80 腿非恰一次');
  if (sells.some(s => (s.condition || '').includes('secSincePeak'))) throw new Error('源已有 secSincePeak 腿（重复插入防线）');
  if (sells[t80Idx].priority !== 10 || sells[t80Idx].cooldownSec !== 300) throw new Error('T80 腿形状漂移（prio/cd）');

  // ── v55 唯一变量：T80 前插 T97 腿（21→22）──
  sells.splice(t80Idx, 0, JSON.parse(JSON.stringify(T97_LEG)));
  if (sells.length !== 22) throw new Error('插入后卖腿数=' + sells.length + ' 期望 22');
  const t97Idx = sells.findIndex(s => s.condition === T97_LEG.condition);
  if (t97Idx !== t80Idx) throw new Error('T97 腿位置错（应在原 T80 位 ' + t80Idx + '，实为 ' + t97Idx + '）');
  if (sells.findIndex(s => s.condition === T80_COND) !== t80Idx + 1) throw new Error('T80 腿未顺移到 T97 后');

  // ── libraryRefs 49/9 不动（纯 provenance 防线：本批无库变化）──
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  const buyRef = refs.find(r => r.name === 'buy-v2');
  const earlyRef = refs.find(r => r.name === 'buy-early-narrative');
  if (!buyRef || buyRef.version !== 49) throw new Error('libraryRefs buy-v2 version=' + (buyRef && buyRef.version) + ' 期望 49');
  if (!earlyRef || earlyRef.version !== 9) throw new Error('libraryRefs early version=' + (earlyRef && earlyRef.version) + ' 期望 9');

  cfg.name = 'v55-实盘-both-高点停滞减仓-1029';
  cfg.description = 'v54 + T97 高点停滞减仓臂（用户拍板「peakProfitPct >= 10 AND'
    + ' secSincePeak > 60 → 卖 1 卡，冷却 60s，最多卖 2 张」）：FA 新键 secSincePeak'
    + '=距持仓期峰值秒数（任意接受价轨峰推进、outlier 不推峰、创新高归零重计、'
    + '与 peakProfitPct 可靠价轨分轨）；打盈转亏主通道（P13 峰≥20 亏 0 全清）之前的'
    + '时间层减仓，与 T80 回撤锁盈（幅度层）同 priority 10 成梯队。定标：5 天 113'
    + ' episode 反事实 N=60/mf=2/peak≥10 最优 +0.0109 BNB（盈转亏子集 n=29 贡献'
    + ' ≈全部；双阈值/profitGate 数据否决；误杀面=二次腾飞票）。买腿 2 条（T96 净买'
    + '换轨 v49/v9）/gmgn/libraryRefs/perCardBNB/钱包/其余 21 卖腿与 v54 0007ff5a'
    + ' 逐字一致。';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| buys:', buys.length, '| sells:', sells.length);
  console.log('T97 新腿[' + t97Idx + ']:', JSON.stringify({ condition: sells[t97Idx].condition, cards: sells[t97Idx].cards, priority: sells[t97Idx].priority, cooldownSec: sells[t97Idx].cooldownSec, maxExecutions: sells[t97Idx].maxExecutions, bypassDebounce: sells[t97Idx].bypassDebounce }));
  console.log('T80 顺移[' + (t97Idx + 1) + ']:', sells[t97Idx + 1].condition);
  console.log('wallet:', JSON.stringify(cfg.wallet));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V55_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
