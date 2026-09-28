#!/usr/bin/env node
/**
 * precheck fail 重试服务 + 代币分类提取——本地零 DB 单测
 * （打桩 dbManager 单例 client + NarrativeAnalyzer.analyze 静态方法，不连任何真实服务）
 *
 * 覆盖：
 *   1. deriveTokenCategory 六路：prestage.category / __clear 穿透 / super_ip_fast /
 *      event:X / 双 null / prestage 优先于 stage1
 *   2. 候选过滤：address-fail 触发，其他规则 fail 与通过行不触发
 *   3. 出窗完全停止（=300s 边界 skip / 窗内触发）
 *   4. 无创建锚不重试（fail-closed）
 *   5. 交易增量阈值（19 < 20 skip / ≥ 20 触发；增量基准 = analyzed_at 之后）
 *   6. per-token 次数上限（第 6 轮 skip）
 *   7. maxPerScan 单轮限量
 *   8. 重析成功判定（仍 address-fail 不计 resolved；ignoreCache 参数透传）
 *   9. 重析成功后行不再候选（stub 更新 token_narrative 行 → 下轮零候选）
 *  10. enabled=false 不挂 timer
 *  11. no_public_info 域（FOMOON 案）：ruleName 形状候选 / enrichSocialByGmgn 透传 /
 *      GMGN 缓存定点失效（url 小写）/ 独立 1800s 窗（与 address 300s 互不影响）
 *  12. GMGN 失效失败跳过本轮（不烧 analyze、attempts 不计）+ 仍 no_public_info
 *      不计成功、拿到语料后计成功
 *
 * 用法：node scripts/_test_precheck_fail_retry.cjs
 */

'use strict';

// ═══════════════ dbManager 单例打桩（必须在被测模块加载前完成）═══════════════
const { dbManager } = require('../src/services/dbManager');

/** 链式 thenable mock：gt/eq/order/limit 过滤；select(col, {count,head}) 计数模式 */
class MockQuery {
    constructor(db, table, countMode = false) {
        this.db = db;
        this.table = table;
        this.countMode = countMode;
        this._gt = {};
        this._eqs = {};
        this._lim = null;
        this._asc = true;
    }
    select(_cols, opts) {
        if (opts && opts.count) this.countMode = true;
        return this;
    }
    gt(col, v) { this._gt[col] = v; return this; }
    eq(col, v) { this._eqs[col] = v; return this; }
    order(_col, opts) { this._asc = opts ? !!opts.ascending : true; return this; }
    limit(n) { this._lim = n; return this; }
    then(resolve) { resolve(this._exec()); }
    _exec() {
        let rows = this.db.tables[this.table] || [];
        for (const [col, v] of Object.entries(this._gt)) {
            rows = rows.filter(r => String(r[col]) > String(v));
        }
        for (const [col, v] of Object.entries(this._eqs)) {
            rows = rows.filter(r => r[col] === v);
        }
        rows = [...rows].sort((a, b) => (this._asc
            ? new Date(a.created_at || a.received_at || 0) - new Date(b.created_at || b.received_at || 0)
            : new Date(b.created_at || b.received_at || 0) - new Date(a.created_at || a.received_at || 0)));
        if (this._lim != null) rows = rows.slice(0, this._lim);
        if (this.countMode) return { count: rows.length, error: null };
        return { data: rows, error: null };
    }
}

function freshDb() {
    const db = { tables: { token_narrative: [], wss_events: [], wss_price_ticks: [] } };
    db.client = { from: (t) => new MockQuery(db, t) };
    return db;
}

const activeDb = freshDb();
dbManager.isInitialized = true;
dbManager.client = activeDb.client;

// ═══════════════ 测试基建 ═══════════════
let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.error(`  ❌ ${name}${detail ? ` | ${detail}` : ''}`); }
}

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

/** token_narrative 行（address-fail 形状缺省；validationStage=null = 通过行/其他形状） */
function narrativeRow(addr, { analyzedAtMsAgo = 60000, validationStage = 'address' } = {}) {
    return {
        token_address: addr,
        analyzed_at: iso(analyzedAtMsAgo),
        is_valid: true,
        pre_check_result: validationStage === null ? null : {
            rating: 'low', pass: false, reason: '账号质量不达标',
            details: { addressVerified: false, validationStage },
        },
    };
}

