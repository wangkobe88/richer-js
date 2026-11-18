#!/usr/bin/env node
/**
 * T175/AF1 前置活跃度门单测——零 DB 鞒网络
 *
 * 覆盖：
 * - actFrontRoute 纯函数全分支（low/ultra∧burst 豁免、reject_wash、high_skip、mid_full）
 * - AF1 题集：3 题组成、题面与 cheat 题集逐字一致（dynamic import ESM 本地文件）
 * - evaluateActFront 全路径（打桩 dbClient/loadLlm）：五路分流 / act 答案缺席
 *   fail-open / 未知桶 fail / Jev 失败+冷却 / insufficient_ticks / disabled /
 *   anchorMs 透传 / inflight join / awaitMs 竞速超时 / 不落表 / 不粘滞（每信号真调）
 * - 引擎 _actFrontGateEvaluate（call 打桩 this）：灰度关零调用 bit 一致 /
 *   灰度开分流消费（reject → fail、burst_exempt/high_skip → skipCheat）
 * - FP14 N 升格臂：routerEntryBuyPct <10 拒 / 恰 10.0 不触发 / null（<15 笔样本薄）不触发
 * 失败 exit 非零。
 */

const fs = require('fs');
const path = require('path');
const { CheatCheckService, actFrontRoute } = require('../src/market-analysis/CheatCheckService');
const { evaluateFactorPreBuy: fpJudge, FACTOR_PREBUY_VERSION } = require('../src/market-analysis/factor-pre-buy-check');

