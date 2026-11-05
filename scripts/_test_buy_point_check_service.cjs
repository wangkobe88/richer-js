#!/usr/bin/env node
/**
 * BuyPointCheckService 单测（T117 BP 门服务，2026-11-05）——零 DB 零网络
 * （deps.dbClient/loadLlm/now/pullTicks 全打桩）。
 *
 * 覆盖：
 *   A. 五状态形状：disabled（物化语义缺段=关）/ insufficient_ticks（minTicks 预门
 *      不调 Jev 不落表）/ assessed（bucket/prob/dimensions/anchors/model/usage）/
 *      fail（llm_load/cooldown/jev_error/jev_timeout/mapper_error/chain_error）/
 *      timeout（竞速超时 late 链续跑落行）
 *   B. Jev 超时迟到丢弃（_runJev settled 后迟到结果/失败一律丢弃）
 *   C. 首行 prompt 恰一次（jev_prompt 首行全文、次行 null——无界增长防线）
 *   D. inflight join（并发同 token 单链：ask 1 次/insert 1 行/joined 计数）
 *   E. settle 双模（waitIdle 注入=竞速帽+idle 命中/超时计数；未注入=固定 sleep）
 *   F. signalInfo 溯源（context.signalId → [ANCHOR] 段渲染进 Jev state）
 *   G. 冷却时钟（deps.now 可控：冷却期 fail cooldown、过期重析）
 *   H. 源码口径防线（dbManager 单层 ../ 路径锁 v67 事故同款 / logger receiver
 *      绑定锁 member call / jev_prompt 首行防线 / 全 fail-closed 语义注释在场）
 *
 * 用法：node scripts/_test_buy_point_check_service.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const { BuyPointCheckService } = require(path.join(ROOT, 'src', 'market-analysis', 'BuyPointCheckService.js'));

let passed = 0, failed = 0;
function check(name, fn) {
    return Promise.resolve()
        .then(fn)
        .then(() => { passed++; console.log(`  ✓ ${name}`); })
        .catch((e) => { failed++; console.log(`  ✗ ${name}\n    ${e && e.message}`); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 打桩工厂 ──
const T0 = Date.parse('2026-11-05T10:00:00.000Z');
const at = (dt) => new Date(T0 + dt * 1000).toISOString();
const trow = (dt, side, bnb, price, o = {}) => ({
    block_time: at(dt), block_number: 1000 + dt, log_index: o.li ?? 0,
    trade_type: side, trader_address: o.w || '0x' + 'aa'.repeat(20), sender_address: o.sender !== undefined ? o.sender : (o.w || '0x' + 'aa'.repeat(20)),
    bnb_amount: bnb, token_amount: o.tok ?? 1e6, price_bnb: price, price_outlier: o.outlier === true,
    tx_hash: '0x' + (1000 + dt), quote_token: o.quote ?? null,
});

/** supabase 风格链式 stub：from().select().eq().order().limit() → {data,error} */
function mkDb({ ticksAsc = [], events = [], insertOk = true } = {}) {
    const inserted = [];
    const mkChain = (data) => ({
        select() { return this; },
        eq() { return this; },
        order() { return this; },
        limit() { return Promise.resolve({ data, error: null }); },
    });
    return {
        inserted,
        from(table) {
            if (table === 'wss_price_ticks') {
                const desc = ticksAsc.slice().reverse(); // 服务期望倒序 DB 形状
                return mkChain(desc);
            }
            if (table === 'wss_events') return mkChain(events);
            if (table === 'buy_point_analyses') {
                return {
                    insert(rows) {
                        if (!insertOk) return Promise.resolve({ data: null, error: { message: 'stub insert fail' } });
                        inserted.push(...rows);
                        return Promise.resolve({ data: rows, error: null });
                    },
                };
            }
            return mkChain([]);
        },
    };
}

