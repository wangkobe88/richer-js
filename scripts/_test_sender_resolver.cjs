#!/usr/bin/env node
/**
 * SenderResolver + 两 collector 分流接线 + 引擎接线 单测（零 DB 零网络）
 *
 * 打桩点：SenderResolver._makeProvider（stub provider: send(eth_getBlockByNumber)/
 * getTransaction/destroy——CD377 起块拉取走裸调 send，ethers getBlock 抽象路径弃用）
 * 与 collector 构造第 6 参（stub resolver: submit）。
 *
 * 2026-11-04 块预取 join + GMGN 路由事件映射改造后解析链（A 节锁定）：
 *   EOA kind 快路 → 路由事件映射 → txFrom 缓存 → 块预取 join（getCode 判型退役）
 *   → 单行 getTransaction fallback → 重试耗尽 NULL
 *
 * 2026-11-06 CD377（A15-A20 锁定）：块拉取裸调+fn 内形状门（退化 failover/负缓存/
 * 熔断）+ null block lag 分治 + 映射复查两点（块路径未定值/进重试前）+ 路径计数和不变量
 *
 * 节：
 *   A  resolver 纯逻辑（快路/映射/块 join/缓存/fallback/重试/failover/溢出/stop/
 *      waitTokenIdle/callTimeoutMs）
 *   B  collector 分流接线（无 resolver 旧路径 / submit 回推 / EOA 快路 price_outlier 时序 /
 *      B5-B10 直连回迁补丁：延迟喂 FA / 直推 sender=null / 尘 tick 门 / offers 不传（tvl 口径）/
 *      _onTickBuffered 钩子 / registerToken platform 键）
 *   C  源码口径防回归（grep 断言：getCode 退役/路由事件映射/块 join 存在）
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
function ok(cond, label) {
    assert.ok(cond, label);
    passed++;
    console.log(`  ✓ ${label}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 挂桩 provider 工厂：按脚本控制 send(eth_getBlockByNumber)/getTransaction。
 *  CD377 起块拉取走裸调 send（hexTag 进/blockOf 收还原数字块号，计数仍记
 *  calls.getBlock 保存量断言零翻动）；非块方法 throw=测试红（链路异常立即可见） */
function makeStub(r, { blockOf, txOf }) {
    const calls = { getBlock: 0, getTransaction: 0 };
    r._makeProvider = (url) => ({
        url,
        send: async (method, params) => {
            if (method !== 'eth_getBlockByNumber') throw new Error(`stub 未实现 method: ${method}`);
            calls.getBlock++;
            const res = blockOf(Number.parseInt(params[0], 16));
            if (res && res.__defer) return res.promise;
            return res;
        },
        getTransaction: async (h) => {
            calls.getTransaction++;
            const res = txOf(h);
            if (res && res.__defer) return res.promise;
            return res;
        },
        destroy: () => {},
    });
    return calls;
}
function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject, __defer: true };
}

/** 全块对象（transactions: tx 对象数组——ethers getBlock(full=true) 形状） */
const fullBlock = (entries) => ({ transactions: entries.map(([hash, from]) => ({ hash, from })) });

const { SenderResolver, resolveAnkrHttpUrlFromEnv, DEFAULT_RPC_URLS } = require('../src/collectors/sender-resolver.js');
const quietLogger = { info: () => {}, warn: () => {}, error: () => {}, log: () => {} };

// tickRow 模板（block_number/token_address 为块 join 与 per-token seq 依赖键）
const row = (txHash, blockNumber = 100, token = '0xtok') => ({
    tx_hash: txHash, token_address: token, block_number: blockNumber, sender_address: null,
});

// ═══════════════ A 节：resolver 纯逻辑 ═══════════════

