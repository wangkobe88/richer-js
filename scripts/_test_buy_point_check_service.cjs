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

/** supabase 风格链式 stub：from().select().eq().lte().order().limit() → {data,error}
 *  lte 语义过滤（anchorMs 截窗断言原料）：block_time ≤ 锚 的行才可见——服务侧由
 *  DB 截窗承担，桩侧同款实现（as-of 防前视） */
function mkDb({ ticksAsc = [], events = [], insertOk = true } = {}) {
    const inserted = [];
    const lteCalls = []; // 全部 .lte(col, val) 传参记录
    const mkChain = (data) => {
        const filters = [];
        return {
            select() { return this; },
            eq() { return this; },
            order() { return this; },
            lte(col, val) { filters.push([col, val]); lteCalls.push([col, val]); return this; },
            limit() {
                let out = data;
                for (const [c, v] of filters) {
                    if (c !== 'block_time') continue;
                    const t = new Date(v).getTime();
                    out = out.filter((r) => new Date(r.block_time).getTime() <= t);
                }
                return Promise.resolve({ data: out, error: null });
            },
        };
    };
    return {
        inserted,
        lteCalls,
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
        // BP48 两质量题退役：stub 答案不带 early_bird/pullback（8 维度形状，
        // market_pattern/activity/famous/holder 缺席=容缺 null——mapper 层全分支
        // 已在 _test_buy_point_lib 锁定，服务层只测透传与门变换）
        price_trend: { probabilities: { fast_up: 0.8, slow_up: 0.2 } },
        market_heat: { probabilities: { high: 0.6, mid: 0.4 } },
        entry_position: { probabilities: { near_high: 0.9, shallow_pullback: 0.1 } },
        price_level: { probabilities: { near_launch: 0.7, low: 0.3 } },
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

// platform 刻意不设（2026-11-08 发行价口径修正后）：全文件=旧口径（首可靠价锚）
// bit 回归锁——null 平台零变化；常量平台锚行为锁在 P 段末（META_FM 专断言）
const META = { symbol: 'TST', name: 'Test', createdAtMs: T0, totalSupply: 1e9, creatorAddress: '0x' + 'aa'.repeat(20) };
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
    await check('assessed：bucket/prob/rule/dimensions/anchors/model/usage 全形状（BP48 无 qualities）', async () => {
        const db = mkDb({ ticksAsc: TICKS10 });
        const llm = mkLlm({});
        const s = mkSvc(CFG, db, llm);
        const r = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, { signalId: 'SIG-A' });
        assert.strictEqual(r.status, 'assessed');
        assert.strictEqual(r.assessment.bucket, 'neutral');
        assert.strictEqual(r.assessment.prob, null, '纯门链 prob=null（BP48 无质量层）');
        assert.strictEqual(r.assessment.rule, 'gates_passed');
        assert.strictEqual(!('qualities' in r), true, 'BP48 qualities 键随服务返回删除');
        assert.strictEqual(r.dimensions.price_trend.bucket, 'fast_up');
        assert.strictEqual(r.dimensions.market_pattern, null, '缺席维度容缺 null');
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
    await check('fail/mapper_error：维度题在场未知桶 → error 行（failReason 含 mapper；BP48 缺答案容缺不再 throw）', async () => {
        const answers = {
            price_trend: { probabilities: { bogus_bucket: 0.9 } },
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

    // ═══ I. anchorMs 截窗 + persist:false 回测隔离（backtest.signalGateReal） ═══
    console.log('I. anchorMs 截窗 + persist:false 回测隔离');
    await check('anchorMs：tail 查询 .lte(block_time, 锚 iso) + 锚后行不可见（截到 7 行 < minTicks）', async () => {
        const db = mkDb({ ticksAsc: TICKS10 });
        const s = mkSvc({ ...CFG }, db, mkLlm());
        const anchorMs = T0 + 65 * 1000; // dt 5..65 共 7 行 ≤ 锚；70..95 共 3 行在锚后
        const r = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {}, { anchorMs });
        assert.strictEqual(r.status, 'insufficient_ticks', JSON.stringify(r));
        assert.strictEqual(r.anchorTickCount, 7, '锚后行不可见（无锚=10 行必过预门——截窗「真的截」的行为证据）');
        assert.ok(db.lteCalls.length >= 1, 'lte 传参在场');
        assert.ok(db.lteCalls.every(([c, v]) => c === 'block_time' && v === new Date(anchorMs).toISOString()),
            JSON.stringify(db.lteCalls));
    });
    await check('anchorMs：锚内 8 行恰过 minTicks → assessed（截窗下全链）且未满帽仅 tail 单查询', async () => {
        const db = mkDb({ ticksAsc: TICKS10 });
        const s = mkSvc({ ...CFG }, db, mkLlm());
        const r = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {}, { anchorMs: T0 + 75 * 1000 });
        assert.strictEqual(r.status, 'assessed', JSON.stringify(r));
        assert.strictEqual(db.lteCalls.length, 1, `tail 单查询（实际 ${db.lteCalls.length} 处 lte）`);
    });
    await check('anchorMs：满帽补 head 查询同样 .lte 截窗', async () => {
        const db = mkDb({ ticksAsc: TICKS10 });
        // pullLimit 下限 10（num min=10）：锚=末行时刻 → 10 行=帽 → capped → 补 head
        const s = mkSvc({ ...CFG, pullLimit: 10, headLimit: 5 }, db, mkLlm());
        const r = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {}, { anchorMs: T0 + 95 * 1000 });
        assert.strictEqual(r.status, 'assessed', JSON.stringify(r));
        assert.strictEqual(db.lteCalls.length, 2, `tail+head 两查询均带 lte（实际 ${db.lteCalls.length}）`);
    });
    await check('无/非法 anchorMs=零 lte（生产现状 bit 一致；0=有限正数门拒收）', async () => {
        const db = mkDb({ ticksAsc: TICKS10 });
        const s = mkSvc({ ...CFG }, db, mkLlm());
        const r = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {});
        assert.strictEqual(r.status, 'assessed');
        assert.strictEqual(db.lteCalls.length, 0, '不传 → 零 lte');
        const db0 = mkDb({ ticksAsc: TICKS10 });
        await mkSvc({ ...CFG }, db0, mkLlm()).gateBuyPoint('0x' + 'ab'.repeat(20), META, {}, { anchorMs: 0 });
        assert.strictEqual(db0.lteCalls.length, 0, 'anchorMs=0 → 同不传');
    });
    await check('persist:false 跳写 buy_point_analyses（判定照常）+ 对照组照常落行', async () => {
        const db = mkDb({ ticksAsc: TICKS10 });
        const s = mkSvc({ ...CFG, persist: false }, db, mkLlm());
        const r = await s.gateBuyPoint('0x' + 'ab'.repeat(20), META, {});
        assert.strictEqual(r.status, 'assessed');
        assert.strictEqual(db.inserted.length, 0, '零 insert（回测不污染生产 BP 判定域）');
        assert.ok(s.stats.persistSkipped >= 1, `persistSkipped=${s.stats.persistSkipped}`);
        const db2 = mkDb({ ticksAsc: TICKS10 });
        await mkSvc({ ...CFG }, db2, mkLlm()).gateBuyPoint('0x' + 'ab'.repeat(20), META, {});
        assert.strictEqual(db2.inserted.length, 1, '对照组 persist 默认=true 落 1 行');
    });
    await check('回测构造形状物化：settleDelayMs:0 不回落 4000（num min=0）+ persist 物化', () => {
        const s = mkSvc({ enabled: true, settleDelayMs: 0, persist: false }, mkDb(), mkLlm());
        assert.strictEqual(s._settleDelayMs, 0);
        assert.strictEqual(s._persist, false);
    });
    await check('源码口径：.lte(block_time, anchorIso) 恰两处（tail+head）', () => {
        const src = read('src/market-analysis/BuyPointCheckService.js');
        const n = (src.match(/\.lte\('block_time', anchorIso\)/g) || []).length;
        assert.strictEqual(n, 2, `实际 ${n}`);
    });

    // ═══ P. BP42 pump 豁免票位置门已随 BP55 退役（2026-11-09 用户裁定「这个已经
    //     不需要特殊处理了，现在庄盘也不接受价格高于 40%（也就是超出
    //     near_launch）」——BP48 起①⑤⑧位置门同线 ≤+40，pump 豁免票走盘型桶
    //     位置门即可，专属门/常量/引擎透传链整段删除）═══
    console.log('P. BP55 pump 豁免票位置门退役');
    // 高价 ticks：价格自 1e-9 → 1.72e-9（+72%，low 档拉离）；TICKS10=+9%（near_launch 内）
    const TICKS_PUMP = Array.from({ length: 10 }, (_, i) => trow(5 + i * 10, i % 2 ? 'sell' : 'buy', 0.1, (1 + i * 0.08) * 1e-9, { li: i }));
    const PUMP_TOK = '0x' + 'cd'.repeat(20);
    await check('传 pumpExempt（历史参数）∧ 已拉离（vsLaunch≈+72 > 40）→ 门不消费照常门链评估 neutral/gates_passed', async () => {
        const db = mkDb({ ticksAsc: TICKS_PUMP });
        const s = mkSvc({ ...CFG }, db, mkLlm());
        const r = await s.gateBuyPoint(PUMP_TOK, META, {}, { pumpExempt: true });
        assert.strictEqual(r.status, 'assessed');
        assert.strictEqual(r.assessment.bucket, 'neutral');
        assert.strictEqual(r.assessment.rule, 'gates_passed');
        assert.strictEqual(db.inserted.length, 1);
        const rowAssess = db.inserted[0].snapshot_digest.assessment;
        assert.strictEqual(rowAssess.bucket, 'neutral', `落表行综合=mapper 原样（实际 ${JSON.stringify(rowAssess)}）`);
    });
    await check('传 pumpExempt ∧ near_launch 内（vsLaunch≈+9 ≤ 40）→ 照常评估（与拉离形状同判——门已无行为）', async () => {
        const db = mkDb({ ticksAsc: TICKS10 });
        const s = mkSvc({ ...CFG }, db, mkLlm());
        const r = await s.gateBuyPoint(PUMP_TOK, META, {}, { pumpExempt: true });
        assert.strictEqual(r.status, 'assessed');
        assert.strictEqual(r.assessment.bucket, 'neutral');
        assert.strictEqual(r.assessment.rule, 'gates_passed');
    });
    await check('源码口径：PUMP_EXEMPT_LAUNCH_PCT 常量与 pump 位置门产出绝迹（整链删除锁）', () => {
        const svc = read('src/market-analysis/BuyPointCheckService.js');
        assert.ok(!/const PUMP_EXEMPT_LAUNCH_PCT/.test(svc), 'BP 侧常量声明应绝迹');
        assert.ok(!/opts\.pumpExempt/.test(svc), 'opts.pumpExempt 消费应绝迹');
        assert.ok(!/rule: 'pump_exempt_gate'/.test(svc), 'rule 产出应绝迹');
        const mapper = read('src/market-analysis/buy-point-result-mapper.js');
        assert.ok(/const RESTART_LAUNCH_PCT = 40;/.test(mapper), 'mapper restart 常量不受影响');
    });

    console.log(failed === 0 ? `\n✅ buy_point_check_service 全部通过（${passed} 断言）` : `\n❌ buy_point_check_service：${failed} 失败 / ${passed} 通过`);
    process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
    console.error('\n❌ FAIL:', e && e.message);
    console.error(e);
    process.exit(1);
});
