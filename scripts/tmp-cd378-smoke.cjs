#!/usr/bin/env node
/**
 * CD378 本地真跑冒烟（一次性，不进 git）：
 * 1. 裸 WebSocket 连真 ANKR WSS（不订阅——零推送流量）
 * 2. collector 实例把 _ws 指到裸连接（_onMessage 手动接线）
 * 3. 通道自证：eth_getBlockByNumber(latest, full) 拿最新块真 tx 样本
 * 4. resolver submit 真 tx 行 → 断言 WSS 主路定值 + dataseed 零调用
 * 5. 断连场景：ws close 后 submit → dataseed 回退接住
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');

const env = fs.readFileSync(path.join(__dirname, '..', 'config', '.env'), 'utf8');
const wsUrl = (env.match(/ANKR_WS_URL\s*=\s*["']?([^"'\s]+)/) || [])[1];
if (!wsUrl) { console.error('❌ config/.env 无 ANKR_WS_URL'); process.exit(1); }

const { SenderResolver } = require('../src/collectors/sender-resolver.js');
const { FourMemeAnkrWsCollector } = require('../src/collectors/fourmeme-ankr-ws-collector.js');
const quietLogger = { info: () => {}, warn: () => {}, error: () => {} };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(cond, label) {
    console.log(`${cond ? '  ✓' : '  ❌'} ${label}`);
    if (!cond) failed++;
}

(async () => {
    // ── 1. 裸连 ANKR（无订阅→无推送，只跑请求/应答）──
    const ws = new WebSocket(wsUrl);
    const opened = new Promise((res, rej) => {
        ws.on('open', res);
        ws.on('error', rej);
        setTimeout(() => rej(new Error('连接超时 10s')), 10000);
    });
    await opened;
    console.log('✓ ANKR WSS 已连接（无订阅零推送）');

    // ── 2. collector 通道接线（_onMessage 手动喂给 collector 仲裁逻辑）──
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'default.json'), 'utf8'));
    const c = new FourMemeAnkrWsCollector(cfg, quietLogger, null, null, {}, {});
    c._ws = ws; // readyState=OPEN；send 直通真连接
    ws.on('message', (data) => { try { c._onMessage(data); } catch {} });
    ws.on('close', () => {}); // 防未处理事件

    // ── 3. 通道自证：最新块真 tx 样本（一次调用拿全部测试材料）──
    const t0 = Date.now();
    const head = await c._rpcRequest('eth_getBlockByNumber', ['latest', true], 8000);
    const rtt = Date.now() - t0;
    const txs = (head.result && Array.isArray(head.result.transactions) ? head.result.transactions : [])
        .filter((t) => t && t.hash && t.from);
    check(rtt < 8000 && txs.length > 0, `通道自证 eth_getBlockByNumber(full) ${rtt}ms 块 ${head.result.number} 含 ${txs.length} tx`);
    console.log(`  · blockNumber=${parseInt(head.result.number, 16)} transactions=${txs.length}`);

    // ── 4. resolver WSS 主路：真 tx 行 → wssTxResolved、dataseed 零调用 ──
    const r = new SenderResolver({ concurrency: 2 }, quietLogger);
    const dataseed = { getBlock: 0, getTransaction: 0 };
    r._makeProvider = () => ({
        send: async (m) => { if (m === 'eth_getBlockByNumber') { dataseed.getBlock++; return null; } throw new Error('unexpected'); },
        getTransaction: async () => { dataseed.getTransaction++; return null; },
        destroy: () => {},
    });
    r.attachWss(c._rpcRequest.bind(c)); // 生产同款挂法

    const sample = txs.slice(0, 4); // 4 笔真 tx（含 hash+from 真值）
    const pushed = [];
    const t1 = Date.now();
    for (const t of sample) {
        r.submit({
            tickRow: { tx_hash: t.hash, token_address: '0xtok', block_number: parseInt(head.result.number, 16), sender_address: null },
            trader: '0xcontractrouter', txHash: t.hash, pushRow: (x) => pushed.push(x),
        });
    }
    const deadline = Date.now() + 5000;
    while (pushed.length < sample.length && Date.now() < deadline) await sleep(20);
    const wssMs = Date.now() - t1;
    check(pushed.length === sample.length, `4 行全部定值（${wssMs}ms 总耗时——并发管道化）`);
    const allMatch = sample.every((t) => pushed.some((p) => p.tx_hash === t.hash
        && p.sender_address === t.from.toLowerCase()));
    check(allMatch, '每行 sender=链上真 tx.from（逐笔对拍）');
    const s = r.stats;
    check(s.wssTxResolved === sample.length && s.wssTxLookups === sample.length,
        `wssTxResolved=${s.wssTxResolved} wssTxLookups=${s.wssTxLookups}`);
    check(dataseed.getBlock === 0 && dataseed.getTransaction === 0 && s.wssTxFallbacks === 0,
        'dataseed 零调用零 fallback（主路全接）');
    check(r._wssTxInflight.size === 0, 'in-flight 表清空');

    // ── 5. 断连回退：ws close → resolver 层走 dataseed（真 dataseed 可达）──
    ws.close();
    await sleep(200);
    const r2fallback = [];
    r.submit({
        tickRow: { tx_hash: '0xdead' + Date.now(), token_address: '0xtok', block_number: parseInt(head.result.number, 16), sender_address: null },
        trader: '0xcontractrouter', txHash: '0xdead' + Date.now(), pushRow: (x) => r2fallback.push(x),
    });
    const dl2 = Date.now() + 15000;
    while (r2fallback.length === 0 && Date.now() < dl2) await sleep(50);
    check(r2fallback.length === 1, `断连后行回落 dataseed 定值（sender=${r2fallback[0] && r2fallback[0].sender_address}）`);

    console.log(failed === 0 ? '\n✅ CD378 冒烟全过' : `\n❌ ${failed} 项失败`);
    process.exit(failed === 0 ? 0 : 1);
})().catch((err) => { console.error('❌ 冒烟异常:', err.message); process.exit(1); });