async function testA() {
    console.log('\nA. SenderResolver 纯逻辑');

    // A1 EOA 快路：kind 缓存命中 → submit 内同步回推（零延迟、不进 backlog）
    {
        const r = new SenderResolver({}, quietLogger);
        const pushed = [];
        r._cacheKind('0xeoa1', 'eoa');
        r.submit({ tickRow: row('0x1'), trader: '0xeoa1', txHash: '0x1', pushRow: (x) => pushed.push(x) });
        ok(pushed.length === 1 && pushed[0].sender_address === '0xeoa1', 'A1 EOA 快路同步回推 sender=trader');
        ok(r.stats.eoaFast === 1 && r._backlog.length === 0, 'A1 不进 backlog 零 RPC');
        ok(r.pendingFor('0xtok') === 0, 'A1 快路同帧定值 pending=0');
    }

    // A2 新 trader（无 blockNumber 行）→ 单行 fallback；from===trader（EOA 直连）
    //    反哺 kind 缓存走未来快路；getCode 全链退役（永零调用）
    {
        const r = new SenderResolver({ concurrency: 1 }, quietLogger);
        const calls = makeStub(r, { blockOf: () => { throw new Error('不应拉块'); }, txOf: () => ({ from: '0xEoaDirect' }) });
        const pushed = [];
        r.submit({ tickRow: row('0x2', null), trader: '0xeoadirect', txHash: '0x2', pushRow: (x) => pushed.push(x) });
        await sleep(20);
        ok(pushed.length === 1 && pushed[0].sender_address === '0xeoadirect', 'A2 无 blockNumber 单行 fallback 定值（lowercase）');
        ok(calls.getTransaction === 1 && calls.getBlock === 0, 'A2 单行回查一次、块路径未触发');
        ok(r.kindSync('0xeoadirect') === 'eoa', 'A2 from===trader 反哺 kind 缓存（from 恒 EOA）');
        r.submit({ tickRow: row('0x2b', null), trader: '0xeoadirect', txHash: '0x2b', pushRow: (x) => pushed.push(x) });
        ok(pushed.length === 2 && r.stats.eoaFast === 1 && calls.getTransaction === 1, 'A2 kind 落缓存后同地址快路零 RPC');
    }

    // A3 块预取 join：同块 3 行（不同合约 trader）→ 一次 getBlock 全簇定值 + from 反哺
    {
        const r = new SenderResolver({ concurrency: 3 }, quietLogger);
        const calls = makeStub(r, {
            blockOf: (bn) => fullBlock([['0xt3a', '0xUserA'], ['0xt3b', '0xUserB'], ['0xt3c', '0xUserC']]),
            txOf: () => { throw new Error('不应单行回查'); },
        });
        const pushed = [];
        for (const [tx, trader] of [['0xt3a', '0xr1'], ['0xt3b', '0xr2'], ['0xt3c', '0xr3']]) {
            r.submit({ tickRow: row(tx, 777), trader, txHash: tx, pushRow: (x) => pushed.push(x) });
        }
        await sleep(40);
        ok(pushed.length === 3, 'A3 同块 3 行全簇定值');
        ok(pushed.find((x) => x.tx_hash === '0xt3a').sender_address === '0xusera'
            && pushed.find((x) => x.tx_hash === '0xt3b').sender_address === '0xuserb'
            && pushed.find((x) => x.tx_hash === '0xt3c').sender_address === '0xuserc', 'A3 各行 sender=各自 tx.from');
        ok(calls.getBlock === 1 && r.stats.blockPulls === 1 && r.stats.blockJoinRows === 3, 'A3 一次块拉取全簇共享（in-flight 去重）');
        ok(calls.getTransaction === 0, 'A3 块命中不落单行回查');
        ok(r.kindSync('0xusera') === 'eoa', 'A3 from 反哺 kind 缓存');
        ok(r._txFromCache.get('0xt3a') === '0xusera', 'A3 txFrom 缓存落盘（同 tx 后续行零调用）');
    }

    // A4 GMGN 路由事件映射：setRouterEventUser 后合约行零 RPC 定值；miss 计数
    {
        const r = new SenderResolver({ concurrency: 1 }, quietLogger);
        const calls = makeStub(r, { blockOf: () => fullBlock([]), txOf: () => null });
        r.setRouterEventUser('0xgm1', '0xGmgnUser');
        const pushed = [];
        r.submit({ tickRow: row('0xgm1', 500), trader: '0x1de460router', txHash: '0xgm1', pushRow: (x) => pushed.push(x) });
        await sleep(10);
        ok(pushed.length === 1 && pushed[0].sender_address === '0xgmgnuser', 'A4 路由事件映射命中定值（lowercase）');
        ok(calls.getBlock === 0 && calls.getTransaction === 0 && r.stats.routerMapHits === 1, 'A4 映射命中零 RPC');
        r.submit({ tickRow: row('0xgm2', 501), trader: '0x1de460router', txHash: '0xgm2', pushRow: (x) => pushed.push(x) });
        await sleep(10);
        ok(r.stats.routerMapMisses >= 1, 'A4 映射 miss 计数（事件晚到窗口）');
    }

    // A4b 映射 LRU 上限
    {
        const r = new SenderResolver({ routerEventMapLimit: 4 }, quietLogger);
        for (let i = 0; i < 5; i++) r.setRouterEventUser(`0xgm${i}`, '0xu');
        ok(r._routerEventMap.size <= 4 && !r._routerEventMap.has('0xgm0') && r._routerEventMap.has('0xgm4'), 'A4b 映射超限清一半（插入序）');
    }

    // A5 块内无该 txHash（重组/节点 lag）→ blockFallbackRows + 单行 fallback 成功
    {
        const r = new SenderResolver({ concurrency: 1 }, quietLogger);
        const calls = makeStub(r, { blockOf: () => fullBlock([['0xother', '0xsomeone']]), txOf: (h) => ({ from: '0xFallbackUser' }) });
        const pushed = [];
        r.submit({ tickRow: row('0x5', 900), trader: '0xrouter5', txHash: '0x5', pushRow: (x) => pushed.push(x) });
        await sleep(20);
        ok(pushed.length === 1 && pushed[0].sender_address === '0xfallbackuser', 'A5 块 miss 落单行回查成功');
        ok(r.stats.blockFallbackRows === 1 && calls.getTransaction === 1, 'A5 fallback 计数');
    }

    // A5b 块拉取失败 → rpcErrors + 单行 fallback；失败 promise 不留缓存（第二行重拉块）
    {
        const r = new SenderResolver({ concurrency: 1 }, quietLogger);
        let blockFails = true;
        const calls = makeStub(r, {
            blockOf: () => { if (blockFails) throw new Error('block rpc down'); return fullBlock([['0x5b2', '0xBlockUser']]); },
            txOf: (h) => (h === '0x5b1' ? { from: '0xSingleUser' } : null),
        });
        const pushed = [];
        r.submit({ tickRow: row('0x5b1', 901), trader: '0xrouter5b', txHash: '0x5b1', pushRow: (x) => pushed.push(x) });
        await sleep(20);
        ok(pushed.length === 1 && pushed[0].sender_address === '0xsingleuser', 'A5b 块失败降级单行成功');
        ok(r.stats.rpcErrors >= 1 && r.stats.blockFallbackRows === 1, 'A5b 块失败计数');
        blockFails = false;
        r.submit({ tickRow: row('0x5b2', 901), trader: '0xrouter5b', txHash: '0x5b2', pushRow: (x) => pushed.push(x) });
        await sleep(20);
        ok(pushed[1].sender_address === '0xblockuser' && r.stats.blockPulls === 2, 'A5b 失败 promise 不留缓存（重试重新拉块成功，blockPulls=2）');
    }

    // A6 txFrom 缓存：块 join 命中行落缓存后，同 txHash 新行零调用共享
    {
        const r = new SenderResolver({ concurrency: 1 }, quietLogger);
        const calls = makeStub(r, { blockOf: () => fullBlock([['0x6a', '0xagguser']]), txOf: () => { throw new Error('不应单行'); } });
        const pushed = [];
        r.submit({ tickRow: row('0x6a', 600), trader: '0xrouter6', txHash: '0x6a', pushRow: (x) => pushed.push(x) });
        await sleep(20);
        r.submit({ tickRow: row('0x6a-1', 600), trader: '0xrouter6', txHash: '0x6a', pushRow: (x) => pushed.push(x) });
        await sleep(20);
        ok(pushed.length === 2 && pushed.every((x) => x.sender_address === '0xagguser'), 'A6 同 txHash 行共享定值');
        ok(calls.getBlock === 1 && r.stats.txFromCacheHits === 1, 'A6 缓存命中零块拉取');
    }

    // A7 重试→耗尽 NULL：块+单行全失败 retryLimit=1 → retried=1 后 NULL
    {
        const r = new SenderResolver({ concurrency: 1, retryLimit: 1, retryDelayMs: 10 }, quietLogger);
        const calls = makeStub(r, { blockOf: () => { throw new Error('down'); }, txOf: () => null });
        const pushed = [];
        r.submit({ tickRow: row('0x7', 700), trader: '0xrouter7', txHash: '0x7', pushRow: (x) => pushed.push(x) });
        await sleep(80);
        ok(pushed.length === 1 && pushed[0].sender_address === null, 'A7 全链失败耗尽 NULL（保数据丢修复）');
        ok(r.stats.retried === 1 && r.stats.senderNull === 1, 'A7 重试 1 次后 NULL');
        ok(r.kindSync('0xrouter7') === null, 'A7 失败不落 kind 缓存（下次有机会重解析）');
    }

    // A8 溢出：backlog 满 → 最老行 NULL 强制落库
    {
        const d1 = deferred();
        const r = new SenderResolver({ concurrency: 1, backlogLimit: 2 }, quietLogger);
        makeStub(r, { blockOf: () => d1, txOf: () => null });
        const pushed = [];
        r.submit({ tickRow: row('t1', 1), trader: '0xslow', txHash: 't1', pushRow: (x) => pushed.push(x) }); // 占 inflight
        r.submit({ tickRow: row('t2', 2), trader: '0xslow', txHash: 't2', pushRow: (x) => pushed.push(x) });
        r.submit({ tickRow: row('t3', 3), trader: '0xslow', txHash: 't3', pushRow: (x) => pushed.push(x) });
        r.submit({ tickRow: row('t4', 4), trader: '0xslow', txHash: 't4', pushRow: (x) => pushed.push(x) }); // 触发溢出
        ok(pushed.length === 1 && pushed[0].tx_hash === 't2' && pushed[0].sender_address === null, 'A8 溢出最老行 NULL 强制落库');
        ok(r.stats.backlogOverflow === 1 && r._backlog.length === 2, 'A8 溢出计数与剩余 backlog');
        d1.resolve(fullBlock([])); // 释放 inflight 防泄漏到后续节
        await sleep(10);
    }

    // A9 failover：rrIndex 起点轮询 + 逐 provider 降级（块拉取链）
    {
        const r = new SenderResolver({ rpcUrls: ['https://a', 'https://b'], concurrency: 1 }, quietLogger);
        const seen = [];
        r._makeProvider = (url) => ({
            url,
            send: async (method) => {
                if (method !== 'eth_getBlockByNumber') throw new Error(`stub 未实现 method: ${method}`);
                seen.push(url); if (url === 'https://a') throw new Error('down'); return fullBlock([['0x8', '0xeoa8']]);
            },
            getTransaction: async () => null,
            destroy: () => {},
        });
        const pushed = [];
        r.submit({ tickRow: row('0x8', 800), trader: '0xeoa8', txHash: '0x8', pushRow: (x) => pushed.push(x) });
        await sleep(20);
        ok(pushed.length === 1 && pushed[0].sender_address === '0xeoa8', 'A9 failover 到第二端点成功（from===trader EOA 直连）');
        ok(seen.length >= 2 && seen.includes('https://b'), 'A9 失败端点后逐个降级');
    }

    // A10 ankrFromEnv 推导 + fail-loud
    {
        const hadWs = process.env.ANKR_WS_URL, hadKey = process.env.ANKR_API_KEY;
        delete process.env.ANKR_WS_URL; delete process.env.ANKR_API_KEY;
        ok(resolveAnkrHttpUrlFromEnv() === null, 'A10 无 env 推导 null');
        process.env.ANKR_WS_URL = 'wss://rpc.ankr.com/bsc/ws/0123456789abcdef0123456789';
        ok(resolveAnkrHttpUrlFromEnv() === 'https://rpc.ankr.com/bsc/0123456789abcdef0123456789', 'A10 ANKR_WS_URL 尾段推导');
        delete process.env.ANKR_WS_URL;
        process.env.ANKR_WS_URL = 'wss://rpc.ankr.com/bsc/ws'; // 无 key 尾段 'ws' 不合格
        process.env.ANKR_API_KEY = '0123456789abcdef0123456789abcdef';
        ok(resolveAnkrHttpUrlFromEnv() === 'https://rpc.ankr.com/bsc/0123456789abcdef0123456789abcdef', 'A10 尾段不合格回退 ANKR_API_KEY');
        const r = new SenderResolver({ rpcMode: 'ankrFromEnv' }, quietLogger);
        delete process.env.ANKR_WS_URL; delete process.env.ANKR_API_KEY;
        assert.throws(() => r._resolveRpcUrls(), /ankrFromEnv/);
        ok(true, 'A10 ankrFromEnv 推导失败 throw（部署错误 fail-loud，不静默回退）');
        ok(Array.isArray(DEFAULT_RPC_URLS) && DEFAULT_RPC_URLS.length === 5, 'A10 默认 dataseed 池 5 域名');
        if (hadWs === undefined) delete process.env.ANKR_WS_URL; else process.env.ANKR_WS_URL = hadWs;
        if (hadKey === undefined) delete process.env.ANKR_API_KEY; else process.env.ANKR_API_KEY = hadKey;
    }

    // A11 stop：等 in-flight → 剩余 backlog 全部 NULL 回推；停机后到货 NULL 直推
    {
        const d1 = deferred(), d2 = deferred();
        const r = new SenderResolver({ concurrency: 1 }, quietLogger);
        let i = 0;
        r._makeProvider = () => ({
            send: async () => (i++ === 0 ? d1.promise : d2.promise),
            getTransaction: async () => null,
            destroy: () => {},
        });
        const pushed = [];
        r.submit({ tickRow: row('s1', 1), trader: '0xslow', txHash: 's1', pushRow: (x) => pushed.push(x) });
        d1.resolve(fullBlock([['s1', '0xuser1']]));
        await sleep(10);
        r.submit({ tickRow: row('s2', 2), trader: '0xslow', txHash: 's2', pushRow: (x) => pushed.push(x) }); // 占 inflight
        r.submit({ tickRow: row('s3', 3), trader: '0xslow', txHash: 's3', pushRow: (x) => pushed.push(x) });
        r.submit({ tickRow: row('s4', 4), trader: '0xslow', txHash: 's4', pushRow: (x) => pushed.push(x) });
        const stopP = r.stop();
        d2.resolve(fullBlock([])); // 释放 in-flight（3s deadline 内）
        await stopP;
        const s3 = pushed.find((x) => x.tx_hash === 's3');
        const s4 = pushed.find((x) => x.tx_hash === 's4');
        ok(s3 && s4 && s3.sender_address === null && s4.sender_address === null, 'A11 stop 剩余 backlog 全部 NULL 回推');
        ok(r._backlog.length === 0 && r._stopped, 'A11 停机后 backlog 清空');
        // 停机后到货行：NULL 直推保行（竞态窗口）
        r.submit({ tickRow: row('s5', 5), trader: '0xany', txHash: 's5', pushRow: (x) => pushed.push(x) });
        const s5 = pushed.find((x) => x.tx_hash === 's5');
        ok(s5 && s5.sender_address === null, 'A11 停机后到货 NULL 直推不丢行');
    }

    // A12 waitTokenIdle / pendingFor：watermark 防打断 + deadline 帽 + 快路零 pending
    {
        const d1 = deferred();
        const r = new SenderResolver({ concurrency: 1 }, quietLogger);
        makeStub(r, { blockOf: () => d1, txOf: () => null });
        const pushed = [];
        r.submit({ tickRow: row('w1', 1, '0xwtok'), trader: '0xwslow', txHash: 'w1', pushRow: (x) => pushed.push(x) });
        ok(r.pendingFor('0xwtok') === 1, 'A12 入队后 pending=1');
        // 等待启动后再入队的新行不打断（watermark：target=调用时刻快照）
        const idleP = r.waitTokenIdle('0xwtok', 2000);
        r.submit({ tickRow: row('w2', 2, '0xwtok'), trader: '0xwslow', txHash: 'w2', pushRow: (x) => pushed.push(x) });
        d1.resolve(fullBlock([['w1', '0xwuser'], ['w2', '0xwuser']]));
        const idle = await idleP;
        ok(idle === true && r.pendingFor('0xwtok') === 0, 'A12 watermark 等待不被等待期新入队行打断');
        // deadline 帽：永不完成的块 → 等 80ms 帽后 false 返回
        const d2 = deferred();
        makeStub(r, { blockOf: () => d2, txOf: () => null });
        r.submit({ tickRow: row('w3', 3, '0xwtok2'), trader: '0xwslow', txHash: 'w3', pushRow: (x) => pushed.push(x) });
        const t0 = Date.now();
        const idle2 = await r.waitTokenIdle('0xwtok2', 80);
        ok(idle2 === false && Date.now() - t0 >= 70, 'A12 deadline 帽返回 false（调用方按超时处理）');
        d2.resolve(fullBlock([]));
        await sleep(10);
        // EOA 快路：同帧定值零等待
        r._cacheKind('0xeoaw', 'eoa');
        r.submit({ tickRow: row('w4', 4, '0xwtok3'), trader: '0xeoaw', txHash: 'w4', pushRow: (x) => pushed.push(x) });
        ok((await r.waitTokenIdle('0xwtok3', 100)) === true, 'A12 快路行 waitTokenIdle 即刻返回');
    }

    // A13 callTimeoutMs：块拉取超时 → 降级单行（callTimeouts 计数；超时≠失败重试）
    {
        const r = new SenderResolver({ concurrency: 1, rpcUrls: ['https://one'], callTimeoutMs: 30, retryLimit: 0 }, quietLogger);
        const calls = makeStub(r, {
            blockOf: () => new Promise(() => {}), // 永不返回 → 超时
            txOf: () => ({ from: '0xSlowBlockUser' }),
        });
        const pushed = [];
        r.submit({ tickRow: row('0x13', 1300), trader: '0xrouter13', txHash: '0x13', pushRow: (x) => pushed.push(x) });
        await sleep(120);
        ok(pushed.length === 1 && pushed[0].sender_address === '0xslowblockuser', 'A13 块超时降级单行成功');
        ok(r.stats.callTimeouts >= 1, 'A13 超时计数');
    }

    // A14 _pushResolved 幂等：同 entry 双 push 只一次
    {
        const r = new SenderResolver({}, quietLogger);
        let n = 0;
        const entry = { tickRow: row('0x14'), pushRow: () => { n++; } };
        r._pushResolved(entry, '0xa');
        r._pushResolved(entry, '0xb');
        ok(n === 1 && entry.tickRow.sender_address === '0xa', 'A14 _pushResolved 幂等防重');
    }

    // A15 CD377 形状门 failover：端点 a 返回 hash 数组（ethers 抽象路径实测事故形状）
    //    → fn 内 throw → 逐端点 failover → 端点 b full 对象建 map（单端点退化被救回不计 degrade）
    {
        const r = new SenderResolver({ rpcUrls: ['https://a', 'https://b'], concurrency: 1 }, quietLogger);
        const seen = [];
        r._makeProvider = (url) => ({
            url,
            send: async (method) => {
                if (method !== 'eth_getBlockByNumber') throw new Error(`stub 未实现: ${method}`);
                seen.push(url);
                if (url === 'https://a') return { transactions: ['0xt15', '0xt15b'] }; // hash 数组=事故形状
                return fullBlock([['0xt15', '0xuser15']]);
            },
            getTransaction: async () => { throw new Error('不应单行'); },
            destroy: () => {},
        });
        const pushed = [];
        r.submit({ tickRow: row('0xt15', 1500), trader: '0xr15', txHash: '0xt15', pushRow: (x) => pushed.push(x) });
        await sleep(20);
        ok(pushed.length === 1 && pushed[0].sender_address === '0xuser15', 'A15 形状退化端点 failover 到好端点定值');
        ok(seen.length === 2 && seen[1] === 'https://b', 'A15 fn 内 throw 触发端点 failover（200-OK 也走降级链）');
        ok(r.stats.blockShapeDegrades === 0 && r.stats.blockJoinRows === 1, 'A15 单端点退化被 failover 救回（不计全端点退化）');
    }

    // A16 CD377 全端点形状退化：负缓存（空 Map 留缓存防同块重拉风暴）+ 连续熔断停预取
    {
        const r = new SenderResolver({ rpcUrls: ['https://only'], concurrency: 1, shapeBreakerThreshold: 2 }, quietLogger);
        makeStub(r, {
            blockOf: () => ({ transactions: ['0xh'] }), // 恒 hash 数组=全端点退化
            txOf: (h) => ({ from: '0xsingle16' }),
        });
        const pushed = [];
        r.submit({ tickRow: row('0x16a', 1600), trader: '0xr16', txHash: '0x16a', pushRow: (x) => pushed.push(x) });
        await sleep(20);
        ok(pushed[0].sender_address === '0xsingle16' && r.stats.blockShapeDegrades === 1, 'A16 全端点退化计 degrade、行落单行定值');
        // 同块第二行：负缓存命中不重拉（防「throw 逐出→同块逐行×N 端点×全块 payload」重拉风暴）
        r.submit({ tickRow: row('0x16b', 1600), trader: '0xr16', txHash: '0x16b', pushRow: (x) => pushed.push(x) });
        await sleep(20);
        ok(r.stats.blockPulls === 1 && pushed[1].sender_address === '0xsingle16', 'A16 同块负缓存不重拉（blockPulls 仍 1）');
        // 第二块再退化 → streak 达阈 2 → 熔断；第三块不再发块拉取（行直落单行）
        r.submit({ tickRow: row('0x16c', 1601), trader: '0xr16', txHash: '0x16c', pushRow: (x) => pushed.push(x) });
        await sleep(20);
        ok(r.stats.blockShapeDegrades === 2 && r._prefetchPausedUntil > Date.now(), 'A16 连续 2 块退化触发熔断（pause 未到期）');
        const pullsBefore = r.stats.blockPulls;
        r.submit({ tickRow: row('0x16d', 1602), trader: '0xr16', txHash: '0x16d', pushRow: (x) => pushed.push(x) });
        await sleep(20);
        ok(r.stats.blockPulls === pullsBefore && pushed[3].sender_address === '0xsingle16', 'A16 熔断期停块预取（行直落单行 fallback）');
    }

    // A17 CD377 null block（端点 lag，ankr 领先 RPC 池）：isBlockLag 不 failover 不计
    //     rpcErrors、失败 promise 逐出缓存（同块第二行重拉）
    {
        const r = new SenderResolver({ rpcUrls: ['https://only'], concurrency: 1 }, quietLogger);
        const calls = makeStub(r, {
            blockOf: () => null, // 端点还没该块（成功响应非错误——刻意不走 failover）
            txOf: (h) => ({ from: '0xlagUser' }),
        });
        const pushed = [];
        r.submit({ tickRow: row('0x17a', 1700), trader: '0xr17', txHash: '0x17a', pushRow: (x) => pushed.push(x) });
        await sleep(20);
        ok(pushed[0].sender_address === '0xlaguser', 'A17 lag 块行落单行定值');
        ok(r.stats.blockNotFound === 1 && r.stats.rpcErrors === 0, 'A17 lag 计 blockNotFound 不计 rpcErrors（lag 风暴不放大流量）');
        r.submit({ tickRow: row('0x17b', 1700), trader: '0xr17', txHash: '0x17b', pushRow: (x) => pushed.push(x) });
        await sleep(20);
        ok(r.stats.blockPulls === 2, 'A17 lag promise 不留缓存（同块第二行重拉）');
    }

    // A18 CD377 复查点①：块 join RPC 往返窗内路由事件进 map → from=null 后复查接住
    //     （ankr 领先 dataseed 主形态：块内无该 txHash 但事件已到，零单行零新增延迟）
    {
        const d = deferred();
        const r = new SenderResolver({ concurrency: 1 }, quietLogger);
        const calls = makeStub(r, { blockOf: () => d, txOf: () => { throw new Error('不应单行'); } });
        const pushed = [];
        r.submit({ tickRow: row('0x18', 1800), trader: '0xr18', txHash: '0x18', pushRow: (x) => pushed.push(x) });
        await sleep(10);                          // 行挂上块 join（in-flight）
        r.setRouterEventUser('0x18', '0xlateUser'); // 路由事件晚到几十 ms 进 map
        d.resolve(fullBlock([]));                 // 块内无该 txHash
        await sleep(10);
        ok(pushed.length === 1 && pushed[0].sender_address === '0xlateuser', 'A18 块路径未定值后复查 map 接住定值');
        ok(r.stats.routerMapLateHits === 1 && calls.getTransaction === 0, 'A18 lateHits 计数、零单行回查');
        ok(r.stats.blockFallbackRows === 0, 'A18 复查接住不计 fallback');
    }

    // A19 CD377 复查点②：块路径+单行回查均未定值（双晚角落）→ 进重试前复查接住砍 3s 尾巴
    {
        const d = deferred();
        const r = new SenderResolver({ concurrency: 1, retryLimit: 2, retryDelayMs: 5 }, quietLogger);
        makeStub(r, {
            blockOf: () => fullBlock([]), // 块内无该 tx 且事件未到
            txOf: () => d,                // 单行慢（lag 往返）
        });
        const pushed = [];
        r.submit({ tickRow: row('0x19', 1900), trader: '0xr19', txHash: '0x19', pushRow: (x) => pushed.push(x) });
        await sleep(10);                           // 块路径已过、单行挂起
        r.setRouterEventUser('0x19', '0xretryUser');
        d.resolve(null);                           // 单行也未定值
        await sleep(10);
        ok(pushed.length === 1 && pushed[0].sender_address === '0xretryuser', 'A19 重试前复查 map 接住定值');
        ok(r.stats.routerMapRetryHits === 1 && r.stats.retried === 0, 'A19 retryHits 计数、零重试（尾巴砍掉）');
        ok(r.stats.blockFallbackRows === 1, 'A19 块+复查①均未定值计 fallback（口径收窄后）');
    }

    // A20 CD377 定值路径计数和不变量：终态行数 = 各定值路径计数之和（无泄漏/无双计）
    {
        const r = new SenderResolver({ concurrency: 2, retryLimit: 0 }, quietLogger);
        makeStub(r, {
            blockOf: () => fullBlock([['0x20b', '0xjoinUser']]),
            txOf: (h) => (h === '0x20c' ? { from: '0xsingleUser' } : null),
        });
        r._cacheKind('0xeoa20', 'eoa');
        r.setRouterEventUser('0x20a', '0xmapUser');
        const pushed = [];
        const sub = (tx, trader) => r.submit({ tickRow: row(tx, 2000, '0xtok20'), trader, txHash: tx, pushRow: (x) => pushed.push(x) });
        sub('0x20e', '0xeoa20'); // eoaFast
        sub('0x20a', '0xr20');   // routerMapHits
        sub('0x20b', '0xr20');   // blockJoinRows
        sub('0x20c', '0xr20');   // blockFallbackRows → txFromResolved
        await sleep(40);
        sub('0x20d', '0xr20');   // blockFallbackRows → 单行 null → retryLimit=0 → senderNull
        await sleep(40);
        const s = r.stats;
        const sum = s.eoaFast + s.routerMapHits + s.routerMapLateHits + s.routerMapRetryHits
            + s.txFromCacheHits + s.blockJoinRows + s.txFromResolved + s.senderNull;
        ok(pushed.length === 5 && sum === 5, 'A20 终态行数=路径计数和（5 行 5 路径全覆盖）');
        ok(s.blockFallbackRows === 2 && s.txFromResolved === 1 && s.senderNull === 1,
            'A20 fallback 口径=块+复查均未定值落单行（20c 单行定值/20d NULL）');
    }

    // ═══ A21-A27 CD378 ANKR WSS 单笔主路径 ═══

    // A21 WSS 主路定值：from 命中 → 零 dataseed；from 反哺 txFrom+kind 双缓存
    //     （from==trader 场景 trader 即 EOA；from!=trader 场景合约 trader 不落 kind）
    {
        const r = new SenderResolver({ concurrency: 2 }, quietLogger);
        const calls = makeStub(r, { blockOf: () => { throw new Error('不应拉块'); }, txOf: () => { throw new Error('不应单行'); } });
        const wssCalls = [];
        r.attachWss(async (method, params) => {
            wssCalls.push([method, params[0]]);
            return { result: { from: '0xWssUser' } };
        });
        const pushed = [];
        r.submit({ tickRow: row('0x21', 2100), trader: '0xr21', txHash: '0x21', pushRow: (x) => pushed.push(x) });
        await sleep(20);
        ok(pushed.length === 1 && pushed[0].sender_address === '0xwssuser', 'A21 WSS 单笔定值 sender=tx.from（lowercase）');
        ok(wssCalls.length === 1 && wssCalls[0][0] === 'eth_getTransactionByHash' && wssCalls[0][1] === '0x21',
            'A21 请求=eth_getTransactionByHash(txHash)');
        ok(calls.getBlock === 0 && calls.getTransaction === 0, 'A21 WSS 命中零 dataseed 调用');
        ok(r.stats.wssTxLookups === 1 && r.stats.wssTxResolved === 1 && r.stats.wssTxFallbacks === 0,
            'A21 lookups/resolved 计数、零 fallback');
        ok(r._txFromCache.get('0x21') === '0xwssuser', 'A21 from 反哺 txFrom 缓存（同 tx 后续行零查询）');
        ok(r.kindSync('0xwssuser') === 'eoa' && r.kindSync('0xr21') === null,
            'A21 from 反哺 kind 缓存（合约 trader 不落 kind=语义正确）');
    }

    // A22 WSS result=null（ankr 侧 tx 不存在的极罕见形状）→ 复查 map（往返窗内事件
    //     晚到）lateHits 定值；miss 走 dataseed 块 join（CD377 回退层不破）
    {
        const d = deferred();
        const r = new SenderResolver({ concurrency: 1 }, quietLogger);
        const calls = makeStub(r, { blockOf: () => fullBlock([['0x22', '0xjoin22']]), txOf: () => null });
        r.attachWss(() => d.promise);
        const pushed = [];
        r.submit({ tickRow: row('0x22', 2200), trader: '0xr22', txHash: '0x22', pushRow: (x) => pushed.push(x) });
        await sleep(10);                            // 行挂上 WSS await
        r.setRouterEventUser('0x22', '0xwssLate');  // 往返窗内路由事件进 map
        d.resolve({ result: null });                // ankr 无该 tx
        await sleep(10);
        ok(pushed.length === 1 && pushed[0].sender_address === '0xwsslate', 'A22 WSS null 后复查 map 接住定值');
        ok(r.stats.routerMapLateHits === 1 && r.stats.wssTxFallbacks === 1, 'A22 lateHits 计数、WSS 未定值计 fallback');
        ok(calls.getBlock === 0, 'A22 复查接住零 dataseed（块 join 不触发）');

        // miss 形状：无 map 条目 → 落块 join 回退层照常定值
        const r2 = new SenderResolver({ concurrency: 1 }, quietLogger);
        const calls2 = makeStub(r2, { blockOf: () => fullBlock([['0x22b', '0xjoin22b']]), txOf: () => null });
        r2.attachWss(async () => ({ result: null }));
        const pushed2 = [];
        r2.submit({ tickRow: row('0x22b', 2201), trader: '0xr22b', txHash: '0x22b', pushRow: (x) => pushed2.push(x) });
        await sleep(20);
        ok(pushed2.length === 1 && pushed2[0].sender_address === '0xjoin22b', 'A22b WSS null+复查 miss → dataseed 块 join 定值');
        ok(r2.stats.wssTxFallbacks === 1 && r2.stats.blockJoinRows === 1, 'A22b fallback 后块 join 接棒（CD377 回退层完好）');
    }

    // A23 WSS reject（超时/断连/error 帧）→ 行落 dataseed 块 join 照常定值
    {
        const r = new SenderResolver({ concurrency: 1 }, quietLogger);
        const calls = makeStub(r, { blockOf: () => fullBlock([['0x23', '0xjoin23']]), txOf: () => null });
        r.attachWss(async () => { throw new Error('wss_rpc_timeout'); });
        const pushed = [];
        r.submit({ tickRow: row('0x23', 2300), trader: '0xr23', txHash: '0x23', pushRow: (x) => pushed.push(x) });
        await sleep(20);
        ok(pushed.length === 1 && pushed[0].sender_address === '0xjoin23', 'A23 WSS reject → dataseed 块 join 定值（回退层接住）');
        ok(r.stats.wssTxFallbacks === 1 && calls.getBlock === 1 && r.stats.blockJoinRows === 1,
            'A23 reject 计 fallback、块 join 一次');
    }

    // A23b 连续错误熔断：达阈值进冷却（行直走 dataseed 不再烧 WSS）→ attachWss
    //     重挂清零恢复（重连 open=天然恢复点）
    {
        const r = new SenderResolver({ concurrency: 1, wssErrorBreakerThreshold: 3 }, quietLogger);
        const calls = makeStub(r, { blockOf: () => fullBlock([]), txOf: (h) => ({ from: '0xsingle' + h.slice(2, 5) }) });
        let wssFail = true;
        const wssCalls = [];
        r.attachWss(async () => { wssCalls.push(1); if (wssFail) throw new Error('boom'); return { result: null }; });
        const pushed = [];
        for (let i = 0; i < 3; i++) { // 3 连败 → streak=3 达阈值熔断
            r.submit({ tickRow: row('0x23b' + i, 2310), trader: '0xr23b', txHash: '0x23b' + i, pushRow: (x) => pushed.push(x) });
            await sleep(10);
        }
        ok(r.stats.wssCooldowns === 1 && r._wssCooldownUntil > Date.now(), 'A23b 连续 3 败进熔断');
        r.submit({ tickRow: row('0x23bx', 2311), trader: '0xr23b', txHash: '0x23bx', pushRow: (x) => pushed.push(x) });
        await sleep(20);
        ok(wssCalls.length === 3, 'A23b 熔断期行不再调 WSS（dataseed 单行接住）');
        r.attachWss(async () => ({ result: { from: '0xwssRecovered' } })); // 重挂=清零冷却
        r.submit({ tickRow: row('0x23by', 2312), trader: '0xr23b', txHash: '0x23by', pushRow: (x) => pushed.push(x) });
        await sleep(20);
        ok(pushed.find((x) => x.tx_hash === '0x23by').sender_address === '0xwssrecovered',
            'A23b attachWss 重挂清零冷却恢复 WSS 主路');
        ok(calls.getBlock >= 1 && pushed.length === 5, 'A23b 熔断期 dataseed 回退接住（5 行全定值零丢失）');
    }

    // A24 in-flight 溢出：wssInflightLimit=1 + 挂起查询 → 第 2 行 wssOverflows 直落
    //     dataseed（不排队不等待——WSS 故障窗口回落）
    {
        const d = deferred();
        const r = new SenderResolver({ concurrency: 2, wssInflightLimit: 1 }, quietLogger);
        const calls = makeStub(r, { blockOf: () => fullBlock([['0x24b', '0xjoin24']]), txOf: () => null });
        r.attachWss(() => d.promise);
        const pushed = [];
        r.submit({ tickRow: row('0x24a', 2400), trader: '0xr24', txHash: '0x24a', pushRow: (x) => pushed.push(x) });
        await sleep(10); // 行 1 挂上 WSS（in-flight 1/1）
        r.submit({ tickRow: row('0x24b', 2400), trader: '0xr24', txHash: '0x24b', pushRow: (x) => pushed.push(x) });
        await sleep(10);
        ok(pushed.find((x) => x.tx_hash === '0x24b').sender_address === '0xjoin24',
            'A24 溢出行直落 dataseed 块 join 定值');
        ok(r.stats.wssOverflows === 1 && r.stats.wssTxFallbacks === 1, 'A24 溢出计数+fallback 计数');
        d.resolve({ result: { from: '0xwss24' } });
        await sleep(10);
        ok(pushed.find((x) => x.tx_hash === '0x24a').sender_address === '0xwss24', 'A24 挂起行恢复后 WSS 定值');
    }

    // A25 per-tx in-flight join：同 tx 两行（不同 trader）共享一次查询
    {
        const r = new SenderResolver({ concurrency: 2 }, quietLogger);
        makeStub(r, { blockOf: () => { throw new Error('不应拉块'); }, txOf: () => { throw new Error('不应单行'); } });
        let wssCalls = 0;
        const d = deferred();
        r.attachWss(() => { wssCalls++; return d.promise; });
        const pushed = [];
        r.submit({ tickRow: row('0x25', 2500), trader: '0xr25a', txHash: '0x25', pushRow: (x) => pushed.push(x) });
        r.submit({ tickRow: row('0x25', 2500), trader: '0xr25b', txHash: '0x25', pushRow: (x) => pushed.push(x) });
        await sleep(10);
        d.resolve({ result: { from: '0xwss25' } });
        await sleep(10);
        ok(wssCalls === 1, 'A25 同 tx 两行共享一次 WSS 查询（in-flight join）');
        ok(pushed.length === 2 && pushed.every((x) => x.sender_address === '0xwss25'),
            'A25 两行同 sender 定值（查询后 in-flight 表自清）');
        ok(r.stats.wssTxLookups === 1 && r.stats.wssTxResolved === 2, 'A25 lookups=1/resolved=2');
        ok(r._wssTxInflight.size === 0, 'A25 完成后 in-flight 表清空');
    }

    // A26 熔断期行直接跳过 WSS 层：不计数 lookups/fallbacks（层关=CD377 行为）
    {
        const r = new SenderResolver({ concurrency: 1 }, quietLogger);
        const calls = makeStub(r, { blockOf: () => fullBlock([['0x26', '0xjoin26']]), txOf: () => null });
        r.attachWss(async () => ({ result: { from: '0xnever' } }));
        r._wssCooldownUntil = Date.now() + 60000; // 手动置熔断态
        const pushed = [];
        r.submit({ tickRow: row('0x26', 2600), trader: '0xr26', txHash: '0x26', pushRow: (x) => pushed.push(x) });
        await sleep(20);
        ok(pushed[0].sender_address === '0xjoin26' && calls.getBlock === 1, 'A26 熔断期行走 dataseed 块 join');
        ok(r.stats.wssTxLookups === 0 && r.stats.wssTxFallbacks === 0, 'A26 熔断期不计 lookups/fallbacks（层关语义）');
    }

    // A27 未注入 wssFn（单测/未接线形态）→ WSS 层天然跳过 = CD377 行为 bit 一致
    {
        const r = new SenderResolver({ concurrency: 1 }, quietLogger);
        makeStub(r, { blockOf: () => fullBlock([['0x27', '0xjoin27']]), txOf: () => null });
        const pushed = [];
        r.submit({ tickRow: row('0x27', 2700), trader: '0xr27', txHash: '0x27', pushRow: (x) => pushed.push(x) });
        await sleep(20);
        ok(pushed[0].sender_address === '0xjoin27' && r.stats.blockJoinRows === 1, 'A27 无 wssFn 块 join 照常（存量路径）');
        ok(r.stats.wssTxLookups === 0 && r.stats.wssTxResolved === 0 && r.stats.wssTxFallbacks === 0
            && r.stats.wssOverflows === 0 && r.stats.wssCooldowns === 0, 'A27 WSS 五键全零（未注入零影响）');
    }
}

