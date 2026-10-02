#!/usr/bin/env node
/**
 * 推文拉取优化（CA 惰性早停 + userId 级全量缓存，2026-10-02 用户三点方案）——
 * 本地零 DB 零网络单测（dbManager 单例打桩 + global fetch 打桩）
 *
 * 背景：窗口离散 key (userId, untilSec) 同作者不同 token 锚不同永不命中
 * （B2 回测实测 651 真拉 / 259 唯一作者 ≈2.5 倍冗余，@binance 37 次居首）；
 * 且窗口模式 count 失效翻满全窗（@binance 一次 98 条 5 页），而全量消费 CA
 * 匹配的只有 verifyTokenAddress / findCaTweetInAccount 两处、其余消费 20 条封顶。
 *
 * 方案（用户三点）：① userId 级全量 key 跨 token 复用（复用时按请求窗口截断）；
 * ② CA 早停（每页匹配命中即停，早停点恒 ≤ 原停点零覆盖损失）；
 * ③ 早停截断列表落 CA 专属 key（同 token 跨调用点共享、跨 token 不共享防漏深 CA）
 *
 * 覆盖：
 *  A. textContainsAddress 纯函数（去 0x 双形态/大小写/空值）
 *  B. getUserTweets CA 惰性早停
 *   B1 窗口模式第 1 页命中 → 单页停 + addressMatched 标记 + 命中推文在列表
 *   B2 置顶推命中 → 第 1 页即停
 *   B3 不命中 → 翻到窗口边界（crossedWindow）+ 无标记（回归 = 原行为）
 *   B4 第 2 页命中 → 两页停
 *   B5 命中在窗口外（越界被丢）推文 → 不算命中，翻到窗口边界
 *   B6 凑数模式命中 → 够数前停
 *   B7 无 matchAddress → 原行为回归（凑数/窗口两分支）
 *  C. getAccountWithFullTweets 双 key 缓存矩阵
 *   C1 CA key 命中直接用（零网络）
 *   C2 全量 key 覆盖足够 → 截断复用（零网络，窗口外截掉，第 0 条恒留）
 *   C3 覆盖不足真拉命中 → 落 CA key，全量 key 不更新（截断深度对其它 token 无效）
 *   C4 真拉未命中翻满 → 更新全量 key {tweets, oldestSec}
 *   C5 同 token 二次调用 → CA key 命中零网络
 *   C6 不同 token CA key 不共享（tokenB 翻满落全量 key）
 *   C7 早停标记不落缓存行（JSON 序列化天然丢属性）
 *   C8 凑数口径：全量条数够 slice 复用 / 不够真拉
 *  D. 源码口径断言
 *   D1 analyzeAccountCommunityToken 规则验证调用透传 tokenAddress
 *   D2 NarrativeAnalyzer 账号收集调用透传 tokenAddress
 *   D3 早停只对窗口内推文判（源码序：过滤循环内）
 *
 * 用法：node scripts/_test_tweet_pull_optimization.cjs
 */

'use strict';

// ═══════════════ dbManager 单例打桩（必须在被测模块加载前完成）═══════════════
const { dbManager } = require('../src/services/dbManager');

/** external_resource_cache 内存表：upsert 走 JSON 往返（模拟真实 DB 序列化——
 *  早停标记 addressMatched 是数组属性，JSON.stringify 只序列化索引元素，天然丢失） */
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
                    const ser = { ...row, content: JSON.parse(JSON.stringify(row.content)) };
                    const i = rows.findIndex(r => r.url === row.url && r.resource_type === row.resource_type);
                    if (i >= 0) rows[i] = ser; else rows.push(ser);
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

const ADDR_A = '0xaaaabbbbccccdddd111122223333444455556666';
const ADDR_B = '0x1111222233334444aaaabbbbccccddddeeeeffff';
const BASE = 1800000000; // 窗口锚（秒）

const tw = (id, text, secOffset) => ({
    tweet_id: String(id),
    text,
    created_at: '2026-09-30',
    createdTimeStamp: (BASE + secOffset) * 1000,
});

const USER_SHAPE = {
    data: { user: { result: {
        rest_id: '777',
        core: { screen_name: 'ProjDev', name: 'Proj Dev', created_at: '2020-01-01T00:00:00.000Z' },
        legacy: { description: 'bio', followers_count: 1000, statuses_count: 500 },
        verification: { verified: false },
        is_blue_verified: false,
    } } },
};

