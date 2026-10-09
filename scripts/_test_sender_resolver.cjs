#!/usr/bin/env node
/**
 * SenderResolver + 两 collector 分流接线 + watcher 接线 单测（零 DB 零网络）
 *
 * 打桩点：SenderResolver._makeProvider（stub provider: getCode/getTransaction/destroy）
 * 与 collector 构造第 6 参（stub resolver: submit）。
 *
 * 节：
 *   A  resolver 纯逻辑（快路/getCode 三态/反查/重试/缓存/failover/ankrFromEnv/溢出/stop）
 *   B  collector 分流接线（无 resolver 旧路径 / submit 回推 / EOA 快路 price_outlier 时序 /
 *      B5-B10 直连回迁补丁：延迟喂 FA / 直推 sender=null / 尘 tick 门 / offers 不传（tvl 口径）/
 *      _onTickBuffered 钩子 / registerToken platform 键）
 *   C  源码口径防回归（grep 断言）
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

/** 挂桩 provider 工厂：按脚本控制 getCode/getTransaction */
function makeStub(resolver, { codeOf, txOf }) {
    const calls = { getCode: 0, getTransaction: 0 };
    resolver._makeProvider = (url) => ({
        url,
        getCode: async (addr) => {
            calls.getCode++;
            const r = codeOf(addr);
            if (r && r.__defer) return r.promise;
            return r;
        },
        getTransaction: async (h) => {
            calls.getTransaction++;
            const r = txOf(h);
            if (r && r.__defer) return r.promise;
            return r;
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

const { SenderResolver, resolveAnkrHttpUrlFromEnv, DEFAULT_RPC_URLS } = require('../src/collectors/sender-resolver.js');
const quietLogger = { info: () => {}, warn: () => {}, error: () => {}, log: () => {} };

// ═══════════════ A 节：resolver 纯逻辑 ═══════════════

async function testA() {
    console.log('\nA. SenderResolver 纯逻辑');

    // A1 EOA 快路：kind 缓存命中 → submit 内同步回推（零延迟、不进 backlog）
    {
        const r = new SenderResolver({}, quietLogger);
        const pushed = [];
        r._cacheKind('0xeoa1', 'eoa');
        r.submit({ tickRow: { tx_hash: '0x1' }, trader: '0xeoa1', txHash: '0x1', pushRow: (row) => pushed.push(row) });
        ok(pushed.length === 1 && pushed[0].sender_address === '0xeoa1', 'A1 EOA 快路同步回推 sender=trader');
        ok(r.stats.eoaFast === 1 && r._backlog.length === 0, 'A1 不进 backlog 零 RPC');
    }

    // A2 getCode '0x' → EOA（回推 trader；kind 落缓存后同地址走快路）
    {
        const r = new SenderResolver({ concurrency: 1 }, quietLogger);
        const calls = makeStub(r, { codeOf: () => '0x', txOf: () => { throw new Error('不应反查'); } });
        const pushed = [];
        r.submit({ tickRow: { tx_hash: '0x2' }, trader: '0xeoa2', txHash: '0x2', pushRow: (row) => pushed.push(row) });
        await sleep(20);
        ok(pushed.length === 1 && pushed[0].sender_address === '0xeoa2', 'A2 getCode 0x 判 EOA 回推 trader');
        ok(r.stats.eoaByCode === 1 && calls.getCode === 1, 'A2 stats.eoaByCode/getCode 计数');
        r.submit({ tickRow: { tx_hash: '0x2b' }, trader: '0xeoa2', txHash: '0x2b', pushRow: (row) => pushed.push(row) });
        ok(pushed.length === 2 && r.stats.eoaFast === 1 && calls.getCode === 1, 'A2 kind 缓存落盘后同地址快路零 getCode');
    }

    // A3 getCode 合约 → 反查 tx.from（from 反哺 kind 缓存为 EOA）
    {
        const r = new SenderResolver({ concurrency: 1 }, quietLogger);
        const calls = makeStub(r, { codeOf: (a) => (a === '0xrouter' ? '0xdeadbeef' : '0x'), txOf: () => ({ from: '0xUSER' }) });
        const pushed = [];
        r.submit({ tickRow: { tx_hash: '0x3' }, trader: '0xrouter', txHash: '0x3', pushRow: (row) => pushed.push(row) });
        await sleep(20);
        ok(pushed.length === 1 && pushed[0].sender_address === '0xuser', 'A3 合约行走反查 tx.from（lowercase）');
        ok(r.stats.txFromResolved === 1 && calls.getTransaction === 1, 'A3 反查一次');
        ok(r.kindSync('0xuser') === 'eoa', 'A3 tx.from 反哺 kind 缓存');
    }

    // A4 getCode 失败 → 不缓存、不当 EOA 直通 → 反查（EOA 直连时 from===trader 同样正确；
    //    反查成功后 from 反哺 kind 缓存是正确语义——BSC tx.from 恒 EOA）
    {
        const r = new SenderResolver({ concurrency: 1 }, quietLogger);
        const calls = makeStub(r, { codeOf: () => { throw new Error('rpc down'); }, txOf: () => ({ from: '0xEoaDirect' }) });
        const pushed = [];
        r.submit({ tickRow: { tx_hash: '0x4' }, trader: '0xeoadirect', txHash: '0x4', pushRow: (row) => pushed.push(row) });
        await sleep(20);
        ok(pushed.length === 1 && pushed[0].sender_address === '0xeoadirect', 'A4 getCode 失败 fail-safe 走反查结果正确');
        ok(r.kindSync('0xeoadirect') === 'eoa' && r.stats.rpcErrors === 1, 'A4 from===trader 反哺缓存为 eoa（tx.from 恒 EOA 安全结论）');
        ok(calls.getTransaction === 1, 'A4 反查仍发生');
    }

    // A4b getCode + 反查两路全失败 → 耗尽 NULL；trader 不进 kind 缓存（绝不冒充 EOA）
    {
        const r = new SenderResolver({ concurrency: 1, retryLimit: 0 }, quietLogger);
        makeStub(r, { codeOf: () => { throw new Error('down'); }, txOf: () => { throw new Error('down'); } });
        const pushed = [];
        r.submit({ tickRow: { tx_hash: '0x4b' }, trader: '0xunknown4b', txHash: '0x4b', pushRow: (row) => pushed.push(row) });
        await sleep(20);
        ok(pushed.length === 1 && pushed[0].sender_address === null, 'A4b 两路全失败 NULL 回推');
        ok(r.kindSync('0xunknown4b') === null, 'A4b 失败不落 kind 缓存（下次有机会重试 getCode）');
    }

    // A5 反查 null → 重试 → 耗尽 NULL（重试保留 kind 不再 getCode）
    {
        const r = new SenderResolver({ concurrency: 1, retryLimit: 1, retryDelayMs: 10 }, quietLogger);
        const calls = makeStub(r, { codeOf: () => '0xc0de', txOf: () => null });
        const pushed = [];
        r.submit({ tickRow: { tx_hash: '0x5' }, trader: '0xrouter5', txHash: '0x5', pushRow: (row) => pushed.push(row) });
        await sleep(80);
        ok(pushed.length === 1 && pushed[0].sender_address === null, 'A5 反查耗尽留 NULL（保数据丢修复）');
        ok(r.stats.retried === 1 && r.stats.senderNull === 1, 'A5 重试 1 次后 NULL 计数');
        ok(calls.getCode === 1 && calls.getTransaction === 2, 'A5 重试保留 kind 跳过 getCode、反查两次');
    }

    // A6 txFrom 缓存：聚合交易一条 tx 多 log 共享一次反查
    {
        const r = new SenderResolver({ concurrency: 1 }, quietLogger);
        const calls = makeStub(r, { codeOf: () => '0xc0de', txOf: () => ({ from: '0xagguser' }) });
        const pushed = [];
        for (const tx of ['0x6a', '0x6b']) {
            r.submit({ tickRow: { tx_hash: `${tx}-0` }, trader: '0xrouter6', txHash: tx, pushRow: (row) => pushed.push(row) });
            await sleep(20);
        }
        r.submit({ tickRow: { tx_hash: '0x6a-1' }, trader: '0xrouter6', txHash: '0x6a', pushRow: (row) => pushed.push(row) });
        await sleep(20);
        ok(pushed.length === 3 && pushed.every((p) => p.sender_address === '0xagguser'), 'A6 同 txHash 行全部解析到同一 from');
        ok(calls.getTransaction === 2 && r.stats.txFromCacheHits === 1, 'A6 缓存命中省一次反查');
    }

    // A7 溢出：backlog 满 → 最老行 NULL 强制落库
    {
        const d1 = deferred();
        const r = new SenderResolver({ concurrency: 1, backlogLimit: 2 }, quietLogger);
        makeStub(r, { codeOf: () => d1, txOf: () => null });
        const pushed = [];
        r.submit({ tickRow: { tx_hash: 'i1' }, trader: '0xslow', txHash: 't1', pushRow: (row) => pushed.push(row) }); // 占 inflight
        r.submit({ tickRow: { tx_hash: 'i2' }, trader: '0xslow', txHash: 't2', pushRow: (row) => pushed.push(row) });
        r.submit({ tickRow: { tx_hash: 'i3' }, trader: '0xslow', txHash: 't3', pushRow: (row) => pushed.push(row) });
        r.submit({ tickRow: { tx_hash: 'i4' }, trader: '0xslow', txHash: 't4', pushRow: (row) => pushed.push(row) }); // 触发溢出
        ok(pushed.length === 1 && pushed[0].tx_hash === 'i2' && pushed[0].sender_address === null, 'A7 溢出最老行 NULL 强制落库');
        ok(r.stats.backlogOverflow === 1 && r._backlog.length === 2, 'A7 溢出计数与剩余 backlog');
        d1.resolve('0x'); // 释放 inflight 防泄漏到后续节
        await sleep(10);
    }

    // A8 failover：rrIndex 起点轮询 + 逐 provider 降级
    {
        const r = new SenderResolver({ rpcUrls: ['https://a', 'https://b'], concurrency: 1 }, quietLogger);
        const seen = [];
        r._makeProvider = (url) => ({
            url,
            getCode: async () => { seen.push(url); if (url === 'https://a') throw new Error('down'); return '0x'; },
            getTransaction: async () => null,
            destroy: () => {},
        });
        const pushed = [];
        r.submit({ tickRow: { tx_hash: '0x8' }, trader: '0xeoa8', txHash: '0x8', pushRow: (row) => pushed.push(row) });
        await sleep(20);
        ok(pushed.length === 1 && pushed[0].sender_address === '0xeoa8', 'A8 failover 到第二端点成功');
        ok(seen.length >= 2 && seen.includes('https://b'), 'A8 失败端点后逐个降级');
    }

    // A9 ankrFromEnv 推导 + fail-loud
    {
        const hadWs = process.env.ANKR_WS_URL, hadKey = process.env.ANKR_API_KEY;
        delete process.env.ANKR_WS_URL; delete process.env.ANKR_API_KEY;
        ok(resolveAnkrHttpUrlFromEnv() === null, 'A9 无 env 推导 null');
        process.env.ANKR_WS_URL = 'wss://rpc.ankr.com/bsc/ws/0123456789abcdef0123456789';
        ok(resolveAnkrHttpUrlFromEnv() === 'https://rpc.ankr.com/bsc/0123456789abcdef0123456789', 'A9 ANKR_WS_URL 尾段推导');
        delete process.env.ANKR_WS_URL;
        process.env.ANKR_WS_URL = 'wss://rpc.ankr.com/bsc/ws'; // 无 key 尾段 'ws' 不合格
        process.env.ANKR_API_KEY = '0123456789abcdef0123456789abcdef';
        ok(resolveAnkrHttpUrlFromEnv() === 'https://rpc.ankr.com/bsc/0123456789abcdef0123456789abcdef', 'A9 尾段不合格回退 ANKR_API_KEY');
        const r = new SenderResolver({ rpcMode: 'ankrFromEnv' }, quietLogger);
        delete process.env.ANKR_WS_URL; delete process.env.ANKR_API_KEY;
        assert.throws(() => r._resolveRpcUrls(), /ankrFromEnv/);
        ok(true, 'A9 ankrFromEnv 推导失败 throw（部署错误 fail-loud，不静默回退）');
        ok(Array.isArray(DEFAULT_RPC_URLS) && DEFAULT_RPC_URLS.length === 5, 'A9 默认 dataseed 池 5 域名');
        if (hadWs === undefined) delete process.env.ANKR_WS_URL; else process.env.ANKR_WS_URL = hadWs;
        if (hadKey === undefined) delete process.env.ANKR_API_KEY; else process.env.ANKR_API_KEY = hadKey;
    }

    // A10 stop：等 in-flight → 剩余 backlog 全部 NULL 回推
    {
        const d1 = deferred(), d2 = deferred();
        const r = new SenderResolver({ concurrency: 1 }, quietLogger);
        let i = 0;
        r._makeProvider = () => ({
            getCode: async () => (i++ === 0 ? d1 : d2),
            getTransaction: async () => null,
            destroy: () => {},
        });
        const pushed = [];
        r.submit({ tickRow: { tx_hash: 's1' }, trader: '0xslow', txHash: 's1', pushRow: (row) => pushed.push(row) });
        d1.resolve('0x');
        await sleep(10);
        r.submit({ tickRow: { tx_hash: 's2' }, trader: '0xslow', txHash: 's2', pushRow: (row) => pushed.push(row) }); // 占 inflight
        r.submit({ tickRow: { tx_hash: 's3' }, trader: '0xslow', txHash: 's3', pushRow: (row) => pushed.push(row) });
        r.submit({ tickRow: { tx_hash: 's4' }, trader: '0xslow', txHash: 's4', pushRow: (row) => pushed.push(row) });
        const stopP = r.stop();
        d2.resolve('0x'); // 释放 in-flight（3s deadline 内）
        await stopP;
        const s3 = pushed.find((p) => p.tx_hash === 's3');
        const s4 = pushed.find((p) => p.tx_hash === 's4');
        ok(s3 && s4 && s3.sender_address === null && s4.sender_address === null, 'A10 stop 剩余 backlog 全部 NULL 回推');
        ok(r._backlog.length === 0 && r._stopped, 'A10 停机后 backlog 清空');
        // 停机后到货行：NULL 直推保行（竞态窗口）
        r.submit({ tickRow: { tx_hash: 's5' }, trader: '0xany', txHash: 's5', pushRow: (row) => pushed.push(row) });
        const s5 = pushed.find((p) => p.tx_hash === 's5');
        ok(s5 && s5.sender_address === null, 'A10 停机后到货 NULL 直推不丢行');
    }

    // A11 回推幂等：同 entry 双 push 只一次
    {
        const r = new SenderResolver({}, quietLogger);
        let n = 0;
        const entry = { tickRow: { tx_hash: '0x11' }, pushRow: () => { n++; } };
        r._pushResolved(entry, '0xa');
        r._pushResolved(entry, '0xb');
        ok(n === 1 && entry.tickRow.sender_address === '0xa', 'A11 _pushResolved 幂等防重');
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
            c2._factorAggregator = { processTick: () => ({ priceOutlier: true }), registerToken: () => {} };
            c2._minTickBnb = 0;
            c2._emitTick(decoded('0xb3'));
            ok(c2._tickBuffer.length === 1, `B3[${name}] EOA 快路同步进 buffer`);
            ok(c2._tickBuffer[0].price_outlier === true, `B3[${name}] FA outlier 回写在 flush 前生效（对象引用机制）`);
            ok(c2._tickBuffer[0].sender_address === '0xtrader', `B3[${name}] 快路 sender=trader`);
        }

        // B5 resolver 慢路延迟喂 FA（回迁补丁）：未回推前 FA 零调用；回推后 FA 收到已定值 sender
        {
            const c = new Ctor({ [cfgKey]: {} }, quietLogger);
            const got = [];
            c._senderResolver = { submit: (p) => got.push(p) };
            const faTicks = [];
            c._factorAggregator = { processTick: (t) => faTicks.push(t), registerToken: () => {} };
            c._minTickBnb = 0;
            c._emitTick(decoded('0xb5'));
            ok(got.length === 1 && faTicks.length === 0, `B5[${name}] 未回推 FA 零调用（合约行延迟喂食）`);
            got[0].tickRow.sender_address = '0xresolved';
            got[0].pushRow(got[0].tickRow);
            ok(faTicks.length === 1 && faTicks[0].sender_address === '0xresolved' && faTicks[0].trader_address === '0xtrader', `B5[${name}] 回推后 FA 收已解析 sender（钱包口径 sender||trader）`);
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
            c._onTickBuffered = (row) => hooked.push(row);
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

    // B8 fourmeme FA tick 刻意不含 offers/funds_bnb（对齐 SharedTickConsumer/回测口径：DB 行无
    //    这两列 tvl 恒 0——直连恢复后若重新传入会造成虚拟/回测 tvl 因子分叉）
    {
        const c = new FourMemeAnkrWsCollector({ fourmemeWs: {} }, quietLogger);
        const faTicks = [];
        c._factorAggregator = { processTick: (t) => faTicks.push(t), registerToken: () => {} };
        c._minTickBnb = 0;
        c._emitTick(decodedFm('0xb8'));
        ok(faTicks.length === 1 && !('offers' in faTicks[0]) && !('funds_bnb' in faTicks[0]), 'B8[fourmeme] FA tick 无 offers/funds_bnb（tvl 口径对齐回测）');
    }

    // B4 resolver 停机竞态口径：stop 后到货（kind 未知，需 RPC 才能判）→ NULL 直推保行；
    //    kind 已知 EOA 的行不受 stopped 影响（快路零资源，同步直推 sender=trader）
    {
        const r = new SenderResolver({}, quietLogger);
        await r.stop();
        const pushed = [];
        r.submit({ tickRow: { tx_hash: '0xb4' }, trader: '0xunknownX', txHash: '0xb4', pushRow: (row) => pushed.push(row) });
        ok(pushed.length === 1 && pushed[0].sender_address === null, 'B4 stop 后到货（kind 未知）NULL 直推不丢行');
        r._cacheKind('0xeoay', 'eoa');
        r.submit({ tickRow: { tx_hash: '0xb4b' }, trader: '0xeoay', txHash: '0xb4b', pushRow: (row) => pushed.push(row) });
        ok(pushed.length === 2 && pushed[1].sender_address === '0xeoay', 'B4 stop 后 EOA 快路仍直推（零资源不受 stopped 影响）');
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
        ok(/pushRow: \(row\) => \{ this\._feedFa\(decoded, row, priceUsd\); this\._pushTickRow\(row\); \}/.test(src), `C1[${name}] pushRow 回推统一经 _feedFa→_pushTickRow（sender 定值后进 FA/buffer）`);
        ok(/sender_address: tickRow\.sender_address \|\| null/.test(src), `C1[${name}] _feedFA 钱包口径 sender||trader`);
        ok(/constructor\(config, logger, tokenPool = null, factorAggregator = null, callbacks = \{\}, senderResolver = null\)/.test(src), `C1[${name}] 构造第 6 参 senderResolver`);
    }

    const w = read('src/watcher/WssWatcherService.js');
    ok(/const collector = new p\.Ctor\(watcherCfg\(p\.section\), this\.logger, null, null, \{[\s\S]*?\}, this\._senderResolver\);/.test(w), 'C2 collector 构造传第 6 参 this._senderResolver');
    const stopIdx = w.indexOf('await this._senderResolver.stop()');
    const collStopIdx = w.indexOf('await collector.stop()');
    ok(stopIdx > 0 && collStopIdx > stopIdx, 'C2 resolver.stop() 先于 collector.stop()（回推行进 buffer 再 flush）');
    ok(w.includes('senderResolve: this._senderResolver ? this._senderResolver.getStats() : null'), 'C2 心跳 payload 带 senderResolve stats');
    ok(w.includes("this.config.senderResolve.enabled === true"), 'C2 enabled===true 才构造（缺段零变化）');

    const cfg = JSON.parse(read('config/default.json'));
    ok(cfg.senderResolve?.enabled === true, 'C3 default.json senderResolve.enabled=true');
    ok(Array.isArray(cfg.senderResolve?.rpcUrls) && cfg.senderResolve.rpcUrls.length === 5, 'C3 rpcUrls dataseed 5 域名');

    const ddl = read('scripts/sql/add-wss-ticks-sender-address.sql');
    ok(ddl.includes('ADD COLUMN IF NOT EXISTS sender_address text NULL'), 'C4 DDL 加列');
}

(async () => {
    await testA();
    await testB();
    testC();
    console.log(`\n✅ 全部通过：${passed} 断言`);
})().catch((err) => {
    console.error(`\n❌ 失败（已过 ${passed} 断言）:`, err.message);
    process.exit(1);
});
