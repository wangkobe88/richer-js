#!/usr/bin/env node
/**
 * news-monitor 模块（news_monitor 项目收编）——本地零 DB 单测（dbManager/fetch 打桩）
 *
 * 背景（2026-09-30）：news_monitor 独立项目（150 systemd + 独立 Supabase）整体迁入
 * richer-js（src/news-monitor/，daemon 182 screen 部署，表在 richer-js Supabase 重建）。
 * 迁移原则 = 语义原样；本单测锁定迁移中合并/改写的纯函数与新增逻辑。
 *
 * 覆盖：
 *   A. shouldStore 筛选矩阵（NEVER_STORE / core 全保 / normal 白名单 / 未知类型照存）
 *   B. trimContent（推文白名单字段 / 截断 / media / quoted / 关注数组 / 字符串 / 未知原样）
 *   C. normalizeEvent（tier 映射 / is_core / 头像注入 / tweet_id / ca / parseTime）
 *   D. parseCsv + extractHandle（引号 / 换行 / URL / @ / 裸 handle）
 *   E. filterByWatchlist（Sheet 命中 / 对象条目自带元数据 / missing throw）
 *   F. selectEvents + buildDigest（核心优先 / 互动补足 / 行格式 / 截取标注）
 *   G. purgeOldEvents 批次逻辑（dbManager 打桩：整批范围删 / 部分过期分块删 / 全新 break）
 *   H. LlmClient（fetch 打桩：正常返回 / max_tokens 截断 throw / 1301 判定 / 4xx 不重试）
 *   I. config（watchlist 装载 / NEWS_ env fail-loud）
 *
 * 用法：node scripts/_test_news_monitor.cjs
 */
'use strict';

const path = require('path');
const SRC = path.resolve(__dirname, '../src/news-monitor');

let pass = 0, fail = 0;
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}

async function checkThrows(name, fn, msgIncludes) {
    try {
        await fn();
        fail++; console.log(`  ✗ ${name}（未抛错）`);
    } catch (e) {
        if (!msgIncludes || String(e.message).includes(msgIncludes)) { pass++; console.log(`  ✓ ${name}`); }
        else { fail++; console.log(`  ✗ ${name}\n    期望含「${msgIncludes}」实际「${e.message}」`); }
    }
}

/** supabase 链式打桩：每次 .from() 按序消耗一个响应；链上任意方法链式、await 出响应 */
function seqSupabase(responses) {
    let i = 0;
    return {
        from() {
            const resp = responses[Math.min(i, responses.length - 1)];
            i++;
            const chain = {
                then(resolve) { resolve(resp); },
            };
            for (const m of ['select', 'order', 'limit', 'lte', 'gte', 'gt', 'lt', 'in', 'eq', 'delete', 'upsert', 'not', 'maybeSingle']) {
                chain[m] = () => chain;
            }
            return chain;
        },
        _calls: () => i,
    };
}