/** token_narrative 行（no_public_info 规则 fail 形状：ruleName，无 validationStage——两类形状互斥） */
function narrativeNoInfoRow(addr, { analyzedAtMsAgo = 40000 } = {}) {
    return {
        token_address: addr,
        analyzed_at: iso(analyzedAtMsAgo),
        is_valid: true,
        pre_check_result: {
            rating: 'low', pass: false, reason: '缺少任何有效的公开信息来源（网站、社交媒体、视频等），无叙事价值',
            details: { ruleName: 'no_public_info', scores: { credibility: 5, virality: 5 }, total_score: 10 },
        },
    };
}

/** wss_events token_create 行 */
function evCreateRow(token, createdMsAgo) {
    return {
        kind: 'token_create', token_address: token,
        created_at: iso(createdMsAgo),
    };
}

/** wss_price_ticks 行（received_at 相对 now） */
function tickRow(id, token, receivedMsAgo) {
    return { id, token_address: token, received_at: iso(receivedMsAgo) };
}

async function main() {
    // ═══ A. deriveTokenCategory（纯函数六路）═══
    console.log('A. deriveTokenCategory 六路');
    const { deriveTokenCategory } = await import('../src/narrative/analyzer/NarrativeAnalyzer.mjs');

    check('prestage.category → project',
        deriveTokenCategory({ category: 'project' }, null) === 'project');
    check('prestage __clear 穿透取 stage1',
        deriveTokenCategory({ __clear: true }, { parsed_output: { eventClassification: { primaryCategory: 'W' } } }) === 'event:W');
    check('super_ip_fast 优先（stage1 同时 __clear）',
        deriveTokenCategory({ category: 'super_ip_fast' }, { __clear: true }) === 'super_ip_fast');
    check('仅 stage1 → event:C',
        deriveTokenCategory(null, { parsed_output: { eventClassification: { primaryCategory: 'C' } } }) === 'event:C');
    check('双 null → null',
        deriveTokenCategory(null, null) === null
        && deriveTokenCategory({ rating: 'unrated' }, { parsed_output: {} }) === null);
    check('prestage 优先于 stage1',
        deriveTokenCategory({ category: 'account_based_meme' },
            { parsed_output: { eventClassification: { primaryCategory: 'A' } } }) === 'account_based_meme');

    // ═══ 打桩 NarrativeAnalyzer.analyze（服务惰性 import 拿到同一模块实例）═══
    const analyzerMod = await import('../src/narrative/analyzer/NarrativeAnalyzer.mjs');
    const analyzeCalls = [];
    const realAnalyze = analyzerMod.NarrativeAnalyzer.analyze;
    let analyzeImpl = async () => ({ llmAnalysis: { preCheck: null, summary: { rating: 'mid' }, prestage: { category: 'project' } }, meta: { promptType: 'account_community' } });
    analyzerMod.NarrativeAnalyzer.analyze = async (addr, options) => {
        analyzeCalls.push({ addr, options });
        return analyzeImpl(addr, options);
    };

    const { PrecheckFailRetryService } = await import('../src/narrative/engine/PrecheckFailRetryService.mjs');

    // 打桩 ExternalResourceCache.invalidate（服务静态 import 拿到同一模块实例，
    // static 方法可写——与 analyze 打桩同手法；默认成功并记录调用）
    const { ExternalResourceCache } = await import('../src/narrative/db/ExternalResourceCache.mjs');
    const invalidateCalls = [];
    const realInvalidate = ExternalResourceCache.invalidate;
    let invalidateImpl = async (url, resourceType) => {
        invalidateCalls.push({ url, resourceType });
        return true;
    };
    ExternalResourceCache.invalidate = async (url, resourceType) => invalidateImpl(url, resourceType);

    // ═══ B. 候选过滤 + 窗口 + 锚 + 阈值（单轮 _scanOnce 全链）═══
    console.log('B. 候选过滤 / 窗口 / 锚 / 增量阈值');
    {
        activeDb.tables.token_narrative.length = 0;
        activeDb.tables.wss_events.length = 0;
        activeDb.tables.wss_price_ticks.length = 0;
        analyzeCalls.length = 0;

        // 三种行：address-fail（应触发）/ 其他 account 阶段 fail（不触发）/ 通过行（不触发）
        const A1 = '0x1111111111111111111111111111111111111111'; // address-fail，窗内 + 增量达标 → 触发
        const A2 = '0x2222222222222222222222222222222222222222'; // 其他 account 阶段 fail（name）→ 不候选
        const A3 = '0x3333333333333333333333333333333333333333'; // 通过行 → 不候选
        activeDb.tables.token_narrative.push(
            narrativeRow(A1, { analyzedAtMsAgo: 60000 }),
            narrativeRow(A2, { analyzedAtMsAgo: 60000, validationStage: 'name' }),
            narrativeRow(A3, { analyzedAtMsAgo: 60000, validationStage: null }),
        );
        activeDb.tables.wss_events.push(evCreateRow(A1, 120000)); // 2min 前创建（窗内）
        for (let i = 0; i < 25; i++) activeDb.tables.wss_price_ticks.push(tickRow(1000 + i, A1, 30000));

        const svc = new PrecheckFailRetryService({});
        await svc._scanOnce();
        check('仅 address-fail 触发重析（1 次，其他 account 阶段/通过行不候选）',
            analyzeCalls.length === 1 && analyzeCalls[0].addr === A1);
        check('ignoreCache:true 透传（address 域无 enrichSocialByGmgn）',
            analyzeCalls[0]?.options?.ignoreCache === true
            && analyzeCalls[0]?.options?.enrichSocialByGmgn === undefined);
        check('候选计数含过滤前形状', svc.stats.candidates === 1);
        check('重析成功计数（stub 返回非 address-fail）', svc.stats.retrySuccess === 1);
    }

    // ═══ C. 出窗完全停止（边界 300s）═══
    {
        activeDb.tables.token_narrative.length = 0;
        activeDb.tables.wss_events.length = 0;
        activeDb.tables.wss_price_ticks.length = 0;
        analyzeCalls.length = 0;

        const W1 = '0x4444444444444444444444444444444444444444'; // 创建于 301s 前（出窗）
        const W2 = '0x5555555555555555555555555555555555555555'; // 创建于 299s 前（窗内）
        activeDb.tables.token_narrative.push(
            narrativeRow(W1, { analyzedAtMsAgo: 40000 }),
            narrativeRow(W2, { analyzedAtMsAgo: 40000 }),
        );
        activeDb.tables.wss_events.push(evCreateRow(W1, 301000), evCreateRow(W2, 299000));
        for (let i = 0; i < 30; i++) activeDb.tables.wss_price_ticks.push(tickRow(2000 + i, W1, 10000));
        for (let i = 0; i < 30; i++) activeDb.tables.wss_price_ticks.push(tickRow(3000 + i, W2, 10000));

        const svc = new PrecheckFailRetryService({});
        await svc._scanOnce();
        check('出窗（301s）完全停止 / 窗内（299s）触发',
            analyzeCalls.length === 1 && analyzeCalls[0].addr === W2);
        check('出窗跳过计数', svc.stats.windowExpiredSkips === 1);
    }

    // ═══ D. 无锚不重试 + 增量不达标 ═══
    {
        activeDb.tables.token_narrative.length = 0;
        activeDb.tables.wss_events.length = 0;
        activeDb.tables.wss_price_ticks.length = 0;
        analyzeCalls.length = 0;

        const N1 = '0x6666666666666666666666666666666666666666'; // 无 token_create 事件
        const N2 = '0x7777777777777777777777777777777777777777'; // 有锚但增量 19 < 20
        activeDb.tables.token_narrative.push(
            narrativeRow(N1), narrativeRow(N2),
        );
        activeDb.tables.wss_events.push(evCreateRow(N2, 120000));
        for (let i = 0; i < 19; i++) activeDb.tables.wss_price_ticks.push(tickRow(4000 + i, N2, 30000));

        const svc = new PrecheckFailRetryService({});
        await svc._scanOnce();
        check('无锚不重试 + 增量 19<20 不触发（零重析）', analyzeCalls.length === 0);
        check('无锚跳过计数', svc.stats.noAnchorSkips === 1);
        check('增量不足跳过计数', svc.stats.volumeBelowSkips === 1);
    }

    // ═══ E. 增量基准 = analyzed_at 之后（窗口内但发生在分析前的旧 tick 不计）═══
    {
        activeDb.tables.token_narrative.length = 0;
        activeDb.tables.wss_events.length = 0;
        activeDb.tables.wss_price_ticks.length = 0;
        analyzeCalls.length = 0;

        const E1 = '0x8888888888888888888888888888888888888888';
        // analyzed_at = 30s 前；30 笔 tick 全在 60s 前（分析之前）→ 增量 0
        activeDb.tables.token_narrative.push(narrativeRow(E1, { analyzedAtMsAgo: 30000 }));
        activeDb.tables.wss_events.push(evCreateRow(E1, 120000));
        for (let i = 0; i < 30; i++) activeDb.tables.wss_price_ticks.push(tickRow(5000 + i, E1, 60000));

        const svc = new PrecheckFailRetryService({});
        await svc._scanOnce();
        check('增量基准 = analyzed_at 之后（分析前旧 tick 不计数）', analyzeCalls.length === 0);
    }

    // ═══ F. per-token 次数上限 + maxPerScan ═══
    {
        activeDb.tables.token_narrative.length = 0;
        activeDb.tables.wss_events.length = 0;
        activeDb.tables.wss_price_ticks.length = 0;
        analyzeCalls.length = 0;

        const F1 = '0x9999999999999999999999999999999999999999';
        activeDb.tables.token_narrative.push(narrativeRow(F1));
        activeDb.tables.wss_events.push(evCreateRow(F1, 120000));
        for (let i = 0; i < 40; i++) activeDb.tables.wss_price_ticks.push(tickRow(6000 + i, F1, 10000));

        const svc = new PrecheckFailRetryService({});
        // stub 仍返回 address-fail（未解决）→ 行持续候选
        analyzeImpl = async () => ({
            llmAnalysis: { preCheck: { details: { validationStage: 'address' } }, summary: { rating: 'low' } },
            meta: {},
        });
        for (let round = 0; round < 6; round++) await svc._scanOnce();
        check('per-token 上限 5 次（第 6 轮不再触发）',
            analyzeCalls.length === 5, `got ${analyzeCalls.length}`);
        check('上限跳过计数', svc.stats.maxRetriesSkips === 1);
        check('未解决不计成功', svc.stats.retrySuccess === 0);

        // maxPerScan：重置计数，3 个合格候选一轮最多触发 2 个
        activeDb.tables.token_narrative.length = 0;
        activeDb.tables.wss_events.length = 0;
        analyzeCalls.length = 0;
        for (let i = 0; i < 3; i++) {
            const addr = '0xaaaa' + String(i).padStart(36, '0');
            activeDb.tables.token_narrative.push(narrativeRow(addr));
            activeDb.tables.wss_events.push(evCreateRow(addr, 120000));
            for (let j = 0; j < 30; j++) activeDb.tables.wss_price_ticks.push(tickRow(7000 + i * 100 + j, addr, 10000));
        }
        const svc2 = new PrecheckFailRetryService({});
        await svc2._scanOnce();
        check('maxPerScan=2 单轮限量（3 候选触发 2）', analyzeCalls.length === 2);
    }

    // ═══ G. 重析成功后行不再候选 ═══
    {
        activeDb.tables.token_narrative.length = 0;
        activeDb.tables.wss_events.length = 0;
        activeDb.tables.wss_price_ticks.length = 0;
        analyzeCalls.length = 0;

        const G1 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
        activeDb.tables.token_narrative.push(narrativeRow(G1));
        activeDb.tables.wss_events.push(evCreateRow(G1, 120000));
        for (let i = 0; i < 30; i++) activeDb.tables.wss_price_ticks.push(tickRow(8000 + i, G1, 10000));

        // stub 模拟真实 analyze 的副作用：成功后清掉 pre_check_result、前移 analyzed_at
        analyzeImpl = async (addr) => {
            const row = activeDb.tables.token_narrative.find(r => r.token_address === addr);
            row.pre_check_result = null;
            row.analyzed_at = new Date().toISOString();
            return { llmAnalysis: { preCheck: null, summary: { rating: 'mid' }, prestage: { category: 'project' } }, meta: {} };
        };
        const svc = new PrecheckFailRetryService({});
        await svc._scanOnce();
        check('首轮触发重析', analyzeCalls.length === 1);
        await svc._scanOnce();
        check('重析成功后行不再候选（次轮零重析）', analyzeCalls.length === 1);
    }

    // ═══ J. no_public_info 域（FOMOON 案）：候选 / 参数 / GMGN 缓存失效 / 独立窗口 ═══
    {
        activeDb.tables.token_narrative.length = 0;
        activeDb.tables.wss_events.length = 0;
        activeDb.tables.wss_price_ticks.length = 0;
        analyzeCalls.length = 0;
        invalidateCalls.length = 0;
        analyzeImpl = async () => ({
            llmAnalysis: { preCheck: null, summary: { rating: 'mid' }, prestage: { category: 'project' } },
            meta: { promptType: 'standard' },
        });

        // J1 混合大小写地址（验证 invalidate key 小写化）；创建 20min 前：no_public_info
        // 1800s 窗内、address 300s 窗外——两域独立配窗互不影响
        const J1 = '0xC5E17933501712485D2EC6662679409006767777';
        const J2 = '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD'; // address-fail，同 20min 前创建 → 已出 address 窗
        const J3 = '0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE'; // no_public_info，创建 1801s 前 → 出 1800s 窗
        activeDb.tables.token_narrative.push(
            narrativeNoInfoRow(J1),
            narrativeRow(J2, { analyzedAtMsAgo: 40000 }),
            narrativeNoInfoRow(J3, { analyzedAtMsAgo: 40000 }),
        );
        activeDb.tables.wss_events.push(
            evCreateRow(J1, 1200000), evCreateRow(J2, 1200000), evCreateRow(J3, 1801000),
        );
        for (let i = 0; i < 30; i++) activeDb.tables.wss_price_ticks.push(tickRow(9000 + i, J1, 10000));

        const svc = new PrecheckFailRetryService({});
        await svc._scanOnce();
        check('no_public_info 窗内（20min）触发；同刻 address-fail 已出 300s 窗（独立配窗）',
            analyzeCalls.length === 1 && analyzeCalls[0].addr === J1);
        check('enrichSocialByGmgn:true + ignoreCache:true 透传',
            analyzeCalls[0]?.options?.ignoreCache === true
            && analyzeCalls[0]?.options?.enrichSocialByGmgn === true);
        check('GMGN 缓存定点失效（url 小写 + gmgn_token_info）',
            invalidateCalls.length === 1
            && invalidateCalls[0].url === `gmgn:token:bsc:${J1.toLowerCase()}`
            && invalidateCalls[0].resourceType === 'gmgn_token_info');
        check('出窗跳过计数（address 窗 + no_public_info 窗各 1）',
            svc.stats.windowExpiredSkips === 2);
    }

    // ═══ K. GMGN 失效失败跳过 + no_public_info 成功判定 ═══
    {
        activeDb.tables.token_narrative.length = 0;
        activeDb.tables.wss_events.length = 0;
        activeDb.tables.wss_price_ticks.length = 0;
        analyzeCalls.length = 0;
        invalidateCalls.length = 0;

        const K1 = '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF';
        activeDb.tables.token_narrative.push(narrativeNoInfoRow(K1));
        activeDb.tables.wss_events.push(evCreateRow(K1, 120000));
        for (let i = 0; i < 30; i++) activeDb.tables.wss_price_ticks.push(tickRow(9500 + i, K1, 10000));

        // 失效失败（invalidate 返回 false）→ 跳过本轮：不烧 analyze、attempts 不计
        invalidateImpl = async () => false;
        const svc = new PrecheckFailRetryService({});
        await svc._scanOnce();
        check('GMGN 失效失败 → 不触发 analyze（不烧配额）', analyzeCalls.length === 0);
        check('失效失败跳过计数', svc.stats.gmgnInvalidateFailSkips === 1);
        check('失效失败不计 attempts（下轮可再试）', svc._retryCounts.get(K1) === undefined);

        // 失效恢复 + stub 仍 no_public_info fail → 触发但未解决
        invalidateImpl = async (url, resourceType) => { invalidateCalls.push({ url, resourceType }); return true; };
        analyzeImpl = async () => ({
            llmAnalysis: {
                preCheck: { rating: 'low', pass: false, details: { ruleName: 'no_public_info' } },
                summary: { rating: 'low' },
            },
            meta: { promptType: 'minimal' },
        });
        await svc._scanOnce();
        check('失效恢复后触发（attempts 从 0 起）',
            analyzeCalls.length === 1 && svc._retryCounts.get(K1) === 1);
        check('仍 no_public_info 不计成功', svc.stats.retrySuccess === 0);

        // stub 拿到语料（preCheck null = 通过/走 Jev）→ 计成功
        analyzeImpl = async () => ({
            llmAnalysis: { preCheck: null, summary: { rating: 'mid' }, prestage: { category: 'project' } },
            meta: { promptType: 'standard' },
        });
        await svc._scanOnce();
        check('拿到语料后计成功（语料到位，评级归 Jev）',
            analyzeCalls.length === 2 && svc.stats.retrySuccess === 1);
    }

    // ═══ H. enabled=false ═══
    {
        const svc = new PrecheckFailRetryService({ enabled: false });
        svc.start();
        check('enabled=false 不挂 timer', svc._timer === null);
        svc.stop();
    }

    // ═══ I. start/stop 生命周期 ═══
    {
        const svc = new PrecheckFailRetryService({ scanIntervalMs: 60000 });
        svc.start();
        check('start 挂 timer', svc._timer !== null);
        svc.stop();
        check('stop 清 timer', svc._timer === null);
    }

    // 还原 analyze / invalidate（防影响同进程后续 import 方）
    analyzerMod.NarrativeAnalyzer.analyze = realAnalyze;
    ExternalResourceCache.invalidate = realInvalidate;

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
    console.error('测试执行异常:', err);
    process.exitCode = 1;
});