/** 分页假响应：pages 数组按 cursor 索引取页 */
const pagedHandler = (pages, pinned = null) => (u) => {
    if (u.includes('/graphql/UserByScreenName')) return USER_SHAPE;
    if (u.includes('/sapi/UserTweets')) {
        const m = u.match(/cursor=(\d+)/);
        const idx = m ? Number(m[1]) : 0;
        const p = pages[idx] || { tweets: [], next_cursor_str: null, pinned_tweet: null };
        return { ...p, pinned_tweet: pinned && idx === 0 ? pinned : (p.pinned_tweet || null) };
    }
    return 'THROW';
};

(async () => {
    const { textContainsAddress, getUserTweets } = require('../src/utils/twitter-validation/new-apis');

    // ═══ A. textContainsAddress 纯函数 ═══
    console.log('A. textContainsAddress 纯函数');
    check('A1 带 0x 命中', textContainsAddress(`来吧 ${ADDR_A} 开盘`, ADDR_A) === true);
    check('A2 不带 0x 命中（去前缀双形态）', textContainsAddress(`CA: ${ADDR_A.replace(/^0x/, '')} 谨防假币`, ADDR_A) === true);
    check('A3 大小写不敏感（推文混合大小写）', textContainsAddress('CA: 0xAAAABBBBCCCCDDDD111122223333444455556666', ADDR_A) === true);
    check('A4 查询地址大写 0X 前缀也归一', textContainsAddress(`ca ${ADDR_A}`, `0X${ADDR_A.slice(2)}`) === true);
    check('A5 不含 → false', textContainsAddress('无关推文', ADDR_A) === false);
    check('A6 空文本 → false', textContainsAddress('', ADDR_A) === false);
    check('A7 空地址 → false', textContainsAddress('任意', '') === false);
    check('A8 纯 0x（归一后空串）→ false', textContainsAddress('0x', '0x') === false);

    // ═══ B. getUserTweets CA 惰性早停 ═══
    console.log('B. getUserTweets CA 惰性早停');
    const tweetsReqCount = () => fetchCalls.filter(u => u.includes('/sapi/UserTweets')).length;

    // B1: 窗口模式第 1 页命中 → 单页停 + 标记 + 命中推文在列表
    {
        fetchCalls = [];
        fetchHandler = pagedHandler([
            { tweets: [tw(1, '新推文', 100), tw(2, `正式宣告 ${ADDR_A}`, 95)], next_cursor_str: '1' },
            { tweets: [tw(3, '更早', 50)], next_cursor_str: null },
        ]);
        const list = await getUserTweets('777', { count: '20', untilSec: BASE, matchAddress: ADDR_A });
        fetchHandler = null;
        check('B1 第 1 页命中只拉 1 页', tweetsReqCount() === 1, `实际 ${tweetsReqCount()}`);
        check('B1 addressMatched 标记', list.addressMatched === true);
        check('B1 命中推文在列表', list.some(t => t.tweet_id === '2'));
        check('B1 第 2 页未拉（更早推文不在列表）', !list.some(t => t.tweet_id === '3'));
    }

    // B2: 置顶推命中 → 第 1 页即停
    {
        fetchCalls = [];
        fetchHandler = pagedHandler([
            { tweets: [tw(1, '新推文', 100)], next_cursor_str: '1' },
            { tweets: [tw(2, '更早', 50)], next_cursor_str: null },
        ], tw(0, `置顶宣告 ${ADDR_A}`, -5000));
        const list = await getUserTweets('777', { count: '20', untilSec: BASE, matchAddress: ADDR_A });
        fetchHandler = null;
        check('B2 置顶命中只拉 1 页', tweetsReqCount() === 1, `实际 ${tweetsReqCount()}`);
        check('B2 addressMatched 标记', list.addressMatched === true);
        check('B2 置顶推在列表头部（unshift）', list[0] && list[0].tweet_id === '0');
    }

    // B3: 不命中 → 翻到窗口边界 + 无标记（回归 = 原行为）
    {
        fetchCalls = [];
        fetchHandler = pagedHandler([
            { tweets: [tw(1, '新推文', 100)], next_cursor_str: '1' },
            { tweets: [tw(2, '窗口外', -50)], next_cursor_str: '2' },
            { tweets: [tw(3, '更远', -100)], next_cursor_str: null },
        ]);
        const list = await getUserTweets('777', { count: '20', untilSec: BASE, matchAddress: ADDR_A });
        fetchHandler = null;
        check('B3 不命中翻到 crossedWindow 页（2 页后边界停）', tweetsReqCount() === 2, `实际 ${tweetsReqCount()}`);
        check('B3 无 addressMatched 标记', list.addressMatched !== true);
        check('B3 窗口外推文被丢弃', !list.some(t => t.tweet_id === '2'));
    }

    // B4: 第 2 页命中 → 两页停
    {
        fetchCalls = [];
        fetchHandler = pagedHandler([
            { tweets: [tw(1, '新推文', 100)], next_cursor_str: '1' },
            { tweets: [tw(2, `宣告 ${ADDR_A}`, 90)], next_cursor_str: '2' },
            { tweets: [tw(3, '更早', -100)], next_cursor_str: null },
        ]);
        const list = await getUserTweets('777', { count: '20', untilSec: BASE, matchAddress: ADDR_A });
        fetchHandler = null;
        check('B4 第 2 页命中共拉 2 页', tweetsReqCount() === 2, `实际 ${tweetsReqCount()}`);
        check('B4 标记 + 命中推文在列表', list.addressMatched === true && list.some(t => t.tweet_id === '2'));
    }

    // B5: 命中在窗口外（越界被丢）推文 → 不算命中，翻到窗口边界
    {
        fetchCalls = [];
        fetchHandler = pagedHandler([
            { tweets: [tw(1, `窗口外宣告 ${ADDR_A}`, -100)], next_cursor_str: null },
        ]);
        const list = await getUserTweets('777', { count: '20', untilSec: BASE, matchAddress: ADDR_A });
        fetchHandler = null;
        check('B5 越界 CA 推不算命中（无标记）', list.addressMatched !== true);
        check('B5 越界推文不进列表', list.length === 0);
    }

    // B6: 凑数模式命中 → 够数前停
    {
        fetchCalls = [];
        fetchHandler = pagedHandler([
            { tweets: [tw(1, '推文一', 100), tw(2, '推文二', 99)], next_cursor_str: '1' },
            { tweets: [tw(3, `宣告 ${ADDR_A}`, 98)], next_cursor_str: '2' },
            { tweets: [tw(4, '推文四', 97)], next_cursor_str: null },
        ]);
        const list = await getUserTweets('777', { count: '100', matchAddress: ADDR_A });
        fetchHandler = null;
        check('B6 凑数模式第 2 页命中停（未凑满 100）', tweetsReqCount() === 2, `实际 ${tweetsReqCount()}`);
        check('B6 标记 + 3 条', list.addressMatched === true && list.length === 3);
    }

    // B7: 无 matchAddress → 原行为回归
    {
        fetchCalls = [];
        fetchHandler = pagedHandler([
            { tweets: [tw(1, `宣告 ${ADDR_A}`, 100), tw(2, '推文二', 99)], next_cursor_str: null },
        ]);
        const list = await getUserTweets('777', { count: '20', untilSec: BASE });
        fetchHandler = null;
        check('B7 无 matchAddress 不早停不标记（单页 cursor 尽停）',
            tweetsReqCount() === 1 && list.addressMatched !== true && list.length === 2);
        fetchCalls = [];
        fetchHandler = pagedHandler([
            { tweets: [tw(1, 'a', 100)], next_cursor_str: '1' },
            { tweets: [tw(2, 'b', 99)], next_cursor_str: null },
        ]);
        const list2 = await getUserTweets('777', { count: '2' });
        fetchHandler = null;
        check('B7 无 matchAddress 凑数模式够数停（原逻辑）', tweetsReqCount() === 2 && list2.length === 2);
    }

    // ═══ C. getAccountWithFullTweets 双 key 缓存矩阵 ═══
    console.log('C. getAccountWithFullTweets 双 key 缓存矩阵');
    const { getAccountWithFullTweets } = await import(
        '../src/narrative/analyzer/prompts/account/account-community-rules.mjs'
    );

    // C1: CA key 命中直接用（零网络）
    {
        theCache.rows.length = 0;
        theCache.rows.push(
            { url: 'twitter_user_info:projdev', resource_type: 'twitter_user_info', status: 'success',
              content: { id: '777', screen_name: 'ProjDev', name: 'Proj Dev', description: '', followers_count: 1, statuses_count: 1 },
              cached_at: new Date().toISOString(), expires_at: null },
            { url: `twitter_user_tweets:777:ca:${ADDR_A}`, resource_type: 'twitter_user_tweets', status: 'success',
              content: [tw(1, `宣告 ${ADDR_A}`, 100)],
              cached_at: new Date().toISOString(), expires_at: null },
        );
        fetchCalls = [];
        const res = await getAccountWithFullTweets('ProjDev', 20, { untilSec: BASE, tokenAddress: ADDR_A });
        check('C1 CA key 命中零网络', fetchCalls.length === 0, JSON.stringify(fetchCalls));
        check('C1 组装结果（1 条 CA 推文）', res && res.tweets.length === 1 && res.tweets[0].tweet_id === '1');
    }

    // C2: 全量 key 覆盖足够 → 截断复用（零网络）
    {
        theCache.rows.length = 0;
        theCache.rows.push(
            { url: 'twitter_user_info:projdev', resource_type: 'twitter_user_info', status: 'success',
              content: { id: '777', screen_name: 'ProjDev', name: 'Proj Dev', description: '', followers_count: 1, statuses_count: 1 },
              cached_at: new Date().toISOString(), expires_at: null },
            { url: 'twitter_user_tweets:777', resource_type: 'twitter_user_tweets', status: 'success',
              content: { tweets: [tw(1, '最新', 100), tw(2, '窗口内旧', 10), tw(3, '窗口外旧', -1000)],
                         oldestSec: BASE - 1000 },
              cached_at: new Date().toISOString(), expires_at: null },
        );
        fetchCalls = [];
        const res = await getAccountWithFullTweets('ProjDev', 20, { untilSec: BASE });
        check('C2 全量 key 覆盖足够截断复用零网络', fetchCalls.length === 0, JSON.stringify(fetchCalls));
        check('C2 截断（第0条恒留+窗口内，窗口外截掉）',
            res && res.tweets.length === 2 && !res.tweets.some(t => t.tweet_id === '3'),
            JSON.stringify(res && res.tweets.map(t => t.tweet_id)));
    }

    // C3: 覆盖不足真拉命中 → 落 CA key，全量 key 不更新
    {
        theCache.rows.length = 0;
        theCache.rows.push(
            { url: 'twitter_user_info:projdev', resource_type: 'twitter_user_info', status: 'success',
              content: { id: '777', screen_name: 'ProjDev', name: 'Proj Dev', description: '', followers_count: 1, statuses_count: 1 },
              cached_at: new Date().toISOString(), expires_at: null },
            { url: 'twitter_user_tweets:777', resource_type: 'twitter_user_tweets', status: 'success',
              content: { tweets: [tw(9, '浅缓存', 100)], oldestSec: BASE + 50 },   // 覆盖只到 BASE+50，请求窗口 BASE 更深
              cached_at: new Date().toISOString(), expires_at: null },
        );
        fetchCalls = [];
        fetchHandler = pagedHandler([
            { tweets: [tw(1, `宣告 ${ADDR_A}`, 90)], next_cursor_str: '1' },
            { tweets: [tw(2, '更早', -100)], next_cursor_str: null },
        ]);
        const res = await getAccountWithFullTweets('ProjDev', 20, { untilSec: BASE, tokenAddress: ADDR_A });
        fetchHandler = null;
        check('C3 覆盖不足真拉一次', tweetsReqCount() === 1, `实际 ${tweetsReqCount()}`);
        check('C3 CA 命中推文在返回列表', res && res.tweets.some(t => t.tweet_id === '1'));
        const caRow = theCache.rows.find(r => r.url === `twitter_user_tweets:777:ca:${ADDR_A}`);
        check('C3 早停截断列表落 CA 专属 key', !!caRow && Array.isArray(caRow.content) && caRow.content.length === 1);
        const fullRow = theCache.rows.find(r => r.url === 'twitter_user_tweets:777');
        check('C3 全量 key 不被截断列表污染（仍是浅缓存 1 条）',
            fullRow && fullRow.content.tweets.length === 1 && fullRow.content.tweets[0].tweet_id === '9');
    }

    // C5: 同 token 二次调用 → CA key 命中零网络（延续 C3 状态）
    {
        fetchCalls = [];
        const res = await getAccountWithFullTweets('ProjDev', 20, { untilSec: BASE, tokenAddress: ADDR_A });
        check('C5 同 token 二次调用零网络（CA key）', fetchCalls.length === 0 && res && res.tweets.length === 1);
    }

    // C6: 不同 token CA key 不共享 → tokenB 翻满落全量 key
    {
        fetchCalls = [];
        fetchHandler = pagedHandler([
            { tweets: [tw(1, `宣告 ${ADDR_A}`, 90), tw(2, '普通推文', 80)], next_cursor_str: '1' },
            { tweets: [tw(3, '窗口外', -100)], next_cursor_str: null },
        ]);
        const res = await getAccountWithFullTweets('ProjDev', 20, { untilSec: BASE, tokenAddress: ADDR_B });
        fetchHandler = null;
        check('C6 tokenB CA 未命中翻到边界（2 页）', tweetsReqCount() === 2, `实际 ${tweetsReqCount()}`);
        check('C6 tokenB 列表含 tokenA 的 CA 推文（对 B 是普通推文，不早停）',
            res && res.tweets.some(t => t.tweet_id === '1'));
        const fullRow = theCache.rows.find(r => r.url === 'twitter_user_tweets:777');
        check('C6 翻满全量更新全量 key（2 条 + oldestSec=BASE+80）',
            fullRow && fullRow.content.tweets.length === 2 && fullRow.content.oldestSec === BASE + 80,
            JSON.stringify(fullRow && fullRow.content.oldestSec));
    }

    // C7: 早停标记不落缓存行（JSON 序列化天然丢属性）
    {
        const caRow = theCache.rows.find(r => r.url === `twitter_user_tweets:777:ca:${ADDR_A}`);
        check('C7 CA key 行无 addressMatched 属性（JSON 往返丢）', caRow && caRow.content.addressMatched === undefined);
    }

    // C8: 凑数口径：全量条数够 slice 复用 / 不够真拉
    {
        // C6 后全量 key 有 2 条；凑数 100 条 → 不够 → 真拉
        fetchCalls = [];
        fetchHandler = pagedHandler([
            { tweets: Array.from({ length: 100 }, (_, i) => tw(100 + i, `bulk ${i}`, 100 - i)), next_cursor_str: null },
        ]);
        const res = await getAccountWithFullTweets('ProjDev', 50, {});
        fetchHandler = null;
        check('C8a 凑数口径条数不够真拉', tweetsReqCount() === 1 && res && res.tweets.length === 100);
        // 全量 key 已被 100 条翻满行更新 → 再凑数 100 → slice 复用零网络
        fetchCalls = [];
        const res2 = await getAccountWithFullTweets('ProjDev', 50, {});
        check('C8b 凑数口径条数够 slice 复用零网络', fetchCalls.length === 0 && res2 && res2.tweets.length === 100);
    }

    // ═══ D. 源码口径断言 ═══
    console.log('D. 源码口径');
    const fs = require('fs');
    const path = require('path');
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');

    {
        const svc = read('src/narrative/analyzer/services/account-analysis-service.mjs');
        check('D1 规则验证调用透传 tokenAddress', svc.includes('tokenAddress: tokenData.address || null'));
        check('D1b detectIssuerByCaTimeline 并入 tokenAddress 透传', svc.includes('{ ...options, tokenAddress }'));
        const ana = read('src/narrative/analyzer/NarrativeAnalyzer.mjs');
        check('D2 NarrativeAnalyzer tweetsWindowOptions 带 tokenAddress', ana.includes('tokenAddress: normalizedAddress'));
        check('D2b 四处调用点全部改用 tweetsWindowOptions（无残留旧窗口 options）',
            !/tweetWindowUntilSec \? \{ untilSec: tweetWindowUntilSec \} : \{\}/.test(ana));
        const apis = read('src/utils/twitter-validation/new-apis.js');
        check('D3 早停判定在窗口过滤循环内（源码序：push 与判定同分支）',
            /allTweets\.push\(t\);\s*\n\s*\/\/ CA 早停只对窗口内推文判/.test(apis));
        check('D3b textContainsAddress 导出（单一真相，narrative 侧可复用）',
            /module\.exports = \{[\s\S]*?textContainsAddress[\s\S]*?\};/.test(apis));
        // 兜底保留：crossedWindow / cursor 尽 / 10 页上限
        check('D3c 窗口分支兜底保留（crossedWindow/cursor）', apis.includes('addressMatched || !cursor || tweets.length === 0 || crossedWindow'));
        check('D3d MAX_PAGES=10 上限保留', apis.includes('const MAX_PAGES = 10'));
    }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
