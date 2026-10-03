#!/usr/bin/env node
// ============================================================================
// holderTrendGrowth < 55 买门配对回测（2026-10-03，用户指令）：
//   门验证背景：82093ca3（v6 策略，09-30 11:00Z→10-02 02:18Z，231 票）残差上
//   hg 峰值 <55 档净 +5.289（拦 62 票赢11/亏51）、9 主题全正、细档 25-70 宽平台
//   全正、机制与 top1 门互补（top1 管「一家推」、hg 管「没人接」）——
//   但这是 in-sample（holderTrendCV 门刚因同一陷阱被否决），须新窗口 out-of-sample。
//
// 两臂（唯一差异 = 买腿 condition 追加 hg 门）：
//   R1 门臂：  ... AND (holderTrendGrowthRatio >= 55 OR holderTrendGrowthRatio IS NULL)
//              （null fail-open = 验证矩阵口径：首买 <10s 序列未成型票放行；
//                写主 condition 不写 preBuy——hg 是 FA trendFactors，fire factors 上下文；
//                narrativeCallCondition 不加——condition 不过根本不触发叙事调用，
//                buy-v2 v3 tokenCycle 门同款先例）
//   R0 基线臂：买腿零改动（= 82093ca3 快照 buy-v2 v6）
//
// ⚠️ v2（2026-10-03 重跑）：首版门子句误写裸键 holderTrendGrowth（真名
//   holderTrendGrowthRatio，FourMemeFactorAggregator 发射），且当时校验只 warn
//   不拒载 → (X >= 55 OR X IS NULL) 恒真，门零拦截，两臂作废（5efaff23/20b5b439
//   stopped 留行）。v2 用真名 + 未知因子 fail-fast 已上线（用户裁定），错名即拒启。
//   叙事缓存：首版 R1 已把新窗 token 按 J1.27(2c16d36) 重析落缓存，v2 两臂
//   直接复用（失效/重析步骤不再需要，同源成立）。
//
// 叙事口径（用户指令：第一个回测叙事重跑，第二个直接用第一个的结果）：
//   跑前失效新窗 token_narrative（is_valid=false，脚本 invalidate-narrative-hg-window.cjs）
//   → R1 触碰的 token miss 重析（182 已部署 J1.27+C56，代码 2c16d36）
//   → R0 命中 R1 落下的新缓存；R1 未触碰的 token R0 触碰时 miss 就地重析（同代码）
//   → 两臂叙事评级完全同源，差分 = 纯门净效应
//
// 基底 = 82093ca3 config 整包（buy-v2 v6 买腿 + 17 卖腿 + TPA/PM/tokenCycle/stopLoss）
// 窗口 = 82093ca3 endTime 无缝衔接 → 10-03T04:00Z（out-of-sample，~26h）
// 源实验 = 50442571（running 的 both 实跑，experiment_tokens 新窗覆盖 29,469 token；
//   原 B2/960d1bbf 名下集合止于旧窗，沿用会漏掉全部新窗 token）
//
// 用法（182）：node scripts/create-hg55-pair.cjs [--commit]
//   默认 dry-run 打印两臂差异；--commit 真建。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const BASE_ID = '82093ca3-ea73-4f26-9aef-cb9a1acee842';
const SRC_ID = '50442571-967e-4537-875d-df7d0ceca01d';
const WIN_START = '2026-10-02T02:18:18.992Z';
const WIN_END = '2026-10-03T04:00:00.000Z';
const HG_GATE = ' AND (holderTrendGrowthRatio >= 55 OR holderTrendGrowthRatio IS NULL)';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const base = await factory.load(BASE_ID);
  if (!base) throw new Error('基底实验不存在: ' + BASE_ID);

  const legs = [];
  for (const withGate of [true, false]) {
    const cfg = JSON.parse(JSON.stringify(base.config));
    // 窗口 + 源切换（新窗 out-of-sample；源=50442571 新窗覆盖 29,469 token）
    cfg.backtest = {
      ...cfg.backtest,
      startTime: WIN_START,
      endTime: WIN_END,
      sourceExperimentId: SRC_ID,
    };
    const buy = cfg.strategiesConfig.buyStrategies[0];
    if (withGate) {
      if (!/holderTrendGrowthRatio/.test(buy.condition)) buy.condition += HG_GATE;
      cfg.name = '回测-hg55门v2-R1门臂-1002-1003新窗';
      cfg.description = 'hg<55 门配对 v2 R1（门臂）：基底 82093ca3 整包，买腿 condition 追加 (holderTrendGrowthRatio >= 55 OR IS NULL)；'
        + '新窗 10-02T02:18→10-03T04:00Z（out-of-sample）；源 50442571；v2=首版裸键 holderTrendGrowth 写错门恒真作废（5efaff23），'
        + '本版真名重跑；叙事直接复用首版 R1 已落的 J1.27(2c16d36) 重析缓存';
    } else {
      if (/holderTrendGrowthRatio/.test(buy.condition)) throw new Error('基线臂 condition 意外含 hg 门');
      cfg.name = '回测-hg55基线v2-R0对照-1002-1003新窗';
      cfg.description = 'hg<55 门配对 v2 R0（基线臂）：基底 82093ca3 整包零门改动，与 R1 唯一差异 = 无 hg 门；'
        + '同窗同源，叙事直接吃首版 R1 落下的缓存（用户裁定）；差分 = 门净效应；v2 重跑（首版 20b5b439 随门臂作废）';
    }
    legs.push({ withGate, cfg });
  }

  // ── dry-run 打印 ──
  for (const { withGate, cfg } of legs) {
    const buy = cfg.strategiesConfig.buyStrategies[0];
    console.log(`\n===== ${withGate ? 'R1 门臂' : 'R0 基线'} =====`);
    console.log('  name:', cfg.name);
    console.log('  condition:', buy.condition);
    console.log('  preBuy:', buy.preBuyCheckCondition);
    console.log('  backtest:', JSON.stringify(cfg.backtest));
    console.log('  卖腿数:', cfg.strategiesConfig.sellStrategies.length,
      '| PM:', JSON.stringify(cfg.positionManagement),
      '| tokenCycle:', JSON.stringify(cfg.tokenCycle),
      '| stopLoss:', JSON.stringify(cfg.stopLoss));
  }
  // 门差异唯一性检查
  const [r1, r0] = legs.map(l => JSON.stringify(l.cfg));
  if (r1 === r0) throw new Error('两臂 config 完全相同——门未生效');

  if (!COMMIT) { console.log('\n[dry-run] 未建实验；加 --commit 真建（R1、R0 各一）'); process.exit(0); }

  const ids = [];
  for (const { cfg } of legs) {
    const container = await factory.createFromConfig(cfg, 'backtest');
    ids.push(container.id);
    console.log('创建', cfg.name, '→', container.id);
  }
  console.log('\n========================================');
  console.log('R1_ID=' + ids[0]);
  console.log('R0_ID=' + ids[1]);
  console.log('========================================');
  console.log('下一步：① 失效叙事 ② 跑 R1 ③ 跑 R0（182 串行）');
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
