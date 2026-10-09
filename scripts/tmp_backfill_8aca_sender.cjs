// 8aca25e2 局部回填：被拦 190 token 的首 90s 窗 buy 行 sender_address（2026-09-30 ②号修复）
//
// 流程：被拦 signal(top1>=60) → token 首 90s 窗 buy 行(sender IS NULL) → 备份 →
//       txHash 去重 → dataseed 池 getTransactionByHash 反查 tx.from → 按 id 批量 UPDATE。
// 幂等：只处理 sender IS NULL 的行，重跑安全。查不到的 tx 保持 NULL 留计数。
'use strict';
require('dotenv').config({ path: '/home/ubuntu/richer-js/config/.env' });
const fs = require('fs');
const { ethers } = require('ethers');
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');

const EXP = '8aca25e2-7baf-421d-9a6a-6698d85d977d';
const BACKUP = '/home/ubuntu/richer-js/data/backfill-8aca-sender-backup.json';
const RPC_URLS = [
    'https://bsc-dataseed1.binance.org/',
    'https://bsc-dataseed2.binance.org/',
    'https://bsc-dataseed3.binance.org/',
    'https://bsc-dataseed1.defibit.io/',
    'https://bsc-dataseed1.nariox.io/',
];
const CONCURRENCY = 6;
const RETRY = 3;

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function main() {
    const c = dbManager.getClient();

    // 1) 被拦 signal 的 token
    const { data: sigs, error: sErr } = await c.from('strategy_signals')
        .select('token_address,metadata->preBuyCheckFactors->earlyTradesTop1BuySharePct')
        .eq('experiment_id', EXP)
        .eq('action', 'buy')
        .limit(2000);
    if (sErr) throw new Error(sErr.message);
    const tokens = [...new Set(sigs.filter(s => (s.earlyTradesTop1BuySharePct ?? -1) >= 60).map(s => s.token_address))];
    log(`被拦 token: ${tokens.length}`);

    // 2) token_create 锚
    const anchor = new Map();
    for (let i = 0; i < tokens.length; i += 100) {
        const { data: evs, error } = await c.from('wss_events')
            .select('token_address,block_time')
            .eq('kind', 'token_create')
            .in('token_address', tokens.slice(i, i + 100));
        if (error) throw new Error(error.message);
        for (const e of evs) {
            const prev = anchor.get(e.token_address);
            if (!prev || (e.block_time && e.block_time < prev)) anchor.set(e.token_address, e.block_time);
        }
    }
    log(`锚到 create: ${anchor.size}/${tokens.length}`);

    // 3) 每 token 首 90s 窗 sender IS NULL 的 buy 行（id + txHash）
    const rows = [];
    for (const tok of tokens) {
        const t = anchor.get(tok);
        if (!t) continue;
        const to = new Date(new Date(t).getTime() + 90 * 1000).toISOString();
        const { data: rs, error } = await c.from('wss_price_ticks')
            .select('id,tx_hash')
            .eq('token_address', tok)
            .eq('trade_type', 'buy')
            .gte('block_time', t)
            .lt('block_time', to)
            .is('sender_address', null)
            .limit(2000);
        if (error) throw new Error(error.message);
        rows.push(...rs);
    }
    log(`待回填行: ${rows.length}，独立 txHash: ${new Set(rows.map(r => r.tx_hash)).size}`);
    if (!rows.length) { log('无待回填行，结束'); process.exit(0); }

    // 4) 备份（幂等：已有备份不覆盖——重跑保护）
    if (!fs.existsSync(BACKUP)) {
        fs.writeFileSync(BACKUP, JSON.stringify({ at: new Date().toISOString(), note: '回填前 sender 全 NULL', rows: rows.map(r => ({ id: r.id, tx_hash: r.tx_hash })) }));
        log(`备份已写: ${BACKUP} (${rows.length} 行)`);
    } else {
        log(`备份已存在，跳过（${BACKUP}）`);
    }

    // 5) 反查 txHash → from（并发池 + 轮询 failover + 重试）
    const providers = RPC_URLS.map(u => new ethers.JsonRpcProvider(u, 56, { batchMaxCount: 1, staticNetwork: true }));
    let rr = 0;
    const txFrom = new Map();
    let failed = 0, done = 0;
    const hashes = [...new Set(rows.map(r => r.tx_hash))];
    async function lookup(hash) {
        for (let attempt = 0; attempt <= RETRY; attempt++) {
            const p = providers[(rr++) % providers.length];
            try {
                const tx = await p.getTransaction(hash);
                if (tx && tx.from) return tx.from.toLowerCase();
                return null; // 链上无此 tx（不应发生）——不重试
            } catch (e) {
                if (attempt === RETRY) throw e;
                await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
            }
        }
    }
    const queue = [...hashes];
    async function worker() {
        for (;;) {
            const h = queue.shift();
            if (!h) return;
            try {
                const from = await lookup(h);
                if (from != null) txFrom.set(h, from);
                else failed++;
            } catch (e) {
                failed++;
                if (failed <= 5 || failed % 100 === 0) log(`反查失败 tx=${h} ${e.message}`);
            }
            if (++done % 500 === 0) log(`反查进度 ${done}/${hashes.length} 失败 ${failed}`);
        }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    log(`反查完成: 成功 ${txFrom.size}/${hashes.length}，失败 ${failed}`);

    // 6) 批量 UPDATE（按 txHash 分组 → 行 id 批）
    let updated = 0, skipped = 0;
    const byHash = new Map();
    for (const r of rows) {
        const from = txFrom.get(r.tx_hash);
        if (!from) { skipped++; continue; }
        if (!byHash.has(from)) byHash.set(from, []);
        byHash.get(from).push(r.id);
    }
    // UPDATE 也可以按 id 批（同 from 的行一起）
    const idBatch = [];
    for (const [from, ids] of byHash) for (const id of ids) idBatch.push({ id, from });
    for (let i = 0; i < idBatch.length; i += 100) {
        const batch = idBatch.slice(i, i + 100);
        // 同批可能不同 from——按 from 分小批
        const sub = new Map();
        for (const b of batch) {
            if (!sub.has(b.from)) sub.set(b.from, []);
            sub.get(b.from).push(b.id);
        }
        for (const [from, ids] of sub) {
            const { error } = await c.from('wss_price_ticks').update({ sender_address: from }).in('id', ids);
            if (error) throw new Error(`UPDATE 失败: ${error.message} ids=${ids.slice(0, 3)}...`);
            updated += ids.length;
        }
        if ((i / 100) % 10 === 0) log(`UPDATE 进度 ${updated}/${idBatch.length}`);
    }
    log(`✅ 回填完成: 更新 ${updated} 行，反查失败保持 NULL ${skipped} 行`);
    for (const p of providers) { try { p.destroy(); } catch {} }
    process.exit(0);
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