/** Jev 打桩：可控延迟/可控答案/可控失败；记录每次 ask 收到的 state/questions */
function mkLlm({ delayMs = 0, answers, fail = null, version = 'BPTEST' } = {}) {
    const calls = [];
    const baseAnswers = {
        price_trend: { probabilities: { fast_up: 0.8, slow_up: 0.2 } },
        sell_pressure: { probabilities: { low: 0.9, mid: 0.1 } },
        market_heat: { probabilities: { high: 0.6, mid: 0.4 } },
        entry_position: { probabilities: { near_high: 0.9, shallow_pullback: 0.1 } },
        price_level: { probabilities: { near_launch: 0.7, low: 0.3 } },
        early_bird_quality: { probabilities: { good: 0.72, neutral: 0.28 } },
        pullback_entry_quality: { probabilities: { insufficient: 0.8, poor: 0.2 } },
        high_chase_quality: { probabilities: { insufficient: 0.9, poor: 0.1 } },
    };
    return {
        calls,
        JevClient: {
            ask(state, questions, opts) {
                calls.push({ state, questions, opts });
                if (fail) return Promise.reject(new Error(fail));
                return sleep(delayMs).then(() => ({ answers: answers || baseAnswers, model: 'stub-model', usage: { total: 42 } }));
            },
        },
        buildBuyPointQuestions: () => ({ stub_questions: true }),
        BUY_POINT_QUESTIONS_VERSION: version,
    };
}

const META = { symbol: 'TST', name: 'Test', platform: 'fourmeme', createdAtMs: T0, totalSupply: 1e9, creatorAddress: '0x' + 'aa'.repeat(20) };
const TICKS10 = Array.from({ length: 10 }, (_, i) => trow(5 + i * 10, i % 2 ? 'sell' : 'buy', 0.1, (1 + i * 0.01) * 1e-9, { li: i }));

function mkSvc(config, db, llm, extraDeps = {}) {
    return new BuyPointCheckService(config, { info() {}, warn() {}, error() {} }, {
        dbClient: db, loadLlm: async () => llm, ...extraDeps,
    });
}