let passed = 0;
function ok(cond, label) {
  if (!cond) {
    console.error(`\n❌ FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`  ✓ ${label}`);
}

// ── 内存 DB 桩（cheat service 单测同款；AF 门只读 ticks 不落表）──
function makeDb({ ticks = [] } = {}) {
  const state = { tickQueries: 0, inserts: 0 };
  const client = {
    from(table) {
      const ops = [];
      const p = {
        select: (...a) => { ops.push(['select', a]); return p; },
        eq: (...a) => { ops.push(['eq', a]); return p; },
        lte: (...a) => { ops.push(['lte', a]); return p; },
        order: (...a) => { ops.push(['order', a]); return p; },
        limit: (...a) => { ops.push(['limit', a]); return p; },
        insert: () => { state.inserts++; return Promise.resolve({ error: null }); },
        then: (res, rej) => Promise.resolve(resultFor(table, ops)).then(res, rej),
      };
      return p;
    },
  };
  function resultFor(table) {
    if (table === 'wss_price_ticks') {
      state.tickQueries++;
      const sorted = [...ticks].sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
      return { data: sorted.slice(-1000), error: null };
    }
    return { data: [], error: null }; // cheat_detection bootstrap（AF 门不做 bootstrap 但链共享 helper 兜底）
  }
  return { client, state };
}

function genTicks(n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      block_time: new Date(1700000000000 + i * 2000).toISOString(),
      block_number: 100 + Math.floor(i / 2), log_index: i % 2,
      trade_type: i % 3 === 2 ? 'sell' : 'buy',
      bnb_amount: i % 3 === 2 ? 0.11 : 0.1, price_bnb: 1e-9, price_outlier: false,
      trader_address: `0xw${i % 10}`.padEnd(42, '0'),
      sender_address: `0xw${i % 10}`.padEnd(42, '0'),
      quote_token: null,
    });
  }
  return rows;
}

const LVL = ['none', 'weak', 'moderate', 'strong'];
const ACTL = ['low', 'mid', 'high', 'ultra'];
const SBWL = ['none', 'burst'];
const phAns = (bucket, p = 0.78) => ({ type: 'choice', choice: bucket, probabilities: Object.fromEntries(LVL.map((b) => [b, b === bucket ? p : (1 - p) / 3])) });
const actAns = (bucket, p = 0.81) => ({ type: 'choice', choice: bucket, probabilities: Object.fromEntries(ACTL.map((b) => [b, b === bucket ? p : (1 - p) / 3])) });
const sbwAns = (bucket, p = 0.8) => ({ type: 'choice', choice: bucket, probabilities: Object.fromEntries(SBWL.map((b) => [b, b === bucket ? p : 1 - p])) });

/** AF 答案工厂（3 题） */
const afAnswers = (act, sbw = 'none', wash = 'none') => ({
  activity_level: act ? actAns(act) : undefined,
  stall_burst_wave: sbwAns(sbw),
  wash_pair: phAns(wash),
});

/** LLM 桩：AF 题集工厂带全键（生产路径 5b 兜底不触发）；ask 计数可控 */
function makeLlm({ answers, hang = false, reject = null } = {}) {
  const calls = { afAsk: 0, cheatAsk: 0 };
  return {
    mod: {
      JevClient: {
        ask: async (_state, questions, opts) => {
          if (opts && opts.label === 'act-front') {
            calls.afAsk++;
            calls.afQuestions = questions;
            if (hang) await new Promise(() => {});
            if (reject) throw new Error(reject);
            return { model: 'fake', answers, usage: { total: 1 } };
          }
          calls.cheatAsk++;
          return { model: 'fake', answers: {}, usage: { total: 1 } };
        },
      },
      buildCheatQuestions: () => ({}),
      buildActFrontQuestions: () => ({ activity_level: { type: 'choice' }, wash_pair: { type: 'choice' }, stall_burst_wave: { type: 'choice' } }),
      ACT_FRONT_QUESTIONS_VERSION: 'AF-test',
      CHEAT_QUESTIONS_VERSION: 'D3-test',
    },
    calls,
  };
}

function makeSvc(db, llm, config = {}, nowRef = { t: 1000000 }) {
  return new CheatCheckService(
    { enabled: true, settleDelayMs: 0, timeoutMs: 500, minTicks: 6, ...config },
    null,
    { dbClient: db.client, now: () => nowRef.t, loadLlm: async () => llm.mod },
  );
}

const META = { address: '0xtok', symbol: 'S', name: 'S', platform: 'fourmeme', createdAtMs: 1700000000000, creatorAddress: null };

async function main() {
  // ═══════════════ A. actFrontRoute 纯函数全分支 ═══════════════
  console.log('A. actFrontRoute 分流纯函数');
  ok(actFrontRoute('low', false, 'none') === 'reject_low', 'low∧¬burst → reject_low');
  ok(actFrontRoute('low', true, 'none') === 'burst_exempt', 'low∧burst → burst_exempt（ba5e 立法保持）');
  ok(actFrontRoute('ultra', false, 'none') === 'reject_ultra', 'ultra∧¬burst → reject_ultra');
  ok(actFrontRoute('ultra', true, 'strong') === 'burst_exempt', 'ultra∧burst → burst_exempt（burst 豁免优先于档位拒）');
  ok(actFrontRoute('high', false, 'strong') === 'reject_wash', 'high∧wash=strong → reject_wash（CD380 denied 搬家）');
  ok(actFrontRoute('high', false, 'none') === 'high_skip', 'high∧wash=none → high_skip');
  ok(actFrontRoute('high', true, 'moderate') === 'high_skip', 'high∧wash=moderate → high_skip（strong 唯一拒线）');
  ok(actFrontRoute('high', false, null) === 'high_skip', 'high∧wash 答案缺席 → high_skip（EXT 容缺 null≠strong）');
  ok(actFrontRoute('mid', false, 'none') === 'mid_full', 'mid → mid_full（照走 cheat 全链）');
  ok(actFrontRoute('mid', true, 'strong') === 'mid_full', 'mid∧burst∧wash=strong → mid_full（分流与档位唯一决定，wash 拒线只在 high 档）');

  // ═══════════════ B. AF1 题集组成与题面一致（单一真相源）═══════════════
  console.log('B. AF1 题集（dynamic import ESM 本地文件）');
  {
    const q = await import('../src/market-analysis/llm/cheat-questions.mjs');
    const af = q.buildActFrontQuestions();
    const keys = Object.keys(af);
    ok(keys.length === 3 && keys.includes('activity_level') && keys.includes('wash_pair') && keys.includes('stall_burst_wave'),
      `AF1 题集恰 3 题（activity_level/wash_pair/stall_burst_wave；实际 ${keys.join(',')}）`);
    const full = q.buildCheatQuestions();
    for (const k of keys) {
      ok(JSON.stringify(af[k]) === JSON.stringify(full[k]), `AF1 题面与 cheat 题集逐字一致（${k}）`);
    }
    ok(q.ACT_FRONT_QUESTIONS_VERSION === 'AF1', `AF1 版本常量（实际 ${q.ACT_FRONT_QUESTIONS_VERSION}）`);
  }

  // ═══════════════ C. evaluateActFront 全路径 ═══════════════
  console.log('C. evaluateActFront 分流/故障路径');
  {
    const db = makeDb({ ticks: genTicks(20) });
    const svc = new CheatCheckService({ enabled: false }, null, { dbClient: db.client });
    const r = await svc.evaluateActFront('0xtok', META, {});
    ok(r.status === 'disabled' && db.state.tickQueries === 0, 'enabled=false → disabled 零链路');
  }
  const CASES = [
    ['low', 'none', 'none', 'reject_low'],
    ['low', 'burst', 'none', 'burst_exempt'],
    ['ultra', 'none', 'strong', 'reject_ultra'],
    ['high', 'none', 'strong', 'reject_wash'],
    ['high', 'none', 'none', 'high_skip'],
    ['mid', 'none', 'none', 'mid_full'],
  ];
  for (const [act, sbw, wash, path] of CASES) {
    const db = makeDb({ ticks: genTicks(20) });
    const llm = makeLlm({ answers: afAnswers(act, sbw, wash) });
    const svc = makeSvc(db, llm);
    const r = await svc.evaluateActFront('0xtok', META, {});
    ok(r.status === 'assessed' && r.path === path && r.act === act && r.sbw === sbw && r.wash === wash,
      `分流 ${act}/sbw=${sbw}/wash=${wash} → ${path}（实际 ${r.status}/${r.path}/${r.act}/${r.sbw}/${r.wash}）`);
    ok(db.state.inserts === 0, `${path}：不落 cheat_detection 表（非 cheat 判定）`);
    ok(Object.keys(llm.calls.afQuestions || {}).length === 3, `${path}：Jev 调用恰 3 题`);
  }
  {
    // act 答案缺席（Jev 没答 activity_level）→ fail_open 放行进 cheat
    const db = makeDb({ ticks: genTicks(20) });
    const llm = makeLlm({ answers: afAnswers(null, 'none') });
    const svc = makeSvc(db, llm);
    const r = await svc.evaluateActFront('0xtok', META, {});
    ok(r.status === 'assessed' && r.act === null && r.path === 'fail_open',
      `act 答案缺席 → path=fail_open（宁跑全链不误拒；实际 ${r.path}）`);
  }
  {
    // 未知桶 → 读档 throw → fail（fail-open 放行进 cheat）
    const bad = { activity_level: { type: 'choice', probabilities: { extreme: 1.0 } }, stall_burst_wave: sbwAns('none'), wash_pair: phAns('none') };
    const db = makeDb({ ticks: genTicks(20) });
    const llm = makeLlm({ answers: bad });
    const svc = makeSvc(db, llm);
    const r = await svc.evaluateActFront('0xtok', META, {});
    ok(r.status === 'fail' && String(r.reason).includes('未知桶名'), `未知桶名 → fail+reason（实际 ${r.status}/${r.reason}）`);
  }
  {
    // Jev reject → fail + 冷却（第二次调用 cooldown）
    const db = makeDb({ ticks: genTicks(20) });
    const llm = makeLlm({ answers: afAnswers('mid'), reject: 'boom' });
    const nowRef = { t: 1000000 };
    const svc = makeSvc(db, llm, {}, nowRef);
    const r1 = await svc.evaluateActFront('0xtok', META, {});
    nowRef.t += 1000; // 冷却 10s 内
    const r2 = await svc.evaluateActFront('0xtok', META, {});
    ok(r1.status === 'fail' && r2.status === 'fail' && r2.reason === 'cooldown' && llm.calls.afAsk === 1,
      `Jev 失败 → fail；冷却期内二次调用 cooldown 秒回零 Jev（${r1.status}/${r2.status}/${r2.reason}/ask=${llm.calls.afAsk}）`);
  }
  {
    // insufficient_ticks → fail-open 放行进 cheat（不双拒）
    const db = makeDb({ ticks: genTicks(3) });
    const llm = makeLlm({ answers: afAnswers('mid') });
    const svc = makeSvc(db, llm);
    const r = await svc.evaluateActFront('0xtok', META, {});
    ok(r.status === 'insufficient_ticks' && r.anchorTickCount === 3 && llm.calls.afAsk === 0,
      `minTicks 不足 → insufficient_ticks 零 Jev（cheat 门同款预门兜底；实际 ${r.status}/${r.anchorTickCount}）`);
  }
  {
    // 不粘滞：同 token 连续两次评估两次真调
    const db = makeDb({ ticks: genTicks(20) });
    const llm = makeLlm({ answers: afAnswers('mid') });
    const svc = makeSvc(db, llm);
    await svc.evaluateActFront('0xtok', META, {});
    const r2 = await svc.evaluateActFront('0xtok', META, {});
    ok(llm.calls.afAsk === 2 && r2.path === 'mid_full', `每信号真调不粘滞（ask=${llm.calls.afAsk}）`);
  }
  {
    // inflight join：并发两调用共享一次链
    const db = makeDb({ ticks: genTicks(20) });
    const llm = makeLlm({ answers: afAnswers('mid') });
    const svc = makeSvc(db, llm);
    const [a, b] = await Promise.all([
      svc.evaluateActFront('0xtok', META, {}),
      svc.evaluateActFront('0xtok', META, {}),
    ]);
    ok(llm.calls.afAsk === 1 && a.path === 'mid_full' && b.path === 'mid_full' && svc.stats.actFrontJoined === 1,
      `inflight join（ask=${llm.calls.afAsk} joined=${svc.stats.actFrontJoined}）`);
  }
  {
    // awaitMs 竞速超时 → timeout_fail_open（不等待 hang 的链）
    const db = makeDb({ ticks: genTicks(20) });
    const llm = makeLlm({ answers: afAnswers('mid'), hang: true });
    const svc = makeSvc(db, llm, { timeoutMs: 10000 });
    const t0 = Date.now();
    const r = await svc.evaluateActFront('0xtok', META, {}, { awaitMs: 50 });
    ok(r.status === 'timeout_fail_open' && Date.now() - t0 < 500, `竞速超时 fail-open（${r.status} ${Date.now() - t0}ms）`);
  }

  // ═══════════════ D. 引擎 _actFrontGateEvaluate（call 打桩 this）═══════════════
  console.log('D. 引擎侧灰度与分流消费');
  const ENGINE_SRC = fs.readFileSync(path.join(__dirname, '../src/trading-engine/core/AbstractTradingEngine.js'), 'utf8');
  ok(ENGINE_SRC.includes('_actFrontGateEvaluate') && ENGINE_SRC.includes('_actFrontGateEnabled !== true'),
    '引擎源码口径：AF 门挂点+灰度关短路在场');
  const FM_SRC = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
  const BT_SRC = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/BacktestEngine.js'), 'utf8');
  ok(FM_SRC.includes('await this._actFrontGateEvaluate(') && BT_SRC.includes('await this._actFrontGateEvaluate('),
    '两引擎门链段 AF 调用点在场');
  ok(FM_SRC.includes('skipped_by_act_front') && BT_SRC.includes('skipped_by_act_front'),
    '跳过路径 cheatCheck.info=skipped_by_act_front 留痕在场');
  ok(FM_SRC.includes("actFrontGate && _cheatCfg.actFrontGate.enabled === true")
      && BT_SRC.includes("actFrontGate?.enabled === true"),
    '灰度键装载=cheatCheck.actFrontGate.enabled（两引擎）');
  {
    // 灰度关：service 零调用、skipCheat=false（现行 bit 一致）
    const calls = { n: 0 };
    const mini = Object.create(require('../src/trading-engine/core/AbstractTradingEngine').AbstractTradingEngine.prototype);
    Object.assign(mini, {
      _actFrontGateEnabled: false,
      _cheatCheckService: { enabled: true, evaluateActFront: async () => { calls.n++; return { status: 'assessed', path: 'reject_low' }; } },
      logger: { warn: () => {}, info: () => {} },
      _updateSignalMetadata: async () => {},
      _updateSignalStatus: async () => {},
    });
    const res = await mini._actFrontGateEvaluate('0xtok', { token: '0xtok', symbol: 'S' }, null, null, {});
    ok(res.pass === true && res.skipCheat === false && res.info === null && calls.n === 0,
      `灰度关 → pass+不跳cheat+零 service 调用（${JSON.stringify(res)} calls=${calls.n}）`);
  }
  {
    // 灰度开+reject：拒+signal failed
    const statusCalls = [];
    const mini = Object.create(require('../src/trading-engine/core/AbstractTradingEngine').AbstractTradingEngine.prototype);
    Object.assign(mini, {
      _actFrontGateEnabled: true,
      _cheatCheckService: { enabled: true, evaluateActFront: async () => ({ status: 'assessed', act: 'low', sbw: 'none', wash: 'none', path: 'reject_low', version: 'AF1' }) },
      logger: { warn: () => {}, info: () => {} },
      _updateSignalMetadata: async () => {},
      _updateSignalStatus: async (sid, st, info) => { statusCalls.push({ sid, st, info }); },
    });
    const res = await mini._actFrontGateEvaluate('0xtok', { token: '0xtok', symbol: 'S' }, null, 42, {});
    ok(res.pass === false && res.reason.includes('act_front_low'), `reject_low → 拒 reason=${res.reason}`);
    ok(statusCalls.length === 1 && statusCalls[0].st === 'failed' && statusCalls[0].info.reason === 'act_front_low',
      'signal status=failed reason=act_front_low');
  }
  {
    // 灰度开+high_skip：pass+skipCheat；mid_full：pass+不跳；timeout：pass+不跳
    const mk = (path, status = 'assessed') => {
      const mini = Object.create(require('../src/trading-engine/core/AbstractTradingEngine').AbstractTradingEngine.prototype);
      Object.assign(mini, {
        _actFrontGateEnabled: true,
        _cheatCheckService: { enabled: true, evaluateActFront: async () => ({ status, act: 'high', sbw: 'none', wash: 'none', path, version: 'AF1' }) },
        logger: { warn: () => {}, info: () => {} },
        _updateSignalMetadata: async () => {},
        _updateSignalStatus: async () => {},
      });
      return mini;
    };
    ok((await mk('high_skip')._actFrontGateEvaluate('0xtok', { token: '0xtok' }, null, null, {})).skipCheat === true, 'high_skip → skipCheat=true');
    ok((await mk('burst_exempt')._actFrontGateEvaluate('0xtok', { token: '0xtok' }, null, null, {})).skipCheat === true, 'burst_exempt → skipCheat=true');
    ok((await mk('mid_full')._actFrontGateEvaluate('0xtok', { token: '0xtok' }, null, null, {})).skipCheat === false, 'mid_full → skipCheat=false（照走 cheat）');
    ok((await mk(null, 'timeout_fail_open')._actFrontGateEvaluate('0xtok', { token: '0xtok' }, null, null, {})).skipCheat === false,
      'timeout_fail_open → skipCheat=false（fail-open 进 cheat 全链）');
  }

  // ═══════════════ E. FP14 N 升格臂 ═══════════════
  console.log('E. FP N 通道升格臂');
  ok(FACTOR_PREBUY_VERSION === 'FP15', `FP 版本=FP15（T174b 合并口径）（实际 ${FACTOR_PREBUY_VERSION}）`);
  {
    // 最小 snapshot 直调（cheatDerived=BP snapshot 的 base.derived 整包引用形状）
    const mkSnap = (routerEntryBuyPct) => ({ cheatDerived: { routerEntryBuyPct, buyN: 20, sellN: 5, totalBuyBnb: 2, totalSellBnb: 0.5 }, buyDerived: { activity: {} } });
    ok(fpJudge(mkSnap(9.9)).pass === false && fpJudge(mkSnap(9.9)).arms.includes('n_no_retail_entry'),
      'routerEntryBuyPct=9.9 → n_no_retail_entry 拒');
    ok(fpJudge(mkSnap(10.0)).arms.includes('n_no_retail_entry') === false, '恰 10.0 不触发（G17 严格小于同线）');
    ok(fpJudge(mkSnap(55)).arms.includes('n_no_retail_entry') === false, '55% 散户入口在场放行');
    ok(fpJudge(mkSnap(null)).arms.includes('n_no_retail_entry') === false, 'null（<15 笔样本薄 fail-open）不触发');
    const FP_SRC = fs.readFileSync(path.join(__dirname, '../src/market-analysis/factor-pre-buy-check.js'), 'utf8');
    ok(FP_SRC.includes('NO_RETAIL_ENTRY_PCT = 10') && FP_SRC.includes('G17 N_no_retail_entry 同线同值'),
      'N 线值=10 与 G17 同线注释在场');
  }

  console.log(`\n✅ _test_act_front_gate 全部通过（${passed} 断言）`);
}

main().catch((e) => { console.error(e); process.exit(1); });