// ═══════════════ B 节：collector 分流接线 ═══════════════

async function testB() {
    console.log('\nB. 两 collector 分流接线');

    const { FourMemeAnkrWsCollector } = require('../src/collectors/fourmeme-ankr-ws-collector.js');
    const { FlapAnkrWsCollector } = require('../src/collectors/flap-ankr-ws-collector.js');

    const decodedFm = (tx) => ({
        token: '0xtoken', tradeType: 'buy', trader: '0xtrader', priceBnb: 0.001,
        tokenAmount: 1000, bnbAmount: 1, offers: 10, fundsBnb: 5,
        blockNumber: 100, blockTimeMs: 1700000000000, txHash: tx, logIndex: 0,
    });
    const decodedFlap = (tx) => ({
        token: '0xtoken', tradeType: 'buy', trader: '0xtrader', priceBnb: 0.001,
        tokenAmount: 1000, bnbAmount: 1,
        blockNumber: 100, blockTimeMs: 1700000000000, txHash: tx, logIndex: 0,
    });

    for (const [name, Ctor, cfgKey, decoded] of [
        ['fourmeme', FourMemeAnkrWsCollector, 'fourmemeWs', decodedFm],
        ['flap', FlapAnkrWsCollector, 'flapWs', decodedFlap],
    ]) {
        // B1 无 resolver（默认第 6 参 null）→ 旧路径：sender_address=null 直进 buffer
        {
            const c = new Ctor({ [cfgKey]: {} }, quietLogger);
            c._emitTick(decoded('0xb1'));
            ok(c._tickBuffer.length === 1, `B1[${name}] 无 resolver 直进 buffer`);
            ok(c._tickBuffer[0].sender_address === null && c.stats.ticksBuffered === 1, `B1[${name}] 旧路径 sender_address=null`);
        }

        // B2 stub resolver：submit 被调 + 行未回推不进 buffer；回推后进 buffer
        {
            const c = new Ctor({ [cfgKey]: {} }, quietLogger, null, null, {}, {});
            const got = [];
            c._senderResolver = { submit: (p) => got.push(p) };
            c._emitTick(decoded('0xb2'));
            ok(got.length === 1 && got[0].trader === '0xtrader' && got[0].txHash === '0xb2', `B2[${name}] resolver.submit 收到 trader/txHash`);
            ok(c._tickBuffer.length === 0, `B2[${name}] 未回推不进 buffer（延迟入 buffer）`);
            got[0].tickRow.sender_address = '0xreal';
            got[0].pushRow(got[0].tickRow);
            ok(c._tickBuffer.length === 1 && c._tickBuffer[0].sender_address === '0xreal', `B2[${name}] 回推经 _pushTickRow 进 buffer`);
        }

        // B3 EOA 快路同步回推 + FA price_outlier 回写时序（对象引用在 flush 前回写）
        {
            const c2 = new Ctor({ [cfgKey]: {} }, quietLogger);
            c2._senderResolver = {
                submit: (p) => { p.tickRow.sender_address = p.trader; p.pushRow(p.tickRow); }, // EOA 快路同步回推
            };
            c2._factorAggregator = { processTick: () => ({ priceOutlier: true }), applyWalletTick: () => ({}), registerToken: () => {} };
            c2._minTickBnb = 0;
            c2._emitTick(decoded('0xb3'));
            ok(c2._tickBuffer.length === 1, `B3[${name}] EOA 快路同步进 buffer`);
            ok(c2._tickBuffer[0].price_outlier === true, `B3[${name}] FA outlier 回写在 flush 前生效（对象引用机制）`);
            ok(c2._tickBuffer[0].sender_address === '0xtrader', `B3[${name}] 快路 sender=trader`);
        }

        // B5 resolver 慢路两阶段喂食（2026-10-14 鸡蛋案改造）：emitTick 即喂价格段
        //    （deferWallet，零回查依赖——fire 价不被 RPC 回查延迟污染）；wallet 段等回推：
        //    未回推 applyWalletTick 零调用；回推后收到已定值 sender（钱包口径 sender||trader）
        {
            const c = new Ctor({ [cfgKey]: {} }, quietLogger);
            const got = [];
            c._senderResolver = { submit: (p) => got.push(p) };
            const faFeeds = [];
            const walletFeeds = [];
            c._factorAggregator = {
                processTick: (t, opts) => faFeeds.push({ t, opts }),
                applyWalletTick: (t) => walletFeeds.push(t),
                registerToken: () => {},
            };
            c._minTickBnb = 0;
            c._emitTick(decoded('0xb5'));
            ok(got.length === 1 && faFeeds.length === 1 && faFeeds[0].opts.deferWallet === true, `B5[${name}] 价格段 emitTick 即喂（deferWallet 透传）`);
            ok(walletFeeds.length === 0, `B5[${name}] 未回推 wallet 段零调用`);
            got[0].tickRow.sender_address = '0xresolved';
            got[0].pushRow(got[0].tickRow);
            ok(walletFeeds.length === 1 && walletFeeds[0].sender_address === '0xresolved' && walletFeeds[0].trader_address === '0xtrader', `B5[${name}] 回推后 wallet 段收已解析 sender`);
            ok(c._tickBuffer.length === 1, `B5[${name}] 回推行进 buffer`);
        }

        // B6 直推路径（无 resolver）FA 收 sender_address=null（回退 trader = 旧 collector 行为）
        {
            const c = new Ctor({ [cfgKey]: {} }, quietLogger);
            const faTicks = [];
            c._factorAggregator = { processTick: (t) => faTicks.push(t), registerToken: () => {} };
            c._minTickBnb = 0;
            c._emitTick(decoded('0xb6'));
            ok(faTicks.length === 1 && faTicks[0].sender_address === null, `B6[${name}] 直推 FA sender=null`);
        }

        // B7 尘 tick（< minTickBnb）不喂 FA，仍照常落 buffer
        {
            const c = new Ctor({ [cfgKey]: {} }, quietLogger);
            const faTicks = [];
            c._factorAggregator = { processTick: (t) => faTicks.push(t), registerToken: () => {} };
            c._minTickBnb = 2; // decoded.bnbAmount=1 < 2 → 尘 tick
            c._emitTick(decoded('0xb7'));
            ok(faTicks.length === 0 && c._tickBuffer.length === 1, `B7[${name}] 尘 tick 不喂 FA 仍落 buffer`);
        }

        // B9 _onTickBuffered 钩子（TPA live 缓冲，pumpfun 同款）：push 后同步触发，行引用=buffer 行
        {
            const c = new Ctor({ [cfgKey]: {} }, quietLogger);
            const hooked = [];
            c._onTickBuffered = (r) => hooked.push(r);
            c._emitTick(decoded('0xb9'));
            ok(hooked.length === 1 && hooked[0] === c._tickBuffer[0] && hooked[0].sender_address === null, `B9[${name}] _onTickBuffered 同步触发（行引用=buffer 行）`);
        }

        // B10 registerToken meta 带 platform 键（直喂 FA 后路由门/毕业锚维度自带，此前由 consumer 注入）
        {
            const c = new Ctor({ [cfgKey]: {} }, quietLogger);
            let meta = null;
            c._factorAggregator = { processTick: () => ({}), registerToken: (_t, m) => { meta = m; } };
            c._handleTokenCreate({ creator: '0xc', token: '0xt', name: 'n', symbol: 's', totalSupply: 1e9, blockTimeMs: 1700000000000, blockNumber: 1, txHash: '0xz' });
            ok(meta && meta.platform === name, `B10[${name}] registerToken meta.platform=${name}`);
        }
    }

    // B8 fourmeme FA tick 刻意不含 offers/funds_bnb（对齐 DB 行/回测口径：行无这两列
    //    这两列 tvl 恒 0——直连恢复后若重新传入会造成虚拟/回测 tvl 因子分叉）
    {
        const c = new FourMemeAnkrWsCollector({ fourmemeWs: {} }, quietLogger);
        const faTicks = [];
        c._factorAggregator = { processTick: (t) => faTicks.push(t), registerToken: () => {} };
        c._minTickBnb = 0;
        c._emitTick(decodedFm('0xb8'));
        ok(faTicks.length === 1 && !('offers' in faTicks[0]) && !('funds_bnb' in faTicks[0]), 'B8[fourmeme] FA tick 无 offers/funds_bnb（tvl 口径对齐回测）');
    }

    // B4 resolver 停机竞态口径：stop 后到货（kind 未知，需回查才能定）→ NULL 直推保行；
    //    kind 已知 EOA 的行不受 stopped 影响（快路零资源，同步直推 sender=trader）
    {
        const r = new SenderResolver({}, quietLogger);
        await r.stop();
        const pushed = [];
        r.submit({ tickRow: row('0xb4', 1), trader: '0xunknownX', txHash: '0xb4', pushRow: (x) => pushed.push(x) });
        ok(pushed.length === 1 && pushed[0].sender_address === null, 'B4 stop 后到货（kind 未知）NULL 直推不丢行');
        r._cacheKind('0xeoay', 'eoa');
        r.submit({ tickRow: row('0xb4b', 1), trader: '0xeoay', txHash: '0xb4b', pushRow: (x) => pushed.push(x) });
        ok(pushed.length === 2 && pushed[1].sender_address === '0xeoay', 'B4 stop 后 EOA 快路仍直推（零资源不受 stopped 影响）');
    }
}

