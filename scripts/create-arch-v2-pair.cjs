#!/usr/bin/env node
// ============================================================================
// 拱形止损卖侧重构 R2（2026-10-06，用户三轮裁定后定稿）
//
// 裁定链（2026-10-06，四轮）：
//   ① 17 卖腿除毕业臂 P3/P8 外全部弃用（纯拱形族）；stopLoss 段保留
//   ② 20K 档 -25 → -35（run8：兜底放深更差，-35 近最优）；B3 (75,78] 档去掉
//      （「超买不要加太多」）；A6/A5/A1/快跌门全不加（快跌门矩阵普遍拉低净效应）
//   ③ 市值口径失真案（躺赢 0x2088…ffff grad 38.9 无毕业事件）：6/634 票
//      price×totalSupply(1e9) >> 毕业锚却未毕业 = 高价发行票；失真票卖后
//      -49%~-74%（毕业臂秒卖歪打正着救命，G1/G2 天然承接）→ 市值分档全砍：
//      100K 档 3 fire 全是失真票净 -0.226、低市值深档 run9 12 格全负
//      （-1.29~-2.66）、纯兜底 [[0,-35]] -0.4034 全场最优
//   ④ B1/B2 的 ≥20K 门同建于失真因子 → 一并去掉，按 P5/P6 原文无门迁移
//   ⑤ 回放结束强平按 ticks 末价（引擎既有语义 _forceSellAllRemaining 按
//      FA currentPrice=最后非离群 tick 价全平，R0/R1 实证 109/109 零跳过）
//
// R2 腿族 5 条（全无 groups 全周期可见；P3/P5/P6/P8 原文迁移，P11 纯兜底拱形）：
//   P3  G1 毕业臂①  graduationProgress >= 0.9                卖半
//   P5  B1 超买T85  rsi>85 + rise≥5                          卖 40%
//   P6  B2 超买T78  (78,85] + rise≥5                         卖 30%
//   P8  G2 毕业臂②  graduationProgress >= 0.98               再卖半
//   P11 A  纯兜底   peakProf≥10 + dd≤-35                     全清
// 评估序 3→5→6→8→11：毕业升段 → 超买止盈 → 拱形兜底全清；全清腿后 markAsSold
// 早退，分段腿（cards:"1"）先卖不影响后续全清（sellPct 恒精确 1 → PM 删仓）。
//
// ★口径警示：R0 基线（57fde778）含 P5-P17 分段卖（R2 已弃用）→ R2 fire 点
//   持仓与 R0 有系统性口径差，对拍差分 = 卖侧全族重构净效应（非单腿）。
//   矩阵只选参数方向，R2 配对回测才是决策门。
//
// 用法：
//   node scripts/create-arch-v2-pair.cjs --selftest   # 本地零 DB 腿预检（loadStrategies+断言）
//   node scripts/create-arch-v2-pair.cjs              # 182 dry-run 打印
//   node scripts/create-arch-v2-pair.cjs --commit     # 182 真建 R2 单臂
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const BASE_ID = '6f92e2f9-1b21-4ea6-b6a1-2e8dc70090e3';   // 11-双平台虚拟-V2v6策略+hg55门-1003（stopped）
const WIN_START = '2026-10-03T14:31:00.000Z';              // 与 R0/R1 逐字相同
const WIN_END = '2026-10-04T13:10:00.000Z';

