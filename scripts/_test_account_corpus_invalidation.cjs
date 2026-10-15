#!/usr/bin/env node
/**
 * 账号语料缓存失效（C70 bunker 案 0x2ec1e08c…7777，2026-10-15）——本地零 DB 单测
 * （dbManager 单例打桩 external_resource_cache 内存表 + global fetch 打桩）
 *
 * 根因：穿透/重析的 ignoreCache 只跳过 token_narrative 行缓存，数据抓取层全吃
 * external_resource_cache——twitter_user_info maxAge 30 天，bunker 三次 worker
 * 重试全命中发币后 5s 的 2 粉快照；且项目方 CA 后补进 bio 时 30 天缓存导致永远
 * 匹配不到。「重取数重析」= 行缓存穿透 + 数据层失效（invalidateAccountCorpus
 * → getAccountWithFullTweets invalidateCache → 失效三键 → 真拉回写）。
 *
 * 覆盖：
 *  A. invalidateAccountCorpusCache 纯键断言：handle 归一 / 三键形状 / :ca: 地址
 *     小写 / userId=null 只失效 userKey
 *  B. getAccountWithFullTweets invalidateCache 时序（bunker 事故现场反证）：
 *     预置 2 粉旧行 → 失效三键 → 真拉 94 粉新数据 → 回写（不带失效=命中旧行
 *     零网络吃旧快照，即事故）；操作序 getRow→del×3→fetch
 *  C. 未传 invalidateCache=零失效调用（存量零变化机器证明：无 invalidateCache
 *     的全部调用路径 delete 恒零）
 *  D. 源码口径：NarrativeAnalyzer 语料形状门（every account）+ 两处透传 /
 *     account-analysis-service 透传 / worker address 分支带失效（no_public_info
 *     分支刻意不带）
 *
 * 用法：node scripts/_test_account_corpus_invalidation.cjs
 */

'use strict';

// ═══ dbManager 单例打桩（必须在被测模块加载前完成）═══
const { dbManager } = require('../src/services/dbManager');

/** external_resource_cache 内存表：ops 记录全部 DB+网络操作序（时序断言用） */
function cacheDb() {
    const rows = [];
    const ops = [];
    const match = (r, eqs) => Object.entries(eqs).every(([k, v]) => r[k] === v);
    const client = {
        from(table) {
            if (table !== 'external_resource_cache') {
                throw new Error(`未预期的表: ${table}`);
            }
            const q = {
                _eqs: {},
                eq(col, v) { this._eqs[col] = v; return this; },
                select() { return this; },
                // get 的 or(expires_at.is.null,...) 条件：内存表行恒 success+expires_at
                // null，语义等价于恒真——返回 this 不过滤
                or() { return this; },
                async maybeSingle() {
                    ops.push(`get:${this._eqs.url}`);
                    const hit = rows.find(r => match(r, this._eqs));
                    return { data: hit ? { ...hit } : null, error: null };
                },
                async upsert(row, opts) {
                    if (!opts || opts.onConflict !== 'url,resource_type') {
                        throw new Error('upsert 缺 onConflict url,resource_type');
                    }
                    ops.push(`set:${row.url}`);
                    const ser = { ...row, content: JSON.parse(JSON.stringify(row.content)) };
                    const i = rows.findIndex(r => r.url === row.url && r.resource_type === row.resource_type);
                    if (i >= 0) rows[i] = ser; else rows.push(ser);
                    return { error: null };
                },
            };
            q.delete = () => {
                const d = {
                    _eqs: {},
                    eq(col, v) { this._eqs[col] = v; return this; },
                    then(resolve) {
                        ops.push(`del:${this._eqs.url}`);
                        for (let i = rows.length - 1; i >= 0; i--) {
                            if (match(rows[i], this._eqs)) rows.splice(i, 1);
                        }
                        resolve({ error: null });
                    },
                };
                return d;
            };
            return q;
        },
    };
    return { rows, ops, client };
}

const theCache = cacheDb();
dbManager.isInitialized = true;
dbManager.client = theCache.client;

// ═══ global fetch 打桩（防真网；操作序并入 ops）═══
let fetchHandler = null;
globalThis.fetch = async (url) => {
    const u = String(url);
    theCache.ops.push(`net:${u.includes('/graphql/UserByScreenName') ? 'userInfo' : 'userTweets'}`);
    if (fetchHandler) {
        const shape = fetchHandler(u);
        if (shape === 'THROW') throw new Error('mock 网络故障');
        return { ok: true, status: 200, statusText: 'OK', json: async () => shape };
    }
    throw new Error(`未预期的网络调用: ${u}`);
};

// ═══ 测试基建 ═══
let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.error(`  ❌ ${name}${detail ? ` | ${detail}` : ''}`); }
}