// ═══════════════ B11 节：router-events 纯函数（聚合路由事件 → 用户 EOA，CD376 扩 5 源） ═══════════════

function testB11() {
    console.log('\nB11. router-events 纯函数（extractRouterEventUsers：topics 槽位 + data 字位双解码）');
    const {
        ROUTER_EVENT_SUBSCRIPTION, ROUTER_SWAP_TOPIC0, ROUTER_FEE_TOPIC0, GMGN_ROUTER_ADDRESS,
        ROUTER_EVENT_SOURCE_ADDRS, ROUTER_EVENT_TOPIC0_WHITELIST, ROUTER_EVENT_SPECS, extractRouterEventUsers,
    } = require('../src/collectors/router-events.js');

    const pad = (addr) => '0x' + '0'.repeat(24) + addr.toLowerCase().replace(/^0x/, '');
    // CD376 五新源地址（链上事实字面量——B11.1 集合锁的期望值，防手滑改错）
    const R3508 = '0x3508dca95a64c9378cb07ef6f40553a50905372a';
    const R01A2 = '0x01a21c857a3219991fba2b1a2824b1b758966b54';
    const RD36B = '0xd36b6d646ac6e23672e9eedec558164c7f2d6deb';
    const R296B = '0x296b00198dc7ec3410e12da814d9267bb8df506a';
    const FRONT5994 = '0x5994814f2c4040b863a0125a45de152a8c2a4dec';
    const ANON20EF = '0x20efd6d5195b7b50273f01cd79a27989255356f9f13293edc53ee142accfdb75';
    const FRONT_T0 = '0x1bb43f2da90e35f7b0cf38521ca95a49e68eb42fac49924930a5bd73cdf7576c';
    // 2026-11-05 链上真实样本（tx.from 对拍通过的 data 原文）
    const D36B_REAL_DATA = '0x'
        + '00000000000000000000000061794894c83de847818304f24347dea2eeb79728' // word0 用户 EOA
        + '0000000000000000000000000f93636f10fbb4820f2c2f241d167c287041b190' // word1 tokenIn（非地址形状，不在候选序）
        + '00000000000000000000000055d398326f99059ff775485246999027b3197955' // word2 tokenOut（USDT，地址形状——候选序刻意跳过）
        + '00000000000000000000000061794894c83de847818304f24347dea2eeb79728' // word3 receiver（恒同 word0）
        + '0000000000000000000000000000000000000000000000002498ab8899a9d582' // word4 amountIn
        + '000000000000000000000000000000000000000000000001cf7e7c6723b34623'; // word5 amountOut
    const FRONT5994_REAL_DATA = '0x'
        + '000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' // word0 tokenIn=原生 BNB 哨兵（右对齐：高 12 字节零过朴素门、低 20 字节恒 e 被哨兵排除挡住）
        + '0000000000000000000000004ebef4c08386b2b4a37aa2d056f26160573b7777' // word1 tokenOut（flap token 尾 7777，地址形状——候选序单槽刻意不取）
        + '0000000000000000000000004362c9a9615bd6bc2fbdbf49ff2a90679672a3e6' // word2 用户 EOA（唯一候选槽位）
        + '000000000000000000000000000000000000000000000000000388f27d8d3000' // word3 amount
        + '000000000000000000000000000000000000000000000c9199d63409dca22f64'; // word4 amountOut
    const word = (hex64) => hex64; // 可读性别名
    const wUser = '00000000000000000000000061794894c83de847818304f24347dea2eeb79728';
    const wAmount = '2498ab8899a9d582000000000000000000000000000000000000000000000000'; // 高位金额（高 12 字节非零 → 必不过形状门）
    const wSentinel = '000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'; // 右对齐 0xEeee…×40 哨兵 word

    // B11.1 订阅形状内容锁（C6 只锁 collector 侧字面量，本节是源表唯一内容锁——改漏无人报警）
    {
        const expectedSrcs = [GMGN_ROUTER_ADDRESS, R3508, R01A2, RD36B, R296B, FRONT5994];
        const sub = ROUTER_EVENT_SUBSCRIPTION;
        ok(sub.address.length === 6 && sub.address[0] === GMGN_ROUTER_ADDRESS
            && JSON.stringify([...sub.address].sort()) === JSON.stringify([...expectedSrcs].sort()),
            'B11.1 订阅 address=6 源集合（GMGN/3508/01a2/d36b/296b/5994 前置），GMGN 居首');
        ok(sub.topics[0].length === 7 && sub.topics[0].includes(ROUTER_SWAP_TOPIC0) && sub.topics[0].includes(ROUTER_FEE_TOPIC0)
            && sub.topics[0].includes(ANON20EF) && sub.topics[0].includes(FRONT_T0)
            && JSON.stringify([...sub.topics[0]].sort()) === JSON.stringify([...ROUTER_EVENT_TOPIC0_WHITELIST].sort()),
            'B11.1 topic0 白名单=7 值（swap+fee+01a2 三值+20ef+1bb4）');
        ok(GMGN_ROUTER_ADDRESS === '0x1de460f363af910f51726def188f9004276bf4bc', 'B11.1 GMGN 路由地址与链上实证一致');
        ok(ROUTER_EVENT_SOURCE_ADDRS.every((a) => ROUTER_EVENT_SPECS[a] && Object.keys(ROUTER_EVENT_SPECS[a]).length > 0)
            && Object.keys(ROUTER_EVENT_SPECS).length === ROUTER_EVENT_SOURCE_ADDRS.length,
            'B11.1 SPECS 双键表与订阅源一一对应（无孤儿源/无漏表项）');
        const specced = new Set();
        for (const byAddr of Object.values(ROUTER_EVENT_SPECS)) for (const t of Object.keys(byAddr)) specced.add(t);
        ok(ROUTER_EVENT_TOPIC0_WHITELIST.every((t) => specced.has(t)) && specced.size === ROUTER_EVENT_TOPIC0_WHITELIST.length,
            'B11.1 白名单与 SPECS 值域一致（无死值/无漏订）');
    }

    // B11.2 Swap 形状：topics[1]+[2] 均=用户（左填充 32 字节剥成 20 字节小写）
    {
        const u1 = pad('0xAa11aa22aa33aa44aa55aa66aa77aa88aa99AA11');
        const u2 = pad('0xBb22bb33bb44bb55bb66bb77bb88bb99bb00BB22');
        const got = extractRouterEventUsers({ address: GMGN_ROUTER_ADDRESS, topics: [ROUTER_SWAP_TOPIC0, u1, u2], transactionHash: '0xTXA' });
        ok(got && got.txHash === '0xtxa' && got.users.length === 2
            && got.users[0] === '0x' + u1.slice(26) && got.users[1] === '0x' + u2.slice(26),
            'B11.2 Swap 双地址全提取（txHash lowercase、topic 剥 padding 小写带 0x）');
    }

    // B11.3 FeeCollected 形状：只取 topics[2]（topics[1]=收费方刻意不取）
    {
        const collector = pad('0xCC33cc44cc55cc66cc77cc88cc99cc00cc11CC33');
        const user = pad('0xDD44dd55dd66dd77dd88dd99dd00dd11dd22DD44');
        const got = extractRouterEventUsers({ address: GMGN_ROUTER_ADDRESS, topics: [ROUTER_FEE_TOPIC0, collector, user], transactionHash: '0xTXB' });
        ok(got && got.users.length === 1 && got.users[0] === '0x' + user.slice(26),
            'B11.3 FeeCollected 只取 topics[2]=用户（收费方不冒充用户）');
    }

    // B11.4 未知组合 / 缺字段 → null（fail-safe：绝不从 data 猜地址）
    ok(extractRouterEventUsers({ address: GMGN_ROUTER_ADDRESS, topics: ['0xdeadbeef', pad('0xaaaa'), pad('0xbbbb')], transactionHash: '0xTXC' }) === null,
        'B11.4 未知 topic0 不消费');
    ok(extractRouterEventUsers({ address: GMGN_ROUTER_ADDRESS, topics: [ROUTER_SWAP_TOPIC0] }) === null, 'B11.4 缺 transactionHash → null');
    ok(extractRouterEventUsers({ address: GMGN_ROUTER_ADDRESS, topics: [ROUTER_SWAP_TOPIC0, pad('0xaaaa')], transactionHash: '0xTXD' }) !== null,
        'B11.4 Swap 单 indexed 地址（缺 topics[2]）仍取 topics[1]');
    ok(extractRouterEventUsers(null) === null && extractRouterEventUsers({}) === null, 'B11.4 空形状 → null');
    ok(extractRouterEventUsers({ topics: [ROUTER_SWAP_TOPIC0, pad('0xaaaa'), pad('0xbbbb')], transactionHash: '0xTXE' }) === null,
        'B11.4 缺 address → null（双键查表必需，不回退单键防跨源撞车洞）');

    // B11.5 3508 与 GMGN 完全同款：同一事件两地址 decode 输出全等
    {
        const u1 = pad('0xAa11aa22aa33aa44aa55aa66aa77aa88aa99AA11');
        const u2 = pad('0xBb22bb33bb44bb55bb66bb77bb88bb99bb00BB22');
        const g1 = extractRouterEventUsers({ address: GMGN_ROUTER_ADDRESS, topics: [ROUTER_SWAP_TOPIC0, u1, u2], transactionHash: '0xTXF' });
        const g2 = extractRouterEventUsers({ address: R3508, topics: [ROUTER_SWAP_TOPIC0, u1, u2], transactionHash: '0xTXF' });
        const feeUser = pad('0xDD44dd55dd66dd77dd88dd99dd00dd11dd22DD44');
        const g3 = extractRouterEventUsers({ address: R3508, topics: [ROUTER_FEE_TOPIC0, pad('0xcc33cc44cc55cc66cc77cc88cc99cc00cc11cc33'), feeUser], transactionHash: '0xTXG' });
        ok(JSON.stringify(g1) === JSON.stringify(g2) && g2 && g2.users.length === 2,
            'B11.5 3508 Swap 同款 decode=GMGN 同输出（同 topic0 双槽）');
        ok(g3 && g3.users.length === 1 && g3.users[0] === '0x' + feeUser.slice(26),
            'B11.5 3508 FeeCollected 同款只取 topics[2]');
    }

    // B11.6 01a2 三事件均 topics[1]=用户（单槽，缺 topics[2] 形状常态）
    {
        const t0s = ROUTER_EVENT_TOPIC0_WHITELIST.filter((t) => t !== ROUTER_SWAP_TOPIC0 && t !== ROUTER_FEE_TOPIC0 && t !== ANON20EF && t !== FRONT_T0);
        ok(t0s.length === 3, 'B11.6 01a2 三 topic0 在白名单中（另 4 值为 GMGN/3508/20ef/1bb4）');
        const u = pad('0xEe55ee66ee77ee88ee99ee00ee11ee22ee33EE44');
        for (const t0 of t0s) {
            const got = extractRouterEventUsers({ address: R01A2, topics: [t0, u], transactionHash: '0xTXH' });
            ok(got && got.users.length === 1 && got.users[0] === '0x' + u.slice(26),
                `B11.6 01a2 事件 ${t0.slice(2, 8)}… topics[1]=用户单提取`);
        }
    }

    // B11.7 d36b/296b 匿名事件 data 解码（候选序 [0,3]：word0 主、word3 receiver 备；token 槽位刻意不取）
    {
        for (const [name, addr] of [['d36b', RD36B], ['296b', R296B]]) {
            const got = extractRouterEventUsers({ address: addr, topics: [ANON20EF], data: D36B_REAL_DATA, transactionHash: '0xTXI' });
            ok(got && got.users.length === 1 && got.users[0] === '0x61794894c83de847818304f24347dea2eeb79728',
                `B11.7 ${name} 真实样本 data → word0 用户单提取（word1/2=token 槽位地址形状刻意跳过）`);
        }
        // word0 塞金额形状（高 24 字节非零）→ 落 word3（receiver 恒同 word0）
        const amtFirst = '0x' + word(wAmount) + word(wUser) + word(wUser) + word(wUser) + word(wAmount) + word(wAmount);
        const gotAmt = extractRouterEventUsers({ address: RD36B, topics: [ANON20EF], data: amtFirst, transactionHash: '0xTXJ' });
        ok(gotAmt && gotAmt.users.length === 1 && gotAmt.users[0] === '0x61794894c83de847818304f24347dea2eeb79728',
            'B11.7 word0 金额形状（前缀非零）→ 候选序落 word3 receiver');
        // word0/3 均坏（金额+全零）→ null
        const bothBad = '0x' + word(wAmount) + word(wUser) + word(wUser) + '0'.repeat(64) + word(wAmount) + word(wAmount);
        ok(extractRouterEventUsers({ address: RD36B, topics: [ANON20EF], data: bothBad, transactionHash: '0xTXK' }) === null,
            'B11.7 word0 金额形状+word3 全零 → 候选全坏 null 不冒充');
        // word0=0xEeee 哨兵 + word3=用户 → 取 word3（哨兵不冒充用户）
        const sentFirst = '0x' + word(wSentinel) + word(wUser) + word(wUser) + word(wUser) + word(wAmount) + word(wAmount);
        const gotSent = extractRouterEventUsers({ address: R296B, topics: [ANON20EF], data: sentFirst, transactionHash: '0xTXL' });
        ok(gotSent && gotSent.users.length === 1 && gotSent.users[0] === '0x61794894c83de847818304f24347dea2eeb79728',
            'B11.7 word0=0xEeee 原生哨兵 → 形状门排除、落 word3 用户');
        // word0=哨兵 + word3=哨兵 → null（两哨兵都不冒充）
        const sentBoth = '0x' + word(wSentinel) + word(wUser) + word(wUser) + word(wSentinel) + word(wAmount) + word(wAmount);
        ok(extractRouterEventUsers({ address: R296B, topics: [ANON20EF], data: sentBoth, transactionHash: '0xTXM' }) === null,
            'B11.7 word0/3 均 0xEeee 哨兵 → null（哨兵恒不冒充用户）');
        // data 缺失 / 非_string / 截短 → null
        ok(extractRouterEventUsers({ address: RD36B, topics: [ANON20EF], transactionHash: '0xTXN' }) === null,
            'B11.7 data kind 缺 data → null');
        ok(extractRouterEventUsers({ address: RD36B, topics: [ANON20EF], data: D36B_REAL_DATA.slice(0, 65), transactionHash: '0xTXO' }) === null,
            'B11.7 data 截短（差一位不足 word0）→ null');
    }

    // B11.8 5994 前置合约 data word2（0x168303 路由的恒定 tx.to 中介——两清单防混见 CD376）
    {
        const got = extractRouterEventUsers({ address: FRONT5994, topics: [FRONT_T0], data: FRONT5994_REAL_DATA, transactionHash: '0xTXP' });
        ok(got && got.users.length === 1 && got.users[0] === '0x4362c9a9615bd6bc2fbdbf49ff2a90679672a3e6',
            'B11.8 5994 真实样本 data → word2 用户（word0=0xEeee 哨兵被形状门排除）');
        ok(extractRouterEventUsers({ address: FRONT5994, topics: [FRONT_T0], data: FRONT5994_REAL_DATA.slice(0, 2 + 2 * 64), transactionHash: '0xTXQ' }) === null,
            'B11.8 data 截短（word2 不足）→ null');
        // word2 换金额形状 → null（唯一候选坏不冒充）
        const amtW2 = '0x' + word(wSentinel) + word(wUser) + word(wAmount) + word(wAmount) + word(wAmount);
        ok(extractRouterEventUsers({ address: FRONT5994, topics: [FRONT_T0], data: amtW2, transactionHash: '0xTXR' }) === null,
            'B11.8 word2 金额形状 → 唯一候选坏 null');
    }

    // B11.9 跨源撞车防线：双键 (address,topic0) 组合外一律 null
    ok(extractRouterEventUsers({ address: GMGN_ROUTER_ADDRESS, topics: [ANON20EF], data: D36B_REAL_DATA, transactionHash: '0xTXS' }) === null,
        'B11.9 20ef × GMGN 地址 → null（GMGN 表无此 topic0）');
    ok(extractRouterEventUsers({ address: RD36B, topics: [ROUTER_SWAP_TOPIC0, pad('0xaaaa'), pad('0xbbbb')], transactionHash: '0xTXT' }) === null,
        'B11.9 swap topic0 × d36b 地址 → null（d36b 表无 swap）');
    ok(extractRouterEventUsers({ address: '0x9999999999999999999999999999999999999999', topics: [ROUTER_SWAP_TOPIC0, pad('0xaaaa'), pad('0xbbbb')], transactionHash: '0xTXU' }) === null,
        'B11.9 已知 topic0 × 表外地址 → null');
    ok(extractRouterEventUsers({ address: FRONT5994, topics: [ANON20EF], data: D36B_REAL_DATA, transactionHash: '0xTXV' }) === null,
        'B11.9 20ef × 5994 地址 → null（同签名不同源不复用）');
}

