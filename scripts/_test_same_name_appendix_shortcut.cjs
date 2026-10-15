#!/usr/bin/env node
/**
 * getAccountWithFullTweets 两层缓存——本地零 DB 零网络单测
 * （dbManager 单例打桩 external_resource_cache + global fetch 打桩，
 *   不连任何真实服务）
 *
 * 历史：本文件原 A 节（SameNameCheck appendix 短路）+ C2/C3 源码口径随
 * same-name-check-service.mjs AVE 死代码删除（2026-10-15 ③'：appendix 仅
 * AVE 发现链路≤2026-05 写入、wss 组装行恒无 → 短路后 AVE 一次不发，
 * copycat_token 拦截 2026-06 起=0）。文件名沿用防引用断裂。
 *
 * 覆盖：
 *  B. getAccountWithFullTweets 两层 ExternalResourceCache
 *   B1. 缓存全命中 → 组装结果正确 + fetch 零调用
 *   B2. 全 miss → 真拉两次 + set key 形状 twitter_user_info:<handle小写> /
 *       twitter_user_tweets:<userId>:c<count>
 *   B3. handle 大小写归一 → userInfo 层跨大小写命中（零新网络）
 *   B4. untilSec 窗口 → userInfo 命中 + tweets 独立 key w<sec>（只拉 UserTweets 一次）
 *   B5. 网络失败 → 返回 null + 缓存表零痕迹（无 success 行也无 failed 行——
 *       刻意不走 CachedFetcher 失败冷却，宣告竞态 300s 重试窗语义保持）
 *   B6. apidance 空 stub 用户（C53 形状）→ throw → null + 不落缓存
 *  C. 源码口径断言
 *   C1. cache-ttl-config 含 twitter_user_info / twitter_user_tweets 两档
 *
 * 用法：node scripts/_test_same_name_appendix_shortcut.cjs
 */

'use strict';

// ═══════════════ dbManager 单例打桩（必须在被测模块加载前完成）═══════════════
const { dbManager } = require('../src/services/dbManager');

/** external_resource_cache 内存表：eq/maybeSingle/upsert 足够覆盖
 *  ExternalResourceCache.get/set 的调用面（or() 简化为不过滤——测试不构造过期行） */
function cacheDb() {
    const rows = [];
    const client = {
        from(table) {
            if (table !== 'external_resource_cache') {
                throw new Error(`未预期的表: ${table}`);
            }
            const q = {
                _eqs: {},
                eq(col, v) { this._eqs[col] = v; return this; },
                select() { return this; },
                or() { return this; },
                async maybeSingle() {
                    const hit = rows.find(r => Object.entries(this._eqs).every(([k, v]) => r[k] === v));
                    return { data: hit ? { ...hit } : null, error: null };
                },
                async upsert(row, opts) {
                    if (!opts || opts.onConflict !== 'url,resource_type') {
                        throw new Error('upsert 缺 onConflict url,resource_type');
                    }
                    const i = rows.findIndex(r => r.url === row.url && r.resource_type === row.resource_type);
                    if (i >= 0) rows[i] = row; else rows.push(row);
                    return { error: null };
                },
            };
            return q;
        },
    };
    return { rows, client };
}

const theCache = cacheDb();
dbManager.isInitialized = true;
dbManager.client = theCache.client;

// ═══════════════ global fetch 打桩（防真网；未 handler 命中的调用直接 fail）═══════════════
let fetchCalls = [];
let fetchHandler = null;
globalThis.fetch = async (url) => {
    const u = String(url);
    fetchCalls.push(u);
    if (fetchHandler) {
        const shape = fetchHandler(u);
        if (shape === 'THROW') throw new Error('mock 网络故障');
        return { ok: true, status: 200, statusText: 'OK', json: async () => shape };
    }
    throw new Error(`未预期的网络调用: ${u}`);
};

// ═══════════════ 测试基建 ═══════════════
let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.error(`  ❌ ${name}${detail ? ` | ${detail}` : ''}`); }
}
const mockLogger = { debug() {}, info() {}, warn() {}, error() {} };

