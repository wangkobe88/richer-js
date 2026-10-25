#!/usr/bin/env node
/**
 * T2 nonce-guard 双卖事故补账（2026-10-25 K线人生 0xfeff…7777，v37 ca8f9493）
 *
 * 事故：卖出首发 nonce 1735（tx 0x0017…49ff）链上已成交，HTTP 响应丢失后请求层重发
 * 同 raw 撞出 "nonce too low: next nonce 1736, tx nonce 1735"，_nonceGuard 误判拒收
 * reset 重发 nonce 1736 同参数卖出 → 双卖 1 卡。首发无 trades 行 → 卡账本虚挂 1 卡
 * （页面显示持有 1 卡），链上余额≈0，幽灵持仓熔断循环。
 *
 * 补账（幂等）：
 *   1. 补首发卖出行（input=首发请求量 103853.317733612755546346，实收=链上余额差+gas
 *      补偿口径 0.001733346151413766 BNB，块时刻 10:16:57Z，cardTrade 4→3）
 *   2. 后续三笔卖出 cardTrade 顺移：0x66f7 4→3 改 3→2；0x8baf 3→2 改 2→1；
 *      0xee1f 2→1 改 1→0（账本归零）
 *   防线：行存在性幂等跳过；cardTrade 当前形状不符预期=告警退出不硬改（防二次执行错移）
 *
 * 运行：node scripts/backfill-t2-nonce-double-sell.cjs [--commit]
 * （默认 dry-run 打印计划；--commit 落库）
 */

const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Decimal = require('decimal.js');

const ROOT = path.resolve(__dirname, '..');
const { dbManager } = require(path.join(ROOT, 'src/services/dbManager'));

const COMMIT = process.argv.includes('--commit');

const EXP = 'ca8f9493-d6ea-4d97-9b3c-1470cbbafc88';
const TOKEN = '0xfeff214ddc93fa0eec1ab7b78c5c3893384e7777';
const SYMBOL = 'K线人生';

// 事故首发卖出（链上实证：blk 129688220 @ 2026-10-25T10:16:57Z，nonce 1735，SUCCESS）
const GHOST = {
    txHash: '0x0017932659c26f2df904571f412f49d3cfba766b0691eb72ae978b66c21049ff',
    signalId: 'b88cc080-866f-4850-bd6d-a0a4756e9376', // 同一次 SellEval（P9）触发的首发
    qty: '103853.317733612755546346',                 // 发单请求量（trader 日志 49474 行实证）
    bnbReceived: '0.001733346151413766',              // 链上余额差 + gasUsed×gasPrice 补偿
    bnbUsd: 735.947076452453,                          // SELL1（0x66f7）同刻口径
    sellPercentage: 0.25,
    executedAt: '2026-10-25T10:16:57.000Z',            // blk 129688220 timestamp
};

// 后续三笔卖出 cardTrade 顺移表（按链上成交序）
const SHIFT = [
    { txHash: '0x66f7cc40c4bd59ab45e2b6167e104ac18fc14f2082da1cad9d6b697db4b290f1', expect: { before: 4, after: 3 }, to: { before: 3, after: 2 } },
    { txHash: '0x8baf77ae605d399d1651111240eee3a6c6ed3d9a3bd2847097864a10137c2589', expect: { before: 3, after: 2 }, to: { before: 2, after: 1 } },
    { txHash: '0xee1ff7a23009b3bc6c25fd65ecbc328fc2b59630e997ca3fae5e9256b0ae506c', expect: { before: 2, after: 1 }, to: { before: 1, after: 0 } },
];