// ── R2 卖腿 5 条（P3/P5/P6/P8 = 6f92e2f9 原文字段，仅去 groups；P11 纯兜底拱形）──
const R2_LEGS = [
  {
    // G1：P3 原文迁移（2026-10-06 裁定保留），去 cycle==3 全周期可见
    cards: '1',
    priority: 3,
    condition: 'graduationProgress >= 0.9',
    cooldownSec: null,
    description: '毕业臂①（拱形v2 保留腿）：可靠价市值达毕业锚 90% 卖半（起步 0.9 留尘价余量）；'
      + '迁移自 6f92e2f9 P3 原文，去 cycle==3 全周期可见（2026-10-06 裁定：17 腿唯 P3/P8 保留）；'
      + '高价发行票 grad 超界（躺赢案 38.9）恒真触发秒卖——卖后 -49%~-74% 实证歪打正着',
    maxExecutions: 1,
    bypassDebounce: true,
    sellPercentage: 0.5,
  },
  {
    // B1：P5 原文迁移（≥20K 门建在失真因子上，裁定去掉）
    cards: '1',
    priority: 5,
    condition: 'rsi9Bar5mRt > 85 AND risePct5m >= 5',
    cooldownSec: null,
    description: '超买止盈 T85（拱形v2 B1）：5m RSI9 实时口径>85 且 5min 涨幅≥5，卖 40%；'
      + 'P5 原文迁移（裁定：超买止盈保留，≥20K 门建于 peakMarketCapSinceLastBuy '
      + '失真因子上（躺赢案）一并去掉）；R0 10-03/04 窗 P5-P7 全程 0 fire；'
      + 'rsi null → 比较恒 false 不触发（fail-closed）',
    maxExecutions: 1,
    bypassDebounce: true,
    sellPercentage: 0.4,
  },
  {
    // B2：P6 原文迁移；B3 (75,78] 档裁定去掉（「超买不要加太多」）
    cards: '1',
    priority: 6,
    condition: 'rsi9Bar5mRt > 78 AND rsi9Bar5mRt <= 85 AND risePct5m >= 5',
    cooldownSec: null,
    description: '超买止盈 T78（拱形v2 B2）：互斥带 (78,85] 且 5min 涨幅≥5，卖 30%；'
      + 'P6 原文迁移（≥20K 门裁定去掉）；原 B3 (75,78] 档裁定去掉；互斥带防连续 tick 级联打光',
    maxExecutions: 1,
    bypassDebounce: true,
    sellPercentage: 0.3,
  },
  {
    // G2：P8 原文迁移
    cards: '1',
    priority: 8,
    condition: 'graduationProgress >= 0.98',
    cooldownSec: null,
    description: '毕业臂②（拱形v2 保留腿）：≥0.98 再卖半（若①已触发余半仓的 50%）；'
      + '迁移自 6f92e2f9 P8 原文，去 cycle==3 全周期可见',
    maxExecutions: 1,
    bypassDebounce: true,
    sellPercentage: 0.5,
  },
  {
    // A 纯兜底拱形腿：市值分档全砍（失真 + 增量全负）后的单腿
    cards: 'all',
    priority: 11,
    condition: 'peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -35',
    cooldownSec: null,
    description: '拱形v2-A 纯兜底腿：峰值利润 ≥10% 武装 + 回撤 ≤-35 全清（meme 拱形形状'
      + '峰后归零，深回撤处离场）；市值分档全砍（2026-10-06 裁定）：peakMarketCapSinceLastBuy '
      + '对高价发行票失真（6/634，100K 档 3 fire 全失真票净 -0.226）+ 低市值深档 run9 '
      + '12 格全负（-1.29~-2.66）+ 纯兜底 [[0,-35]] -0.4034 全场最优；'
      + 'dd null（未武装/无峰）→ 比较恒 false 不触发（fail-closed）',
    maxExecutions: 1,
    bypassDebounce: true,
    sellPercentage: 1,
  },
];

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const SELFTEST = args.includes('--selftest');

// ── 本地零 DB 预检：复刻 FourMemeWssTradingEngine 装配形状过 loadStrategies ──
function selftest() {
  // 断言 1：5 腿 / priority 唯一且为评估序 [3,5,6,8,11] / 无 groups·cycle 残留
  const priorities = R2_LEGS.map(l => l.priority);
  if (R2_LEGS.length !== 5) throw new Error(`腿数 ${R2_LEGS.length} ≠ 5`);
  if (new Set(priorities).size !== 5) throw new Error('priority 重复: ' + priorities.join(','));
  if (JSON.stringify(priorities) !== JSON.stringify([3, 5, 6, 8, 11])) {
    throw new Error('priority 序非评估序 [3,5,6,8,11]: ' + priorities.join(','));
  }
  for (const l of R2_LEGS) {
    if (l.groups != null || l.cycle != null) throw new Error(`P${l.priority} 残留 groups/cycle`);
    if (!l.condition || !l.description) throw new Error(`P${l.priority} 缺 condition/description`);
    // 括号红线（hg55 同构）：本设计纯 AND 无 OR/IS NULL；若未来出现须整体带括号
    if (/ OR |IS NULL|IS NOT NULL/i.test(l.condition)) {
      throw new Error(`P${l.priority} 含 OR/IS NULL——hg55 括号红线，须人工核对门子句括号`);
    }
  }
  // 断言 2：引擎装配形状（FourMemeWssTradingEngine.js:394-414 同构）+ loadStrategies
  // 全量校验（条件语法 + 因子键 ∈ getAvailableFactorIds + groups 归一）
  const { StrategyEngine } = require('../src/strategies/StrategyEngine');
  const { getAvailableFactorIds } = require('../src/trading-engine/core/FactorBuilder');
  const strategyArray = R2_LEGS.map((s, idx) => ({
    id: `sell_${idx}_${s.priority}`,
    name: `卖出策略 P${s.priority}`,
    description: s.description,
    action: 'sell',
    condition: s.condition,
    priority: s.priority,
    maxExecutions: s.maxExecutions || null,
    bypassDebounce: !!s.bypassDebounce,
    sellPercentage: s.sellPercentage,
    cards: s.cards,
    cooldownSec: s.cooldownSec,
    enabled: true,
  }));
  const engine = new StrategyEngine({});
  engine.loadStrategies(strategyArray, getAvailableFactorIds()); // throw = 拒启（未知因子/语法错）
  console.log('[selftest] 5 腿 loadStrategies 全过（条件语法 + 因子键校验 + groups 归一）');
  for (const s of R2_LEGS) console.log(`  P${String(s.priority).padEnd(2)} cards=${String(s.cards).padEnd(3)} sellPct=${s.sellPercentage} | ${s.condition}`);
  console.log('[selftest] OK');
}