// apidance 响应形状（new-apis.js 解析口径）
const USER_BY_SCREEN_NAME_SHAPE = {
    data: { user: { result: {
        rest_id: '12345',
        core: { screen_name: 'TestUser', name: 'Test User', created_at: '2020-01-01T00:00:00.000Z' },
        legacy: { description: 'bio text', followers_count: 1000, statuses_count: 500 },
        verification: { verified: false },
        is_blue_verified: false,
    } } },
};
const USER_TWEETS_SHAPE = {
    tweets: [
        { tweet_id: '100', text: 'hello world', created_at: '2026-10-01', createdTimeStamp: 1800000000000 },
        { tweet_id: '101', text: 'ca 0xabc', created_at: '2026-10-01', createdTimeStamp: 1800000001000 },
    ],
    next_cursor_str: null,
    pinned_tweet: null,
};

async function main() {
    // ═══ B. getAccountWithFullTweets 两层缓存 ═══
    console.log('B. getAccountWithFullTweets 两层缓存');
    const { getAccountWithFullTweets } = await import(
        '../src/narrative/analyzer/prompts/account/account-community-rules.mjs'
    );

    const isUserReq = (u) => u.includes('/graphql/UserByScreenName');
    const isTweetsReq = (u) => u.includes('/sapi/UserTweets');
    const defaultHandler = (u) => {
        if (isUserReq(u)) return USER_BY_SCREEN_NAME_SHAPE;
        if (isTweetsReq(u)) return USER_TWEETS_SHAPE;
        return 'THROW';
    };

    // B1: 预置两层缓存（userId 级全量 key，oldestSec 覆盖足够）→ 全命中零网络
    {
        theCache.rows.length = 0;
        const until = 1234567890;
        theCache.rows.push(
            { url: 'twitter_user_info:testuser', resource_type: 'twitter_user_info', status: 'success',
              content: { id: '12345', screen_name: 'TestUser', name: 'Test User', description: 'cached bio',
                         followers_count: 2000, statuses_count: 300, created_at: '2019-06-01T00:00:00.000Z' },
              cached_at: new Date().toISOString(), expires_at: null },
            { url: 'twitter_user_tweets:12345', resource_type: 'twitter_user_tweets', status: 'success',
              content: { tweets: [
                  { tweet_id: '200', text: 'cached tweet', created_at: '2026-09-30', createdTimeStamp: (until + 3600) * 1000 },
                  { tweet_id: '199', text: 'cached old tweet', created_at: '2026-09-01', createdTimeStamp: (until - 86400) * 1000 },
              ], oldestSec: until - 86400 },
              cached_at: new Date().toISOString(), expires_at: null },
        );
        fetchCalls = [];
        const res = await getAccountWithFullTweets('TestUser', 50, { untilSec: until });
        check('B1 组装结果正确（覆盖足够截断：第0条恒留+窗口内1条，窗口外1条被截）',
            res && res.type === 'account' && res.screen_name === 'TestUser'
            && res.description === 'cached bio' && res.followers_count === 2000
            && Array.isArray(res.tweets) && res.tweets.length === 1 && res.tweets[0].text === 'cached tweet',
            JSON.stringify(res));
        check('B1 缓存全命中 fetch 零调用', fetchCalls.length === 0, JSON.stringify(fetchCalls));
    }

    // B2: 全 miss → 真拉 + set key 形状（userId 级全量 key + {tweets, oldestSec} 包装）
    {
        theCache.rows.length = 0;
        fetchCalls = [];
        fetchHandler = defaultHandler;
        const res = await getAccountWithFullTweets('FreshUser', 50, {});
        fetchHandler = null;
        const userReqs = fetchCalls.filter(isUserReq).length;
        const tweetsReqs = fetchCalls.filter(isTweetsReq).length;
        check('B2 真拉 UserByScreenName×1 + UserTweets×1（单页停）', userReqs === 1 && tweetsReqs === 1,
            `user=${userReqs} tweets=${tweetsReqs}`);
        check('B2 返回组装结果', res && res.screen_name === 'TestUser' && res.tweets.length === 2);
        const keys = theCache.rows.map(r => `${r.resource_type}:${r.url}`);
        check('B2 set userInfo key=twitter_user_info:freshuser（handle 小写归一）',
            theCache.rows.some(r => r.resource_type === 'twitter_user_info' && r.url === 'twitter_user_info:freshuser'),
            keys.join(' | '));
        const fullRow = theCache.rows.find(r => r.resource_type === 'twitter_user_tweets' && r.url === 'twitter_user_tweets:12345');
        check('B2 set tweets userId 级全量 key=twitter_user_tweets:12345', !!fullRow, keys.join(' | '));
        check('B2 全量条目 {tweets,oldestSec} 形状（oldestSec=跳过第0条后最老=1800000001）',
            fullRow && Array.isArray(fullRow.content.tweets) && fullRow.content.tweets.length === 2
            && fullRow.content.oldestSec === 1800000001,
            JSON.stringify(fullRow && fullRow.content.oldestSec));
    }

    // B3: handle 大小写归一 → userInfo 层跨大小写命中 + 全量 key 覆盖足够截断 → 零新网络
    {
        fetchCalls = [];
        const res = await getAccountWithFullTweets('FRESHUSER', 50, { untilSec: 1800000001 });   // 大写；oldestSec(1800000001)<=untilSec 覆盖足够
        check('B3 大小写归一全命中（fetch 零调用）', fetchCalls.length === 0, JSON.stringify(fetchCalls));
        check('B3 结果来自缓存（screen_name 原样大小写）', res && res.screen_name === 'TestUser');
    }

    // B4: untilSec 窗口比缓存深（覆盖不足）→ userInfo 命中 + tweets 真拉一次 + 全量 key 更新 + 二次调用零网络
    {
        fetchCalls = [];
        fetchHandler = defaultHandler;
        const res = await getAccountWithFullTweets('FreshUser', 20, { untilSec: 1799913600 });   // 比假响应最老推文(1800000001)深 86400s
        fetchHandler = null;
        const tweetsReqs = fetchCalls.filter(isTweetsReq).length;
        const userReqs = fetchCalls.filter(isUserReq).length;
        check('B4 userInfo 层命中（UserByScreenName 零调用）', userReqs === 0, JSON.stringify(fetchCalls));
        check('B4 覆盖不足 tweets 真拉一次', tweetsReqs === 1);
        check('B4 返回结果（假响应 2 条均在深窗口内）', res && res.tweets.length === 2);
        check('B4 全量 key 覆盖深度更新（oldestSec 1799913600→1800000001 重写不变/凑满后一致）',
            theCache.rows.some(r => r.resource_type === 'twitter_user_tweets' && r.url === 'twitter_user_tweets:12345'),
            theCache.rows.map(r => r.url).join(' | '));
        // 同窗口二次调用 → 全量 key 覆盖足够 → 截断复用零网络
        fetchCalls = [];
        const res2 = await getAccountWithFullTweets('FreshUser', 20, { untilSec: 1800000001 });
        check('B4 同窗口二次调用 fetch 零调用', fetchCalls.length === 0 && res2 && res2.tweets.length === 2);
    }

    // B5: 网络失败 → null + 缓存表零痕迹（无 failed 行——重试语义保持）
    {
        const before = theCache.rows.length;
        fetchCalls = [];
        fetchHandler = () => 'THROW';
        const res = await getAccountWithFullTweets('GhostUser', 50, {});
        fetchHandler = null;
        check('B5 网络失败返回 null', res === null);
        check('B5 缓存表零新增（无 success 无 failed 行）', theCache.rows.length === before);
        check('B5 无 status=failed 行（不走 CachedFetcher 失败冷却）',
            !theCache.rows.some(r => r.status === 'failed'));
    }

    // B6: apidance 空 stub 用户（C53 形状：user.result 存在但 core 空）→ throw → null 不落缓存
    {
        const before = theCache.rows.length;
        fetchHandler = (u) => {
            if (isUserReq(u)) {
                return { data: { user: { result: { rest_id: '999', core: {}, legacy: {} } } } };
            }
            return USER_TWEETS_SHAPE;
        };
        const res = await getAccountWithFullTweets('StubUser', 50, {});
        fetchHandler = null;
        check('B6 空 stub 返回 null', res === null);
        check('B6 空 stub 不落缓存', theCache.rows.length === before);
    }

    // ═══ C. 源码口径断言 ═══
    console.log('C. 源码口径');
    const fs = require('fs');
    const path = require('path');

    // C1: TTL 两档
    {
        const ttl = await import('../src/narrative/db/cache-ttl-config.mjs');
        const ui = ttl.getCacheTTL('twitter_user_info');
        const tw = ttl.getCacheTTL('twitter_user_tweets');
        check('C1 twitter_user_info 档 30d/365d', ui.maxAge === 30 * 86400 && ui.ttl === 365 * 86400,
            JSON.stringify(ui));
        check('C1 twitter_user_tweets 档 6h/90d', tw.maxAge === 6 * 3600 && tw.ttl === 90 * 86400,
            JSON.stringify(tw));
    }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
