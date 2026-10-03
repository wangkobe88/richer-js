#!/usr/bin/env node
// ============================================================================
// router 门观察史双门配对回测（2026-10-03 用户指令：
// 「把 <50 涨进窗 以及 被拒 >10 次 干掉，再开个回测」）
//
// 门验证背景（analyze-router-late-entry.cjs，5efaff23/9252d60a 双样本复现）：
//   router 区间门 [50,80) 拒后晚进车的票分裂——≥80 回落进窗侧净正（bot 退潮
//   散户接棒），<50 涨进窗侧净负（GMGN 追热），出界 fire >10 次的票结构不稳
//   净负（3-10 次档是净正主力 +2.70/18 张，阈值必须卡 >10 不误伤）。
//   两个形状都是「信号历史」函数 → 引擎 _routerGateState 观察史 + 两个新
//   preBuy 因子（earlyTradesRouterLowSideSeen / earlyTradesRouterRejectCount，
//   pre-check/router-gate-state.js，单测 _test_router_gate_state.cjs 62 断言）。
//   阈值来自 10-02→10-03T04:00Z 窗（两样本），同窗再验证 = 自证循环 →
//   本配对开新窗 out-of-sample。
//
// 两臂（唯一差异 = 买腿 preBuyCheckCondition 追加两门子句；写在 preBuy 不写
//   condition——观察史因子在 preBuy 评估上下文，FA fire factors 里没有）：
//   W1 门臂：  ... AND (platform != 'flap' OR earlyTradesRouterLowSideSeen == 0
//                        OR earlyTradesRouterLowSideSeen IS NULL)
//                 AND (platform != 'flap' OR earlyTradesRouterRejectCount <= 10
//                        OR earlyTradesRouterRejectCount IS NULL)
//              （null fail-open = 首 fire 无状态放行；fourmeme 短路放行）
//   W0 基线臂：preBuy 零改动（= 9252d60a 快照，含 hg55 门与 router 区间门）
//
// 基底 = 9252d60a config 整包（hg55 门 v2 R1 门臂：buy-v2 v6 买腿 + hg 门 +
//   17 卖腿 + TPA/PM/tokenCycle/stopLoss）——新门叠在当前最强配置上验证增量
// 窗口 = 9252d60a endTime（10-03T04:00Z）无缝衔接 → 创建时刻（out-of-sample）
// 源实验 = 50442571（running 的 both 实跑，新窗 token 持续覆盖）
//
// 叙事口径（用户既定模式：第一个重跑、第二个吃缓存）：新窗 token 的
//   token_narrative 由 50442571 实跑（同 J1.27 代码）持续落下，无需失效重析；
//   W1 先跑（触碰 miss 就地重析落缓存）→ W0 吃 W1 落下的缓存 → 两臂同源。
//
// 用法（182）：node scripts/create-router-gate-pair.cjs [--commit]
//   默认 dry-run 打印两臂差异；--commit 真建。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const BASE_ID = '9252d60a-38e0-4ad1-8032-2ec7bab74f99';
const SRC_ID = '50442571-967e-4537-875d-df7d0ceca01d';
const WIN_START = '2026-10-03T04:00:00.000Z';
const ROUTER_GATE = " AND (platform != 'flap' OR earlyTradesRouterLowSideSeen == 0 OR earlyTradesRouterLowSideSeen IS NULL)"
  + " AND (platform != 'flap' OR earlyTradesRouterRejectCount <= 10 OR earlyTradesRouterRejectCount IS NULL)";

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const base = await factory.load(BASE_ID);
  if (!base) throw new Error('基底实验不存在: ' + BASE_ID);

  // 终点 = 创建时刻取整到分钟（新窗覆盖到当下，out-of-sample 于 10-03T04:00Z）
  const winEnd = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString();

  const legs = [];
  for (const withGate of [true, false]) {
    const cfg = JSON.parse(JSON.stringify(base.config));
    cfg.backtest = {
      ...cfg.backtest,
      startTime: WIN_START,
      endTime: winEnd,
      sourceExperimentId: SRC_ID,
    };
    const buy = cfg.strategiesConfig.buyStrategies[0];
    if (withGate) {
      if (!/earlyTradesRouterLowSideSeen/.test(buy.preBuyCheckCondition)) {
        buy.preBuyCheckCondition += ROUTER_GATE;
      }
      cfg.name = '回测-router双门-W1门臂-1003新窗';
      cfg.description = 'router 门观察史配对 W1（门臂）：基底 9252d60a 整包（含 hg55 门），买腿 preBuy 追加两门：'
        + '(平台非flap OR 低侧未见 OR 无状态) AND (平台非flap OR 出界<=10 OR 无状态)——拦「rp<50 涨进窗」+「被拒>10次」；'
        + `新窗 10-03T04:00→${winEnd}（out-of-sample，阈值来自 10-02→10-03 窗双样本）；源 50442571；`
        + '观察史引擎实例级维护（pre-check/router-gate-state.js），叙事 W1 先跑落缓存';
    } else {
      if (/earlyTradesRouterLowSideSeen|earlyTradesRouterRejectCount/.test(buy.preBuyCheckCondition || '')) {
        throw new Error('基线臂 preBuy 意外含 router 观察史门');
      }
      cfg.name = '回测-router双门-W0对照-1003新窗';
      cfg.description = 'router 门观察史配对 W0（基线臂）：基底 9252d60a 整包零改动（含 hg55 门 + router 区间门），'
        + '与 W1 唯一差异 = 无观察史双门；同窗同源，叙事吃 W1 落下的缓存；差分 = 双门净效应';
    }
    legs.push({ withGate, cfg });
  }

  // ── dry-run 打印 ──
  for (const { withGate, cfg } of legs) {
    const buy = cfg.strategiesConfig.buyStrategies[0];
    console.log(`\n===== ${withGate ? 'W1 门臂' : 'W0 基线'} =====`);
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
  const [w1, w0] = legs.map(l => JSON.stringify(l.cfg));
  if (w1 === w0) throw new Error('两臂 config 完全相同——门未生效');

  if (!COMMIT) { console.log('\n[dry-run] 未建实验；加 --commit 真建（W1、W0 各一）'); process.exit(0); }

  const ids = [];
  for (const { cfg } of legs) {
    const container = await factory.createFromConfig(cfg, 'backtest');
    ids.push(container.id);
    console.log('创建', cfg.name, '→', container.id);
  }
  console.log('\n========================================');
  console.log('W1_ID=' + ids[0]);
  console.log('W0_ID=' + ids[1]);
  console.log('========================================');
  console.log('下一步（182 串行，等 f6504c4a 完成）：① 跑 W1（落叙事缓存）② 跑 W0（吃缓存）③ compare-router-gate-pair');
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
