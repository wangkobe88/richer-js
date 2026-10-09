#!/usr/bin/env node
// ============================================================================
// J1.29 形象载体门——门臂回测创建脚本（2026-10-09，用户裁定「可以回测验证，
// 我建议是，叙事如果重新跑了就不必再跑一遍了」）
//
// 基底 = bddd3578-f04f-42e2-b8a7-1ae4b6893a0a
//   「回测-lag门-36a2c12a窗口-叙事重析-1009」（completed，292 票全部有交易，
//   J1.28 重析缓存行）。冻结结果当基线，不重跑。
//
// 门臂与基底 **config 零差异**（M2 载体门挂在叙事侧 mapper——rating 翻 low 经
// rating 门（narrativeRating==2 OR ==3）起作用，策略 config 无需任何改动）。
// 差分靠**叙事缓存状态**隔离：
//   基底跑时缓存行 = J1.28 口径（无 subject_carrier 答案 → 载体门不拦）
//   门臂跑时缓存行 = 回填后 J1.29 口径（backfill-carrier-bddd.mjs 把 dry-run 的
//   subject_carrier 答案合并进 J1.28 行 answers → J1.29 mapper 重映射落库）
//   → diff(门臂, 基底) = 纯 M2 门净效应（单变量对照，其余 16 题答案
//   bit-identical，无换题集重析方差——C60 教训的机制化规避）
//
// 跑序红线：必须先在 182 跑 backfill-carrier-bddd.mjs --commit 回填，再跑门臂
// 回测（叙事全缓存命中零 Jev 调用；tick-cache 复用 36a2c12a 缓存 FRESH 零重拉）。
//
// 用法（182）：node scripts/create-carrier-gate-arm.cjs [--commit]
//   默认 dry-run 打印配置；--commit 真建。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const BASE_ID = 'bddd3578-f04f-42e2-b8a7-1ae4b6893a0a';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const base = await factory.load(BASE_ID);
  if (!base) throw new Error('基底实验不存在: ' + BASE_ID);

  // 门臂 config = 基底整包深拷贝，只改 name/description（门在叙事侧，config 零改动）
  const cfg = JSON.parse(JSON.stringify(base.config));
  cfg.name = '回测-载体门-J129回填臂-1009';
  cfg.description = 'J1.29 载体门验证臂：config 与基底 bddd3578 零差异（门在叙事侧 mapper——'
    + 'C/D+非existing、E+no_visual 拦 → rating 翻 low 经 rating 门起作用）；前置 = 先跑 '
    + 'backfill-carrier-bddd.mjs --commit 把 dry-run 的 subject_carrier 答案注入回填 '
    + 'token_narrative（J1.29 mapper 重映射），本臂叙事全缓存命中零 Jev 调用；'
    + 'diff vs 基底 = 纯 M2 门净效应（其余 16 题答案 bit-identical）；'
    + 'dry-run 预期 ≈ 净效应 +4.33（+21.895→+26.225 BNB，winR 35%→41%）';

  // ── dry-run 打印 ──
  const buy = cfg.strategiesConfig.buyStrategies[0];
  console.log('===== 门臂（单臂）=====');
  console.log('  name:', cfg.name);
  console.log('  condition:', buy.condition);
  console.log('  preBuy:', buy.preBuyCheckCondition);
  console.log('  narrativeCall:', buy.narrativeCallCondition);
  console.log('  backtest:', JSON.stringify(cfg.backtest));
  console.log('  卖腿数:', cfg.strategiesConfig.sellStrategies.length,
    '| PM:', JSON.stringify(cfg.positionManagement),
    '| tokenCycle:', JSON.stringify(cfg.tokenCycle),
    '| stopLoss:', JSON.stringify(cfg.stopLoss));

  // 唯一性校验：两侧同删 name/description 后逐字节全同（基底 config 自带这两个键，
  // 对照必须镜像删除——单侧删恒不等是首版校验自身的 bug，182 诊断实证其余 13 键序一致）
  const stripped = JSON.parse(JSON.stringify(cfg));
  delete stripped.name;
  delete stripped.description;
  const baseStripped = JSON.parse(JSON.stringify(base.config));
  delete baseStripped.name;
  delete baseStripped.description;
  if (JSON.stringify(stripped) !== JSON.stringify(baseStripped)) {
    throw new Error('门臂 config 除 name/description 外与基底存在差异——应零差异');
  }

  if (!COMMIT) { console.log('\n[dry-run] 未建实验；加 --commit 真建'); process.exit(0); }

  const container = await factory.createFromConfig(cfg, 'backtest');
  console.log('\n========================================');
  console.log('GATE_ARM_ID=' + container.id);
  console.log('BASE_ID=' + BASE_ID + '（冻结基底，不重跑）');
  console.log('========================================');
  console.log('下一步（182，严格按序）：');
  console.log('  1) node scripts/narrative/backfill-carrier-bddd.mjs            # dry-run 核对 M2 命中清单');
  console.log('  2) node scripts/narrative/backfill-carrier-bddd.mjs --commit   # 回填 J1.29 口径行');
  console.log('  3) 跑门臂回测 ' + container.id + '（叙事缓存全命中零 Jev；tick-cache FRESH 零重拉）');
  console.log('  4) diff 门臂 vs 基底 = 纯 M2 门净效应（预期 ≈ +4.33）');
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
