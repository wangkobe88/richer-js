#!/usr/bin/env node
/** T225：部署 solodance-test-v1 包（1 独舞买腿 + v7 现行卖腿/stallClose/四门）——182 跑 --commit */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const { validatePack } = require('../src/web/services/StrategyLibraryService');
const COMMIT = process.argv.includes('--commit');
const SOLO_LEG = {
  action: 'buy', priority: 1,
  condition: 'quietSpanMs >= 60000 AND quietSurgeBuyBnb >= 0.4 AND quietSurgeSec <= 30 '
    + 'AND quietExitVsLaunchPct >= 0 AND quietExitVsLaunchPct <= 28.5 '
    + 'AND currentVsLaunchPct > 0 AND currentVsLaunchPct <= 28.5 '
    + 'AND quietExitBigBuyers == 1 AND quietExitLatchHoldPct > 0 '
    + 'AND quietExitEndWithSell == 1 AND actTotalBnb60Ex15 <= 0.05 AND quietExitOthersBuyBnb <= 0.3 '
    + 'AND actTotalBnb >= 0.1 AND tokenAgeSec >= 15 '
    + 'AND launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10 '
    + 'AND (launchBuyBundleWaves < 2 OR launchBuyBundleDominancePct < 30) AND cheatCrewBuyBnb == 0',
  maxExecutions: null, buyPhase: 'first',
  signalGate: { maxTriggers: 2, recheckCondition: "preCheatResult == 'unhealthy' OR priceBackToAlmostLaunch == 1", fpRetry: 2, bpPassLevels: ['good', 'neutral'] },
  description: '独舞臂（T225 用户时序版 2026-11-23：「开盘大户小户买→大户小户卖→(大户留仓)沉寂→拉盘；盘面干净=卖出潮后无新资金跟进」）。八键：①quietSpan≥60s 死透沉寂②surge≥0.4∧≤30s 拉盘涌入③出口价∈[0,28.5] 未破发（T130 地板口径）④现价∈(0,28.5] 低位⑤quietExitBigBuyers==1 活跃段唯一大户（ZKind 1.47B 接力盘切）⑥quietExitLatchHoldPct>0 出口留仓⑦quietExitEndWithSell==1 卖收尾⑧quietExitTailBuyBnbEx≤0.1 尾窗无新买（剔 latch 自买；LAB=0/개구리씨 剔自买后≈0.1 散户零星）。刻意不带人气门（用户裁定散户出清场景 holdersExDust 无意义）与 tradeCount/buyVolume 量门（开盘热闹允许）。对拍专用包：候选池 8 票（2 毕业+6 死盘）Case 集合通道',
  cards: 4,
};
(async () => {
  const db = dbManager.getClient();
  const { data: curArr } = await db.from('strategy_library').select('definition').eq('name', 'trading-standard-v1').order('version', { ascending: false }).limit(1);
  const v7 = curArr[0].definition;
  const def = {
    buyLegs: [SOLO_LEG],
    sellLegs: v7.sellLegs,
    stallClose: v7.stallClose,
    modules: v7.modules,
  };
  const check = validatePack(def);
  if (!check.valid) { console.error('包校验失败:\n  - ' + check.errors.join('\n  - ')); process.exit(1); }
  console.log(`solodance-test-v1：买 ${def.buyLegs.length} 腿 / 卖 ${def.sellLegs.length} 腿 | modules=${JSON.stringify(def.modules)}`);
  if (!COMMIT) { console.log('(dry-run；182 加 --commit 入库)'); process.exit(0); }
  const { data: exArr } = await db.from('strategy_library').select('id, version').eq('name', 'solodance-test-v1').order('version', { ascending: false }).limit(1);
  const existing = exArr[0];
  if (existing) {
    const { error } = await db.from('strategy_library').update({ definition: def, description: 'T225 独舞对拍专用包（1 独舞买腿+现行 v7 卖腿）', updated_at: new Date().toISOString() }).eq('id', existing.id);
    if (error) throw new Error(error.message);
    console.log('已更新 solodance-test-v1', existing.id, 'v' + existing.version);
  } else {
    const { data: ins, error } = await db.from('strategy_library')
      .insert({ name: 'solodance-test-v1', description: 'T225 独舞对拍专用包（1 独舞买腿+现行 v7 卖腿）', definition: def })
      .select('id').single();
    if (error) throw new Error(error.message);
    console.log('已插入 solodance-test-v1', ins.id);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
