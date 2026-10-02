#!/usr/bin/env node
// ============================================================================
// 新一轮回测实验创建（2026-10-02，用户四点变更）：
//   ① 热桶 P9 卖腿 浮盈门槛 30 → 100（sell-hot-v1 v2 库版替换 B2 旧腿）
//   ② router 区间门平台分门（buy-v2 v6：fourmeme 豁免，修 fourmeme 全灭）
//   ③ 买腿新增热度门 earlyTradesUniqueWallets >= 15（v6）
//   ④ 买腿 TPAPre_tokenScore 2.2 → 2.5（v6）
//
// 基底 = B2（960d1bbf）config 整包：
//   - 买腿 ← 策略库 buy-v2 v6 展开（182 DB 已直改）
//   - 卖腿 ← B2 17 腿整包，P9 腿替换为库 sell-hot-v1 v2 版（>100）
//   - TPA zhuangCondition 2.2 刻意不动（庄散比 verdict 门，与买腿门语义不同）
//   - tokenCycle/stopLoss/TPA/PM/fourmemeWs 段照抄
//   - backtest 同窗（09-30T11:00Z → 10-02T02:18:18.992Z），
//     sourceExperimentId=960d1bbf（复用 B2 名下并集 token 53,586 +
//     BacktestTickCache 键 (960d1bbf, platform) 缓存命中 + 叙事缓存全命中
//     ——B2 已用新代码重析，无需失效）→ 纯回放快速
//
// 用法（182）：node scripts/create-next-backtest-v6.cjs [--commit]
//   默认 dry-run 打印 config 差异；--commit 真建。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const B2_ID = '960d1bbf-c561-4651-abb6-7f1a17e153e6';
const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  const factory = ExperimentFactory.getInstance();

  const base = await factory.load(B2_ID);
  if (!base) throw new Error('B2 不存在: ' + B2_ID);
  const cfg = JSON.parse(JSON.stringify(base.config));

  // ── 库拉取：buy-v2 v6 腿 + sell-hot-v1 v2 的 P9 腿 ──
  const { data: buyLib } = await db.from('strategy_library').select('id,name,version,legs')
    .eq('name', 'buy-v2').single();
  if (!buyLib || buyLib.version !== 6) throw new Error('buy-v2 版本非 6: ' + JSON.stringify(buyLib && buyLib.version));
  const { data: hotLib } = await db.from('strategy_library').select('id,name,version,legs')
    .eq('name', 'sell-hot-v1').single();
  if (!hotLib || hotLib.version !== 2) throw new Error('sell-hot-v1 版本非 2: ' + JSON.stringify(hotLib && hotLib.version));
  const p9New = hotLib.legs.find(l => l.priority === 9);
  if (!p9New || !/profitPercent > 100/.test(p9New.condition)) {
    throw new Error('sell-hot-v1 v2 P9 腿形状异常: ' + JSON.stringify(p9New && p9New.condition));
  }

  // ── 买腿 = buy-v2 v6 展开 ──
  cfg.strategiesConfig.buyStrategies = JSON.parse(JSON.stringify(buyLib.legs));

  // ── 卖腿 P9 替换（30 → 100 版），其余 16 腿零改动 ──
  const sells = cfg.strategiesConfig.sellStrategies;
  const p9Idx = sells.findIndex(l => l.priority === 9);
  if (p9Idx < 0) throw new Error('B2 卖腿无 P9');
  const p9Old = sells[p9Idx];
  if (!/profitPercent > 30/.test(p9Old.condition)) {
    throw new Error('B2 P9 非 >30 旧版（已换过？）: ' + p9Old.condition);
  }
  sells[p9Idx] = JSON.parse(JSON.stringify(p9New));

  // ── libraryRefs provenance 更新 ──
  const nowIso = new Date().toISOString();
  const refs = cfg.strategiesConfig.libraryRefs || [];
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (buyRef) { buyRef.version = 6; buyRef.snapshotAt = nowIso; }
  const hotRef = refs.find(r => r.name === 'sell-hot-v1');
  if (hotRef) { hotRef.version = 2; hotRef.snapshotAt = nowIso; }

  // ── 元信息 ──
  cfg.name = '回测-v6四改-平台分门+P9-100+uw15+TPA2.5';
  cfg.description = 'B2(960d1bbf) 同窗配对：①P9 浮盈门 30→100 ②router 门平台分门修 fourmeme 全灭（B1 实证 rp 恒 0）③热度门 uw>=15 ④TPA 门 2.2→2.5；卖腿其余 16 腿/引擎段整包照抄 B2';

  // backtest 段照抄 B2（sourceExperimentId=960d1bbf 字面量——B2 名下并集）
  // cfg.backtest 已随深拷贝带上，无需改

  // ── dry-run 校验打印 ──
  const buyLeg = cfg.strategiesConfig.buyStrategies[0];
  console.log('== 买腿（buy-v2 v6）==');
  console.log('  condition:', buyLeg.condition);
  console.log('  preBuy:', buyLeg.preBuyCheckCondition);
  console.log('  narCall:', buyLeg.narrativeCallCondition, '| cards:', buyLeg.cards);
  console.log('== P9 新腿 ==');
  console.log('  condition:', sells[p9Idx].condition);
  console.log('== backtest ==', JSON.stringify(cfg.backtest));
  console.log('== 卖腿数 ==', sells.length, '| TPA:', JSON.stringify(cfg.tokenPositionAnalyzer.trigger), 'zhuang:', cfg.tokenPositionAnalyzer.zhuangCondition);
  console.log('== PM ==', JSON.stringify(cfg.positionManagement), '| tokenCycle:', JSON.stringify(cfg.tokenCycle), '| stopLoss:', JSON.stringify(cfg.stopLoss));

  if (!COMMIT) { console.log('\n[dry-run] 未建实验；加 --commit 真建'); process.exit(0); }

  const container = await factory.createFromConfig(cfg, 'backtest');
  console.log('\n========================================');
  console.log('NEW_EXP_ID=' + container.id);
  console.log('========================================');
  console.log('启动（182）: node main.js start-experiment -e ' + container.id);
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
