#!/usr/bin/env node
// ============================================================================
// 差距拆解：源 3e57ed75（一期 trader 口径画像库，+34.20/124 票）vs gm 臂
// 944292d6（wallet 口径+GMGN 剔除豁免，+21.58/132 票）——还差的 12.62 在哪里。
//
// 对账恒等式：src − gm = Σ(共同票 src−gm) + Σ(源独有) − Σ(gm独有)
// 源独有票归因看 gm 侧 TPA verdict：block（tokenScore 仍拦）/approve（时序没买）/无行。
// 用法（182）：node scripts/tmp_gmgn_gap_src.cjs
// ============================================================================
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const SRC = '3e57ed75-133e-497d-b8c8-b190eca2a6b8';
const GM = '944292d6-abe9-435b-8240-bb73b8e7429c';

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
        const rec = by.get(t.token_address) || { spent: 0, received: 0, buys: 0, sells: 0, queue: [] };
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
            rec.received += outAmt; rec.sells++;
        }
        by.set(t.token_address, rec);
    }
    for (const [addr, r] of by) {
        r.leftoverCost = r.queue.reduce((s, q) => s + q.cost, 0);
        r.net = r.received - r.spent;
        r.netWithOpen = r.net + r.leftoverCost;
        delete r.queue;
        if (r.buys === 0) by.delete(addr);
    }
    return by;
}

