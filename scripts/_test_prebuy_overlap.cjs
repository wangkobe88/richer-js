#!/usr/bin/env node
// P10 preBuy 早发并发的结构单测（2026-10-13 perf11 画像案）：holder/creator/
// sameName 三项不消费 early 产物，与 early 检查同时发起；cluster/strong 消费
// earlyParticipantCheck._trades 必须等 early 完成后再发。前身 early 先 await 再
// 五项并发 → sameName AVE 网络与 early 的 sniper 查询/六族 CPU 串行堆叠。
// 零 DB 零网络：全子服务打桩（Object.create(prototype) 实例覆盖先例 =
// _test_backtest_perf_probe）。用法：node scripts/_test_prebuy_overlap.cjs
'use strict';

const fs = require('fs');
const path = require('path');
const { PreBuyCheckService } = require('../src/trading-engine/pre-check/PreBuyCheckService');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
const eq = (name, v, expected) => check(name, v, expected);

/** 构造打桩服务：events 数组记录调用序；early 用手动 deferred 控制完成时点 */
function mkSvc(events, opts = {}) {
  const svc = Object.create(PreBuyCheckService.prototype);
  svc.logger = { info() {}, error() {}, warn() {}, debug() {} };
  svc._performHolderCheck = async () => {
    events.push('holder:start');
    if (opts.holderRejects) throw new Error('holder boom');
    return { holder: 'ok' };
  };
  svc._performWalletClusterCheck = async (early) => {
    events.push('cluster:start');
    return { cluster: early._trades.length };
  };
  svc._checkCreatorIsNotBadDevWallet = async () => { events.push('creator:start'); return { creator: 'ok' }; };
  svc._performStrongTraderPositionCheck = async (_a, early) => {
    events.push('strong:start');
    return { strong: early._trades.length };
  };
  svc._performSameNameCheck = async () => { events.push('sameName:start'); return { sameName: 'ok' }; };
  if (opts.earlyThrows) {
    svc._performEarlyParticipantCheck = async () => { events.push('early:start'); throw new Error('early boom'); };
  } else {
    svc._performEarlyParticipantCheck = () => {
      events.push('early:start');
      return new Promise((resolve) => {
        svc._resolveEarly = () => { events.push('early:end'); resolve({ _trades: [1, 2, 3] }); };
      });
    };
  }
  svc.holderService = { checkEarlyTradersRisk: async () => ({ earlyTraderCanBuy: true }) };
  svc.walletLabelService = { calculateLabelFactors: () => ({ label: 1 }) };
  svc.earlyParticipantService = { getEmptyFactorValues: () => ({}) };
  svc.walletClusterService = { getEmptyFactorValues: () => ({}) };
  svc.strongTraderPositionService = { getEmptyFactorValues: () => ({}) };
  svc._safeGetErrorMessage = (e) => e.message;
  svc._evaluateWithCondition = (holder, early, cluster, label, creator, strong, trader, cond) => {
    events.push('eval');
    return { canBuy: true, holderSentinel: holder.holder, clusterSentinel: cluster.cluster, checkDuration: 0 };
  };
  return svc;
}

/** 跑完一次 performAllChecks（默认 early stub 是手动 deferred，冲微任务后放行） */
async function runToCompletion(svc) {
  const p = svc.performAllChecks('0xa', null, 'exp', null);
  if (svc._resolveEarly) {
    await Promise.resolve(); await Promise.resolve();
    svc._resolveEarly();
  }
  return p;
}

