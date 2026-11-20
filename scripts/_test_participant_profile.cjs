#!/usr/bin/env node
/**
 * 参与者 GMGN 画像观察键单测（T193，2026-11-19 张雪电摩 pump 作弊案→画像库消费端）
 * ——零 DB 零网络（dbClient/loadLlm/pullTicks/now 全打桩）。
 *
 * 覆盖：
 *   A. selectTopBuyers：sender||trader COALESCE / buy-only / 同钱包聚合 / 尘埃门
 *      （聚合后口径——单笔尘埃×N 笔可聚合过线=拆单规避面知情锁）/ topN 截断
 *   B. aggregateParticipantProfile：miss 不进分母 / 下中位 / 小亏带 (-2000,0]
 *      边界 / young 分母（createdAtSec null 剔除；nowSec 缺省不评）/ bot 三标签 /
 *      亿级套利伪值中位数免疫 / winrate 0~1 透传 / 空输入形状
 *   C. Service 挂点：灰度关零行为 / 开（digest 段+assessed 透传+.in 查表）/
 *      回测 persist=false 不跑（时序穿越防线）/ 查表失败 fail-open 段级容错
 *   D. 源码口径锁：观察键不进门（factor-pre-buy-check 零消费）+ 回测门控在场
 *
 * 用法：node scripts/_test_participant_profile.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const { selectTopBuyers, aggregateParticipantProfile, PARTICIPANT_PROFILE_VERSION } = require(path.join(ROOT, 'src/market-analysis/participant-profile.js'));
const { BuyPointCheckService } = require(path.join(ROOT, 'src/market-analysis/BuyPointCheckService.js'));

let passed = 0, failed = 0;
function check(name, fn) {
    return Promise.resolve()
        .then(fn)
        .then(() => { passed++; console.log(`  ✓ ${name}`); })
        .catch((e) => { failed++; console.log(`  ✗ ${name}\n    ${e && e.message}`); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = (c) => '0x' + String(c).repeat(40).slice(0, 40);

// ═══ A. selectTopBuyers ═══
(async () => {
console.log('A. selectTopBuyers（top-N 买家选取）');
await check('A1 sender||trader COALESCE：sender null 回落 trader、都在取 sender', async () => {
    const rows = [
        { trade_type: 'buy', bnb_amount: 0.05, sender_address: null, trader_address: W('1a') },
        { trade_type: 'buy', bnb_amount: 0.05, sender_address: W('2b'), trader_address: W('9z') },
    ];
    const top = selectTopBuyers(rows);
    assert.deepStrictEqual(top.map(t => t.wallet), [W('1a'), W('2b')]);
});
await check('A2 只计 buy 行（sell 不入）', async () => {
    const rows = [
        { trade_type: 'buy', bnb_amount: 0.02, sender_address: W('1a') },
        { trade_type: 'sell', bnb_amount: 5, sender_address: W('3c') },
    ];
    const top = selectTopBuyers(rows);
    assert.deepStrictEqual(top.map(t => t.wallet), [W('1a')]);
});
await check('A3 同钱包多笔聚合后按买额降序', async () => {
    const rows = [
        { trade_type: 'buy', bnb_amount: 0.05, sender_address: W('1a') },
        { trade_type: 'buy', bnb_amount: 0.06, sender_address: W('2b') },
        { trade_type: 'buy', bnb_amount: 0.04, sender_address: W('1a') },
    ];
    const top = selectTopBuyers(rows);
    assert.deepStrictEqual(top, [{ wallet: W('1a'), bnb: 0.09 }, { wallet: W('2b'), bnb: 0.06 }]);
});
await check('A4 尘埃门=聚合后 ≥0.01（单笔 0.005×3=0.015 过线——拆单规避面知情锁）', async () => {
    const rows = [
        { trade_type: 'buy', bnb_amount: 0.005, sender_address: W('1a') },
        { trade_type: 'buy', bnb_amount: 0.005, sender_address: W('1a') },
        { trade_type: 'buy', bnb_amount: 0.005, sender_address: W('1a') },
        { trade_type: 'buy', bnb_amount: 0.009, sender_address: W('2b') },
    ];
    const top = selectTopBuyers(rows);
    assert.deepStrictEqual(top.map(t => t.wallet), [W('1a')]); // 0.015 过线；0.009 不过
});
await check('A5 topN 截断（默认 10）', async () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({ trade_type: 'buy', bnb_amount: 0.05, sender_address: W((i + 10).toString(16)) }));
    assert.strictEqual(selectTopBuyers(rows).length, 10);
    assert.strictEqual(selectTopBuyers(rows, { topN: 3 }).length, 3);
});

// ═══ B. aggregateParticipantProfile ═══
console.log('B. aggregateParticipantProfile（聚合观察键）');
const NOW = 1766000000;
const pRow = (addr, o = {}) => ({
    address: addr, tags: o.tags || [], created_at_sec: o.createdAt ?? null,
    token_num: o.tok ?? null, realized_profit: o.rp ?? null, winrate: o.wr ?? null,
});
await check('B1 miss 不进分母（selected vs profiled；各键只算命中者）', async () => {
    const top = [{ wallet: W('1a'), bnb: 0.1 }, { wallet: W('2b'), bnb: 0.09 }];
    const prof = new Map([[W('1a'), pRow(W('1a'), { tok: 300, rp: -50, wr: 0.2 })]]);
    const seg = aggregateParticipantProfile(top, prof, { nowSec: NOW });
    assert.strictEqual(seg.selected, 2);
    assert.strictEqual(seg.profiled, 1);
    assert.strictEqual(seg.medianTokenNum, 300);
    assert.strictEqual(seg.wallets.find(w => w.wallet === W('2b')).miss, true);
});
await check('B2 中位数=下中位（偶数长度取 n/2-1 位）', async () => {
    const top = [1, 2, 3, 4].map(i => ({ wallet: W('a' + i), bnb: 0.1 }));
    const prof = new Map(top.map((t, i) => [t.wallet, pRow(t.wallet, { tok: [10, 20, 30, 40][i] })]));
    assert.strictEqual(aggregateParticipantProfile(top, prof).medianTokenNum, 20);
});
await check('B3 小亏打工带 (-2000,0]：0 算、-2000 不算（开下界）、-2001 不算、正不算', async () => {
    const rps = [0, -2000, -2001, -100, 500];
    const top = rps.map((_, i) => ({ wallet: W('b' + i), bnb: 0.1 }));
    const prof = new Map(top.map((t, i) => [t.wallet, pRow(t.wallet, { rp: rps[i] })]));
    const seg = aggregateParticipantProfile(top, prof);
    assert.strictEqual(seg.smallLoserPct, 40.0); // 0 与 -100 两个 / 5
});
await check('B4 young：≤30d 计入；createdAtSec null 剔出分母（null≠0——Number(null)=0 陷阱锁）；nowSec 缺省不评', async () => {
    const top = [1, 2, 3].map(i => ({ wallet: W('c' + i), bnb: 0.1 }));
    const prof = new Map([
        [W('c1'), pRow(W('c1'), { createdAt: NOW - 10 * 86400 })],   // 10d → young
        [W('c2'), pRow(W('c2'), { createdAt: NOW - 40 * 86400 })],   // 40d → 非
        [W('c3'), pRow(W('c3'), { createdAt: null })],               // 缺 → 分母外
    ]);
    const seg = aggregateParticipantProfile(top, prof, { nowSec: NOW });
    assert.strictEqual(seg.youngPct, 50.0); // 1/2
    assert.strictEqual(seg.wallets.find(w => w.wallet === W('c3')).createdAtSec, null);
    assert.strictEqual(aggregateParticipantProfile(top, prof).youngPct, null);
});
await check('B5 bot 三标签（gmgn/gmgn_go/arbitrager）', async () => {
    const top = [1, 2, 3, 4].map(i => ({ wallet: W('d' + i), bnb: 0.1 }));
    const tags = [['gmgn'], ['gmgn_go'], ['arbitrager'], ['smart_degen', 'kol']];
    const prof = new Map(top.map((t, i) => [t.wallet, pRow(t.wallet, { tags: tags[i] })]));
    assert.strictEqual(aggregateParticipantProfile(top, prof).botTagPct, 75.0);
});
await check('B6 亿级套利伪值中位数免疫（-5e9 尾部不拉偏 median）+ rp=null 不落小亏带', async () => {
    const rps = [-100, -200, -300, -5e9];
    const top = rps.map((_, i) => ({ wallet: W('e' + i), bnb: 0.1 }));
    const prof = new Map(top.map((t, i) => [t.wallet, pRow(t.wallet, { rp: rps[i] })]));
    assert.strictEqual(aggregateParticipantProfile(top, prof).medianRealizedProfit, -300); // 排序后 [-5e9,-300,-200,-100] 下中位
    // null rp：不进 rps 分母、不冒充 0 落小亏带
    const top2 = [{ wallet: W('e9'), bnb: 0.1 }, { wallet: W('e8'), bnb: 0.1 }];
    const prof2 = new Map([[W('e9'), pRow(W('e9'), { rp: null })], [W('e8'), pRow(W('e8'), { rp: -100 })]]);
    const seg2 = aggregateParticipantProfile(top2, prof2);
    assert.strictEqual(seg2.smallLoserPct, 100.0); // 分母 1（null 剔除），命中 1
});
await check('B7 winrate 0~1 原值透传', async () => {
    const top = [1, 2, 3].map(i => ({ wallet: W('f' + i), bnb: 0.1 }));
    const prof = new Map(top.map((t, i) => [t.wallet, pRow(t.wallet, { wr: [0.2, 0.3, 0.45][i] })]));
    assert.strictEqual(aggregateParticipantProfile(top, prof).medianWinrate, 0.3);
});
await check('B8 空输入形状（selected=0 不炸）+ 版本常量', async () => {
    const seg = aggregateParticipantProfile([], new Map(), { nowSec: NOW });
    assert.strictEqual(seg.selected, 0);
    assert.strictEqual(seg.profiled, 0);
    assert.strictEqual(seg.medianTokenNum, null);
    assert.strictEqual(PARTICIPANT_PROFILE_VERSION, 'PP1');
});

// ═══ C. Service 挂点 ═══
console.log('C. BuyPointCheckService 挂点（灰度/回测隔离/fail-open）');
const T0 = Date.parse('2026-11-19T10:00:00.000Z');
const at = (dt) => new Date(T0 + dt * 1000).toISOString();
const META = { symbol: 'TST', name: 'Test', createdAtMs: T0, totalSupply: 1e9, creatorAddress: W('aa') };
const TICKS10 = Array.from({ length: 10 }, (_, i) => ({
    block_time: at(5 + i * 10), block_number: 1000 + i, log_index: i,
    trade_type: i % 2 ? 'sell' : 'buy',
    trader_address: W(String(10 + i)), sender_address: W(String(10 + i)),
    bnb_amount: 0.05, token_amount: 1e6, price_bnb: (1 + i * 0.01) * 1e-9, price_outlier: false,
    tx_hash: '0x' + (1000 + i), quote_token: null,
}));
const mkLlm = () => ({
    JevClient: { ask: () => sleep(1).then(() => ({ answers: { price_trend: { probabilities: { fast_up: 0.8 } } }, model: 'stub', usage: { total: 1 } })) },
    buildBuyPointQuestions: () => ({}), BUY_POINT_QUESTIONS_VERSION: 'BPTEST',
});
/** dbClient 桩：gmgn_wallet_profiles .in 查询（可控命中/失败）；insert 记录 */
function mkDb({ profiles = [], inError = null } = {}) {
    const inserted = []; const inCalls = [];
    return {
        inserted, inCalls,
        from(table) {
            if (table === 'buy_point_analyses') {
                return { insert(rows) { inserted.push(...rows); return Promise.resolve({ data: rows }); } };
            }
            return {
                select() { return this; }, eq() { return this; }, order() { return this; }, lte() { return this; }, limit() { return this; },
                in(col, vals) {
                    inCalls.push([table, col, vals]);
                    if (inError) return Promise.resolve({ data: null, error: inError });
                    return Promise.resolve({ data: profiles.filter(p => vals.includes(p.address)) });
                },
                range() { return Promise.resolve({ data: [] }); },
            };
        },
    };
}
const pullTicksStub = async () => ({ fromMem: true, rows: TICKS10, anchorTickCount: TICKS10.length, capped: false, watermark: null, quoteToken: null });
const mkSvc = (config, db) => new BuyPointCheckService(config, { info() {}, warn() {}, error() {} }, {
    dbClient: db, loadLlm: async () => mkLlm(), pullTicks: pullTicksStub,
});
const CFG = { enabled: true, settleDelayMs: 1, timeoutMs: 5000, gate: { awaitMs: 5000 }, minTicks: 6 };