async function main() {
    const sb = dbManager.getClient();
    const cols = 'token_address,trade_direction,input_amount,output_amount,success,trade_status';
    const [srcTrades, gmTrades] = await Promise.all([
        fetchAll(sb, 'trades', cols, SRC), fetchAll(sb, 'trades', cols, GM),
    ]);
    const src = pnlByToken(srcTrades), gm = pnlByToken(gmTrades);

    const tpaCols = 'token_address,as_of,verdict,holding_factors';
    const [srcTpaRows, gmTpaRows] = await Promise.all([
        fetchAll(sb, 'token_position_analyses', tpaCols, SRC),
        fetchAll(sb, 'token_position_analyses', tpaCols, GM),
    ]);
    const srcTpa = new Map(); for (const r of srcTpaRows) if (!srcTpa.has(r.token_address)) srcTpa.set(r.token_address, r);
    const gmTpa = new Map(); for (const r of gmTpaRows) if (!gmTpa.has(r.token_address)) gmTpa.set(r.token_address, r);

    const sym = new Map();
    try {
        const fs = require('fs');
        for (const l of fs.readFileSync('/tmp/gm_sym_map.txt', 'utf8').trim().split('\n').filter(Boolean)) {
            const [a, s] = l.split(/\s+/); sym.set(a, s);
        }
    } catch { /* 无映射则 ? */ }

    const stat = (tag, m) => {
        const arr = [...m.values()];
        console.log(`${tag}: ${arr.length} 票 | netWithOpen ${f2(sum(arr.map(r => r.netWithOpen)))} | realized ${f2(sum(arr.map(r => r.net)))} | 胜(含open) ${arr.filter(r => r.netWithOpen > 0).length}/${arr.length}`);
    };
    console.log('════════ A. 总量（同 FIFO 口径）════════');
    stat('src 3e57ed75', src);
    stat('gm  944292d6', gm);
    const gap = sum([...src.values()].map(r => r.netWithOpen)) - sum([...gm.values()].map(r => r.netWithOpen));
    console.log(`差距 src − gm（netWithOpen）= ${f2(gap)}`);

    // B 共同票
    const both = [...src.keys()].filter(t => gm.has(t));
    const sB = sum(both.map(t => src.get(t).netWithOpen));
    const gB = sum(both.map(t => gm.get(t).netWithOpen));
    console.log(`\n════════ B. 共同买入 ${both.length} 票 ════════`);
    console.log(`  src 侧 ${f2(sB)} | gm 侧 ${f2(gB)} | src−gm = ${f2(sB - gB)}`);
    const diffs = both.map(t => ({ t, d: src.get(t).netWithOpen - gm.get(t).netWithOpen }))
        .filter(x => Math.abs(x.d) > 1e-6).sort((a, b) => b.d - a.d);
    console.log(`  PnL 有差异 ${diffs.length} 票（正=src 更好）；TOP10 src 更好 / TOP5 gm 更好：`);
    for (const m of diffs.slice(0, 10)) console.log(`    +${f2(m.d)}  ${sym.get(m.t) || '?'} ${m.t}（src ${f2(src.get(m.t).netWithOpen)} / gm ${f2(gm.get(m.t).netWithOpen)}）`);
    for (const m of diffs.slice(-5)) console.log(`    ${f2(m.d)}  ${sym.get(m.t) || '?'} ${m.t}（src ${f2(src.get(m.t).netWithOpen)} / gm ${f2(gm.get(m.t).netWithOpen)}）`);

    // C 源独有（gm 错过）
    const srcOnly = [...src.keys()].filter(t => !gm.has(t));
    console.log(`\n════════ C. 源独有买入 ${srcOnly.length} 票（gm 错过侧，差距主战场）════════`);
    const cBlock = [], cApprove = [], cNoRow = [];
    for (const t of srcOnly) {
        const row = gmTpa.get(t);
        if (!row) cNoRow.push(t); else if (row.verdict === 'block') cBlock.push(t); else cApprove.push(t);
    }
    const cl = (tag, arr) => {
        if (!arr.length) return console.log(`  ${tag}: 0 票`);
        const p = arr.map(t => src.get(t).netWithOpen);
        console.log(`  ${tag}: ${arr.length} 票净 ${f2(sum(p))}（胜 ${p.filter(x => x > 0).length}/${arr.length}）`);
    };
    cl('C1 gm TPA=block（tokenScore 仍拦）', cBlock);
    cl('C2 gm TPA=approve（时序/其它门没买）', cApprove);
    cl('C3 gm 无 TPA 行', cNoRow);
    console.log(`  源独有合计 ${f2(sum(srcOnly.map(t => src.get(t).netWithOpen)))}`);
    console.log(`\n── C1 明细（净额降序，token / gm ts / gm pct / src pnl / src ts）──`);
    for (const t of [...cBlock].sort((a, b) => src.get(b).netWithOpen - src.get(a).netWithOpen)) {
        const g = gmTpa.get(t) || {}; const hf = g.holding_factors || {};
        const shf = (srcTpa.get(t) || {}).holding_factors || {};
        console.log(`  ${sym.get(t) || '?'} ${t}\n    gm ts=${hf.TPAPre_tokenScore ?? '-'} pct=${hf.TPAPre_gmgnUserPct ?? '-'} ex=${hf.TPAPre_gmgnExempt ?? '-'} | src pnl=${f2(src.get(t).netWithOpen)} src ts=${shf.TPAPre_tokenScore ?? '-'}`);
    }
    console.log(`── C2 明细（净额降序）──`);
    for (const t of [...cApprove].sort((a, b) => src.get(b).netWithOpen - src.get(a).netWithOpen).slice(0, 12)) {
        const g = gmTpa.get(t) || {}; const hf = g.holding_factors || {};
        console.log(`  ${sym.get(t) || '?'} ${t} src pnl=${f2(src.get(t).netWithOpen)} | gm ts=${hf.TPAPre_tokenScore ?? '-'} pct=${hf.TPAPre_gmgnUserPct ?? '-'} ex=${hf.TPAPre_gmgnExempt ?? '-'}`);
    }

    // D gm 独有
    const gmOnly = [...gm.keys()].filter(t => !src.has(t));
    console.log(`\n════════ D. gm 独有买入 ${gmOnly.length} 票（gm 新增侧）════════`);
    console.log(`  合计 ${f2(sum(gmOnly.map(t => gm.get(t).netWithOpen)))}（胜 ${gmOnly.filter(t => gm.get(t).netWithOpen > 0).length}/${gmOnly.length}）`);
    const gTop = [...gmOnly].sort((a, b) => gm.get(b).netWithOpen - gm.get(a).netWithOpen);
    for (const t of gTop.slice(0, 6)) console.log(`    +${f2(gm.get(t).netWithOpen)}  ${sym.get(t) || '?'} ${t}`);
    for (const t of gTop.slice(-3)) console.log(`    ${f2(gm.get(t).netWithOpen)}  ${sym.get(t) || '?'} ${t}`);
    // 源侧 TPA 归因：这些票源为什么没买
    const dSrcBlock = gmOnly.filter(t => { const r = srcTpa.get(t); return r && r.verdict === 'block'; }).length;
    const dSrcAppr = gmOnly.filter(t => { const r = srcTpa.get(t); return r && r.verdict === 'approve'; }).length;
    console.log(`  （源侧归因：src TPA block ${dSrcBlock} / approve ${dSrcAppr} / 无行 ${gmOnly.length - dSrcBlock - dSrcAppr}）`);

    console.log(`\n对账：${f2(sB - gB)}(共同差) + ${f2(sum(srcOnly.map(t => src.get(t).netWithOpen)))}(源独有) − ${f2(sum(gmOnly.map(t => gm.get(t).netWithOpen)))}(gm独有) = ${f2((sB - gB) + sum(srcOnly.map(t => src.get(t).netWithOpen)) - sum(gmOnly.map(t => gm.get(t).netWithOpen)))} vs A 段 ${f2(gap)}`);
    process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
