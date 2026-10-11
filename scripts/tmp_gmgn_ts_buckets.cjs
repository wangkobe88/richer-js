#!/usr/bin/env node
// ============================================================================
// tokenScore 门值分桶评估：门降到 1.8 会拦掉/放行什么？
//
// 基线 = tnone 臂 37bd7349（去门实跑，79% 窗，TPA 照跑落表）——唯一 tokenScore
// 全谱系都有真实买入盈亏的臂。按 tnone 自己的 TPA 行 ts 分桶，每桶给
// 触发数 / 买入数 / FIFO netWithOpen / 胜率：门值 X 的被拦代价 = ts≤X 桶的合计。
// 交叉参照 = gm 臂 944292d6（全窗，门 2.5 OR exempt）：exempt 救回票的 ts 谱系。
//
// 桶：≤1.8 / (1.8,2.0] / (2.0,2.2] / (2.2,2.5] / >2.5 / null(触发但无 ts 行=没买门票)
// 局限：tnone 停在 79% 窗（10-08 尾段缺）；ts≤1.8 触发量本身少，统计噪声大。
// 用法（182）：node scripts/tmp_gmgn_ts_buckets.cjs
// ============================================================================
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const TNONE = '37bd7349-b3b7-4fb5-80af-f9f81615349c'; // tnone = 去 tokenScore 门（用户停在 79%）
const GM = '944292d6-abe9-435b-8240-bb73b8e7429c';    // gm = 2.5 门 + gmgnFilter 豁免（全窗）

const f2 = (x) => (Math.round(x * 10000) / 10000).toFixed(4);
const sum = (a) => a.reduce((s, x) => s + x, 0);

async function fetchAll(sb, table, cols, eqVal) {
    const rows = [];
    let offset = 0;
    while (true) {
        const { data, error } = await sb.from(table).select(cols).eq('experiment_id', eqVal)
            .order('id', { ascending: true }).range(offset, offset + 999);
        if (error) throw new Error(table + ': ' + error.message);
        rows.push(...data);
        if (data.length < 1000) break;
        offset += 1000;
    }
    return rows;
}

function pnlByToken(trades) {
    const by = new Map();
    for (const t of trades) {
        if (!(t.success === true || t.trade_status === 'success')) continue;
        const isBuy = t.trade_direction === 'buy' || t.trade_direction === 'BUY';
        const rec = by.get(t.token_address) || { spent: 0, received: 0, buys: 0, queue: [] };
        const inAmt = parseFloat(t.input_amount || 0), outAmt = parseFloat(t.output_amount || 0);
        if (isBuy) {
            if (outAmt > 0) { rec.queue.push({ amount: outAmt, cost: inAmt }); rec.spent += inAmt; rec.buys++; }
        } else {
            let rem = inAmt;
            while (rem > 0 && rec.queue.length) {
                const o = rec.queue[0];
                const sell = Math.min(rem, o.amount);
                const unit = o.cost / o.amount;
                o.amount -= sell; o.cost -= unit * sell; rem -= sell;
                if (o.amount <= 1e-12) rec.queue.shift();
            }
            rec.received += outAmt;
        }
        by.set(t.token_address, rec);
    }
    for (const [addr, r] of by) {
        r.netWithOpen = r.received - r.spent + r.queue.reduce((s, q) => s + q.cost, 0);
        delete r.queue;
        if (r.buys === 0) by.delete(addr);
    }
    return by;
}

function bucketOf(ts) {
    if (ts == null) return 'null(无ts)';
    if (ts <= 1.8) return '≤1.8     ';
    if (ts <= 2.0) return '(1.8,2.0]';
    if (ts <= 2.2) return '(2.0,2.2]';
    if (ts <= 2.5) return '(2.2,2.5]';
    return '>2.5     ';
}

