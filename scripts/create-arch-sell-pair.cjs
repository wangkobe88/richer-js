#!/usr/bin/env node
// ============================================================================
// 拱形止损（峰值市值分档回撤全清）配对回测（2026-10-06，用户指令）
//
// 理念：新发 meme 币主流形状 = 拱形（低点→峰→归零）。卖出契合形状：
// 最高点市值越高 → 允许回撤越小（利润垫越厚越要锁）。
//
// 数据依据（analyze-arch-sell.cjs，6f92e2f9 31 票已平仓实跑，10-03→10-04）：
//   - 拱形验证：31 票实际首卖 dd 全负（中位 ≈-45%）、末 tick dd 几乎全部更深；
//   - 阶梯扫描 12 组全部正净效应 +2.3~+3.4 BNB（方向稳健非单组幸运）；
//   - 最优组合 [[≥100K:-20],[≥20K:-25],[兜底:-35]] × peakProfitPct≥10 → +3.966 BNB，
//     fire 16 票 15 正 1 平零负，贡献均匀（最大单票 +1.015，去之仍 +2.95）。
//
// 两臂（唯一差异 = 卖腿追加拱形止损腿，priority 1.5 压 P1/P2 死票针臂、
// 让位 P3/P8 毕业臂「接近毕业卖出优先」用户语义；无 groups 全周期可见，
// 补热桶/中桶/无档票的通用回撤缺口——冷桶已有 P15 dd≤-10）：
//   R1 腿臂：peakProfitPct >= 10 AND (dd <= -35 OR (peakMcap >= 20000 AND dd <= -25)
//            OR (peakMcap >= 100000 AND dd <= -20))，cards 'all' 全清 bypass
//            （峰值市值因子 peakMarketCapSinceLastBuy = 峰价×totalSupply×bnbUsd，
//             与 dd 同源峰 pos.highestPriceSinceBuyBnb；totalSupply 缺 → null
//             fail-closed 仅兜底档可用）
//   R0 基线臂：卖腿零改动（= 6f92e2f9 快照 17 腿）
//
// 叙事缓存：6f92e2f9 实跑已落 token_narrative（全局），两臂直接命中同源评级。
// R0 另与实跑 -4.454 BNB 对拍（回测模拟保真度参考；叙事时序泄漏/去抖预期小差异）。
//
// 用法（182）：node scripts/create-arch-sell-pair.cjs [--commit]
//   默认 dry-run 打印两臂差异；--commit 真建。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const BASE_ID = '6f92e2f9-1b21-4ea6-b6a1-2e8dc70090e3';   // 11-双平台虚拟-V2v6策略+hg55门-1003（stopped）
const WIN_START = '2026-10-03T14:31:00.000Z';              // 实验创建时刻起
const WIN_END = '2026-10-04T13:10:00.000Z';                // 实验 stopped（13:08）后余量

const ARCH_LEG = {
  priority: 1.5,
  condition: 'peakProfitPct >= 10 AND (drawdownFromHighestSinceLastBuy <= -35'
    + ' OR (peakMarketCapSinceLastBuy >= 20000 AND drawdownFromHighestSinceLastBuy <= -25)'
    + ' OR (peakMarketCapSinceLastBuy >= 100000 AND drawdownFromHighestSinceLastBuy <= -20))',
  cards: 'all',
  sellPercentage: 1,
  maxExecutions: 1,
  bypassDebounce: true,
  description: '拱形止损（2026-10-06 用户理念）：meme 主流形状=拱形（峰后归零），'
    + '峰值市值越高允许回撤越小——≥100K 允许 -20%、≥20K 允许 -25%、兜底 -35%；'
    + '峰值利润 ≥10% 才武装（mp 扫描 +3.966 vs +3.362）；全周期可见补热桶/中桶/'
    + '无档票的通用回撤缺口（冷桶已有 P15 -10）；priority 1.5 让位毕业臂 P3/P8'
    + '（接近毕业卖出优先）。数据：6f92e2f9 31 票 12 组阶梯全正、16 票 fire 15 正 1 平零负',
};

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const base = await factory.load(BASE_ID);
  if (!base) throw new Error('基底实验不存在: ' + BASE_ID);

  const legs = [];
  for (const withArch of [true, false]) {
    const cfg = JSON.parse(JSON.stringify(base.config));
    cfg.backtest = { startTime: WIN_START, endTime: WIN_END, sourceExperimentId: BASE_ID };
    if (withArch) {
      cfg.strategiesConfig.sellStrategies = [...cfg.strategiesConfig.sellStrategies, JSON.parse(JSON.stringify(ARCH_LEG))];
      cfg.name = '回测-拱形止损R1腿臂-1003-1004窗';
      cfg.description = '拱形止损配对 R1（腿臂）：基底 6f92e2f9 整包 + 卖腿追加拱形止损腿'
        + '（峰值市值分档回撤全清 -35/-25/-20 × peakProfit≥10）；窗口 10-03T14:31→10-04T13:10Z；'
        + '与 R0 唯一差异 = 拱形腿；分析依据 analyze-arch-sell.cjs（31 票 +3.966 BNB，fire 16 票 15 正 1 平）';
    } else {
      cfg.name = '回测-拱形止损R0基线-1003-1004窗';
      cfg.description = '拱形止损配对 R0（基线臂）：基底 6f92e2f9 整包零卖腿改动，与 R1 唯一差异 = 无拱形腿；'
        + '同窗同源，差分 = 拱形腿净效应；另与实跑 -4.454 BNB 对拍回测模拟保真度';
    }
    legs.push({ withArch, cfg });
  }

  for (const { withArch, cfg } of legs) {
    console.log(`\n===== ${withArch ? 'R1 腿臂' : 'R0 基线'} =====`);
    console.log('  name:', cfg.name);
    console.log('  卖腿数:', cfg.strategiesConfig.sellStrategies.length,
      '| 买腿:', cfg.strategiesConfig.buyStrategies[0].condition);
    if (withArch) console.log('  拱形腿:', JSON.stringify(cfg.strategiesConfig.sellStrategies[cfg.strategiesConfig.sellStrategies.length - 1]));
    console.log('  backtest:', JSON.stringify(cfg.backtest));
  }
  const [r1, r0] = legs.map(l => JSON.stringify(l.cfg));
  if (r1 === r0) throw new Error('两臂 config 完全相同——拱形腿未生效');

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
  console.log('下一步（182 串行）：跑 R1 → 跑 R0 → compare（trades/signals 对拍）');
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