async function main() {
    // ============ A. shouldStore ============
    {
        console.log('\n— A. shouldStore 筛选矩阵 —');
        const { shouldStore } = require(path.join(SRC, 'ingest.js'));
        check('A1 SYSTEM 永不入库', [shouldStore('SYSTEM', 'core'), shouldStore('SYSTEM', 'normal')], [false, false]);
        check('A2 TRANSLATE 永不入库', [shouldStore('TRANSLATE', 'core'), shouldStore('TRANSLATE', 'normal')], [false, false]);
        check('A3 core 全事件保留', ['NEW_TWEET', 'NEW_RETWEET', 'NEW_UNFOLLOWER', 'UPDATE_BANNER'].map(t => shouldStore(t, 'core')),
            [true, true, true, true]);
        check('A4 normal 白名单保留', ['NEW_TWEET', 'NEW_TWEET_QUOTE', 'CA', 'CA_CREATE', 'DELETE', 'TWEET_TOPPING'].map(t => shouldStore(t, 'normal')),
            [true, true, true, true, true, true]);
        check('A5 normal 低密度丢弃', ['NEW_RETWEET', 'NEW_TWEET_REPLY', 'NEW_FOLLOWER', 'NEW_UNFOLLOWER', 'UPDATE_NAME'].map(t => shouldStore(t, 'normal')),
            [false, false, false, false, false]);
        check('A6 未知类型照存（协议演进不丢信号）', [shouldStore('SOME_NEW_TYPE', 'normal'), shouldStore('SOME_NEW_TYPE', 'core')], [true, true]);
    }

    // ============ B. trimContent ============
    {
        console.log('\n— B. trimContent 裁剪 —');
        const { trimContent } = require(path.join(SRC, 'ingest.js'));

        const tweet = trimContent('NEW_TWEET', {
            id: '123', text: 'x'.repeat(700), favoriteCount: 5,
            userFollowers: 1000, junkField: 'dropped',
            media: [{ thumbUrl: 'https://pbs.twimg.com/a.jpg', type: 'photo' }, { thumbUrl: 'https://pbs.twimg.com/b.jpg' }],
            replyStatus: { userScreenName: '@bob', text: 'y'.repeat(400), media: [{ thumbUrl: 'https://pbs.twimg.com/c.jpg' }] },
        });
        check('B1 正文截断 600+省略号', [tweet.text.length, tweet.text.endsWith('…')], [601, true]);
        check('B2 白名单字段保留/杂字段剔除', [tweet.id, tweet.favoriteCount, tweet.userFollowers, tweet.junkField], ['123', 5, 1000, undefined]);
        check('B3 media 精简 thumbUrl + mediaCount', [tweet.media.length, tweet.media[0], tweet.mediaCount],
            [2, { type: 'photo', url: 'https://pbs.twimg.com/a.jpg' }, 2]);
        check('B4 quoted 原推精简（@剥离/截断/media）', [tweet.quoted.user, tweet.quoted.text.length, tweet.quoted.media.length], ['bob', 301, 1]);

        const followers = trimContent('NEW_FOLLOWER', Array.from({ length: 25 }, (_, i) => ({ twAccount: `u${i}` })));
        check('B5 关注数组截前 10 条', [followers.length, followers[0].userScreenName], [10, 'u0']);

        check('B6 字符串截断 200', trimContent('UPDATE_NAME', 'n'.repeat(300)).length, 201);
        const unknown = { whatever: { nested: [1, 2] } };
        check('B7 未知结构原样保留', trimContent('CA_CREATE', unknown), unknown);
        check('B8 null content', trimContent('NEW_TWEET', null), null);
    }

    // ============ C. normalizeEvent ============
    {
        console.log('\n— C. normalizeEvent —');
        const { normalizeEvent, _resetWarned } = require(path.join(SRC, 'ingest.js'));
        _resetWarned();
        const tierOf = h => (h === 'vip' ? 'core' : (h === 'norm' ? 'normal' : null));

        const row = normalizeEvent({
            id: 42, eventType: 'NEW_TWEET', twAccount: '@Vip', twUserName: '大佬',
            profileUrl: 'https://pbs.twimg.com/av.png', ca: '0xabc',
            content: { id: '999', text: 'hello' },
            createdAt: 1759200000,   // 秒级时间戳
        }, tierOf);
        check('C1 行字段（handle 小写/is_core/tweet_id/ca/头像注入）',
            [row.tw_account, row.is_core, row.tweet_id, row.ca, row.source_event_id, row.content.userAvatar],
            ['vip', true, '999', '0xabc', '42', 'https://pbs.twimg.com/av.png']);
        check('C2 秒级时间戳解析', row.event_time, new Date(1759200000 * 1000).toISOString());

        const norm = normalizeEvent({ id: 'x', eventType: 'NEW_RETWEET', twAccount: 'norm', content: { id: 7, text: 't' } }, tierOf);
        check('C3 normal 转推被筛掉', norm, null);
        const core = normalizeEvent({ id: 'x', eventType: 'NEW_RETWEET', twAccount: 'vip', content: { id: 7, text: 't' } }, tierOf);
        check('C4 core 转推保留', core.is_core, true);
        check('C5 毫秒时间戳解析', normalizeEvent({ id: 'x', eventType: 'NEW_TWEET', twAccount: 'norm', content: { text: 't' }, createdAt: 1759200000000 }, tierOf).event_time,
            new Date(1759200000000).toISOString());
        check('C6 时间解析失败置 null', normalizeEvent({ id: 'x', eventType: 'NEW_TWEET', twAccount: 'norm', content: { text: 't' }, createdAt: 'garbage' }, tierOf).event_time, null);
        check('C7 params.id 缺失 source_event_id=null', normalizeEvent({ eventType: 'NEW_TWEET', twAccount: 'norm', content: { text: 't' } }, tierOf).source_event_id, null);
    }

    // ============ D. parseCsv + extractHandle ============
    {
        console.log('\n— D. parseCsv + extractHandle —');
        const { parseCsv, extractHandle } = require(path.join(SRC, 'sync.js'));
        const rows = parseCsv('h1,h2\n"https://x.com/a,b",核心\n,https://x.com/c\n');
        check('D1 引号内逗号不分裂', rows[1][0], 'https://x.com/a,b');
        check('D2 空行丢弃', rows.length, 3);
        check('D3 CRLF 兼容', parseCsv('a,b\r\nc,d\r\n').length, 2);
        check('D4 引号转义 ""', parseCsv('a,"b""c"\n')[0][1], 'b"c');

        check('D5 URL 提取', [extractHandle('https://x.com/ElonMusk'), extractHandle('https://twitter.com/@jack/'), extractHandle('@naval'), extractHandle('VitalikButerin'), extractHandle('not a handle!')].map(s => s === null ? null : s),
            ['elonmusk', 'jack', 'naval', 'vitalikbuterin', null]);
    }

    // ============ E. filterByWatchlist ============
    {
        console.log('\n— E. filterByWatchlist —');
        const { filterByWatchlist } = require(path.join(SRC, 'sync.js'));
        const sheetAccounts = [
            { handle: 'aaa', handleRaw: 'AAA', displayName: 'A 哥', tier: 'core' },
            { handle: 'bbb', handleRaw: 'bbb', displayName: null, tier: 'normal' },
        ];
        const wl = { solana: ['aaa'], ai: ['bbb', { handle: 'ccc', name: '不在 Sheet 的大号' }] };
        const out = filterByWatchlist(sheetAccounts, wl);
        check('E1 Sheet 命中带元数据 + ecosystem', out[0], { handle: 'aaa', handleRaw: 'AAA', displayName: 'A 哥', tier: 'core', ecosystem: 'solana' });
        check('E2 对象条目自带元数据', out[2], { handle: 'ccc', handleRaw: 'ccc', displayName: '不在 Sheet 的大号', tier: 'normal', ecosystem: 'ai' });

        await checkThrows('E3 字符串条目 Sheet 找不到 → throw（防拼写错误静默缩面）',
            () => { filterByWatchlist(sheetAccounts, { solana: ['typo_handle'] }); }, 'typo_handle');
    }

    // ============ F. selectEvents + buildDigest ============
    {
        console.log('\n— F. selectEvents + buildDigest —');
        const { selectEvents, buildDigest } = require(path.join(SRC, 'report.js'));
        const ev = (id, core, fav) => ({ id, is_core: core, event_type: 'NEW_TWEET', tw_account: `u${id}`, content: { text: `t${id}`, favoriteCount: fav, retweetCount: 0, replyCount: 0 } });
        const events = [ev(1, false, 100), ev(2, true, 1), ev(3, false, 300), ev(4, true, 2)];
        const kept = selectEvents(events, 3);
        check('F1 核心全保 + 普通按互动补足', kept.map(e => e.id), [2, 4, 3]);
        check('F2 核心超 cap 只留核心', selectEvents([ev(1, true, 0), ev(2, true, 0), ev(3, false, 99)], 2).map(e => e.id), [1, 2]);

        const dg = buildDigest(events, 10, h => (h === null ? null : null));
        check('F3 头部计数', dg.total === 4 && dg.kept === 4, true);
        check('F4 行格式含互动与序号', dg.digest.includes('赞300转0回0') && dg.digest.includes('[3] @u3') && dg.digest.includes('发推'), true);
        const dgCut = buildDigest(events, 2);
        check('F5 截取标注', dgCut.digest.includes('已按重要性截取 2 条'), true);
    }

    // ============ G. purgeOldEvents（dbManager 打桩） ============
    {
        console.log('\n— G. purgeOldEvents 批次逻辑 —');
        const { dbManager } = require(path.join(SRC, '../services/dbManager.js'));
        const store = require(path.join(SRC, 'store.js'));
        const realGetClient = dbManager.getClient.bind(dbManager);
        const old = new Date(Date.now() - 40 * 86400_000).toISOString();
        const fresh = new Date(Date.now() - 5 * 86400_000).toISOString();

        try {
            // 场景 1：最老批全过期 → 范围删 id<=max 后下一轮空表收尾
            let stub = seqSupabase([
                { data: [{ id: 1, created_at: old }, { id: 2, created_at: old }], error: null },   // select 批 1
                { data: null, error: null },                                                       // delete lte
                { data: [], error: null },                                                          // select 批 2（空）
            ]);
            dbManager.getClient = () => stub;
            check('G1 整批过期按 id 范围删', await store.purgeOldEvents(30, 5000, 20), 2);

            // 场景 2：批尾已新于 cutoff → 只精确清批内旧行（分块 in）后收工
            stub = seqSupabase([
                { data: [{ id: 1, created_at: old }, { id: 2, created_at: old }, { id: 3, created_at: fresh }], error: null },
                { data: null, error: null },   // delete in [1,2]
            ]);
            dbManager.getClient = () => stub;
            check('G2 部分过期精确清旧行', await store.purgeOldEvents(30, 5000, 20), 2);

            // 场景 3：批内全新 → 0 删立即收工
            stub = seqSupabase([
                { data: [{ id: 5, created_at: fresh }], error: null },
            ]);
            dbManager.getClient = () => stub;
            check('G3 无旧行 0 删', await store.purgeOldEvents(30, 5000, 20), 0);

            // 场景 4：select 报错 → throw（fail-loud）
            stub = seqSupabase([{ data: null, error: { message: 'boom' } }]);
            dbManager.getClient = () => stub;
            await checkThrows('G4 select 失败 throw', () => store.purgeOldEvents(30, 5000, 20), 'purgeOldEvents select');
        } finally {
            dbManager.getClient = realGetClient;
        }
    }

    // ============ H. LlmClient（fetch 打桩） ============
    {
        console.log('\n— H. LlmClient —');
        const { LlmClient, LlmError, isContentPolicyError } = require(path.join(SRC, 'report.js'));
        const realFetch = global.fetch;
        const mkClient = () => new LlmClient({ baseUrl: 'https://llm.test', apiKey: 'k', model: 'glm-test' });

        try {
            // 正常返回：text 块拼接 + usage 更新
            global.fetch = async () => ({
                ok: true,
                json: async () => ({ content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: '结论' }], stop_reason: 'end_turn', usage: { input_tokens: 11, output_tokens: 22 } }),
            });
            const c1 = mkClient();
            check('H1 text 块拼接剥离 thinking', await c1.chat({ system: 's', user: 'u' }), '结论');
            check('H2 lastUsage 更新', c1.lastUsage, { inputTokens: 11, outputTokens: 22 });

            // max_tokens 截断 → throw
            global.fetch = async () => ({
                ok: true,
                json: async () => ({ content: [{ type: 'text', text: '半截' }], stop_reason: 'max_tokens' }),
            });
            await checkThrows('H3 max_tokens 截断视为失败', () => mkClient().chat({ system: 's', user: 'u' }), '截断');

            // 1301 审查：HTTP 400 → LlmError(status 400)，isContentPolicyError 命中；4xx 不重试（fetch 只被调 1 次）
            let calls = 0;
            global.fetch = async () => {
                calls++;
                return { ok: false, status: 400, text: async () => '{"error":{"code":1301,"message":"包含不安全或敏感内容"}}' };
            };
            await checkThrows('H4 1301 抛 LlmError', () => mkClient().chat({ system: 's', user: 'u' }), 'LLM HTTP 400');
            check('H5 4xx 立即抛不重试', calls, 1);
            let err1301 = null;
            try { await mkClient().chat({ system: 's', user: 'u' }); } catch (e) { err1301 = e; }
            check('H6 isContentPolicyError 判定', [
                isContentPolicyError(err1301),
                isContentPolicyError(new LlmError('LLM HTTP 500: x', { status: 500 })),
            ], [true, false]);
        } finally {
            global.fetch = realFetch;
        }
    }

    // ============ I. config ============
    {
        console.log('\n— I. config —');
        const { loadWatchlist, loadNewsConfig } = require(path.join(SRC, 'config.js'));
        const wl = loadWatchlist();
        const total = Object.values(wl).reduce((n, arr) => n + arr.length, 0);
        check('I1 watchlist 装载（11 组 88 账号）', [Object.keys(wl).length, total], [11, 88]);

        // env fail-loud（daemon 全量校验）
        const saved = process.env.NEWS_WSS_TOKEN;
        delete process.env.NEWS_WSS_TOKEN;
        await checkThrows('I2 缺 NEWS_WSS_TOKEN → throw', () => loadNewsConfig('daemon'), 'NEWS_WSS_TOKEN');
        if (saved !== undefined) process.env.NEWS_WSS_TOKEN = saved;

        // 命令子集：listen 不要求 LLM/Sheet
        const savedLlm = process.env.NEWS_LLM_API_KEY;
        delete process.env.NEWS_LLM_API_KEY;
        const cfgListen = loadNewsConfig('listen');
        check('I3 listen 子集不要求 LLM key', [cfgListen.wssUrl !== undefined, cfgListen.llmApiKey === undefined], [true, true]);
        if (savedLlm !== undefined) process.env.NEWS_LLM_API_KEY = savedLlm;
    }

    console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
    process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