// ═══════════════ B12 节：collector 通用 WSS 请求通道（CD378 _rpcRequest） ═══════════════

async function testB12() {
    console.log('\nB12. 三 collector _rpcRequest 通道（请求/应答/仲裁/断连 reject）');
    const { FourMemeAnkrWsCollector } = require('../src/collectors/fourmeme-ankr-ws-collector.js');
    const { FlapAnkrWsCollector } = require('../src/collectors/flap-ankr-ws-collector.js');
    const { GangAnkrWsCollector } = require('../src/collectors/gang-ankr-ws-collector.js');

    // stub ws：readyState=OPEN(1) + send 捕获出站帧（不真连）
    const OPEN = 1;
    const mk = (Ctor, cfg) => {
        const c = new Ctor(cfg, quietLogger, null, null, {}, {});
        const sent = [];
        c._ws = { readyState: OPEN, send: (raw) => sent.push(JSON.parse(raw)) };
        return { c, sent };
    };
    const cfgs = [
        ['fourmeme', FourMemeAnkrWsCollector, { fourmemeWs: {} }],
        ['flap', FlapAnkrWsCollector, { flapWs: {} }],
        ['gang', GangAnkrWsCollector, { gangWs: { contracts: { launchpadV2: '0x1B8F0ICIdumMyFAKEaddr0000000000966E'.toLowerCase() } } }],
    ];

    for (const [name, Ctor, cfg] of cfgs) {
        // B12.1 应答分派：发请求 → 同 id 应答帧 → resolve 整帧；id≥100 发号
        {
            const { c, sent } = mk(Ctor, cfg);
            const p = c._rpcRequest('eth_getTransactionByHash', ['0xtx1']);
            ok(sent.length === 1 && sent[0].method === 'eth_getTransactionByHash' && sent[0].id >= 100,
                `B12.1[${name}] 出站帧带 method+id≥100（jsonrpc 形状）`);
            c._onMessage(JSON.stringify({ jsonrpc: '2.0', id: sent[0].id, result: { from: '0xa', hash: '0xtx1' } }));
            const msg = await p;
            ok(msg.result.from === '0xa', `B12.1[${name}] 同 id 应答 resolve 整帧`);
            ok(c._rpcPending.size === 0 && c.stats.wssRpcRequests === 1 && c.stats.wssRpcErrors === 0,
                `B12.1[${name}] 应答后表清、计数正确`);
        }

        // B12.2 error 帧 reject（429/方法不存在等）
        {
            const { c, sent } = mk(Ctor, cfg);
            const p = c._rpcRequest('eth_getTransactionByHash', ['0xtx2']);
            c._onMessage(JSON.stringify({ jsonrpc: '2.0', id: sent[0].id, error: { code: -32000, message: 'limit exceeded' } }));
            await assert.rejects(p, /wss_rpc_error/, `B12.2[${name}] error 帧 reject`);
            ok(c.stats.wssRpcErrors === 1 && c._rpcPending.size === 0, `B12.2[${name}] 失败计数+表清`);
        }

        // B12.3 超时 reject + 表清（timer 不泄漏）
        {
            const { c } = mk(Ctor, cfg);
            await assert.rejects(c._rpcRequest('eth_getTransactionByHash', ['0xtx3'], 5), /wss_rpc_timeout/,
                `B12.3[${name}] 超时 reject`);
            ok(c._rpcPending.size === 0, `B12.3[${name}] 超时后表清`);
        }

        // B12.4 非 OPEN reject（连接未建/已断）
        {
            const c = new Ctor(cfg, quietLogger, null, null, {}, {});
            await assert.rejects(c._rpcRequest('eth_getTransactionByHash', ['0xtx4']), /wss_not_open/,
                `B12.4[${name}] 非 OPEN 立即 reject`);
        }

        // B12.5 断连全表 reject：挂 2 个 in-flight → _scheduleReconnect → 全部
        //      wss_connection_closed（不 reject=Promise 挂死到 8s 超时）
        {
            const { c, sent } = mk(Ctor, cfg);
            const p1 = c._rpcRequest('eth_getTransactionByHash', ['0xtx5'], 60000);
            const p2 = c._rpcRequest('eth_getTransactionByHash', ['0xtx6'], 60000);
            c._ws = null; // _scheduleReconnect 自身会摘 ws——先置 null 模拟摘除后状态
            c._scheduleReconnect();
            clearTimeout(c._reconnectTimer); // 测试不留重连定时器（不真连）
            c._reconnectTimer = null;
            await assert.rejects(p1, /wss_connection_closed/, `B12.5[${name}] 断连 reject in-flight 1`);
            await assert.rejects(p2, /wss_connection_closed/, `B12.5[${name}] 断连 reject in-flight 2`);
            ok(c._rpcPending.size === 0 && c.stats.wssRpcErrors >= 2, `B12.5[${name}] 全表 reject+清空`);
            ok(sent.length === 2, `B12.5[${name}] 两请求都已出站（reject 非静默丢弃）`);
        }

        // B12.6 id≥100 分派仲裁：旧表 blockTime 优先（fire-and-forget 先例不动），
        //      同 id 双登记不误入 _rpcPending
        {
            const { c } = mk(Ctor, cfg);
            let blockTimeCalled = 0;
            c._onBlockTimeResponse = () => { blockTimeCalled++; };
            const id = c._rpcId++;
            c._blockTimeRequests.set(id, 4321);              // 模拟在途 blockTime 兜底请求
            const entry = { resolve: () => {}, reject: () => {}, timer: null }; // 同 id 也挂 rpc 表
            c._rpcPending.set(id, entry);
            c._onMessage(JSON.stringify({ jsonrpc: '2.0', id, result: { timestamp: '0x65bd4b40' } }));
            ok(blockTimeCalled === 1 && c._rpcPending.size === 1,
                `B12.6[${name}] 旧表优先命中走 blockTime（rpcPending 同 id 不被消费）`);
        }

        // B12.7 stop 残余 in-flight reject（stop 不走 _scheduleReconnect——listeners 已摘）
        {
            const { c } = mk(Ctor, cfg);
            const p = c._rpcRequest('eth_getTransactionByHash', ['0xtx7'], 60000);
            c._ws = null; // 摘除 ws（真进程=removeAllListeners+close；此处只测 rpcPending 清理）
            await c.stop();
            await assert.rejects(p, /wss_stopped/, `B12.7[${name}] stop reject 残余 in-flight（无 8s 挂死）`);
            ok(c._rpcPending.size === 0, `B12.7[${name}] stop 后表清`);
        }
    }
}

