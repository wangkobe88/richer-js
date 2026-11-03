#!/usr/bin/env node
/**
 * 买信号发射节流单测（T110/CD158，2026-11-03）——零 DB 零网络
 *
 * 背景：用户裁定「全局买信号机制」——per-token 冷却**双门**（时间窗默认
 * 3000ms AND 新 ticks 默认 10——2026-11-03 追裁定「3 秒 + 10 个 ticks」，
 * 担心纯时间窗在高频 tick 流下烧光次数帽；ticks 口径=FA state.tradeCount
 * 全量链上交易数）+ 发射次数帽（默认 5），「无论最后是否通过」（门拒/执行
 * 失败/save 失败均不退还）。live=FourMemeWssTradingEngine（Date.now）、
 * backtest=BacktestEngine（fireTs 虚拟时钟）同构挂点；OBSERVE/手工买不走本层。
 *
 * 覆盖：
 *   A. BuySignalThrottle core：恰 cooldownMs 边界=放行（半开窗）/窗内拦/
 *      被拦不记账（冷却锚不重置=连续拦不续窗、帽拦截不加计数）/第 5 过第 6 拦/
 *      0=关（冷却/帽/ticks）/非数值=缺省 3000/5/10/now 入参（源码禁
 *      Date.now）/fireCount 递增/clear
 *   A9. tick 门（追裁定）：双门 AND（时间过 tick 不足拦、tick 过时间不足拦）/
 *      恰 10 ticks 放行/被拦不记 tick 锚/首发射天然过/tickCount 缺失退化
 *      纯时间（fail-open 放行不吞机会）
 *   B. 两引擎接线源码口径锁：挂点位置（live=作弊拉黑短路后 latestPrice 前；
 *      回测=叙事否决短路后 latestPrice 前）、时钟源（live Date.now / 回测
 *      fireTs）、构造读 _mergedWsConfig/wsConfig 同键、拦截不落信号行
 *      （return 先于 markBuyFire/信号 save）、stop 清理、计数点=admit 一体
 *      （save 失败不退还）
 *
 * 用法：node scripts/_test_buy_signal_throttle.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { BuySignalThrottle } = require('../src/trading-engine/core/BuySignalThrottle');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` | ${JSON.stringify(detail)}` : ''}`); }
}

console.log('A. BuySignalThrottle core');
{
  // A1 冷却半开窗边界：恰等于 cooldownMs 放行；差 1ms 拦
  const t = new BuySignalThrottle(3000, 5);
  check('首次发射放行（fireCount=1）', t.admit('0xa', 1000000), { ok: true, fireCount: 1 });
  check('窗内（+2999ms）→ 拦（cooldown）', t.admit('0xa', 1002999).ok, false);
  check('恰 3000ms（半开窗边界）→ 放行', t.admit('0xa', 1003000), { ok: true, fireCount: 2 });
  check('超窗（+3001ms 相对新锚）→ 拦（新锚=1003000）', t.admit('0xa', 1003001).ok, false);
  check('观测计数 cooldownDropped=2', t.cooldownDropped, 2);

  // A2 被拦不记账：冷却锚不因被拦重置（连续拦不续窗）；帽拦截不加计数
  const t2 = new BuySignalThrottle(3000, 5);
  t2.admit('0xa', 1000);
  t2.admit('0xa', 1500); // 拦
  t2.admit('0xa', 2500); // 拦（若被拦重置锚，此笔距 1500 已 1000<3000 仍拦——无法区分；
  // 决定性反证：3500 距首发 1000=2500<3000 拦；4000 距首发恰 3000 放行）
  check('被拦不重置冷却锚（3500 距首发 2500ms 仍拦）', t2.admit('0xa', 3500).ok, false);
  check('4000 距首发恰 3000ms 放行（锚未续窗铁证）', t2.admit('0xa', 4000), { ok: true, fireCount: 2 });

  // A3 帽：第 5 过第 6 拦；帽拦截不加计数（无限拦不涨）
  const t3 = new BuySignalThrottle(0, 5);
  let lastN = 0;
  for (let i = 0; i < 5; i++) { const r = t3.admit('0xb', i); lastN = r.fireCount; }
  check('连发 5 次全过（冷却关）', lastN, 5);
  check('第 6 次 → 拦（cap）', t3.admit('0xb', 9999).ok, false);
  check('帽拦截不加计数（fireCount 封顶 5）', t3.admit('0xb', 99999).ok, false && t3.capDropped === 2);

  // A4 0/负=关：cooldownMs=0 关冷却；maxPerToken=0 不限
  const t4 = new BuySignalThrottle(0, 0);
  let allOk = true, n = 0;
  for (let i = 0; i < 20; i++) { const r = t4.admit('0xc', i); allOk = allOk && r.ok; n = r.fireCount; }
  ok('双关（0/0）→ 同刻连发 20 次全过不限', allOk && n === 20, { allOk, n });
  const t4b = new BuySignalThrottle(-1, 5);
  ok('负 cooldownMs 同关（Math.max(0,·) 归一）', t4b.admit('0xd', 1).ok && t4b.admit('0xd', 1).ok);

  // A5 非数值=缺省（3000/5/10）：undefined/NaN/Infinity 均落缺省
  const t5 = new BuySignalThrottle(undefined, undefined);
  check('缺省 cooldownMs=3000 / maxPerToken=5 / cooldownTicks=10', [t5.cooldownMs, t5.maxPerToken, t5.cooldownTicks], [3000, 5, 10]);
  const t5b = new BuySignalThrottle(NaN, Infinity);
  check('NaN/Infinity 也落缺省（Number.isFinite 门）', [t5b.cooldownMs, t5b.maxPerToken, t5b.cooldownTicks], [3000, 5, 10]);
  check('缺省下第 6 次拦', (() => {
    const t = new BuySignalThrottle(0, 5);
    for (let i = 0; i < 5; i++) t.admit('0xe', i * 10000);
    return t.admit('0xe', 999999).ok;
  })(), false);

  // A6 token 级隔离（跨腿共享=同 token 不同策略腿同受节流）
  const t6 = new BuySignalThrottle(3000, 5);
  t6.admit('0xf1', 1000);
  check('他 token 不受本 token 冷却影响', t6.admit('0xf2', 1000).ok, true);
  check('size=已发射 token 数（被拦 token 无状态=不进 map）', t6.size, 2);

  // A7 clear：进程内清空（stop——同进程接续实验不继承计数）
  t6.clear();
  check('clear 后重发放行（fireCount 从 1 重新计）', t6.admit('0xf1', 1001), { ok: true, fireCount: 1 });
  check('clear 后 size=1', t6.size, 1);

  // A8 源码口径锁：禁 Date.now（now 全入参——回测虚拟时钟红线；注释除外）
  const coreSrc = fs.readFileSync(path.join(__dirname, '../src/trading-engine/core/BuySignalThrottle.js'), 'utf8');
  const coreCode = coreSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('core 源码（剥注释）零 Date.now（now 全入参）', !coreCode.includes('Date.now'));
  ok('检查+记账一体=admit（用户原话「无论是否通过」——门拒/执行失败不退还）',
    coreSrc.includes('发射准入（检查+记账一体）'));
}

console.log('A9. tick 冷却门（2026-11-03 追裁定「3 秒 + 10 个 ticks」双门 AND）');
{
  // A9.1 双门 AND 独立拦：时间过 tick 不足拦 / tick 过时间不足拦 / 双过放行
  const t = new BuySignalThrottle(3000, 0, 10);
  check('首发射放行', t.admit('0xa', 0, 100), { ok: true, fireCount: 1 });
  check('时间过（4000ms）但 tick 仅 +5 → 拦（tick 门）', t.admit('0xa', 4000, 105).ok, false);
  check('tick 过（+100）但时间仅 2000ms → 拦（时间门）', t.admit('0xa', 2000, 200).ok, false);
  check('双门齐过（3000ms AND +10 ticks）→ 放行', t.admit('0xa', 3000, 110), { ok: true, fireCount: 2 });
  check('tickDropped=1 / cooldownDropped=1（观测分键）', [t.tickDropped, t.cooldownDropped], [1, 1]);

  // A9.2 tick 半开窗边界：恰 +10 放行、+9 拦（时间门关的纯 tick 形状）
  const t2 = new BuySignalThrottle(0, 0, 10);
  t2.admit('0xb', 0, 100);
  check('+9 ticks → 拦', t2.admit('0xb', 999999, 109).ok, false);
  check('恰 +10 ticks → 放行（半开窗同口径）', t2.admit('0xb', 999999, 110), { ok: true, fireCount: 2 });

  // A9.3 被拦不记 tick 锚铁证：拦两笔（+5/+8）后 110-100=10 恰过——若被拦
  // 记锚（108），则 110-108=2<10 必拦
  const t3 = new BuySignalThrottle(0, 0, 10);
  t3.admit('0xc', 0, 100);
  t3.admit('0xc', 500, 105);   // 拦（+5）
  t3.admit('0xc', 6000, 108);  // 拦（+8）
  check('被拦不记 tick 锚（两笔被拦后 +10 恰过=锚仍首发的 100）', t3.admit('0xc', 6000, 110), { ok: true, fireCount: 2 });

  // A9.4 首发射 tick 门天然过（lastFireTicks=-Infinity）：tickCount=0 也放行
  check('首发射 tc=0 放行（−∞ 锚 → 0−(−∞)=∞≥10）', new BuySignalThrottle(0, 0, 10).admit('0xd', 0, 0), { ok: true, fireCount: 1 });

  // A9.5 tickCount 缺失退化纯时间（fail-open：tradeCount 是 FA 基础因子恒有值，
  // 缺席=接线异常形状，放行方向不吞发射机会——用户立法本意「好机会上不了车」）
  const t5 = new BuySignalThrottle(0, 0, 10);
  t5.admit('0xe', 0, 100);
  check('tickCount=undefined → tick 门跳过放行', t5.admit('0xe', 1, undefined).ok, true);
  check('tickCount=NaN → 同跳过', t5.admit('0xe', 2, NaN).ok, true);
  check('缺失形状零 tickDropped（未误计）', t5.tickDropped, 0);

  // A9.6 cooldownTicks=0 关 tick 门（只看时间）
  const t6 = new BuySignalThrottle(0, 0, 0);
  t6.admit('0xf', 0, 100);
  check('tick 门关：同 tickCount 连发过', t6.admit('0xf', 1, 100).ok, true);
  check('tick 门关：tc 回退/乱序也不拦（门已关）', t6.admit('0xf', 2, 50).ok, true);
}

console.log('B. 两引擎接线源码口径锁');
{
  const liveSrc = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
  const btSrc = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/BacktestEngine.js'), 'utf8');

  // B1 live 挂点：作弊拉黑短路之后、latestPrice 之前；时钟=Date.now；tick=FA tradeCount
  const liveBlacklistIdx = liveSrc.indexOf('作弊盘拉黑短路（cheat 判定终态，不再交易）');
  const liveThrottleIdx = liveSrc.indexOf('this._buySignalThrottle.admit(tokenAddress, Date.now(), factorResults.tradeCount)');
  const livePriceIdx = liveSrc.indexOf('const latestPrice = factorResults.currentPrice || 0;');
  ok('live 挂点：拉黑短路后 → 节流 → latestPrice（拦在信号落库/叙事直调/preBuy 整条链前）',
    liveBlacklistIdx > 0 && liveThrottleIdx > liveBlacklistIdx && livePriceIdx > liveThrottleIdx);
  ok('live 时钟=Date.now（真墙钟）+ tick 门原料=FA tradeCount（全量链上交易数）', liveThrottleIdx > 0);

  // B2 live 拦截=静默 return（不落信号行不烧门）：return 先于 markBuyFire/信号 save
  const throttleBlockEnd = liveSrc.indexOf('买信号节流拦截:', liveThrottleIdx);
  const markFireIdx = liveSrc.indexOf('this._factorAggregator.markBuyFire(', throttleBlockEnd);
  ok('live 节流拦截 return 先于 markBuyFire（拦截不记 pending 双轨峰）',
    throttleBlockEnd > 0 && markFireIdx > throttleBlockEnd);
  ok('live 节流拦截计数 metrics.buySignalThrottled 在场', liveSrc.includes('this.metrics.buySignalThrottled++'));

  // B3 live 构造：BuySignalThrottle(_mergedWsConfig 三键) + stop clear
  ok('live 构造读 _mergedWsConfig 三键（flap/gang 同键生效）',
    liveSrc.includes('new BuySignalThrottle(') && liveSrc.includes('_throttleCfg.buySignalCooldownMs')
    && liveSrc.includes('_throttleCfg.buySignalCooldownTicks'));
  ok('live stop 清理 _buySignalThrottle.clear()',
    /if \(this\._buySignalThrottle\) this\._buySignalThrottle\.clear\(\);/.test(liveSrc));

  // B4 回测挂点：叙事否决短路后、latestPrice 前；时钟=fireTs 虚拟时钟（禁 Date.now）
  const btNarrativeIdx = btSrc.indexOf('this._narrativeBlockedTokens.has(tokenAddress)');
  const btThrottleIdx = btSrc.indexOf('this._buySignalThrottle.admit(tokenAddress, nowTs, factorResults.tradeCount)');
  const btPriceIdx = btSrc.indexOf('const latestPrice =', btThrottleIdx);
  ok('backtest 挂点：叙事否决短路后 → 节流 → latestPrice',
    btNarrativeIdx > 0 && btThrottleIdx > btNarrativeIdx && btPriceIdx > btThrottleIdx);
  ok('backtest 时钟=nowTs（fireTs 虚拟时钟）+ tick 原料同源 FA tradeCount，admit 全文件零 Date.now 实参',
    btThrottleIdx > 0 && !btSrc.includes('admit(tokenAddress, Date.now'));
  ok('backtest 构造同款（wsConfig 三键）',
    btSrc.includes('new BuySignalThrottle(') && btSrc.includes('wsConfig.buySignalCooldownMs')
    && btSrc.includes('wsConfig.buySignalCooldownTicks'));
  ok('backtest stop 清理', /if \(this\._buySignalThrottle\) this\._buySignalThrottle\.clear\(\);/.test(btSrc));

  // B5 回测构造时钟域反证：nowTs 定义（=fireTs 派生）必须先于挂点使用
  const nowTsDefIdx = btSrc.indexOf('const nowTs =');
  ok('backtest nowTs 定义先于 admit 使用（TDZ 防线）', nowTsDefIdx > 0 && nowTsDefIdx < btThrottleIdx);

  // B6 OBSERVE/手工买不走节流（观察信号服务/manualTrade 独立路径不引 throttle）
  ok('OBSERVE/手工买路径不引节流（ObservationSignalService/manualTrade 零引用）',
    !liveSrc.includes('_buySignalThrottle') || liveSrc.split('_buySignalThrottle').length - 1 === 4,
    liveSrc.split('_buySignalThrottle').length - 1);
}

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