async function main() {
    const client = dbManager.getClient();

    // ── 1. 补首发卖出行（幂等：txHash 已存在则跳过） ──
    const { data: exist } = await client.from('trades')
        .select('id').eq('experiment_id', EXP)
        .eq('metadata->>txHash', GHOST.txHash).limit(1);
    let insertRow = null;
    if (exist && exist.length) {
        console.log(`[1] 首发卖出行已存在（${exist[0].id}），跳过插入`);
    } else {
        const unitPrice = new Decimal(GHOST.bnbReceived).mul(GHOST.bnbUsd)
            .div(new Decimal(GHOST.qty)).toNumber();
        insertRow = {
            id: uuidv4(),
            experiment_id: EXP,
            signal_id: GHOST.signalId,
            token_address: TOKEN,
            token_symbol: SYMBOL,
            chain: 'bsc',
            trade_direction: 'sell',
            trade_status: 'success',
            input_currency: SYMBOL,
            output_currency: 'BNB',
            input_amount: GHOST.qty,
            output_amount: GHOST.bnbReceived,
            unit_price: String(unitPrice),
            success: true,
            is_virtual_trade: false,
            created_at: GHOST.executedAt,
            executed_at: GHOST.executedAt,
            metadata: {
                txHash: GHOST.txHash,
                bnbUsd: GHOST.bnbUsd,
                bnbReceived: GHOST.bnbReceived,
                sellPercentage: GHOST.sellPercentage,
                cardTrade: { cards: 1, before: 4, after: 3 },
                protocol: 'Flap Portal',
                method: 'swapExactInput',
                backfill: 'T2-nonce-guard-double-sell',
                backfillNote: '首发 nonce 1735 链上已成交未记账（_nonceGuard 误判拒收重发双卖）；实收=链上余额差+gas 补偿，块 129688220',
            },
        };
        console.log(`[1] 将插入首发卖出行: ${GHOST.txHash.slice(0, 12)} qty=${GHOST.qty} 实收=${GHOST.bnbReceived} BNB cardTrade 4→3 unit_price=${unitPrice.toExponential(6)}`);
    }

    // ── 2. 后续三笔 cardTrade 顺移（形状防线：不符预期退出） ──
    const updates = [];
    for (const s of SHIFT) {
        const { data: rows, error } = await client.from('trades')
            .select('id, metadata').eq('experiment_id', EXP)
            .eq('metadata->>txHash', s.txHash).limit(1);
        if (error || !rows || !rows.length) {
            console.error(`[2] ✗ 未找到 ${s.txHash.slice(0, 12)} 行（${error ? error.message : '无结果'}），中止`);
            process.exit(1);
        }
        const cur = rows[0].metadata.cardTrade;
        if (!cur || cur.before !== s.expect.before || cur.after !== s.expect.after) {
            console.error(`[2] ✗ ${s.txHash.slice(0, 12)} cardTrade 当前 ${JSON.stringify(cur)} ≠ 预期 ${JSON.stringify(s.expect)}（可能已顺移/形状漂移），中止`);
            process.exit(1);
        }
        updates.push({ id: rows[0].id, txHash: s.txHash, metadata: { ...rows[0].metadata, cardTrade: { ...s.to } } });
        console.log(`[2] ${s.txHash.slice(0, 12)} cardTrade ${cur.before}→${cur.after} 改 ${s.to.before}→${s.to.after}`);
    }

    if (!COMMIT) {
        console.log('\ndry-run 完成（--commit 落库）');
        process.exit(0);
    }

    if (insertRow) {
        const { error } = await client.from('trades').insert([insertRow]);
        if (error) { console.error('插入失败:', error.message); process.exit(1); }
        console.log('✅ 已插入首发卖出行');
    }
    for (const u of updates) {
        const { error } = await client.from('trades').update({ metadata: u.metadata }).eq('id', u.id);
        if (error) { console.error(`更新失败 ${u.txHash.slice(0, 12)}:`, error.message); process.exit(1); }
        console.log(`✅ 已顺移 ${u.txHash.slice(0, 12)}`);
    }

    // ── 3. 回放验证：卡账本应归零 ──
    const { data: all } = await client.from('trades')
        .select('trade_direction, input_amount, output_amount, executed_at, metadata')
        .eq('experiment_id', EXP).eq('token_address', TOKEN)
        .order('executed_at', { ascending: true, nullsFirst: false }).limit(20);
    let cards = 0;
    for (const t of all) {
        const ct = t.metadata && t.metadata.cardTrade;
        if (ct) cards = ct.after;
        else cards += t.trade_direction === 'buy' ? (ct ? ct.cards : 0) : 0;
    }
    console.log(`\n卡账本回放终态: ${cards} 卡（期望 0）`);
    process.exit(cards === 0 ? 0 : 1);
}

main().catch(err => { console.error('执行异常:', err); process.exit(1); });
