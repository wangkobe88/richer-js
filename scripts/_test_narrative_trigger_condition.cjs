#!/usr/bin/env node
/**
 * C84 叙事发起条件触发状态机单测（2026-10-17 买腿链路重构）——本地零 DB 零网络。
 *
 * 链路：tick 因子过门（narrativeTriggerCondition，如 buyVolumeBnb >= 0.5 OR
 * narrativeRetryDue == 1）→ 后台多轮叙事分析（首轮 reason='condition'；账号型
 * rating=1 到期补轮 reason='retry' 带 ignoreCache+invalidateAccountCorpus，上限
 * maxAnalyses）→ FA 投影（narrativeRating/Rounds/RetryDue）→ 单一买条件
 * （narrativeRating == 2 OR == 3）裁决。分析未完成/未通过/失败(9) = 条件恒
 * false = 不产生买信号（无 signal 行，用户需求第二点）。
 *
 * 覆盖：
 *   A. 触发条件解析（legacy 零激活/空白/trim/卖腿忽略/缓存）
 *   B. 首轮状态机 + inFlight 抑制 + 完成回填（FA 投影/轮次行 insert+update 形状）
 *   C. retry 四门（interval/rating≠1/accountOnly/上限）+ 条件不满足
 *   I. C162 corpusEmpty 零语料补轮臂（hasNoOwnedCorpus 纯函数/60s 节奏/8 轮上限/
 *      accountOnly 臂优先/非两臂不重试/完成回填投影/FA retryDue 臂投影）
 *   D. catch 兜底（rating 归 9 拦截）/ 评级归一 [1,2,3,9] 外 → null
 *   E. stop 清理 identity 反证（清态后完成回填不投影）
 *   F. 轮次表（insert 失败观测 fail-open 交易照跑 / rowId 缺失 update no-op）
 *   G. 事故反证：分析未完成时单一买条件恒 false（真 ConditionEvaluator 全串）
 *   H. 互斥 fail-fast（narrativeTriggerCondition × narrativeCallCondition）+ legacy 链仍在
 *
 * 零 DB 零网络：dbManager require.cache 打桩（未打桩路径真调会 fail）。
 * 用法：node scripts/_test_narrative_trigger_condition.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ══ dbManager 打桩（先于引擎模块加载）══
const dbOps = [];
let nextRowId = 100;
let INSERT_FAIL = false;
const DB_PATH = require.resolve(path.join(ROOT, 'src/services/dbManager'));
require.cache[DB_PATH] = {
  id: DB_PATH, filename: DB_PATH, loaded: true,
  exports: {
    dbManager: {
      getClient() {
        return {
          from(table) {
            const op = { table };
            dbOps.push(op);
            return {
              insert(row) {
                op.kind = 'insert'; op.row = row;
                return {
                  select() {
                    return {
                      single: async () => (INSERT_FAIL
                        ? { data: null, error: { message: 'mock insert 失败' } }
                        : { data: { id: nextRowId++ }, error: null }),
                    };
                  },
                };
              },
              update(patch) {
                op.kind = 'update'; op.patch = patch;
                return { eq(col, val) { op.eq = [col, val]; return async () => ({ error: null }); } };
              },
            };
          },
        };
      },
    },
  },
};

const { FourMemeWssTradingEngine } = require(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine'));
const FourMemeFactorAggregator = require(path.join(ROOT, 'src/services/FourMemeFactorAggregator'));
const { ConditionEvaluator } = require(path.join(ROOT, 'src/strategies/ConditionEvaluator'));
const { StrategyEngine } = require(path.join(ROOT, 'src/strategies/StrategyEngine'));
const { hasNoOwnedCorpus } = require(path.join(ROOT, 'src/trading-engine/pre-check/NarrativeDirectCaller'));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
async function checkAsync(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
const settle = () => new Promise(r => setImmediate(() => setImmediate(r)));

// ── 受控 getRating（deferred 队列）──
function makeRatingCtl() {
  const pending = [];
  return {
    calls: [],
    getRating(addr, opts) {
      this.calls.push({ addr, opts });
      return new Promise((res, rej) => pending.push({ res, rej }));
    },
    resolve(v) { pending.shift().res(v); },
    reject(e) { pending.shift().rej(e); },
    get inflight() { return pending.length; },
  };
}

// ── 引擎桩（prototype 借调，_test_stop_loss_rules 同款先例）──
let seq = 0;
function makeEng({ strategies, condTrue = true, ctl } = {}) {
  const eng = Object.create(FourMemeWssTradingEngine.prototype);
  eng._experimentId = 'exp-c84-test';
  eng.logger = { info() {}, warn() {}, error() {}, debug() {} };
  eng._narrativeTriggerStates = new Map();
  eng._narrativeTriggerCondCache = undefined;
  eng._narrativeTriggerIntervalMs = 10000;
  eng._narrativeTriggerMaxAnalyses = 3;
  eng._narrativeTriggerNoCorpusIntervalMs = 60000; // C162 零语料臂缺省（FA defaults 同源）
  eng._narrativeTriggerNoCorpusMaxAnalyses = 8;
  eng._strategyEngine = {
    evaluateCondition: () => condTrue,
    getAllStrategies: () => strategies || [{ action: 'buy', condition: 'buyVolumeBnb >= 1', narrativeTriggerCondition: 'buyVolumeBnb >= 0.5 OR narrativeRetryDue == 1' }],
  };
  eng._narrativeCaller = ctl || makeRatingCtl();
  eng.__addr = `0xtrig${++seq}`;
  return eng;
}
const TRIG = FourMemeWssTradingEngine.prototype._narrativeTriggerCheck;
const LAUNCH = FourMemeWssTradingEngine.prototype._narrativeTriggerLaunch;

// 单一买条件全文（库条目逐字，测试 G 段对拍）
const BUY_COND = 'buyVolumeBnb >= 1.0 AND tokenAgeSec < 90 AND holders > 3 AND (marketCap < 4500 OR holderTrendSlope > 0) AND marketCap < 12000 AND (marketCap < 5000 OR (bundleClusterSharePct < 50 AND top1HolderCircPct < 35 AND maxCopyWalletHolderCircPct < 20)) AND (narrativeRating == 2 OR narrativeRating == 3) AND (platform != \'flap\' OR earlyTradesRouterPct >= 30) AND earlyTradesPerWallet < 4';
const COND_BASE = {
  buyVolumeBnb: 2, tokenAgeSec: 50, holders: 10, marketCap: 6000, holderTrendSlope: 1,
  bundleClusterSharePct: 10, top1HolderCircPct: 10, maxCopyWalletHolderCircPct: 5,
  platform: 'fourmeme', earlyTradesRouterPct: 50, earlyTradesPerWallet: 1,
};

(async () => {
  // ═══════════════ A. 触发条件解析 ═══════════════
  console.log('A. 触发条件解析');
  {
    const eng = makeEng({ strategies: [{ action: 'buy', condition: 'buyVolumeBnb >= 1' }] });
    check('A1 legacy 腿无字段 → 条件 null + check 零激活（无状态无调用）', () => {
      assert.strictEqual(eng._narrativeTriggerCondition(), null);
      TRIG.call(eng, eng.__addr, {}, null);
      assert.strictEqual(eng._narrativeTriggerStates.size, 0);
      assert.strictEqual(eng._narrativeCaller.calls.length, 0);
    });
    check('A2 空白串=缺字段（trim 门）', () => {
      const e2 = makeEng({ strategies: [{ action: 'buy', condition: 'x', narrativeTriggerCondition: '   ' }] });
      assert.strictEqual(e2._narrativeTriggerCondition(), null);
    });
    check('A3 卖腿忽略，取首条买腿', () => {
      const e3 = makeEng({
        strategies: [
          { action: 'sell', condition: 'x', narrativeTriggerCondition: 'sellCond' },
          { action: 'buy', condition: 'x', narrativeTriggerCondition: 'buyCond' },
        ],
      });
      assert.strictEqual(e3._narrativeTriggerCondition(), 'buyCond');
    });
    check('A4 条件 trim 后缓存（二次调用零重扫）', () => {
      const e4 = makeEng({
        strategies: [{ action: 'buy', condition: 'x', narrativeTriggerCondition: '  cond  ' }],
      });
      assert.strictEqual(e4._narrativeTriggerCondition(), 'cond');
      assert.strictEqual(e4._narrativeTriggerCondCache, 'cond');
    });
  }

  // ═══════════════ B. 首轮 + inFlight + 完成回填 ═══════════════
  console.log('B. 首轮状态机');
  await checkAsync('B1 首轮：rounds=1/inFlight/FA 投影/insert 行形状（reason=condition）', async () => {
    const eng = makeEng();
    TRIG.call(eng, eng.__addr, {}, null);
    const st = eng._narrativeTriggerStates.get(eng.__addr);
    assert.strictEqual(st.rounds, 1);
    assert.strictEqual(st.inFlight, true);
    assert.strictEqual(st.hasInitial, false);
    assert.deepStrictEqual(eng._narrativeCaller.calls[0].opts, {}); // 首轮无 override
    const proj = FourMemeFactorAggregator.getNarrativeFactors(eng.__addr);
    assert.strictEqual(proj.rating, null); // inFlight 期 rating null → 买门恒 false
    assert.strictEqual(proj.rounds, 1);
    assert.strictEqual(proj.inFlight, true);
    assert.strictEqual(proj.category, null); // inFlight 期无分类（Nightshift 案第四键）
    const ins = dbOps.find(o => o.kind === 'insert' && o.row.token_address === eng.__addr);
    assert.ok(ins, 'insert 行缺失');
    assert.strictEqual(ins.table, 'narrative_analysis_rounds');
    assert.strictEqual(ins.row.experiment_id, 'exp-c84-test');
    assert.strictEqual(ins.row.round_no, 1);
    assert.strictEqual(ins.row.trigger_reason, 'condition');
    assert.ok(/^\d{4}-\d{2}-\d{2}T.*Z$/.test(ins.row.started_at), 'started_at 非 ISO');
    await settle();
    assert.strictEqual(st.currentRowId, 100); // insert id 回填
    FourMemeFactorAggregator.clearNarrativeFactors(eng.__addr);
  });
  await checkAsync('B2 inFlight 抑制：进行中重复 tick 不再发起', async () => {
    const eng = makeEng();
    TRIG.call(eng, eng.__addr, {}, null);
    TRIG.call(eng, eng.__addr, {}, null);
    TRIG.call(eng, eng.__addr, {}, null);
    assert.strictEqual(eng._narrativeCaller.calls.length, 1);
    eng._narrativeCaller.resolve({ numericRating: 3, rating: 'high', durationMs: 10, fromCache: false, accountOnly: false });
    await settle();
    FourMemeFactorAggregator.clearNarrativeFactors(eng.__addr);
  });
  await checkAsync('B3 完成回填：rating=2/accountOnly/投影/update 行形状', async () => {
    const eng = makeEng();
    TRIG.call(eng, eng.__addr, {}, null);
    await settle(); // 等 insert id 回填 currentRowId（生产时序：DB ms 级 < 分析秒级）
    eng._narrativeCaller.resolve({
      numericRating: 2, rating: 'mid', durationMs: 80, fromCache: false, accountOnly: false,
      narrativeCategory: 'project', // Nightshift 案第四键：analyzer 顶层透出回填 st
      narrativeSuperIp: 1, narrativeSuperIpSlogan: 1, // C88 两标签（2026-10-18 CZ 出书簇）
    });
    await settle();
    const st = eng._narrativeTriggerStates.get(eng.__addr);
    assert.strictEqual(st.inFlight, false);
    assert.strictEqual(st.hasInitial, true);
    assert.strictEqual(st.lastRating, 2);
    assert.strictEqual(st.category, 'project'); // 完成时刻分类回填
    assert.strictEqual(st.superIp, 1); // C88 标签回填（漏=live/backtest 三态分裂）
    assert.strictEqual(st.recognizedEntitySlogan, 1);
    assert.ok(Number.isFinite(st.lastCompletedAt));
    const proj = FourMemeFactorAggregator.getNarrativeFactors(eng.__addr);
    assert.strictEqual(proj.rating, 2);
    assert.strictEqual(proj.inFlight, false);
    assert.strictEqual(proj.accountOnly, false);
    assert.strictEqual(proj.category, 'project'); // 投影含第四键（FA narrativeCategory 源）
    assert.strictEqual(proj.superIp, 1); // 投影含 C88 两标签（FA 因子源）
    assert.strictEqual(proj.recognizedEntitySlogan, 1);
    const upd = dbOps.filter(o => o.kind === 'update').pop();
    assert.strictEqual(upd.table, 'narrative_analysis_rounds');
    assert.strictEqual(upd.eq[0], 'id');
    assert.strictEqual(upd.patch.rating, 2);
    assert.strictEqual(upd.patch.from_cache, false);
    assert.strictEqual(upd.patch.error, null);
    assert.ok(/^\d{4}-\d{2}-\d{2}T.*Z$/.test(upd.patch.completed_at));
    FourMemeFactorAggregator.clearNarrativeFactors(eng.__addr);
  });

  // ═══════════════ C. retry 四门 ═══════════════
  console.log('C. retry 补轮门');
  async function completeRound1(eng, over = {}) {
    TRIG.call(eng, eng.__addr, {}, null);
    eng._narrativeCaller.resolve({
      numericRating: 1, rating: 'low', durationMs: 5, fromCache: true,
      accountOnly: true, ...over,
    });
    await settle();
  }
  await checkAsync('C1 interval 未到 → 不发起', async () => {
    const eng = makeEng();
    await completeRound1(eng);
    TRIG.call(eng, eng.__addr, {}, null);
    assert.strictEqual(eng._narrativeCaller.calls.length, 1);
    FourMemeFactorAggregator.clearNarrativeFactors(eng.__addr);
  });
  await checkAsync('C2 到期 → retry 轮（overrideOptions=ignoreCache+invalidateAccountCorpus）', async () => {
    const eng = makeEng();
    await completeRound1(eng);
    const st = eng._narrativeTriggerStates.get(eng.__addr);
    st.lastCompletedAt = Date.now() - 15000; // 快进过期
    TRIG.call(eng, eng.__addr, {}, null);
    assert.strictEqual(eng._narrativeCaller.calls.length, 2);
    assert.deepStrictEqual(eng._narrativeCaller.calls[1].opts,
      { overrideOptions: { ignoreCache: true, invalidateAccountCorpus: true } });
    assert.strictEqual(st.rounds, 2);
    const ins = dbOps.filter(o => o.kind === 'insert' && o.row.token_address === eng.__addr).pop();
    assert.strictEqual(ins.row.round_no, 2);
    assert.strictEqual(ins.row.trigger_reason, 'retry');
    eng._narrativeCaller.resolve({ numericRating: 2, rating: 'mid', durationMs: 5, fromCache: false, accountOnly: false });
    await settle();
    FourMemeFactorAggregator.clearNarrativeFactors(eng.__addr);
  });
  await checkAsync('C3 rating≠1 不重试（翻正即止）', async () => {
    const eng = makeEng();
    await completeRound1(eng, { numericRating: 2, rating: 'mid', accountOnly: true });
    eng._narrativeTriggerStates.get(eng.__addr).lastCompletedAt = Date.now() - 15000;
    TRIG.call(eng, eng.__addr, {}, null);
    assert.strictEqual(eng._narrativeCaller.calls.length, 1);
    FourMemeFactorAggregator.clearNarrativeFactors(eng.__addr);
  });
  await checkAsync('C4 非账号型 rating=1 不重试', async () => {
    const eng = makeEng();
    await completeRound1(eng, { accountOnly: false });
    eng._narrativeTriggerStates.get(eng.__addr).lastCompletedAt = Date.now() - 15000;
    TRIG.call(eng, eng.__addr, {}, null);
    assert.strictEqual(eng._narrativeCaller.calls.length, 1);
    FourMemeFactorAggregator.clearNarrativeFactors(eng.__addr);
  });
  await checkAsync('C5 rounds≥maxAnalyses(3) 不再发起（重试上限）', async () => {
    const eng = makeEng();
    await completeRound1(eng);
    const st = eng._narrativeTriggerStates.get(eng.__addr);
    st.rounds = 3;
    st.lastCompletedAt = Date.now() - 15000;
    TRIG.call(eng, eng.__addr, {}, null);
    assert.strictEqual(eng._narrativeCaller.calls.length, 1);
    FourMemeFactorAggregator.clearNarrativeFactors(eng.__addr);
  });
  check('C6 hasInitial=false 不发起补轮（防未完成态误 retry）', () => {
    const eng = makeEng();
    eng._narrativeTriggerStates.set(eng.__addr, {
      rounds: 1, inFlight: false, hasInitial: false, lastRating: null,
      lastCompletedAt: null, accountOnly: false, currentRowId: null,
    });
    TRIG.call(eng, eng.__addr, {}, null);
    assert.strictEqual(eng._narrativeCaller.calls.length, 0);
  });
  check('C7 触发条件不满足 → 零发起（retry 到期也须过门）', () => {
    const eng = makeEng({ condTrue: false });
    eng._narrativeTriggerStates.set(eng.__addr, {
      rounds: 1, inFlight: false, hasInitial: true, lastRating: 1,
      lastCompletedAt: Date.now() - 15000, accountOnly: true, currentRowId: 1,
    });
    TRIG.call(eng, eng.__addr, {}, null);
    assert.strictEqual(eng._narrativeCaller.calls.length, 0);
  });

  // ═══════════════ D. catch 兜底 / 评级归一 ═══════════════
  console.log('D. 异常兜底');
  await checkAsync('D1 getRating reject → rating 归 9 拦截 + inFlight 复位（不卡死）', async () => {
    const eng = makeEng();
    TRIG.call(eng, eng.__addr, {}, null);
    eng._narrativeCaller.reject(new Error('接线级异常'));
    await settle();
    const st = eng._narrativeTriggerStates.get(eng.__addr);
    assert.strictEqual(st.inFlight, false);
    assert.strictEqual(st.lastRating, 9);
    assert.strictEqual(st.category, null); // 异常轮无分类回填（保持 null=门放行）
    assert.strictEqual(FourMemeFactorAggregator.getNarrativeFactors(eng.__addr).rating, 9);
    FourMemeFactorAggregator.clearNarrativeFactors(eng.__addr);
  });
  await checkAsync('D2 评级归一：numericRating=7（非法）→ lastRating null（宁缺勿假）', async () => {
    const eng = makeEng();
    TRIG.call(eng, eng.__addr, {}, null);
    eng._narrativeCaller.resolve({ numericRating: 7, rating: '?', durationMs: 5, fromCache: false, accountOnly: false });
    await settle();
    assert.strictEqual(eng._narrativeTriggerStates.get(eng.__addr).lastRating, null);
    FourMemeFactorAggregator.clearNarrativeFactors(eng.__addr);
  });
  await checkAsync('D3 numericRating=9 → lastRating 9（超时失败语义）', async () => {
    const eng = makeEng();
    TRIG.call(eng, eng.__addr, {}, null);
    eng._narrativeCaller.resolve({ numericRating: 9, rating: 'unrated', durationMs: 5, fromCache: false, accountOnly: false });
    await settle();
    assert.strictEqual(eng._narrativeTriggerStates.get(eng.__addr).lastRating, 9);
    FourMemeFactorAggregator.clearNarrativeFactors(eng.__addr);
  });

  // ═══════════════ E. stop 清理 identity ═══════════════
  console.log('E. stop 清理');
  await checkAsync('E1 清态后完成回填不投影（identity 校验防旧实验污染下一实验）', async () => {
    const eng = makeEng();
    TRIG.call(eng, eng.__addr, {}, null);
    // 模拟 stop() 全动作：逐 token clearNarrativeFactors + states.clear()
    FourMemeFactorAggregator.clearNarrativeFactors(eng.__addr);
    eng._narrativeTriggerStates.clear();
    eng._narrativeCaller.resolve({ numericRating: 3, rating: 'high', durationMs: 5, fromCache: false, accountOnly: false });
    await settle();
    assert.strictEqual(FourMemeFactorAggregator.getNarrativeFactors(eng.__addr), null,
      '清态后回填不应重写 FA 投影（identity 校验）');
    assert.strictEqual(eng._narrativeCaller.calls.length, 1); // 也未再发起
    FourMemeFactorAggregator.clearNarrativeFactors(eng.__addr);
  });
  {
    const src = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
    check('E2 stop() 清理形状（逐 token clearNarrativeFactors + states.clear）', () => {
      const stopSeg = src.slice(src.indexOf('async stop('), src.indexOf('await super.stop()'));
      assert.ok(/for \(const addr of this\._narrativeTriggerStates\.keys\(\)\)/.test(stopSeg)
        && /clearNarrativeFactors\(addr\)/.test(stopSeg)
        && /this\._narrativeTriggerStates\.clear\(\)/.test(stopSeg), 'stop 清理块漂移');
    });
    check('E3 signal metadata 轮次摘要形状（rounds/finalRating/leadMs）', () => {
      assert.ok(/narrativeRoundsSummary/.test(src) && /finalRating:\s*st\.lastRating/.test(src)
        && /leadMs:\s*Number\.isFinite\(st\.lastCompletedAt\)\s*\?\s*Date\.now\(\)\s*-\s*st\.lastCompletedAt/.test(src),
        'metadata 摘要形状漂移');
    });
    check('E4 ctor 参数投影（FA.setNarrativeFactorConfig 四键全传——C162 noCorpus* 两键同批）', () => {
      assert.ok(/setNarrativeFactorConfig\(\{\s*intervalMs:\s*this\._narrativeTriggerIntervalMs,\s*maxAnalyses:\s*this\._narrativeTriggerMaxAnalyses,\s*noCorpusIntervalMs:\s*this\._narrativeTriggerNoCorpusIntervalMs,\s*noCorpusMaxAnalyses:\s*this\._narrativeTriggerNoCorpusMaxAnalyses,?\s*\}\)/.test(src),
        'ctor 投影形状漂移');
    });
    check('E5 category 链源码口径（Nightshift 案 2026-10-17：st 初始/完成回填/投影/挂点透传四点；C162 插 corpusEmpty 键）', () => {
      assert.ok(/rounds: 0, inFlight: false, hasInitial: false, lastRating: null,\s*\n\s*lastCompletedAt: null, accountOnly: false, corpusEmpty: false, currentRowId: null,\s*\n\s*category: null, superIp: null, recognizedEntitySlogan: null,/.test(src),
        'st 初始对象缺 category:null');
      assert.ok(/st\.category = r\.narrativeCategory \?\? null;/.test(src), '完成回填缺 category 赋值');
      assert.ok(/category: st\.category \?\? null,/.test(src), '_projectNarrativeFactors 缺 category');
      // 2026-10-18 gwp 钱包画像层第五参接尾；2026-10-26 T71 接线整链删除（数据口
      // getEarlyTopBuyers 随 early 族退役）→ 挂点回归四参形状，第五参恒 null
      assert.ok(/factorResults\?\.narrativeCategory \?\? null,\s*\n\s*null\);/.test(src), 'GMGN 挂点第四参后应恒 null（T71 gwp 接线删除）');
    });
    check('E6 C88 标签链源码口径三件套（2026-10-18 CZ 出书簇：st 初始/完成回填/投影——漏一处=三态分裂红线）', () => {
      assert.ok(/superIp: null, recognizedEntitySlogan: null,/.test(src), 'st 初始对象缺两标签 null');
      assert.ok(/st\.superIp = r\.narrativeSuperIp \?\? null;/.test(src), '完成回填缺 superIp 赋值');
      assert.ok(/st\.recognizedEntitySlogan = r\.narrativeSuperIpSlogan \?\? null;/.test(src), '完成回填缺 recognizedEntitySlogan 赋值');
      assert.ok(/superIp: st\.superIp \?\? null,/.test(src), '_projectNarrativeFactors 缺 superIp');
      assert.ok(/recognizedEntitySlogan: st\.recognizedEntitySlogan \?\? null,/.test(src), '_projectNarrativeFactors 缺 recognizedEntitySlogan');
    });
  }

  // ═══════════════ F. 轮次表观测 fail-open ═══════════════
  console.log('F. 轮次表');
  await checkAsync('F1 rowId 缺失 update no-op（insert 失败后完成不 update）', async () => {
    const eng = makeEng();
    const before = dbOps.length;
    await FourMemeWssTradingEngine.prototype._completeNarrativeRoundRow.call(eng, null,
      { numericRating: 2, fromCache: false }, Date.now());
    assert.strictEqual(dbOps.length, before, 'rowId=null 不应触发 db op');
  });
  await checkAsync('F2 insert 失败观测 fail-open：warn 不中断，交易分析照跑', async () => {
    INSERT_FAIL = true;
    const eng = makeEng({ ctl: makeRatingCtl() });
    TRIG.call(eng, eng.__addr, {}, null);
    assert.strictEqual(eng._narrativeCaller.calls.length, 1); // 分析照发起
    await settle();
    eng._narrativeCaller.resolve({ numericRating: 2, rating: 'mid', durationMs: 5, fromCache: false, accountOnly: false });
    await settle();
    const st = eng._narrativeTriggerStates.get(eng.__addr);
    assert.strictEqual(st.lastRating, 2); // 状态机不受观测失败影响
    assert.strictEqual(st.currentRowId, null); // id 未回填
    INSERT_FAIL = false;
    FourMemeFactorAggregator.clearNarrativeFactors(eng.__addr);
  });

  // ═══════════════ G. 事故反证：未完成 → 无信号 ═══════════════
  console.log('G. 单一买条件事故反证');
  {
    const ev = new ConditionEvaluator();
    const ast = ev.parseCondition(BUY_COND);
    check('G1 分析未完成（rating null）→ 全条件恒 false（无 signal 行）', () =>
      assert.strictEqual(ev.evaluate(ast, { ...COND_BASE, narrativeRating: null }), false));
    check('G2 rating=2 → 过门（==2 臂）', () =>
      assert.strictEqual(ev.evaluate(ast, { ...COND_BASE, narrativeRating: 2 }), true));
    check('G3 rating=3 → 过门（==3 臂）', () =>
      assert.strictEqual(ev.evaluate(ast, { ...COND_BASE, narrativeRating: 3 }), true));
    check('G4 rating=1（不通过）→ false', () =>
      assert.strictEqual(ev.evaluate(ast, { ...COND_BASE, narrativeRating: 1 }), false));
    check('G5 rating=9（失败/超时归一）→ false（新链 fail-closed，unrated 放行政策废止）', () =>
      assert.strictEqual(ev.evaluate(ast, { ...COND_BASE, narrativeRating: 9 }), false));
    check('G6 flap 臂：platform=flap 且 routerPct<30 → false', () =>
      assert.strictEqual(ev.evaluate(ast, {
        ...COND_BASE, narrativeRating: 2, platform: 'flap', earlyTradesRouterPct: 29,
      }), false));
    check('G7 perWallet 臂：earlyTradesPerWallet>=4 → false（对倒高频拦）', () =>
      assert.strictEqual(ev.evaluate(ast, { ...COND_BASE, narrativeRating: 2, earlyTradesPerWallet: 4 }), false));
  }

  // ═══════════════ H. 互斥 + legacy 并存 ═══════════════
  console.log('H. 互斥 fail-fast / legacy 并存');
  {
    const ids = new Set(['buyVolumeBnb', 'narrativeRating']);
    const leg = (over) => Object.assign({
      id: 'L1', name: 'leg', action: 'buy', priority: 10, condition: 'buyVolumeBnb >= 1',
    }, over);
    check('H1 同腿 narrativeTriggerCondition × narrativeCallCondition → throw 拒启', () =>
      assert.throws(() => new StrategyEngine().loadStrategies(
        [leg({ narrativeTriggerCondition: 'buyVolumeBnb >= 0.5', narrativeCallCondition: 'buyVolumeBnb >= 1' })], ids),
        /C84 互斥/));
    check('H2 仅 trigger 腿合法加载（字段透传）', () => {
      const se = new StrategyEngine();
      se.loadStrategies([leg({ narrativeTriggerCondition: 'buyVolumeBnb >= 0.5' })], ids);
      assert.strictEqual(se.getAllStrategies()[0].narrativeTriggerCondition, 'buyVolumeBnb >= 0.5');
    });
    check('H3 trigger 条件未知因子 → throw（与 condition 同集防线）', () =>
      assert.throws(() => new StrategyEngine().loadStrategies(
        [leg({ narrativeTriggerCondition: 'notAFactor >= 1' })], ids), /notAFactor/));
    const src = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
    check('H4 legacy 链源码级仍在（N3 预触发钩子 + 同步直调块字段门）', () => {
      assert.ok(/this\._narrativePrefetchCheck\(tokenAddress, factors, token\);/.test(src), 'N3 钩子漂移');
      assert.ok(/narrativeCallCondition/.test(src), '同步直调块字段门漂移');
    });
    check('H5 挂点在买腿分支且先于去抖买评估（C84 挂点序；2026-10-18 gwp 预取插位、2026-10-23 观察信号插位——观察类检查各自插位，去抖买评估恒最后）', () =>
      assert.ok(/this\._narrativeTriggerCheck\(tokenAddress, factors, token\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*(?:\/\/[^\n]*\n\s*this\._walletProfilePrefetchCheck\(tokenAddress, factors, token\);\s*\n)?(?:\s*\/\/[^\n]*\n)*\s*(?:if \(this\._observationService\) this\._observationService\.evaluate\(token, factors, tick\.timestamp\);\s*\n)?\s*this\._scheduleDebouncedBuy\(tokenAddress, tick\);/.test(src),
        '挂点序漂移'));
  }

  // ═══════════════ I. C162 corpusEmpty 零语料补轮臂 ═══════════════
  console.log('I. C162 corpusEmpty 零语料补轮臂（双 BINA 案·正主 0xed71…7777）');
  check('I1 hasNoOwnedCorpus 纯函数真值表（缺对象/全空桶=零语料；任一桶非空=有语料）', () => {
    assert.strictEqual(hasNoOwnedCorpus(undefined), true);
    assert.strictEqual(hasNoOwnedCorpus(null), true);
    assert.strictEqual(hasNoOwnedCorpus({}), true);
    assert.strictEqual(hasNoOwnedCorpus({ twitter: [], websites: [] }), true);
    assert.strictEqual(hasNoOwnedCorpus({ twitter: [{ url: 'x' }], websites: [] }), false);
    assert.strictEqual(hasNoOwnedCorpus({ twitter: [], websites: [{ url: 'y' }] }), false);
    // 非数组桶当空（形状防御——非数组≠非空）
    assert.strictEqual(hasNoOwnedCorpus({ twitter: 'not-array' }), true);
    assert.strictEqual(hasNoOwnedCorpus({ twitter: 'not-array', websites: [{ url: 'y' }] }), false);
  });
  // 零语料票完成轮形状（corpusEmpty=true + accountOnly=false——与 completeRound1 的
  // accountOnly 形状互斥分流）
  async function completeRound1NoCorpus(eng, over = {}) {
    TRIG.call(eng, eng.__addr, {}, null);
    eng._narrativeCaller.resolve({
      numericRating: 1, rating: 'low', durationMs: 5, fromCache: true,
      accountOnly: false, corpusEmpty: true, ...over,
    });
    await settle();
  }
  await checkAsync('I2 完成回填：st.corpusEmpty=true + FA 投影 corpusEmpty 键', async () => {
    const eng = makeEng();
    await completeRound1NoCorpus(eng);
    const st = eng._narrativeTriggerStates.get(eng.__addr);
    assert.strictEqual(st.corpusEmpty, true);
    assert.strictEqual(st.accountOnly, false);
    assert.strictEqual(FourMemeFactorAggregator.getNarrativeFactors(eng.__addr).corpusEmpty, true);
    FourMemeFactorAggregator.clearNarrativeFactors(eng.__addr);
  });
  await checkAsync('I3 常规 interval（10s）到期但 noCorpusInterval（60s）未到 → 不发（正主案：4min 晚到窗须长节奏）', async () => {
    const eng = makeEng();
    await completeRound1NoCorpus(eng);
    eng._narrativeTriggerStates.get(eng.__addr).lastCompletedAt = Date.now() - 15000;
    TRIG.call(eng, eng.__addr, {}, null);
    assert.strictEqual(eng._narrativeCaller.calls.length, 1);
    FourMemeFactorAggregator.clearNarrativeFactors(eng.__addr);
  });
  await checkAsync('I4 noCorpus interval（60s）到期 → 发 retry（override 同款 ignoreCache+invalidateAccountCorpus）', async () => {
    const eng = makeEng();
    await completeRound1NoCorpus(eng);
    eng._narrativeTriggerStates.get(eng.__addr).lastCompletedAt = Date.now() - 61000;
    TRIG.call(eng, eng.__addr, {}, null);
    assert.strictEqual(eng._narrativeCaller.calls.length, 2);
    assert.deepStrictEqual(eng._narrativeCaller.calls[1].opts,
      { overrideOptions: { ignoreCache: true, invalidateAccountCorpus: true } });
    const ins = dbOps.filter(o => o.kind === 'insert' && o.row.token_address === eng.__addr).pop();
    assert.strictEqual(ins.row.trigger_reason, 'retry');
    FourMemeFactorAggregator.clearNarrativeFactors(eng.__addr);
  });
  await checkAsync('I5 rounds≥noCorpusMaxAnalyses(8) 不再发起（零语料臂上限）；7 仍可', async () => {
    const eng = makeEng();
    await completeRound1NoCorpus(eng);
    const st = eng._narrativeTriggerStates.get(eng.__addr);
    st.rounds = 8;
    st.lastCompletedAt = Date.now() - 61000;
    TRIG.call(eng, eng.__addr, {}, null);
    assert.strictEqual(eng._narrativeCaller.calls.length, 1, 'rounds=8 应封顶');
    st.rounds = 7;
    TRIG.call(eng, eng.__addr, {}, null);
    assert.strictEqual(eng._narrativeCaller.calls.length, 2, 'rounds=7 应可补');
    FourMemeFactorAggregator.clearNarrativeFactors(eng.__addr);
  });
  check('I6 双臂同真（accountOnly ∧ corpusEmpty）→ accountOnly 臂参数优先（10s×3 节奏）：rounds=3 即封顶', () => {
    const eng = makeEng();
    eng._narrativeTriggerStates.set(eng.__addr, {
      rounds: 3, inFlight: false, hasInitial: true, lastRating: 1,
      lastCompletedAt: Date.now() - 61000, accountOnly: true, corpusEmpty: true, currentRowId: 1,
    });
    TRIG.call(eng, eng.__addr, {}, null);
    assert.strictEqual(eng._narrativeCaller.calls.length, 0,
      'accountOnly 臂 maxAnalyses=3 封顶（若误用 noCorpusMaxAnalyses=8 则误发）');
  });
  await checkAsync('I7 非两臂票（accountOnly=false ∧ corpusEmpty=false）rating=1 → 不补轮（存量形状不变）', async () => {
    const eng = makeEng();
    await completeRound1(eng, { accountOnly: false, corpusEmpty: false });
    eng._narrativeTriggerStates.get(eng.__addr).lastCompletedAt = Date.now() - 61000;
    TRIG.call(eng, eng.__addr, {}, null);
    assert.strictEqual(eng._narrativeCaller.calls.length, 1);
    FourMemeFactorAggregator.clearNarrativeFactors(eng.__addr);
  });
  await checkAsync('I8 语料到位翻常规形状：二轮 corpusEmpty=false 且仍 rating=1 → 不再补轮（翻入即止）', async () => {
    const eng = makeEng();
    await completeRound1NoCorpus(eng);
    eng._narrativeTriggerStates.get(eng.__addr).lastCompletedAt = Date.now() - 61000;
    TRIG.call(eng, eng.__addr, {}, null); // R2 发起
    eng._narrativeCaller.resolve({
      numericRating: 1, rating: 'low', durationMs: 5, fromCache: false,
      accountOnly: false, corpusEmpty: false, // 语料已到位（宣告推/GMGN link 晚到已聚合）
    });
    await settle();
    TRIG.call(eng, eng.__addr, {}, null);
    assert.strictEqual(eng._narrativeCaller.calls.length, 2, '语料到位后 rating=1 = 真拒不补轮');
    FourMemeFactorAggregator.clearNarrativeFactors(eng.__addr);
  });
  await checkAsync('I9 接线级异常（reject）→ corpusEmpty 不置位保持 false（保守不补轮）', async () => {
    const eng = makeEng();
    TRIG.call(eng, eng.__addr, {}, null);
    eng._narrativeCaller.reject(new Error('接线级异常'));
    await settle();
    const st = eng._narrativeTriggerStates.get(eng.__addr);
    assert.strictEqual(st.lastRating, 9);
    assert.strictEqual(st.corpusEmpty, false, '异常轮语料形状未知，保守 false');
    FourMemeFactorAggregator.clearNarrativeFactors(eng.__addr);
  });
  {
    const src = read('src/trading-engine/pre-check/NarrativeDirectCaller.js');
    check('I10 catch 兜底路径 corpusEmpty:false 显式（超时/异常语料形状未知保守不补轮）', () => {
      assert.ok(/corpusEmpty:\s*false/.test(src), 'catch 路径缺 corpusEmpty:false');
    });
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
})();
