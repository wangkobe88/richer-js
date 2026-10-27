#!/usr/bin/env node

/**
 * gang 叙话语料补采单测（零 DB 零网络，2026-10-27 gang 接入）
 *
 * 覆盖：
 *   A. 三分派路由：enrich(…, 'gang') → _enrichGang；flap/fourmeme 路由不串
 *   B. API 成功映射：twitter→twitterUrl / website→webUrl / name；corpus 留痕
 *      provider=gang_api + creatorHandle（.ai handle 非 URL，绝不冒充 twitterUrl）
 *   C. 404/未就绪 → 延迟重试 1 次（gangRetryDelayMs）→ 仍空 null（走 C77 兜底）
 *   D. 404 重试后命中（indexer 延迟落库形状）
 *   E. 网络异常 → null（enrich 永不抛错）+ warn 日志
 *   F. 全空语料字段（website/twitter null 常态）→ corpus 留痕对象返回（有 corpus
 *      无语料字段=调用方零变化合并）
 *
 * 用法：node scripts/_test_gang_corpus_enrich.cjs
 */
'use strict';

const assert = require('assert');
const { TokenCorpusEnricher } = require('../src/trading-engine/core/TokenCorpusEnricher');

const T = '0x' + '11'.repeat(20);

function makeEnricher(overrides = {}) {
    const logs = [];
    const logger = { info: (id, tag, m) => logs.push(['info', m]), warn: (id, tag, m) => logs.push(['warn', m]), error: () => {}, debug: () => {} };
    const e = new TokenCorpusEnricher({ gangRetryDelayMs: 1, ...overrides }, logger, null);
    e._ipfsClient = { get: async () => { throw new Error('不应触网'); } }; // flap 臂防触网锁
    e._fourMemeApi = { getTokenInfo: async () => { throw new Error('不应触 four.meme API'); } };
    return { e, logs };
}

async function main() {
    // ═══ A. 三分派路由 ═══
    {
        const { e } = makeEnricher();
        let routed = null;
        e._gangApi = { getTokenDetail: async () => { routed = 'gang'; return { address: T, name: 'X', creatorHandle: 'a.ai', website: null, twitter: null }; } };
        const r = await e.enrich(T, 'gang');
        assert.strictEqual(routed, 'gang');
        assert.ok(r.corpus.provider === 'gang_api');
        // flap 路由不串：meta null → _extractCid(null)=null 且非 http → warn null
        const rf = await e.enrich(T, 'flap', null);
        assert.strictEqual(rf, null);
        // four.meme 路由不串（打桩 throw → enrich catch → null）
        const rfm = await e.enrich(T, 'fourmeme');
        assert.strictEqual(rfm, null);
        console.log('✓ A. 三分派路由');
    }

    // ═══ B. 成功映射 ═══
    {
        const { e } = makeEnricher();
        e._gangApi = {
            getTokenDetail: async () => ({
                address: T, name: 'Gang Coin', symbol: 'GANG', creator: '0xc',
                creatorHandle: 'jiebao.ai', website: 'https://gang.fun', twitter: 'https://x.com/gang',
                graduated: false, progressPct: 3.2, raw: {},
            }),
        };
        const r = await e.enrich(T, 'gang');
        assert.strictEqual(r.twitterUrl, 'https://x.com/gang');
        assert.strictEqual(r.webUrl, 'https://gang.fun');
        assert.strictEqual(r.name, 'Gang Coin');
        assert.strictEqual(r.corpus.provider, 'gang_api');
        assert.strictEqual(r.corpus.creatorHandle, 'jiebao.ai');
        assert.ok(r.corpus.fetchedAt);
        // .ai handle 绝不冒充 twitterUrl
        assert.ok(!String(r.twitterUrl).includes('.ai'));
        assert.strictEqual(r.description, undefined, 'gang API 无简介字段');
        console.log('✓ B. 成功映射 + corpus 留痕');
    }

    // ═══ C. 404 重试后仍空 → null ═══
    {
        const { e, logs } = makeEnricher();
        let calls = 0;
        e._gangApi = { getTokenDetail: async () => { calls++; const err = new Error('404'); err.response = { status: 404 }; throw err; } };
        const r = await e.enrich(T, 'gang');
        assert.strictEqual(calls, 2, '恰重试 1 次');
        assert.strictEqual(r, null, '仍空 → null（C77 兜底接管）');
        assert.ok(logs.some(([, m]) => /重试后仍空/.test(m)));
        console.log('✓ C. 404 → 重试 1 次 → null');
    }

    // ═══ D. 重试后命中（indexer 延迟落库）═══
    {
        const { e } = makeEnricher();
        let calls = 0;
        e._gangApi = {
            getTokenDetail: async () => {
                calls++;
                if (calls === 1) { const err = new Error('404'); err.response = { status: 404 }; throw err; }
                return { address: T, name: 'LATE', creatorHandle: 'b.ai', website: null, twitter: null };
            },
        };
        const r = await e.enrich(T, 'gang');
        assert.strictEqual(calls, 2);
        assert.strictEqual(r.name, 'LATE', '重试命中');
        console.log('✓ D. 404 → 重试命中');
    }

    // ═══ E. 网络异常 → null 永不抛错 ═══
    {
        const { e, logs } = makeEnricher();
        e._gangApi = { getTokenDetail: async () => { throw new Error('ECONNRESET'); } };
        const r = await e.enrich(T, 'gang');
        assert.strictEqual(r, null);
        assert.ok(logs.some(([, m]) => /语料补采失败/.test(m)));
        console.log('✓ E. 网络异常 → null 不抛');
    }

    // ═══ F. 全空语料（常态）→ corpus 留痕返回 ═══
    {
        const { e } = makeEnricher();
        e._gangApi = { getTokenDetail: async () => ({ address: T, name: 'NULLS', creatorHandle: 'x.ai', website: null, twitter: null }) };
        const r = await e.enrich(T, 'gang');
        assert.strictEqual(r.twitterUrl, undefined);
        assert.strictEqual(r.webUrl, undefined);
        assert.ok(r.corpus && r.corpus.provider === 'gang_api', '有 corpus 无语料字段（合并零变化）');
        console.log('✓ F. 全空语料 corpus 留痕');
    }

    console.log('\n✅ _test_gang_corpus_enrich 全部通过');
}

main().catch((err) => { console.error('❌', err); process.exit(1); });