await check('C1 灰度关（缺段零行为）：无查表、digest 无段、stats 零计数', async () => {
    const db = mkDb();
    const s = mkSvc(CFG, db);
    const r = await s.gateBuyPoint(W('ab'), META, {});
    assert.strictEqual(r.status, 'assessed');
    assert.strictEqual(db.inCalls.length, 0);
    assert.strictEqual(r.participantProfile, undefined);
    assert.strictEqual(s.stats.ppAggregated, 0);
    assert.strictEqual(db.inserted[0].snapshot_digest.participantProfile, null);
});
await check('C2 开：查表 .in(top 买家) + digest 段 + assessed 透传', async () => {
    const buyers = TICKS10.filter(t => t.trade_type === 'buy').map(t => t.sender_address);
    const uniq = [...new Set(buyers)];
    const db = mkDb({ profiles: uniq.map(w => pRow(w, { tok: 293, rp: -50, wr: 0.27, tags: ['gmgn'], createdAt: T0 / 1000 - 40 * 86400 })) });
    const s = mkSvc({ ...CFG, participantProfile: { enabled: true } }, db);
    const r = await s.gateBuyPoint(W('ab'), META, {});
    assert.strictEqual(r.status, 'assessed');
    assert.ok(db.inCalls.length >= 1 && db.inCalls[0][0] === 'gmgn_wallet_profiles');
    assert.deepStrictEqual(db.inCalls[0][2], uniq); // top 买家集合精确传入
    const seg = r.participantProfile;
    assert.strictEqual(seg.version, 'PP1');
    assert.strictEqual(seg.profiled, uniq.length);
    assert.strictEqual(seg.medianTokenNum, 293);
    assert.strictEqual(seg.botTagPct, 100.0);
    const dig = db.inserted[0].snapshot_digest.participantProfile;
    assert.strictEqual(dig.medianTokenNum, 293);
    assert.strictEqual(s.stats.ppAggregated, 1);
});
await check('C3 回测隔离（persist=false）：不聚合不查表（时序穿越防线）', async () => {
    const db = mkDb();
    const s = mkSvc({ ...CFG, participantProfile: { enabled: true }, persist: false }, db);
    const r = await s.gateBuyPoint(W('ab'), META, {});
    assert.strictEqual(r.status, 'assessed');
    assert.strictEqual(r.participantProfile, undefined);
    assert.strictEqual(db.inCalls.length, 0);
    assert.strictEqual(s.stats.ppSkippedDisabled, 1);
});
await check('C4 查表失败 fail-open：段={error}、门链照常 assessed', async () => {
    const db = mkDb({ inError: { message: 'schema cache miss' } });
    const s = mkSvc({ ...CFG, participantProfile: { enabled: true } }, db);
    const r = await s.gateBuyPoint(W('ab'), META, {});
    assert.strictEqual(r.status, 'assessed');
    assert.strictEqual(r.participantProfile.error, 'schema cache miss');
    assert.strictEqual(s.stats.ppErrors, 1);
});

// ═══ D. 源码口径锁 ═══
console.log('D. 源码口径锁');
await check('D1 观察键不进门：factor-pre-buy-check 零消费 participantProfile/pp 键', async () => {
    const src = read('src/market-analysis/factor-pre-buy-check.js');
    assert.ok(!/participantProfile|medianTokenNum|botTagPct|smallLoserPct/.test(src), 'FP 判定层不得消费观察键');
});
await check('D2 回测门控在场（_persist 门控源码锁）+ 引擎透传 additive', async () => {
    const svc = read('src/market-analysis/BuyPointCheckService.js');
    assert.ok(/this\._ppEnabled[\s\S]{0,400}this\._persist/.test(svc), 'ppEnabled 必须以 _persist 门控（回测不跑）');
    const eng = read('src/trading-engine/core/AbstractTradingEngine.js');
    assert.ok(/res\.participantProfile \? \{ participantProfile: res\.participantProfile \}/.test(eng), '引擎 assessed 透传须在场');
});

console.log(`\n结果: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
})();
