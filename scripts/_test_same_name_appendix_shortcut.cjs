#!/usr/bin/env node
/**
 * SameNameCheck appendix 短路 + 账号收集两层缓存——本地零 DB 零网络单测
 * （dbManager 单例打桩 external_resource_cache + global fetch 打桩 +
 *   AveTokenAPI 实例打桩，不连任何真实服务）
 *
 * 覆盖：
 *  A. SameNameCheck appendix 短路（2026-10-02 d46b1b6c 叙事耗时案）
 *   A1. watcher wss 行（raw_api_data={source:'wss'} 无 appendix）→ 短路返回
 *       isCopycat=false + skipped 标记 + AVE searchTokens 零调用（BSC/Solana 全免）
 *   A2. raw_api_data=null → 短路
 *   A3. appendix 坏 JSON 字符串 → 解析失败 = null → 短路
 *   A4. appendix 对象形式（非字符串）→ 不短路，走完整搜索链
 *   A5. 有 appendix + 同叙事「起来过」代币 → isCopycat=true（AVE 时代老票语义保留）
 *   A6. 有 appendix + 无同叙事代币 → isCopycat=false + details 无 skipped 键（原路径）
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
 *   C2. pre-check-service 0.5 调用透传 tokenData（appendix 来源链闭合）
 *   C3. same-name 短路块位于 BSC/Solana 搜索之前（源码序）
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
    // ═══ A. SameNameCheck appendix 短路 ═══
    console.log('A. SameNameCheck appendix 短路');
    const { SameNameCheckService } = await import('../src/narrative/analyzer/services/same-name-check-service.mjs');

    const newSvc = () => {
        const svc = new SameNameCheckService(mockLogger);
        const calls = [];
        svc.api = {
            async searchTokens(kw, chain, limit, sort) {
                calls.push({ kw, chain, limit, sort });
                if (chain === 'bsc') return svc._mockBsc || [];
                return svc._mockSol || [];
            },
        };
        svc._calls = calls;
        return svc;
    };

    const NOW = Math.floor(Date.now() / 1000);

    // A1: watcher wss 行无 appendix → 短路 + AVE 零调用
    {
        const svc = newSvc();
        const res = await svc.checkIfCopycatToken('TEST', 'Test Token', NOW, {
            raw_api_data: { source: 'wss', totalSupply: 1e9 },  // watcher 时代 wss 组装行形状
        });
        check('A1 wss 行短路 isCopycat=false', res.success === true && res.isCopycat === false, JSON.stringify(res));
        check('A1 details.skipped=no_target_appendix', res.details && res.details.skipped === 'no_target_appendix');
        check('A1 AVE searchTokens 零调用（BSC+Solana 全免）', svc._calls.length === 0, JSON.stringify(svc._calls));
    }

    // A2: raw_api_data=null → 短路
    {
        const svc = newSvc();
        const res = await svc.checkIfCopycatToken('TEST', 'Test Token', NOW, null);
        check('A2 targetTokenData=null 短路', res.isCopycat === false && res.details.skipped === 'no_target_appendix' && svc._calls.length === 0);
    }

    // A3: appendix 坏 JSON 字符串 → 解析失败=null → 短路
    {
        const svc = newSvc();
        const res = await svc.checkIfCopycatToken('TEST', 'Test Token', NOW, {
            raw_api_data: { appendix: '{broken json' },
        });
        check('A3 坏 JSON 短路', res.isCopycat === false && res.details.skipped === 'no_target_appendix' && svc._calls.length === 0);
    }

    // A4: appendix 对象形式 → 不短路，走完整链
    {
        const svc = newSvc();
        const res = await svc.checkIfCopycatToken('TEST', 'Test Token', NOW, {
            raw_api_data: { appendix: { twitter: 'https://x.com/samehandle' } },
        });
        check('A4 对象 appendix 不短路（AVE 被调）', svc._calls.length > 0, JSON.stringify(svc._calls));
        check('A4 isCopycat=false（空搜索结果）', res.isCopycat === false);
        check('A4 details 无 skipped 键（原路径）', !('skipped' in res.details));
        // 搜索面形状：BSC 1 次 + Solana 按 name/symbol 分词（test/token 两词 2 次）
        const bsc = svc._calls.filter(c => c.chain === 'bsc');
        const sol = svc._calls.filter(c => c.chain === 'solana');
        check('A4 搜索面 BSC=1 / Solana=2（test+token 分词）', bsc.length === 1 && sol.length === 2,
            `bsc=${bsc.length} sol=${sol.length}`);
        check('A4 Solana limit=300 逐词拉满', sol.every(c => c.limit === 300));
    }

    // A5: 有 appendix + 同叙事「起来过」代币 → isCopycat=true（老票语义保留）
    {
        const svc = newSvc();
        svc._mockBsc = [{
            token: '0xolder123', name: 'Test Token', symbol: 'TEST',
            issue_platform: 'four.meme',
            created_at: NOW - 3600,                       // 1h 前 > 2min gap
            appendix: JSON.stringify({ twitter: 'https://x.com/samehandle' }),
            price_change_24h: 500,                        // > priceChangeThreshold(300) = 「起来过」
        }];
        const res = await svc.checkIfCopycatToken('TEST', 'Test Token', NOW, {
            raw_api_data: { appendix: JSON.stringify({ twitter: 'https://x.com/samehandle' }) },
        });
        check('A5 同叙事+起来过 → isCopycat=true', res.isCopycat === true, JSON.stringify(res.details));
        check('A5 计数字段 duplicateNarrativeCount=1', res.details.duplicateNarrativeCount === 1);
        check('A5 withinOneDayTokens 含地址', res.details.withinOneDayTokens[0]?.address === '0xolder123');
    }

    // A6: 有 appendix + 无同叙事（appendix 不同）→ isCopycat=false
    {
        const svc = newSvc();
        svc._mockBsc = [{
            token: '0xother456', name: 'Test Token', symbol: 'TEST',
            issue_platform: 'four.meme',
            created_at: NOW - 3600,
            appendix: JSON.stringify({ twitter: 'https://x.com/different' }),  // 不同叙事
            price_change_24h: 500,
        }];
        const res = await svc.checkIfCopycatToken('TEST', 'Test Token', NOW, {
            raw_api_data: { appendix: JSON.stringify({ twitter: 'https://x.com/samehandle' }) },
        });
        check('A6 不同叙事 → isCopycat=false', res.isCopycat === false);
        check('A6 duplicateNarrativeCount=0（叙事门不重复计数）', res.details.duplicateNarrativeCount === 0);
    }

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

    // B1: 预置两层缓存 → 全命中零网络
    {
        theCache.rows.length = 0;
        theCache.rows.push(
            { url: 'twitter_user_info:testuser', resource_type: 'twitter_user_info', status: 'success',
              content: { id: '12345', screen_name: 'TestUser', name: 'Test User', description: 'cached bio',
                         followers_count: 2000, statuses_count: 300, created_at: '2019-06-01T00:00:00.000Z' },
              cached_at: new Date().toISOString(), expires_at: null },
            { url: 'twitter_user_tweets:12345:c100', resource_type: 'twitter_user_tweets', status: 'success',
              content: [{ tweet_id: '200', text: 'cached tweet', created_at: '2026-09-30' }],
              cached_at: new Date().toISOString(), expires_at: null },
        );
        fetchCalls = [];
        const res = await getAccountWithFullTweets('TestUser', 50, {});
        check('B1 组装结果正确', res && res.type === 'account' && res.screen_name === 'TestUser'
            && res.description === 'cached bio' && res.followers_count === 2000
            && Array.isArray(res.tweets) && res.tweets.length === 1 && res.tweets[0].text === 'cached tweet',
            JSON.stringify(res));
        check('B1 缓存全命中 fetch 零调用', fetchCalls.length === 0, JSON.stringify(fetchCalls));
    }

    // B2: 全 miss → 真拉 + set key 形状
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
        check('B2 set tweets key=twitter_user_tweets:12345:c100（凑数口径 c<max(50,100)>）',
            theCache.rows.some(r => r.resource_type === 'twitter_user_tweets' && r.url === 'twitter_user_tweets:12345:c100'),
            keys.join(' | '));
    }

    // B3: handle 大小写归一 → userInfo 层跨大小写命中 + tweets 层同 key 命中 → 零新网络
    {
        fetchCalls = [];
        const res = await getAccountWithFullTweets('FRESHUSER', 50, {});   // 大写
        check('B3 大小写归一全命中（fetch 零调用）', fetchCalls.length === 0, JSON.stringify(fetchCalls));
        check('B3 结果来自缓存（screen_name 原样大小写）', res && res.screen_name === 'TestUser');
    }

    // B4: untilSec 窗口 → userInfo 命中 + tweets 独立 key w<sec>
    {
        fetchCalls = [];
        fetchHandler = defaultHandler;
        const res = await getAccountWithFullTweets('FreshUser', 20, { untilSec: 1234567890 });
        fetchHandler = null;
        const tweetsReqs = fetchCalls.filter(isTweetsReq).length;
        const userReqs = fetchCalls.filter(isUserReq).length;
        check('B4 userInfo 层命中（UserByScreenName 零调用）', userReqs === 0, JSON.stringify(fetchCalls));
        check('B4 tweets 窗口 miss 真拉一次', tweetsReqs === 1);
        check('B4 set tweets 窗口 key=twitter_user_tweets:12345:w1234567890',
            theCache.rows.some(r => r.resource_type === 'twitter_user_tweets' && r.url === 'twitter_user_tweets:12345:w1234567890'),
            theCache.rows.map(r => r.url).join(' | '));
        check('B4 返回结果', res && res.tweets.length === 2);
        // 同窗口二次调用 → tweets 层也命中
        fetchCalls = [];
        const res2 = await getAccountWithFullTweets('FreshUser', 20, { untilSec: 1234567890 });
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
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');

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

    // C2: pre-check-service 0.5 调用透传 tokenData（appendix 来源链闭合）
    {
        const src = read('src/narrative/analyzer/services/pre-check-service.mjs');
        check('C2 0.5 调用第四参透传 tokenData',
            /checkIfCopycatToken\(\s*tokenSymbol,\s*tokenName,\s*Math\.floor\(tokenCreatedAt\),\s*tokenData/.test(src),
            'checkIfCopycatToken 调用未透传 tokenData');
    }

    // C3: same-name 短路块位于 BSC/Solana 搜索之前（源码序）
    {
        const src = read('src/narrative/analyzer/services/same-name-check-service.mjs');
        const shortCircuit = src.indexOf('no_target_appendix');
        const bscSearch = src.indexOf('this._searchBscWithCache(');
        const solSearch = src.indexOf("'solana', 300");
        check('C3 短路块在 BSC 搜索之前', shortCircuit > 0 && bscSearch > 0 && shortCircuit < bscSearch,
            `shortCircuit=${shortCircuit} bscSearch=${bscSearch}`);
        check('C3 短路块在 Solana 搜索之前', solSearch > 0 && shortCircuit < solSearch);
    }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