async function main() {
  let unhandled = 0;
  process.on('unhandledRejection', () => { unhandled++; });

  // ── A. 早发并发：三项在 early 完成前已发起；cluster/strong 在 early 完成后才发起 ──
  console.log('A. 早发并发时序');
  {
    const events = [];
    const svc = mkSvc(events);
    const runP = svc.performAllChecks('0xa', null, 'exp', null);
    await Promise.resolve(); await Promise.resolve(); // 冲微任务队列，让同步起跑落盘
    eq('A1 三项早发（early 挂起期间已 start）',
      events.filter(e => e.endsWith(':start')).sort(),
      ['creator:start', 'early:start', 'holder:start', 'sameName:start'].sort());
    eq('A2 early 尚未完成', events.includes('early:end'), false);
    eq('A3 cluster/strong 未提前（依赖 early 产物）',
      events.includes('cluster:start') || events.includes('strong:start'), false);

    svc._resolveEarly();
    const res = await runP;
    eq('A4 early 完成后 cluster/strong 补发',
      events.indexOf('cluster:start') > events.indexOf('early:end')
      && events.indexOf('strong:start') > events.indexOf('early:end'), true);
    eq('A5 五项全部执行', events.filter(e => e.endsWith(':start')).length, 6); // 含 early 共 6 start
    eq('A6 评估在最后', events[events.length - 1], 'eval');
    eq('A7 结果透传（sentinel 穿过 Promise.all）', res.holderSentinel, 'ok');
    eq('A8 cluster 消费 early._trades', res.clusterSentinel, 3);
  }

  // ── B. P8 计时键仍工作（早发三项从发起计到完成） ──
  console.log('B. 计时探针');
  {
    const events = [];
    const svc = mkSvc(events);
    await runToCompletion(svc);
    const s = svc.getPerfStats();
    for (const k of ['earlyMs', 'parallelMs', 'parHolder', 'parCluster', 'parCreator', 'parStrong', 'parSameName', 'labelMs']) {
      check(`B1 键 ${k} 存在且为非负数`, typeof s[k] === 'number' && s[k] >= 0, true);
    }
    eq('B2 调用计数', s.calls, 1);
  }

  // ── C. 拒绝传播：holder 拒绝 → Promise.all 拒绝 → 外层 catch fail-closed ──
  console.log('C. 拒绝传播');
  {
    const events = [];
    const svc = mkSvc(events, { holderRejects: true });
    const res = await runToCompletion(svc);
    eq('C1 五项拒绝经 Promise.all 传播，canBuy=false', res.canBuy, false);
    eq('C2 失败路径计数', svc.getPerfStats().calls, 1);
  }

  // ── D. 结构性不可达早抛防线：early 抛 + holder 拒绝同时发生，无 unhandled rejection ──
  console.log('D. unhandled rejection 防线');
  {
    const events = [];
    const svc = mkSvc(events, { earlyThrows: true, holderRejects: true });
    const res = await svc.performAllChecks('0xa', null, 'exp', null);
    eq('D1 early 抛出 fail-closed', res.canBuy, false);
    await new Promise(r => setTimeout(r, 10)); // 给漂浮 rejection 现形窗口
    eq('D2 无 unhandled rejection（catch sink 生效）', unhandled, 0);
  }

  // ── E. 源码口径（红线 13：并发结构锁定） ──
  console.log('E. 源码口径');
  {
    const src = fs.readFileSync(path.join(__dirname, '../src/trading-engine/pre-check/PreBuyCheckService.js'), 'utf8');
    const iHolder = src.indexOf("_timed('parHolder'");
    const iCreator = src.indexOf("_timed('parCreator'");
    const iSameName = src.indexOf("_timed('parSameName'");
    const iEarlyAwait = src.indexOf('await this._performEarlyParticipantCheck(');
    const iAll = src.indexOf('await Promise.all([');
    check('E1 五个锚点齐全', [iHolder, iCreator, iSameName, iEarlyAwait, iAll].every(i => i > 0), true);
    eq('E2 三项早发先于 early await（文本序=发起序）',
      iHolder < iEarlyAwait && iCreator < iEarlyAwait && iSameName < iEarlyAwait, true);
    eq('E3 cluster/strong 在 early await 之后发起',
      src.indexOf("_timed('parCluster'") > iEarlyAwait && src.indexOf("_timed('parStrong'") > iEarlyAwait, true);
    // catch sink：三个早发 promise 各附一个（防早抛路径的漂浮 rejection）
    const sinks = src.match(/P\.catch\(\(\) => \{\}\)/g) || [];
    check('E4 早发 promise 各附 catch sink（3 个）', sinks.length, 3);
    eq('E5 Promise.all 仍收集五项',
      /await Promise\.all\(\[\s*holderP,\s*_timed\('parCluster'[\s\S]*?creatorP,[\s\S]*?sameNameP,/.test(src), true);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