// ═══════════════ C 节：源码口径防回归 ═══════════════

function testC() {
    console.log('\nC. 源码口径防回归（grep 断言）');
    const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

    const fm = read('src/collectors/fourmeme-ankr-ws-collector.js');
    const fl = read('src/collectors/flap-ankr-ws-collector.js');
    for (const [name, src] of [['fourmeme', fm], ['flap', fl]]) {
        ok(src.includes('sender_address: null'), `C1[${name}] tickRow 显式 sender_address 占位`);
        ok(/this\._senderResolver\.submit\(\{/.test(src), `C1[${name}] _emitTick 走 resolver.submit 分流`);
        ok(/const priceFa = this\._feedFa\(decoded, tickRow, priceUsd, \{ deferWallet: true \}\);/.test(src), `C1[${name}] resolver 分支价格段先喂（deferWallet 两阶段，先于 submit）`);
        ok(/pushRow: \(row\) => \{ this\._feedWallet\(decoded, row, priceUsd, priceFa\); this\._pushTickRow\(row\); \}/.test(src), `C1[${name}] pushRow 回推统一经 _feedWallet→_pushTickRow（sender 定值后补 wallet 段再进 buffer）`);
        ok(/sender_address: tickRow\.sender_address \|\| null/.test(src), `C1[${name}] _feedFA 钱包口径 sender||trader`);
        ok(/constructor\(config, logger, tokenPool = null, factorAggregator = null, callbacks = \{\}, senderResolver = null\)/.test(src), `C1[${name}] 构造第 6 参 senderResolver`);
    }

    // C2（直连架构：watcher 2026-10-09 废除，断言对象 = 引擎 _createCollectors/stop）
    const eng = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
    ok(/this\._senderResolver = new SenderResolver\(senderCfg, this\.logger\);/.test(eng), 'C2 引擎构造共享 SenderResolver（enabled===true 门内）');
    ok(eng.includes('senderCfg && senderCfg.enabled === true'), 'C2 enabled===true 才构造（缺段零变化）');
    ok(/this\._senderResolver,\s*\);/.test(eng), 'C2 collector 构造末参传共享 resolver（per-platform 循环内单实例）');
    const resolverStopIdx = eng.indexOf('await this._senderResolver.stop()');
    const writerStopIdx = eng.indexOf('await this._eventWriter.stop()');
    const collStopIdx = eng.indexOf('await c.stop()');
    ok(writerStopIdx > 0 && resolverStopIdx > writerStopIdx && collStopIdx > resolverStopIdx,
        'C2 stop 顺序 eventWriter → senderResolver → collectors（回推行进 buffer 再 flush）');
    ok(eng.includes('senderResolver: this._senderResolver ? this._senderResolver.getStats() : null'), 'C2 getStats 带 senderResolve stats');

    // C5（2026-11-04 块预取 join + 路由事件映射 + per-token 观测口径锁）
    const rsrc = read('src/collectors/sender-resolver.js');
    ok(!rsrc.includes('p.getCode'), 'C5 getCode 判型链退役（from 恒 EOA，块 join/单行反查即答案）');
    ok(!rsrc.includes('KIND_CONTRACT'), 'C5 KIND_CONTRACT 死值清除（kindCache 唯一值域 eoa）');
    ok(rsrc.includes('setRouterEventUser'), 'C5 GMGN 路由事件映射公共写入口存在');
    ok(rsrc.includes('_routerEventMap.get(item.txHash)'), 'C5 映射消费在 _processItem 最前（零 RPC 快路）');
    ok(rsrc.includes("p.send('eth_getBlockByNumber', [hexTag, true])"),
        'C5 CD377 块拉取=裸调 eth_getBlockByNumber(full)（ethers getBlock 抽象路径实测恒 hash 数组弃用）');
    ok(rsrc.includes('e.blockShape = true') && rsrc.includes('blockShapeDegrades'),
        'C5 CD377 fn 内形状门（throw 触发 failover+全退化负缓存+熔断）');
    ok(rsrc.includes('e.isBlockLag = true') && rsrc.includes('blockNotFound'),
        'C5 CD377 null block lag 分治（不 failover 计 blockNotFound）');
    ok(rsrc.includes('routerMapLateHits') && rsrc.includes('routerMapRetryHits'),
        'C5 CD377 映射复查两点（块路径未定值/进重试前——竞态 miss 零延迟接住）');
    ok(rsrc.includes('waitTokenIdle') && rsrc.includes('pendingFor'), 'C5 per-token 观测（waitTokenIdle/pendingFor）存在');
    ok(rsrc.includes('_withTimeout'), 'C5 callTimeoutMs 竞速包装存在');

    const cfg = JSON.parse(read('config/default.json'));
    ok(cfg.senderResolve?.enabled === true, 'C3 default.json senderResolve.enabled=true');
    ok(Array.isArray(cfg.senderResolve?.rpcUrls) && cfg.senderResolve.rpcUrls.length === 5, 'C3 rpcUrls dataseed 5 域名');
    ok(cfg.senderResolve?.callTimeoutMs === 0, 'C3 callTimeoutMs 默认 0=关（现状语义缺省不变）');

    // C6（2026-11-04 阶段 0b：三 collector GMGN 路由事件订阅同构锁）
    const gang = read('src/collectors/gang-ankr-ws-collector.js');
    for (const [name, src] of [['fourmeme', fm], ['flap', fl], ['gang', gang]]) {
        ok(/id: 3, method: 'eth_subscribe', params: \['logs', ROUTER_EVENT_SUBSCRIPTION\]/.test(src), `C6[${name}] id=3 路由事件订阅`);
        ok(/if \(this\._senderResolver && this\._senderResolver\.routerEventMapEnabled\) \{/.test(src), `C6[${name}] 订阅条件=resolver 在场且 routerEventMap 开`);
        ok(/if \(msg\.id === 3\) this\._routerEventSubId = msg\.result;/.test(src), `C6[${name}] 订阅确认帧登记 subId`);
        ok(/else if \(this\._routerEventSubId && msg\.params\.subscription === this\._routerEventSubId\) \{\s*this\._handleRouterEvent\(msg\.params\.result\);/.test(src), `C6[${name}] eth_subscription 分派路由事件`);
        ok(/_handleRouterEvent\(log\) \{[\s\S]*?extractRouterEventUsers\(log\)[\s\S]*?setRouterEventUser/.test(src), `C6[${name}] _handleRouterEvent=提取+写映射（零业务副作用）`);
        ok((src.match(/this\._routerEventSubId = null;/g) || []).length >= 2, `C6[${name}] ctor+断连双处清空 subId`);
        ok(src.includes("require('./router-events.js')"), `C6[${name}] require router-events`);
    }

    const ddl = read('scripts/sql/add-wss-ticks-sender-address.sql');
    ok(ddl.includes('ADD COLUMN IF NOT EXISTS sender_address text NULL'), 'C4 DDL 加列');

    // C8（CD378 ANKR WSS 单笔主路径：resolver 插层 + 三 collector 通道源码锁）
    const wssIdx = rsrc.indexOf('eth_getTransactionByHash');
    const txFromCacheIdx = rsrc.indexOf('2) txFrom 缓存');
    const blockJoinIdx = rsrc.indexOf('4) 块预取 join');
    ok(rsrc.includes('attachWss(fn)') && rsrc.includes('this._wssFn = typeof fn'), 'C8 resolver attachWss 公共入口（last-writer-wins+清零冷却）');
    ok(wssIdx > 0 && txFromCacheIdx > 0 && blockJoinIdx > wssIdx && wssIdx > txFromCacheIdx,
        'C8 WSS 层序=txFrom 缓存后、dataseed 块 join 前（主路径位次锁）');
    ok(rsrc.includes('_wssTxInflight') && rsrc.includes('_wssInflightLimit') && rsrc.includes('wssOverflows'),
        'C8 per-tx in-flight join+溢出门存在');
    ok(rsrc.includes('_wssCooldownUntil') && rsrc.includes('wssCooldowns'), 'C8 连续错误熔断存在');
    ok(rsrc.includes('_wssLookupTx') && rsrc.includes('KIND_EOA'),
        'C8 WSS 定值反哺双缓存（txFrom+kind——from 恒 EOA）');
    for (const [name, src] of [['fourmeme', fm], ['flap', fl], ['gang', gang]]) {
        ok(src.includes('attachWss(this._rpcRequest.bind(this))'), `C8[${name}] collector open 挂 attachWss（重连再 open 天然重挂）`);
        ok(src.includes('_rpcRequest(method, params, timeoutMs'), `C8[${name}] _rpcRequest 通道存在（Promise 化）`);
        ok(src.includes('this._blockTimeRequests.has(msg.id)'), `C8[${name}] id≥100 分派仲裁（旧表 blockTime 优先）`);
        ok(src.includes("'wss_connection_closed'") && src.includes("'wss_stopped'"),
            `C8[${name}] 断连/stop 双处 reject in-flight（不挂死 8s）`);
    }
}

(async () => {
    await testA();
    await testB();
    testB11();
    await testB12();
    testC();
    console.log(`\n✅ 全部通过：${passed} 断言`);
})().catch((err) => {
    console.error(`\n❌ 失败（已过 ${passed} 断言）:`, err.message);
    process.exit(1);
});