(async () => {
    const CFG = { enabled: true, settleDelayMs: 1, timeoutMs: 5000, gate: { awaitMs: 5000 }, minTicks: 8 };

    // ═══ A. 五状态形状 ═══
    console.log('A. 五状态形状（disabled/insufficient/assessed/fail/timeout）');
    await check('disabled：缺段=关（物化语义）', async () => {
        const s = mkSvc({}, mkDb(), mkLlm({}));
        const r = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {});
        assert.deepStrictEqual(r, { status: 'disabled' });
        assert.strictEqual(s.enabled, false);
    });
    await check('enabled:false 显式关', async () => {
        const s = mkSvc({ enabled: false }, mkDb(), mkLlm({}));
        assert.strictEqual((await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {})).status, 'disabled');
    });
    await check('invalid_token：空地址', async () => {
        const s = mkSvc(CFG, mkDb(), mkLlm({}));
        assert.strictEqual((await s.gateBuyPoint('', META, {})).status, 'invalid_token');
    });
    await check('insufficient_ticks：3 行 < minTicks 8 → 不调 Jev 不落表', async () => {
        const db = mkDb({ ticksAsc: TICKS10.slice(0, 3) });
        const llm = mkLlm({});
        const s = mkSvc(CFG, db, llm);
        const r = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {});
        assert.strictEqual(r.status, 'insufficient_ticks');
        assert.strictEqual(r.anchorTickCount, 3);
        assert.strictEqual(llm.calls.length, 0, '不应调 Jev');
        assert.strictEqual(db.inserted.length, 0, '不应落表');
        assert.strictEqual(s.stats.skippedInsufficientTicks, 1);
    });
    await check('空 ticks → insufficient_ticks（anchorTickCount=0）', async () => {
        const s = mkSvc(CFG, mkDb({ ticksAsc: [] }), mkLlm({}));
        const r = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {});
        assert.strictEqual(r.status, 'insufficient_ticks');
        assert.strictEqual(r.anchorTickCount, 0);
    });
    await check('assessed：bucket/prob/rule/qualities/dimensions/anchors/model/usage 全形状', async () => {
        const db = mkDb({ ticksAsc: TICKS10 });
        const llm = mkLlm({});
        const s = mkSvc(CFG, db, llm);
        const r = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, { signalId: 'SIG-A' });
        assert.strictEqual(r.status, 'assessed');
        assert.strictEqual(r.assessment.bucket, 'good');
        assert.strictEqual(r.assessment.prob, 0.72);
        assert.strictEqual(r.assessment.rule, 'any_good');
        assert.strictEqual(r.qualities.early_bird.bucket, 'good');
        assert.strictEqual(r.qualities.pullback_entry.bucket, 'insufficient');
        assert.strictEqual(r.qualities.high_chase.bucket, 'insufficient');
        assert.strictEqual(r.dimensions.price_trend.bucket, 'fast_up');
        assert.strictEqual(typeof r.anchors.mcapBnb, 'number');
        assert.strictEqual(r.model, 'stub-model');
        assert.deepStrictEqual(r.usage, { total: 42 });
        assert.strictEqual(db.inserted.length, 1);
        assert.strictEqual(s.stats.analyzed, 1);
    });
    await check('fail/llm_load：loadLlm 抛错', async () => {
        const s = new BuyPointCheckService(CFG, { info() {}, warn() {}, error() {} }, {
            dbClient: mkDb(), loadLlm: async () => { throw new Error('boom'); },
        });
        const r = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {});
        assert.deepStrictEqual(r, { status: 'fail', reason: 'llm_load' });
    });
    await check('fail/jev_error：ask reject → error 行落表', async () => {
        const db = mkDb({ ticksAsc: TICKS10 });
        const llm = mkLlm({ fail: 'api down' });
        const s = mkSvc(CFG, db, llm);
        const r = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {});
        assert.strictEqual(r.status, 'fail');
        assert.strictEqual(r.reason, 'jev_error');
        assert.strictEqual(db.inserted.length, 1);
        assert.strictEqual(db.inserted[0].verdict, 'error');
        assert.ok(db.inserted[0].fail_reason.includes('api down'));
    });
    await check('fail/jev_timeout：ask 超 timeoutMs → timeout 行落表', async () => {
        const db = mkDb({ ticksAsc: TICKS10 });
        const llm = mkLlm({ delayMs: 400 });
        const s = mkSvc({ ...CFG, timeoutMs: 50, gate: { awaitMs: 5000 } }, db, llm);
        const r = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {});
        assert.strictEqual(r.status, 'fail');
        assert.strictEqual(r.reason, 'jev_timeout');
        assert.strictEqual(db.inserted.length, 1);
        assert.strictEqual(db.inserted[0].verdict, 'timeout');
        await sleep(450); // 等迟到 ask 落定（应被丢弃不二次落行）
        assert.strictEqual(db.inserted.length, 1, '迟到结果丢弃不追加行');
    });
    await check('fail/mapper_error：质量题缺答案 → error 行（failReason 含 mapper）', async () => {
        const answers = {
            price_trend: { probabilities: { fast_up: 0.8, slow_up: 0.2 } },
        };
        const db = mkDb({ ticksAsc: TICKS10 });
        const llm = mkLlm({ answers });
        const s = mkSvc(CFG, db, llm);
        const r = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {});
        assert.strictEqual(r.reason, 'mapper_error');
        assert.strictEqual(db.inserted.length, 1);
        assert.strictEqual(db.inserted[0].verdict, 'error');
        assert.ok(db.inserted[0].fail_reason.includes('mapper'));
    });
    await check('fail/chain_error：拉数层异常被兜底吞（调用方拒）', async () => {
        const badDb = {
            from() { throw new Error('client blown'); },
        };
        const s = mkSvc(CFG, badDb, mkLlm({}));
        const r = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {});
        assert.strictEqual(r.status, 'fail');
        assert.strictEqual(r.reason, 'chain_error');
    });
    await check('timeout：gate 竞速超时 → {status:timeout, late} + late 链续跑落行', async () => {
        const db = mkDb({ ticksAsc: TICKS10 });
        const llm = mkLlm({ delayMs: 200 });
        const s = mkSvc({ ...CFG, gate: { awaitMs: 30 } }, db, llm);
        const r = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {});
        assert.strictEqual(r.status, 'timeout');
        assert.ok(r.late && typeof r.late.then === 'function');
        assert.strictEqual(s.stats.gateTimeouts, 1);
        const late = await r.late; // late 链续跑成功
        assert.strictEqual(late.status, 'assessed');
        assert.strictEqual(db.inserted.length, 1, '迟到链落行（下个买信号可见）');
    });

    // ═══ B. 迟到丢弃（_runJev 竞速后结果一律丢） ═══
    console.log('B. Jev 超时迟到丢弃（timeout 行已落，迟到成功/失败不二次落）');
    await check('迟到失败也丢弃（warn 不追加行）', async () => {
        const db = mkDb({ ticksAsc: TICKS10 });
        let rejectLater;
        const llm = {
            calls: [],
            JevClient: { ask: () => new Promise((_, rej) => { rejectLater = rej; }) },
            buildBuyPointQuestions: () => ({}),
            BUY_POINT_QUESTIONS_VERSION: 'BPTEST',
        };
        const s = mkSvc({ ...CFG, timeoutMs: 30, gate: { awaitMs: 5000 } }, db, llm);
        const r = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {});
        assert.strictEqual(r.reason, 'jev_timeout');
        await sleep(50);
        rejectLater(new Error('late fail')); // settled 后到达
        await sleep(20);
        assert.strictEqual(db.inserted.length, 1);
    });

    // ═══ C. 首行 prompt 恰一次 ═══
    console.log('C. jev_prompt 首行全文防线（每 (token,version) 首行）');
    await check('同 token 二析：首行落全文、次行 null', async () => {
        const db = mkDb({ ticksAsc: TICKS10 });
        const llm = mkLlm({});
        const s = mkSvc(CFG, db, llm);
        const tok = '0x' + 'ab'.repeat(20);
        await s.gateBuyPoint(tok, META, {});
        await s.gateBuyPoint(tok, META, {}); // 首链已出 inflight，新链
        assert.strictEqual(db.inserted.length, 2);
        assert.ok(typeof db.inserted[0].jev_prompt === 'string' && db.inserted[0].jev_prompt.length > 0, '首行 prompt 全文');
        assert.strictEqual(db.inserted[1].jev_prompt, null, '次行 null');
        assert.ok(db.inserted[0].jev_prompt.includes('[PRECOMPUTED]'), 'prompt 是 state 全文');
        // answers_raw 形状
        assert.strictEqual(db.inserted[0].answers_raw.model, 'stub-model');
        assert.strictEqual(db.inserted[1].question_version, 'BPTEST');
    });
    await check('版本换挡后 prompt 再落一次（版本键防串）', async () => {
        const db = mkDb({ ticksAsc: TICKS10 });
        const s = mkSvc(CFG, db, mkLlm({ version: 'BPV1' }));
        const tok = '0x' + 'cd'.repeat(20);
        await s.gateBuyPoint(tok, META, {});
        s._llm = mkLlm({ version: 'BPV2' }); // 模拟题集 bump 换版本
        await s.gateBuyPoint(tok, META, {});
        assert.ok(db.inserted[0].jev_prompt !== null && db.inserted[1].jev_prompt !== null, '版本变化=新键再落全文');
        assert.strictEqual(db.inserted[1].question_version, 'BPV2');
    });

    // ═══ D. inflight join ═══
    console.log('D. inflight join（并发同 token 单链）');
    await check('并发两 gate → ask 1 次/insert 1 行/joined=1', async () => {
        const db = mkDb({ ticksAsc: TICKS10 });
        const llm = mkLlm({ delayMs: 80 });
        const s = mkSvc({ ...CFG, settleDelayMs: 1 }, db, llm);
        const tok = '0x' + 'ef'.repeat(20);
        const [a, b] = await Promise.all([
            s.gateBuyPoint(tok, META, {}),
            sleep(10).then(() => s.gateBuyPoint(tok, META, {})),
        ]);
        assert.strictEqual(a.status, 'assessed');
        assert.strictEqual(b.status, 'assessed');
        assert.strictEqual(llm.calls.length, 1, 'Jev 只调一次');
        assert.strictEqual(db.inserted.length, 1, '只落一行');
        assert.strictEqual(s.stats.inflightJoined, 1);
    });

    // ═══ E. settle 双模 ═══
    console.log('E. settle 双模（waitIdle 注入=竞速帽；未注入=固定 sleep）');
    await check('waitIdle 即真 → settleIdleHits', async () => {
        const db = mkDb({ ticksAsc: TICKS10 });
        const idleCalls = [];
        const s = mkSvc({ ...CFG, settleDelayMs: 2000 }, db, mkLlm({}), {
            waitIdle: async (tok) => { idleCalls.push(tok); return true; },
        });
        const r = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {});
        assert.strictEqual(r.status, 'assessed');
        assert.strictEqual(idleCalls.length, 1);
        assert.strictEqual(s.stats.settleIdleHits, 1);
        assert.strictEqual(s.stats.settleIdleTimeouts, 0);
    });
    await check('waitIdle 超帽 → settleIdleTimeouts（链照跑）', async () => {
        const db = mkDb({ ticksAsc: TICKS10 });
        const s = mkSvc({ ...CFG, settleDelayMs: 20 }, db, mkLlm({}), {
            waitIdle: () => sleep(5000).then(() => true), // 永远赶不上 20ms 帽
        });
        const r = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {});
        assert.strictEqual(r.status, 'assessed');
        assert.strictEqual(s.stats.settleIdleTimeouts, 1);
    });

    // ═══ F. signalInfo 溯源 ═══
    console.log('F. signalInfo 溯源（context → [ANCHOR] 段进 state）');
    await check('signalId/策略名/fire 价进 Jev state', async () => {
        const db = mkDb({ ticksAsc: TICKS10 });
        const llm = mkLlm({});
        const s = mkSvc(CFG, db, llm);
        const r = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {
            signalId: 'SIG-777', signalCreatedAt: '2026-11-05T10:01:00Z', firePriceBnb: 1.5e-9, strategyName: 't3 阶梯',
        });
        assert.strictEqual(r.status, 'assessed');
        assert.ok(llm.calls[0].state.includes('SIG-777'), 'signalId 渲染');
        assert.ok(llm.calls[0].state.includes('t3 阶梯'), '策略名渲染');
        assert.ok(llm.calls[0].state.includes('1.50e-9'), 'fire 价渲染');
        assert.strictEqual(db.inserted[0].signal_id, 'SIG-777');
    });
    await check('无 signalId → 无信号溯源行（signalInfo=null）', async () => {
        const llm = mkLlm({});
        const s = mkSvc(CFG, mkDb({ ticksAsc: TICKS10 }), llm);
        await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {});
        assert.ok(!llm.calls[0].state.includes('信号溯源'), '无信号溯源行');
    });

    // ═══ G. 冷却时钟（deps.now 可控） ═══
    console.log('G. 失败冷却（可控时钟：冷却期 fail cooldown、过期重析）');
    await check('jev_error 后冷却期内秒回 cooldown，过期重析', async () => {
        let now = 1000000;
        let mode = 'fail';
        const db = mkDb({ ticksAsc: TICKS10 });
        const good = mkLlm({}); // 成功桩（标准答案）
        const llm = {
            JevClient: {
                ask: (state, questions, opts) => (mode === 'fail'
                    ? Promise.reject(new Error('first fail'))
                    : good.JevClient.ask(state, questions, opts)),
            },
            buildBuyPointQuestions: good.buildBuyPointQuestions,
            BUY_POINT_QUESTIONS_VERSION: 'BPTEST',
        };
        const s = mkSvc({ ...CFG, failCooldownMs: 5000 }, db, llm, { now: () => now });
        const r1 = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {});
        assert.strictEqual(r1.reason, 'jev_error');
        now += 1000; // 冷却期内
        const r2 = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {});
        assert.strictEqual(r2.reason, 'cooldown', '冷却期秒回');
        assert.strictEqual(s.stats.cooldownSkipped, 1);
        now += 5000; // 过期
        mode = 'ok';
        const r3 = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {});
        assert.strictEqual(r3.status, 'assessed', '冷却过期重析');
    });

    // ═══ H. 源码口径防线 ═══
    console.log('H. 源码口径防线（v67 两事故锁 + fail-closed 语义）');
    {
        const src = read('src/market-analysis/BuyPointCheckService.js');
        await check('dbManager 单层路径锁（../services 恰一次，无 ../../ 双层）', () => {
            assert.ok(src.includes("require('../services/dbManager')"), '单层 require 缺失');
            assert.ok(!src.includes("require('../../services/dbManager')"), '双层路径事故形状在场');
        });
        await check('logger receiver 绑定锁（member call 形状）', () => {
            assert.ok(src.includes("this._logger[level]('', 'BuyPointCheck', msg)"), 'member call 形状变化');
        });
        await check('jev_prompt 首行防线（isFirst 守卫）', () => {
            assert.ok(src.includes('jev_prompt: raw && isFirst ? raw.state : null'), '首行防线形状变化');
        });
        await check('gate timeout 契约注释（fail-closed 拒+late 链落行）', () => {
            assert.ok(src.includes('调用方 fail-closed 拒本笔'), 'timeout 契约注释缺失');
        });
        await check('无粘滞/无拉黑（BP 无终态——与 cheat 刻意不同）', () => {
            assert.ok(!/_sticky|isBlocked|_blacklist/.test(src), '出现粘滞/拉黑形状（BP 不应有）');
        });
    }

    console.log(failed === 0 ? `\n✅ buy_point_check_service 全部通过（${passed} 断言）` : `\n❌ buy_point_check_service：${failed} 失败 / ${passed} 通过`);
    process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
    console.error('\n❌ FAIL:', e && e.message);
    console.error(e);
    process.exit(1);
});