const ADDR_A = '0xAAAABBBBCCCCDDDD111122223333444455556666';
const ADDR_A_LOWER = ADDR_A.toLowerCase();
const BASE = 1800000000;
const tw = (id, text, secOffset) => ({
    tweet_id: String(id), text, created_at: '2026-10-15',
    createdTimeStamp: (BASE + secOffset) * 1000,
});
/** 实时新数据（发币后 10h：94 粉 17 推——bunker 实况） */
const USER_FRESH = {
    data: { user: { result: {
        rest_id: '777',
        core: { screen_name: 'bunkeronbnb', name: 'bunker', created_at: '2026-10-15T04:26:00.000Z' },
        legacy: { description: `bio ${ADDR_A}`, followers_count: 94, statuses_count: 17 },
        verification: { verified: false },
        is_blue_verified: false,
    } } },
};

const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

(async () => {
    const rules = await import('../src/narrative/analyzer/prompts/account/account-community-rules.mjs');
    const { invalidateAccountCorpusCache, getAccountWithFullTweets } = rules;

    console.log('A. invalidateAccountCorpusCache 纯键断言');
    {
        theCache.rows.length = 0; theCache.ops.length = 0;
        theCache.rows.push(
            { url: 'twitter_user_info:bunkeronbnb', resource_type: 'twitter_user_info', status: 'success',
              content: { id: '777', screen_name: 'bunkeronbnb', followers_count: 2, statuses_count: 4 },
              cached_at: new Date().toISOString(), expires_at: null },
            { url: 'twitter_user_tweets:777', resource_type: 'twitter_user_tweets', status: 'success',
              content: { tweets: [tw(1, '旧推', 100)], oldestSec: BASE - 50 },
              cached_at: new Date().toISOString(), expires_at: null },
            { url: `twitter_user_tweets:777:ca:${ADDR_A_LOWER}`, resource_type: 'twitter_user_tweets', status: 'success',
              content: [tw(2, '旧 CA 推', 90)],
              cached_at: new Date().toISOString(), expires_at: null },
        );
        // handle 大写归一 + 地址大写归一 :ca: 小写
        const r = await invalidateAccountCorpusCache('BunkerOnBNB', { userId: '777', tokenAddress: ADDR_A });
        check('A1 三键全失效', Object.values(r).every(v => v === true), JSON.stringify(r));
        check('A2 键集正确（handle 小写 / :ca: 地址小写）',
            theCache.ops.includes('del:twitter_user_info:bunkeronbnb')
            && theCache.ops.includes('del:twitter_user_tweets:777')
            && theCache.ops.includes(`del:twitter_user_tweets:777:ca:${ADDR_A_LOWER}`),
            JSON.stringify(theCache.ops));
        check('A3 三行全部删除', theCache.rows.length === 0);
        check('A4 恰 3 次 delete', theCache.ops.filter(o => o.startsWith('del:')).length === 3);
    }
    {
        // userId=null：推文层 key 不可构造 → 只失效 userKey
        theCache.rows.length = 0; theCache.ops.length = 0;
        theCache.rows.push(
            { url: 'twitter_user_info:x', resource_type: 'twitter_user_info', status: 'success',
              content: {}, cached_at: new Date().toISOString(), expires_at: null },
            { url: 'twitter_user_tweets:999', resource_type: 'twitter_user_tweets', status: 'success',
              content: [], cached_at: new Date().toISOString(), expires_at: null },
        );
        const r = await invalidateAccountCorpusCache('x');
        check('A5 userId 缺失只失效 userKey（推文行保留）',
            r.userKey === true && r.tweetsKey === undefined
            && theCache.rows.some(row => row.url === 'twitter_user_tweets:999'));
    }

    console.log('B. getAccountWithFullTweets invalidateCache 时序（bunker 事故现场反证）');
    {
        // 预置 bunker 首析快照：2 粉 userInfo（30 天 TTL 内）+ 浅覆盖全量推文行
        theCache.rows.length = 0; theCache.ops.length = 0;
        theCache.rows.push(
            { url: 'twitter_user_info:bunkeronbnb', resource_type: 'twitter_user_info', status: 'success',
              content: { id: '777', screen_name: 'bunkeronbnb', name: 'bunker', description: '',
                followers_count: 2, statuses_count: 4, verified: false, is_blue_verified: false },
              cached_at: new Date().toISOString(), expires_at: null },
            { url: 'twitter_user_tweets:777', resource_type: 'twitter_user_tweets', status: 'success',
              content: { tweets: [tw(9, '旧推浅覆盖', 100)], oldestSec: BASE + 50 },
              cached_at: new Date().toISOString(), expires_at: null },
        );
        fetchHandler = (u) => {
            if (u.includes('/graphql/UserByScreenName')) return USER_FRESH;
            if (u.includes('/sapi/UserTweets')) {
                return { tweets: [tw(1, `宣告 ${ADDR_A}`, 90)], next_cursor_str: null, pinned_tweet: null };
            }
            return 'THROW';
        };
        const res = await getAccountWithFullTweets('bunkeronbnb', 20, {
            untilSec: BASE, tokenAddress: ADDR_A, invalidateCache: true,
        });
        fetchHandler = null;
        check('B1 真拉发生（不带失效=命中 2 粉旧行零网络，即 bunker 事故）',
            theCache.ops.some(o => o === 'net:userInfo') && theCache.ops.some(o => o === 'net:userTweets'));
        check('B2 返回新快照 94 粉（重取语义闭环）', res && res.followers_count === 94,
            JSON.stringify(res && res.followers_count));
        check('B3 新宣告推在返回列表（CA 后补载体）',
            res && res.tweets.some(t => t.text.includes(ADDR_A.slice(0, 10))));
        const dels = theCache.ops.map((o, i) => [o, i]).filter(([o]) => o.startsWith('del:'));
        check('B4 三键失效（userKey + 全量 + :ca:）', dels.length === 3, JSON.stringify(theCache.ops));
        const firstNet = theCache.ops.findIndex(o => o.startsWith('net:'));
        check('B5 失效先于真拉（del×3 全部早于首个网络调用）',
            firstNet > -1 && dels.every(([, i]) => i < firstNet),
            `dels=${JSON.stringify(dels)} firstNet=${firstNet}`);
        const getRowIdx = theCache.ops.indexOf('get:twitter_user_info:bunkeronbnb');
        check('B6 getRow 旧 userId 先于失效（读旧行取 777 构造推文层键）',
            getRowIdx > -1 && dels.every(([, i]) => i > getRowIdx));
        const newRow = theCache.rows.find(r => r.url === 'twitter_user_info:bunkeronbnb');
        check('B7 新 userInfo 回写（94 粉行入库）',
            newRow && newRow.content.followers_count === 94);
    }

    console.log('C. 未传 invalidateCache=零失效调用（存量零变化机器证明）');
    {
        // 同 bunker 预置形状，但不带 invalidateCache → 旧行命中零网络零删除
        theCache.rows.length = 0; theCache.ops.length = 0;
        theCache.rows.push(
            { url: 'twitter_user_info:bunkeronbnb', resource_type: 'twitter_user_info', status: 'success',
              content: { id: '777', screen_name: 'bunkeronbnb', name: 'bunker', description: '',
                followers_count: 2, statuses_count: 4, verified: false, is_blue_verified: false },
              cached_at: new Date().toISOString(), expires_at: null },
            { url: `twitter_user_tweets:777:ca:${ADDR_A_LOWER}`, resource_type: 'twitter_user_tweets', status: 'success',
              content: [tw(2, `宣告 ${ADDR_A}`, 90)],
              cached_at: new Date().toISOString(), expires_at: null },
        );
        const res = await getAccountWithFullTweets('bunkeronbnb', 20, {
            untilSec: BASE, tokenAddress: ADDR_A,
        });
        check('C1 零 delete（全部调用路径不失效）',
            theCache.ops.filter(o => o.startsWith('del:')).length === 0, JSON.stringify(theCache.ops));
        check('C2 CA key 命中零网络（原缓存行为）',
            !theCache.ops.some(o => o.startsWith('net:')) && res && res.tweets.length === 1);
        check('C3 返回旧快照 2 粉（P1.10 前事故形状：30 天缓存吃首析行）',
            res && res.followers_count === 2);
    }

    console.log('D. 源码口径（形状门 + 三处透传）');
    {
        const analyzer = read('src/narrative/analyzer/NarrativeAnalyzer.mjs');
        check('D1 NarrativeAnalyzer 语料形状门（every type===account 才失效）',
            analyzer.includes('const shouldInvalidateAccountCorpus = invalidateAccountCorpus')
            && analyzer.includes('&& classifiedUrls.twitter.every(tw => tw.type === \'account\')')
            && analyzer.includes('if (shouldInvalidateAccountCorpus) tweetsWindowOptions.invalidateCache = true;'));
        check('D2 NarrativeAnalyzer 账号链调用点条件透传',
            analyzer.includes('...(shouldInvalidateAccountCorpus ? { invalidateAccountCorpus: true } : {})'));
        const service = read('src/narrative/analyzer/services/account-analysis-service.mjs');
        check('D3 account-analysis-service tweetsOptions 透传',
            service.includes('if (options.invalidateAccountCorpus) tweetsOptions.invalidateCache = true;'));
        const worker = read('src/narrative/engine/PrecheckFailRetryService.mjs');
        check('D4 worker address 分支带失效 / no_public_info 分支刻意不带',
            worker.includes('const analyzeOpts = failShape === \'no_public_info\'\n'
                + '        ? { ignoreCache: true, enrichSocialByGmgn: true }\n'
                + '        : { ignoreCache: true, invalidateAccountCorpus: true };'));
        const caller = read('src/trading-engine/pre-check/NarrativeDirectCaller.js');
        check('D5 引擎穿透执行点双键（ignoreCache + invalidateAccountCorpus）',
            caller.includes('{ ignoreCache: true, invalidateAccountCorpus: true }'));
    }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