async function main() {
  if (SELFTEST) { selftest(); process.exit(0); }

  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const base = await factory.load(BASE_ID);
  if (!base) throw new Error('基底实验不存在: ' + BASE_ID);

  const cfg = JSON.parse(JSON.stringify(base.config));
  cfg.backtest = { startTime: WIN_START, endTime: WIN_END, sourceExperimentId: BASE_ID };
  cfg.strategiesConfig.sellStrategies = JSON.parse(JSON.stringify(R2_LEGS));
  // 库引用：剔 3 条 sell refs（hot/mid/cold 已不构成 R2 卖侧），保留 buy-v2（防引用计数污染）
  if (Array.isArray(cfg.strategiesConfig.libraryRefs)) {
    const before = cfg.strategiesConfig.libraryRefs.length;
    cfg.strategiesConfig.libraryRefs = cfg.strategiesConfig.libraryRefs.filter(r => r.side !== 'sell');
    console.log(`libraryRefs: ${before} → ${cfg.strategiesConfig.libraryRefs.length}（剔 sell refs）`);
  }
  cfg.name = '回测-拱形v2重构R2-1003-1004窗';
  cfg.description = '拱形v2 卖侧重构 R2（单臂）：基底 6f92e2f9 整包，卖腿整体替换为 5 腿'
    + '（G1/G2 毕业臂 + B1/B2 超买止盈无门 + A 纯兜底 -35；全无 groups，市值分档全砍'
    + '——peakMarketCapSinceLastBuy 高价发行票失真 + run9 低市值深档全负 + 纯兜底最优）；'
    + '去 cycle 路由拱形为主体；窗口与 R0(57fde778)/R1(2ff8adeb) 逐字相同，'
    + '对拍差分 = 卖侧全族重构净效应；裁定链与矩阵依据见脚本头注';

  console.log('\n===== R2 单臂 =====');
  console.log('  name:', cfg.name);
  console.log('  卖腿数:', cfg.strategiesConfig.sellStrategies.length,
    '| 买腿零改动:', cfg.strategiesConfig.buyStrategies[0].condition);
  for (const s of cfg.strategiesConfig.sellStrategies) {
    console.log(`  P${s.priority} cards=${s.cards} sellPct=${s.sellPercentage} | ${s.condition}`);
  }
  console.log('  backtest:', JSON.stringify(cfg.backtest));
  console.log('  stopLoss:', JSON.stringify(cfg.stopLoss || null), '（保留零改动）');

  if (!COMMIT) { console.log('\n[dry-run] 未建实验；加 --commit 真建（R2 单臂）'); process.exit(0); }

  const container = await factory.createFromConfig(cfg, 'backtest');
  console.log('创建', cfg.name, '→', container.id);
  console.log('\n========================================');
  console.log('R2_ID=' + container.id);
  console.log('========================================');
  console.log('下一步（182 串行）：node main.js start-experiment -e <R2_ID> -f');
  console.log('对拍：node scripts/compare-arch-sell-pair.cjs --r1 <R2_ID> --r0 57fde778-7a0d-424f-8c5d-fd5f7b7e2fc3 --arch \'P11\'');
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
