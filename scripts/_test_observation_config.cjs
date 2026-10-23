#!/usr/bin/env node
/**
 * 观察信号机制源码形状锁定单测（2026-10-23 ₿DOG 案）
 *
 * 防回归断言（narrative_retry_config 同款源码口径锁定）：
 *  - 引擎消费点：enabled === true 才构造 / 挂载点在 _onFactorsUpdated 买腿分支 /
 *    evaluate 同步直调（无 await 不阻塞 tick 链）
 *  - BacktestEngine 零接线（回测不接观察信号，时序语义红线）
 *  - web-server 校验块 / signals 路由 excludeSignalType 透传
 *  - 模板三处（表单默认不勾 / 回填 / collect 三分支）+ experiments.js flapWs 复制携带
 *  - signals 页：筛选选项 / 灰底徽章 / 手工买按钮 POST manual-trade
 *  - TradeSignal.validate 放行 OBSERVE；docs/current_db.sql CHECK 含 OBSERVE
 *
 * 零 DB 零网络：纯源码文本断言。
 * 用法：node scripts/_test_observation_config.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
const includes = (src, needle) => src.includes(needle);

// ══ A. 引擎消费点（FourMemeWssTradingEngine）══
{
  const eng = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
  check('A1 enabled===true 才构造', includes(eng, "obsCfg.enabled === true"), true);
  check('A2 _mergedWsConfig 读段', includes(eng, "this._mergedWsConfig().observationSignals"), true);
  check('A3 init 重建调用', includes(eng, "this._observationService.init()"), true);
  check('A4 init 失败降级置 null', /catch[\s\S]{0,200}this\._observationService = null/.test(eng), true);
  // 挂载点在买腿分支：与 _scheduleDebouncedBuy 同分支且在叙事触发检查之后
  const buyBranch = eng.match(/_walletProfilePrefetchCheck\(tokenAddress, factors, token\);[\s\S]{0,700}?_scheduleDebouncedBuy\(tokenAddress, tick\);/);
  check('A5 挂载点在买腿分支内', buyBranch !== null, true);
  if (buyBranch) {
    check('A6 evaluate 同步直调（无 await）', includes(buyBranch[0], "this._observationService.evaluate(token, factors, tick.timestamp)"), true);
    check('A7 判空防未启用', /if \(this\._observationService\)/.test(buyBranch[0]), true);
  }
}

// ══ B. BacktestEngine 零接线 ══
{
  const bt = read('src/trading-engine/implementations/BacktestEngine.js');
  check('B1 BacktestEngine 无 observationSignals', includes(bt, 'observationSignals'), false);
  check('B2 BacktestEngine 无 OBSERVE', includes(bt, 'OBSERVE'), false);
}

// ══ C. 服务类形状 ══
{
  const svc = read('src/trading-engine/core/ObservationSignalService.js');
  check('C1 signal_type OBSERVE', includes(svc, "signalType: 'OBSERVE'"), true);
  check('C2 action hold', includes(svc, "action: 'hold'"), true);
  check('C3 叙事臂 2|3 固定', includes(svc, 'factors.narrativeRating === 2 || factors.narrativeRating === 3'), true);
  check('C4 市值臂严格大于', includes(svc, 'factors.marketCap > cfg.marketCapThreshold'), true);
  check('C5 首行无视间隔', includes(svc, 'state.count > 0 && nowMs - state.lastAt < cfg.intervalMs'), true);
  check('C6 fire-and-forget 不回滚', includes(svc, '丢该行不回滚'), true);
  check('C7 分页拉全（max-rows 截断坑防线）', includes(svc, '} while (rows.length === PAGE);'), true);
  check('C8 范围断言与实现同源', includes(svc, 'maxPerToken: [1, 10]') && includes(svc, 'intervalMs: [5000, 3600000]') && includes(svc, 'marketCapThreshold: [0, 1000000]'), true);
}

// ══ D. web-server 校验与路由 ══
{
  const ws = read('src/web-server.js');
  check('D1 校验块存在', includes(ws, 'observationSignals 段形状非法'), true);
  check('D2 两 secKey 循环', includes(ws, "for (const secKey of ['fourmemeWs', 'flapWs']) {\n            const obs ="), true);
  check('D3 四键校验文案', ['observationSignals.enabled 须为布尔', 'maxPerToken 须为整数 [1,10]',
    'intervalMs 须为整数 [5000,3600000]', 'marketCapThreshold 须为整数 [0,1000000]']
    .every(s => includes(ws, s)), true);
  check('D4 signals 路由透传 excludeSignalType', includes(ws, 'excludeSignalType: req.query.excludeSignalType'), true);
}

// ══ E. 模板三处 + 复制链 ══
{
  const html = read('src/web/templates/create_experiment.html');
  check('E1 表单区存在', includes(html, 'id="observation-signals-section"'), true);
  check('E2 checkbox 默认不勾（无 checked 属性）', /<input type="checkbox" id="obs-enabled" class="rounded">/.test(html), true);
  check('E3 三个数字输入', ['obs-interval-ms', 'obs-max-per-token', 'obs-marketcap-threshold'].every(id => includes(html, `id="${id}"`)), true);
  check('E4 回填 enabled===true 才勾', includes(html, 'obsCb.checked = obs.enabled === true'), true);
  check('E5 collect 回测剥离', /tradingMode === 'backtest'\) \{[\s\S]{0,200}delete adv\[k\]\.observationSignals/.test(html), true);
  check('E6 未勾删段（关=删段物化）', includes(html, 'delete adv[sec].observationSignals'), true);
  check('E7 勾选写段 enabled:true', includes(html, 'observationSignals: { ...(adv[sec]?.observationSignals || {}), enabled: true'), true);
  check('E8 删另一段同键', includes(html, 'delete adv[other].observationSignals'), true);
  const exp = read('src/web/static/js/experiments.js');
  check('E9 复制携带 flapWs', includes(exp, 'copyData.flapWs = config.flapWs'), true);
}

// ══ F. signals 页 ══
{
  const js = read('src/web/static/js/experiment_signals.js');
  const html = read('src/web/templates/experiment_signals.html');
  check('F1 筛选选项', includes(html, '<option value="OBSERVE">观察信号</option>'), true);
  check('F2 OBSERVE 走 signalType eq', includes(js, "params.append('signalType', 'OBSERVE')"), true);
  check('F3 默认视图排除', includes(js, "params.append('excludeSignalType', 'OBSERVE')"), true);
  check('F4 action 参数小写修复', includes(js, "params.append('action', this.currentFilters.action.toLowerCase())"), true);
  check('F5 灰底观察徽章', includes(js, 'isObserve ?'), true);
  check('F6 observation 信息块', includes(js, 'metadata.observation || {}'), true);
  check('F7 手工买按钮 POST manual-trade', /manual-trade/.test(js) && includes(js, '.obs-manual-buy'), true);
  const ds = read('src/web/services/ExperimentDataService.js');
  check('F8 服务端 excludeSignalType neq', includes(ds, 'options.excludeSignalType') && includes(ds, "neq('signal_type'"), true);
}

// ══ G. 实体与 DDL 同步 ══
{
  const ts = read('src/trading-engine/entities/TradeSignal.js');
  check('G1 validate 放行 OBSERVE', includes(ts, "['BUY', 'SELL', 'OBSERVE']"), true);
  const ddl = read('docs/current_db.sql');
  check('G2 current_db.sql CHECK 含 OBSERVE', includes(ddl, "'SELL'::character varying, 'OBSERVE'::character varying"), true);
  const mig = read('migrations/alter_strategy_signals_add_observe.sql');
  check('G3 migration 文件存在且 DROP/ADD 约束', includes(mig, 'DROP CONSTRAINT IF EXISTS') && includes(mig, "ADD CONSTRAINT"), true);
}

console.log(`\n结果: ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
