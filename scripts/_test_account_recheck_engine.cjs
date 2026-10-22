#!/usr/bin/env node
/**
 * C166 账号信息复检引擎接线单测（2026-10-22 一次性专号 rug 家族案）——本地零 DB 零网络。
 *
 * 引擎链路：start() 30s interval → _accountHealthScan 遍历持仓 → 懒解析宣告账号
 * （token_narrative.twitter_info，dbManager 直查）→ 双档节流（前 10min 每 30s /
 * 之后每 2min，用户裁定）→ Monitor checkAccount fire-and-forget → FA
 * setAccountHealthFactors 回填（竞态防线：清态后不回填）→ 卖臂 issuerAccountState。
 *
 * 覆盖：
 *   A. _resolveIssuerAccount 懒解析（tweet/account 型/负缓存/DB 错误 60s 节流）
 *   B. _accountHealthScan（双档节流/回填/清仓自清理/回填竞态防线/负缓存不重查）
 *   C. _resetAccountRecheckFor 再买入重置（sold→rebuy 残留 deleted 误卖防线）
 *   D. 源码口径（stop 清理/买入成功点重置调用/默认关 enabled===true 物化）
 *
 * 零 DB 零网络：dbManager require.cache 预污染（母版 _test_narrative_trigger_condition）。
 * 用法：node scripts/_test_account_recheck_engine.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ══ dbManager 打桩（先于引擎模块加载；token_narrative select 链）══
const dbCalls = [];
let narrativeRows = [];     // token_narrative 返回行（twitter_info）
let dbThrow = false;        // throw 形状=网络异常（错误重试路径）
const DB_PATH = require.resolve(path.join(ROOT, 'src/services/dbManager'));
require.cache[DB_PATH] = {
  id: DB_PATH, filename: DB_PATH, loaded: true,
  exports: {
    dbManager: {
      getClient() {
        return {
          from(table) {
            const op = { table, eqs: [] };
            dbCalls.push(op);
            return {
              select(cols) { op.cols = cols; return this; },
              eq(col, val) { op.eqs.push([col, val]); return this; },
              order(col, o) { op.order = [col, o]; return this; },
              async limit(n) {
                op.limit = n;
                if (dbThrow) throw new Error('mock DB 网络异常');
                return { data: narrativeRows, error: null };
              },
            };
          },
        };
      },
    },
  },
};

const { FourMemeWssTradingEngine } =
  require(path.join(ROOT, 'src/trading-engine/implementations/FourMemeWssTradingEngine'));
const FourMemeFactorAggregator = require(path.join(ROOT, 'src/services/FourMemeFactorAggregator'));

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

// ── Monitor 受控桩（checkAccount 记录调用+返回预设结果）──
function makeMonitorCtl() {
  return {
    calls: [],
    next: { state: 'active', detail: 'ok', checkedAt: Date.now() },
    destroyed: 0,
    checkAccount(target) {
      this.calls.push(target);
      return Promise.resolve({ ...this.next });
    },
    destroy() { this.destroyed++; },
  };
}

// ── 引擎桩（prototype 借调，_test_narrative_trigger_condition 同款先例）──
function makeEng({ monitor } = {}) {
  const eng = Object.create(FourMemeWssTradingEngine.prototype);
  eng._experimentId = 'exp-c166-test';
  eng.logs = [];
  eng.logger = {
    info: (...a) => eng.logs.push(['info', ...a]),
    warn: (...a) => eng.logs.push(['warn', ...a]),
    error: (...a) => eng.logs.push(['error', ...a]),
    debug: () => {},
  };
  eng._accountHealthEnabled = true;
  eng._accountHealthMonitor = monitor || makeMonitorCtl();
  eng._accountRecheckStates = new Map();
  eng._accountHealthFirstWindowMs = 10 * 60 * 1000;
  eng._accountHealthFastMs = 30 * 1000;
  eng._accountHealthSlowMs = 120 * 1000;
  eng._resolveIssuerLastAttempt = new Map();
  eng.holdings = []; // _getAllHoldings 源
  eng._getAllHoldings = function () { return this.holdings; };
  return eng;
}
const ADDR = '0xc166aaa111222333444555666777888999aaac166';
function resetDbState(rows) {
  dbCalls.length = 0; dbThrow = false; narrativeRows = rows || [];
}

(async () => {
  console.log('A. _resolveIssuerAccount 懒解析');
  await checkAsync('A1 tweet 型 twitter_info → handle+宣告推接线', async () => {
    const eng = makeEng();
    resetDbState([{ twitter_info: { type: 'tweet', author_screen_name: 'fourge', tweet_id: '18890001' } }]);
    const st = await eng._resolveIssuerAccount(ADDR);
    assert.deepStrictEqual([st.handle, st.announceTweetId, st.resolved], ['fourge', '18890001', true]);
    assert.strictEqual(eng._accountRecheckStates.get(ADDR), st);
    assert.ok(eng.logs.some(l => l[0] === 'info' && String(l[3]).includes('宣告账号复检接线')));
  });
  await checkAsync('A2 account 型 → handle 无宣告推', async () => {
    const eng = makeEng();
    resetDbState([{ twitter_info: { type: 'account', screen_name: 'someAccount' } }]);
    const st = await eng._resolveIssuerAccount(ADDR);
    assert.deepStrictEqual([st.handle, st.announceTweetId], ['someAccount', null]);
  });
  await checkAsync('A3 无行/无 twitter_info → 负缓存 resolved:true handle:null（防每轮重查）', async () => {
    const eng = makeEng();
    resetDbState([{ twitter_info: null }]);
    const st = await eng._resolveIssuerAccount(ADDR);
    assert.deepStrictEqual([st.handle, st.resolved], [null, true]);
    await eng._resolveIssuerAccount(ADDR); // 第二次
    assert.strictEqual(dbCalls.length, 1, '负缓存后不应重查 DB');
  });
  await checkAsync('A4 DB throw → 返回 null 不缓存（下轮重试）', async () => {
    const eng = makeEng();
    resetDbState([]); dbThrow = true;
    const st = await eng._resolveIssuerAccount(ADDR);
    assert.strictEqual(st, null);
    assert.strictEqual(eng._accountRecheckStates.has(ADDR), false);
    assert.ok(eng.logs.some(l => l[0] === 'error' && String(l[3]).includes('解析失败')));
  });
  await checkAsync('A5 错误重试 60s 节流：节流窗内重试直接 null 不打 DB', async () => {
    const eng = makeEng();
    resetDbState([]); dbThrow = true;
    await eng._resolveIssuerAccount(ADDR); // 记录 attempt
    dbThrow = false; resetDbState([{ twitter_info: { type: 'account', screen_name: 'x' } }]);
    dbCalls.length = 0;
    const st = await eng._resolveIssuerAccount(ADDR);
    assert.strictEqual(st, null);
    assert.strictEqual(dbCalls.length, 0, '60s 内不应重打 DB');
  });
  await checkAsync('A6 twitter_info 无 type → 负缓存 handle=null', async () => {
    const eng = makeEng();
    resetDbState([{ twitter_info: { screen_name: 'noType' } }]);
    const st = await eng._resolveIssuerAccount(ADDR);
    assert.strictEqual(st.handle, null);
  });

  console.log('B. _accountHealthScan 扫描');
  await checkAsync('B1 懒解析+到间隔打网 → active 回填 FA', async () => {
    const mon = makeMonitorCtl();
    const eng = makeEng({ monitor: mon });
    resetDbState([{ twitter_info: { type: 'tweet', author_screen_name: 'fourge', tweet_id: '18890001' } }]);
    eng.holdings = [{ tokenAddress: ADDR }];
    await eng._accountHealthScan();
    await settle();
    assert.strictEqual(mon.calls.length, 1);
    assert.deepStrictEqual(mon.calls[0], { handle: 'fourge', announceTweetId: '18890001' });
    assert.strictEqual(FourMemeFactorAggregator.getAccountHealthFactors(ADDR)?.state, 'active');
  });
  await checkAsync('B2 deleted 回填 FA + 🚨 warn（rug 前兆留痕）', async () => {
    const mon = makeMonitorCtl();
    mon.next = { state: 'deleted', detail: 'account_gone', checkedAt: Date.now() };
    const eng = makeEng({ monitor: mon });
    resetDbState([{ twitter_info: { type: 'account', screen_name: 'rugdev' } }]);
    eng.holdings = [{ tokenAddress: ADDR }];
    await eng._accountHealthScan();
    await settle();
    assert.strictEqual(FourMemeFactorAggregator.getAccountHealthFactors(ADDR)?.state, 'deleted');
    assert.ok(eng.logs.some(l => l[0] === 'warn' && String(l[3]).includes('rug 前兆')));
  });
  await checkAsync('B3 未到间隔不打网（fast 档节流）', async () => {
    const mon = makeMonitorCtl();
    const eng = makeEng({ monitor: mon });
    resetDbState([]);
    eng._accountRecheckStates.set(ADDR, {
      handle: 'fourge', announceTweetId: null, resolved: true,
      firstHeldAt: Date.now() - 1000, lastCheckAt: Date.now() - 5000, // fast=30s 未到
    });
    eng.holdings = [{ tokenAddress: ADDR }];
    await eng._accountHealthScan();
    await settle();
    assert.strictEqual(mon.calls.length, 0);
  });
  await checkAsync('B4 双档：持仓>10min 后用 slow=120s 档（fast 已过也不打）', async () => {
    const mon = makeMonitorCtl();
    const eng = makeEng({ monitor: mon });
    resetDbState([]);
    eng._accountRecheckStates.set(ADDR, {
      handle: 'fourge', announceTweetId: null, resolved: true,
      firstHeldAt: Date.now() - (10 * 60 * 1000 + 5000),
      lastCheckAt: Date.now() - 60 * 1000, // > fast 30s（fast 档会打）< slow 120s（slow 档不打）
    });
    eng.holdings = [{ tokenAddress: ADDR }];
    await eng._accountHealthScan();
    await settle();
    assert.strictEqual(mon.calls.length, 0, 'slow 档未到不打——证明切到 slow 间隔');
  });
  await checkAsync('B5 清仓自清理：持仓移除后扫描删复检态+FA clear', async () => {
    const eng = makeEng();
    resetDbState([]);
    eng._accountRecheckStates.set(ADDR, { handle: 'x', resolved: true, lastCheckAt: 0, firstHeldAt: Date.now() });
    FourMemeFactorAggregator.setAccountHealthFactors(ADDR, { state: 'deleted' });
    eng.holdings = []; // 已清仓
    await eng._accountHealthScan();
    assert.strictEqual(eng._accountRecheckStates.has(ADDR), false);
    assert.strictEqual(FourMemeFactorAggregator.getAccountHealthFactors(ADDR), null);
  });
  await checkAsync('B6 回填竞态防线：检测进行中清态 → 完成后不回填 FA', async () => {
    const mon = makeMonitorCtl();
    let gateRes;
    mon.checkAccount = () => new Promise(res => { gateRes = res; });
    const eng = makeEng({ monitor: mon });
    resetDbState([]);
    eng._accountRecheckStates.set(ADDR, {
      handle: 'fourge', announceTweetId: null, resolved: true,
      firstHeldAt: Date.now() - 60 * 1000, lastCheckAt: 0,
    });
    eng.holdings = [{ tokenAddress: ADDR }];
    const scanP = eng._accountHealthScan();
    eng._accountRecheckStates.delete(ADDR); // stop/清仓竞态：检测 in-flight 中清态
    gateRes({ state: 'deleted', detail: 'account_gone', checkedAt: Date.now() });
    await scanP; await settle();
    assert.strictEqual(FourMemeFactorAggregator.getAccountHealthFactors(ADDR), null, '清态后晚到结果不回填');
  });
  await checkAsync('B7 负缓存票跳过检测（handle=null 不打网）', async () => {
    const mon = makeMonitorCtl();
    const eng = makeEng({ monitor: mon });
    resetDbState([{ twitter_info: null }]); // 无宣告账号
    eng.holdings = [{ tokenAddress: ADDR }];
    await eng._accountHealthScan();
    await settle();
    assert.strictEqual(mon.calls.length, 0);
    assert.strictEqual(eng._accountRecheckStates.get(ADDR)?.handle, null);
  });

  console.log('C. 再买入重置');
  await checkAsync('C1 _resetAccountRecheckFor 清复检态+FA 注入（sold→rebuy 残留 deleted 误卖防线）', () => {
    const eng = makeEng();
    resetDbState([]);
    eng._accountRecheckStates.set(ADDR, { handle: 'x', resolved: true, lastCheckAt: 1, firstHeldAt: 1 });
    FourMemeFactorAggregator.setAccountHealthFactors(ADDR, { state: 'deleted' });
    eng._resetAccountRecheckFor(ADDR);
    assert.strictEqual(eng._accountRecheckStates.has(ADDR), false);
    assert.strictEqual(FourMemeFactorAggregator.getAccountHealthFactors(ADDR), null);
  });

  console.log('D. 源码口径');
  {
    check('D1 stop 清理：逐 token clearAccountHealthFactors + Map clear + monitor.destroy', () => {
      const src = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
      const blk = src.slice(src.indexOf('_accountRecheckStates')) ; // 首见=ctor；stop 段验证
      const stopSeg = src.slice(src.indexOf('async stop()'), src.indexOf('async stop()') + 6000);
      assert.ok(stopSeg.includes('clearAccountHealthFactors'), 'stop 段缺 FA 清理');
      assert.ok(stopSeg.includes('_accountRecheckStates.clear()'), 'stop 段缺 Map 清理');
      assert.ok(stopSeg.includes('_accountHealthMonitor.destroy()'), 'stop 段缺 monitor destroy');
      assert.ok(blk.length > 0);
    });
    check('D2 买入成功点调用重置（✅ 买入成功日志前）', () => {
      const src = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
      const i = src.indexOf('_resetAccountRecheckFor(tokenAddress);');
      assert.ok(i > 0, '买入成功点无重置调用');
      const around = src.slice(Math.max(0, i - 1500), i + 1500);
      assert.ok(around.includes('买入成功'), '重置调用不在买入成功分支附近');
    });
    check('D3 默认关物化：enabled === true 才开（gwp 同款新机制语义）', () => {
      const src = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
      assert.ok(src.includes('this._accountHealthEnabled = ahcCfg.enabled === true'));
    });
    check('D4 interval 挂 start()：Math.min(fastMs, 30s) 轮询（双档细粒度由扫描内节流管）', () => {
      const src = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
      const i = src.indexOf("this._intervals.accountHealth = setInterval");
      assert.ok(i > 0, 'start() 缺复检 interval');
      assert.ok(src.includes('Math.min(this._accountHealthFastMs, 30 * 1000)'));
    });
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  if (failed > 0) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