async function main() {
    const sb = dbManager.getClient();
    const tpaCols = 'token_address,verdict,holding_factors';
    const tradeCols = 'token_address,trade_direction,input_amount,output_amount,success,trade_status';
    const [tnTpaRows, gmTpaRows, tnTrades, gmTrades] = await Promise.all([
        fetchAll(sb, 'token_position_analyses', tpaCols, TNONE),
        fetchAll(sb, 'token_position_analyses', tpaCols, GM),
        fetchAll(sb, 'trades', tradeCols, TNONE),
        fetchAll(sb, 'trades', tradeCols, GM),
    ]);
    const tnPnl = pnlByToken(tnTrades), gmPnl = pnlByToken(gmTrades);
    const tnTpa = new Map(); for (const r of tnTpaRows) if (!tnTpa.has(r.token_address)) tnTpa.set(r.token_address, r);
    const gmTpa = new Map(); for (const r of gmTpaRows) if (!gmTpa.has(r.token_address)) gmTpa.set(r.token_address, r);

    const sym = new Map();
    try {
        const fs = require('fs');
        for (const l of fs.readFileSync('/tmp/gm_sym_map.txt', 'utf8').trim().split('\n').filter(Boolean)) {
            const [a, s] = l.split(/\s+/); sym.set(a, s);
        }
    } catch { /* 无映射则 ? */ }

    // ── 矩阵打印：per (臂, 桶) 触发/买入/盈亏 ──
    const matrix = (tag, tpa, pnl) => {
        console.log(`\n──── ${tag} ────`);
        console.log('  ts 桶       | 触发 | 买入 | netWithOpen | 胜率   | 累计(≤桶上限被拦代价)');
        const order = ['≤1.8     ', '(1.8,2.0]', '(2.0,2.2]', '(2.2,2.5]', '>2.5     ', 'null(无ts)'];
        const groups = new Map(order.map(b => [b, []]));
        for (const [t, r] of tpa) groups.get(bucketOf(r.holding_factors?.TPAPre_tokenScore)).push(t);
        let cum = 0;
        for (const b of order) {
            const toks = groups.get(b);
            const bought = toks.filter(t => pnl.has(t));
            const p = bought.map(t => pnl.get(t).netWithOpen);
            const s = sum(p);
            if (b !== 'null(无ts)') cum += s;
            console.log(`  ${b} | ${String(toks.length).padStart(4)} | ${String(bought.length).padStart(4)} | ${f2(s).padStart(10)} | ${bought.length ? (p.filter(x => x > 0).length + '/' + bought.length).padStart(6) : '   -  '}` +
                (b !== 'null(无ts)' ? ` | ${f2(cum)}` : ' |'));
        }
        const noTpaBought = [...pnl.keys()].filter(t => !tpa.has(t));
        if (noTpaBought.length) console.log(`  （买入但无 TPA 行（触发后买腿外路径？）：${noTpaBought.length} 票 ${f2(sum(noTpaBought.map(t => pnl.get(t).netWithOpen)))}）`);
    };
    console.log('════════ tokenScore 分桶 × 实跑盈亏 ════════');
    matrix('tnone 37bd7349（无门，79% 窗）← 门值评估基线', tnTpa, tnPnl);
    matrix('gm 944292d6（门 2.5 OR exempt，全窗）← 参照', gmTpa, gmPnl);

    // ── tnone 低段明细（1.8 决策直接证据）──
    console.log('\n──── tnone 低段（ts≤2.0）逐票明细 ────');
    const low = [...tnTpa.entries()]
        .filter(([, r]) => { const ts = r.holding_factors?.TPAPre_tokenScore; return ts != null && ts <= 2.0; })
        .map(([t, r]) => ({ t, ts: r.holding_factors.TPAPre_tokenScore, pnl: tnPnl.has(t) ? tnPnl.get(t).netWithOpen : null }))
        .sort((a, b) => a.ts - b.ts);
    for (const r of low) console.log(`  ts=${r.ts}  ${r.pnl == null ? '未买    ' : f2(r.pnl).padStart(8)}  ${sym.get(r.t) || '?'} ${r.t}`);

    // ── gm 臂 exempt 救回票的 ts 谱系（豁免与降门重叠度）──
    console.log('\n──── gm 臂 exempt=1 且已买票的 ts 谱系（豁免救回 vs 降门重叠面）────');
    const exBought = [...gmTpa.entries()].filter(([t, r]) => r.holding_factors?.TPAPre_gmgnExempt === 1 && gmPnl.has(t));
    const exTs = exBought.map(([, r]) => r.holding_factors.TPAPre_tokenScore).sort((a, b) => a - b);
    console.log(`  ${exBought.length} 票 | ts 范围 ${exTs[0]} ~ ${exTs[exTs.length - 1]} | ts≤2.5 ${exTs.filter(x => x <= 2.5).length} 票（降门也救）/ >2.5 ${exTs.filter(x => x > 2.5).length} 票（仅豁免救）`);
    console.log(`  净额(netWithOpen) 合计 ${f2(sum(exBought.map(([t]) => gmPnl.get(t).netWithOpen)))}`);

    process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
