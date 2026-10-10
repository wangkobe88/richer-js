#!/usr/bin/env node
// ============================================================================
// 三门验证臂——回测创建脚本（2026-10-10，用户裁定「三个门我都接受，加上后回测」）
//
// 基底 = 7bee34f9-e8bc-4539-b64c-3fbd2b27dd05
//   「回测-载体门-J129回填臂-1009」（completed，J1.29 叙事口径缓存行，冻结不重跑）。
//
// 三门（全部因子扫描 2026-10-10 门臂 220 票验证，用户裁定上线回测）：
//   G1 低名门  strictSameNameTokenCount < 3 → 拦（孤本野名无既有人气承接；
//             d46b1b6c 双窗口同向；23 张 −2.456 弃赢仅 2 张 +0.26）
//   G7 slope 门 holderTrendSlope >= 0.55 → 拦（10s 桶×8 点 OLS 相对斜率——
//             每 10 秒持有数 +55%+ = 爆炸级刷 holder 对倒盘；0.55 档拦 7 张
//             −0.76，阈值往小调会砍健康快涨大腿 BNBGUY +2.655@0.222）
//   G4 bundler 门 gmgnBundlerWalletRatio < 21.4 AND covered=1 → 拦
//             （GMGN wallet_tags_stat 定格式快照——实跑 fire 真值 vs 5 天后
//             重析快照 31/31 逐位相同零漂移，时点错位已实证排除；拦 77 张
//             −3.948；§四-18 量纲不稳先例由用户裁定解禁）
//
// 挂位（因子容器归属）：slope 门挂 condition（FA fire 因子，hg55 同位）；
//   低名门/bundler 门挂 preBuyCheckCondition（preBuy 因子容器）。
//   null 语义：slope null（快枪票<4桶）放行（OR IS NULL，hg55 同款 fail-open）；
//   tc=-1（AVE 失败）拦（fail-closed，门臂 0 张实证无影响）；
//   covered=0（GMGN 缺数据）放行（宁漏拦不误杀，x-0 案 risk null 同方向）。
//
// 差分：三门臂 vs 7bee34f9 = 纯三门净效应（config 其余零差异，叙事缓存全命中
//   同口径，tick-cache 复用同窗口）。贪心独立增量预期 ≈ +6.4 BNB
//   （G4 −3.95 + G1 独有 −1.74 + G7 独有 −0.70，重叠票不重复计）。
//
// 用法（182）：node scripts/create-triple-gate-arm.cjs [--commit]
//   默认 dry-run 打印配置；--commit 真建。建后 node src/run-engine.js <id> 跑。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const BASE_ID = '7bee34f9-e8bc-4539-b64c-3fbd2b27dd05';

// 追加子句（放行语义；AND/OR only——&&/|| 会被静默截断，红线）
const COND_APPEND = ' AND (holderTrendSlope < 0.55 OR holderTrendSlope IS NULL)';
const PREBUY_APPEND = ' AND strictSameNameTokenCount >= 3'
  + ' AND (gmgnRiskCovered == 0 OR gmgnBundlerWalletRatio >= 21.4)';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const base = await factory.load(BASE_ID);
  if (!base) throw new Error('基底实验不存在: ' + BASE_ID);

  const cfg = JSON.parse(JSON.stringify(base.config));
  const buy = cfg.strategiesConfig.buyStrategies[0];
  const origCond = buy.condition;
  const origPre = buy.preBuyCheckCondition;
  buy.condition = origCond + COND_APPEND;
  buy.preBuyCheckCondition = origPre + PREBUY_APPEND;
  cfg.name = '回测-三门验证-G1低名+G7slope+G4bundler-1010';
  cfg.description = '三门验证臂（基底 7bee34f9 J1.29 叙事口径 + 三因子门）：'
    + 'G1 低名门 strictSameNameTokenCount<3 拦 / G7 slope 门 holderTrendSlope>=0.55 拦'
    + '（null 放行）/ G4 bundler 门 gmgnBundlerWalletRatio<21.4 且 covered=1 拦'
    + '（covered=0 放行）；差分 vs 基底 = 纯三门净效应，贪心独立增量预期 ≈ +6.4 BNB；'
    + '三门数据支撑 = 门臂 220 票全因子扫描（2026-10-10），bundler 时点漂移 31/31 零已实证排除';

  // 唯一性校验：除 name/description/两条条件外与基底逐字节全同（防手滑改别的）
  const strip = (c) => {
    const s = JSON.parse(JSON.stringify(c));
    delete s.name;
    delete s.description;
    s.strategiesConfig.buyStrategies[0].condition = origCond;
    s.strategiesConfig.buyStrategies[0].preBuyCheckCondition = origPre;
    return JSON.stringify(s);
  };
  if (strip(cfg) !== strip(base.config)) {
    throw new Error('三门臂 config 除 name/description/两条条件外与基底存在差异——应零差异');
  }

  console.log('===== 三门验证臂 =====');
  console.log('  name:', cfg.name);
  console.log('  condition: ', buy.condition);
  console.log('  preBuy:', buy.preBuyCheckCondition);
  console.log('  narrativeCall:', buy.narrativeCallCondition);
  console.log('  backtest:', JSON.stringify(cfg.backtest));
  console.log('  卖腿数:', cfg.strategiesConfig.sellStrategies.length);

  if (!COMMIT) { console.log('\n[dry-run] 未建实验；加 --commit 真建'); process.exit(0); }

  const container = await factory.createFromConfig(cfg, 'backtest');
  console.log('\n========================================');
  console.log('TRIPLE_ARM_ID=' + container.id);
  console.log('BASE_ID=' + BASE_ID + '（冻结基底，不重跑）');
  console.log('========================================');
  console.log('下一步（182）：nohup node src/run-engine.js ' + container.id
    + ' > /tmp/triple-arm.log 2>&1 &   # 叙事全缓存命中零 Jev；tick-cache 复用');
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
