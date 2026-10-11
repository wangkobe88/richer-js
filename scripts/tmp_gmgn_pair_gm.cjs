#!/usr/bin/env node
// ============================================================================
// gm 臂正式差分：944292d6（gm 豁免臂）vs fb4630c7（b2 wallet 重跑基线）
// 2026-10-11。两臂同源（3e57ed75 克隆）同窗口 bit-identical，唯一 config 差异：
//   ① condition tokenScore 门 → (… OR TPAPre_gmgnExempt == 1)
//   ② tokenPositionAnalyzer.gmgnFilter = { enabled: true, exemptPct: 60 }
//     （触发门 minHolders 剔除 GMGN 用户 + top20 剔除 + 占比 ≥60 verdict 改写 approve）
//
// 差分维度：
//   A 两臂总净额（FIFO netWithOpen）
//   B 共同买入票逐票 PnL 差（触发时点偏移的混合因素量级）
//   C gm 独有票：b2 TPA=block（豁免救回主效应，对拍 tnone 假想组 17 票 +4.315@79%）
//               / b2 TPA=approve（时序扰动）/ b2 无 TPA 行
//   D b2 独有票（gm 没买）：gm TPA verdict 归因
//
// 用法（182）：node scripts/tmp_gmgn_pair_gm.cjs
// ============================================================================
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const B2 = 'fb4630c7-f4d4-4127-bf80-b440b5a82953';   // b2 = TPA wallet 重跑基线
const GM = '944292d6-abe9-435b-8240-bb73b8e7429c';   // gm = GMGN 剔除+豁免臂

const f2 = (x) => (Math.round(x * 10000) / 10000).toFixed(4);
const sum = (a) => a.reduce((s, x) => s + x, 0);

/** 分页拉全表（小行集） */
async function fetchAll(sb, table, cols, eqCol, eqVal) {
    const rows = [];
    let offset = 0;
    while (true) {
        const q = sb.from(table).select(cols).eq(eqCol, eqVal)
            .order('id', { ascending: true }).range(offset, offset + 999);
        const { data, error } = await q;
        if (error) throw new Error(table + ': ' + error.message);
        rows.push(...data);
        if (data.length < 1000) break;
        offset += 1000;
    }
    return rows;
}

/** FIFO per-token PnL（tmp_gmgn_pair_tnone 同款） */
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

    // ── 数据拉取 ──
    const [b2Trades, gmTrades] = await Promise.all([
        fetchAll(sb, 'trades', 'token_address,trade_direction,input_amount,output_amount,success,trade_status', 'experiment_id', B2),
        fetchAll(sb, 'trades', 'token_address,trade_direction,input_amount,output_amount,success,trade_status', 'experiment_id', GM),
    ]);
    const b2Pnl = pnlByToken(b2Trades);
    const gmPnl = pnlByToken(gmTrades);

    const tpaCols = 'token_address,as_of,verdict,holding_factors';
    const [b2TpaRows, gmTpaRows] = await Promise.all([
        fetchAll(sb, 'token_position_analyses', tpaCols, 'experiment_id', B2),
        fetchAll(sb, 'token_position_analyses', tpaCols, 'experiment_id', GM),
    ]);
    const b2Tpa = new Map(); // token → 首行（trigger_no=1）
    for (const r of b2TpaRows) if (!b2Tpa.has(r.token_address)) b2Tpa.set(r.token_address, r);
    const gmTpa = new Map();
    for (const r of gmTpaRows) if (!gmTpa.has(r.token_address)) gmTpa.set(r.token_address, r);

    // symbol：从 gm 臂日志 grep「Token added to pool」映射（experiment_tokens 全表 order 超时，绕开）
    const sym = new Map();
    try {
        const fs = require('fs');
        const logSym = fs.readFileSync('/tmp/gm_sym_map.txt', 'utf8').trim().split('\n')
            .filter(Boolean).map(l => l.split(/\s+/));
        for (const [a, s] of logSym) sym.set(a, s);
    } catch { /* 无映射文件则 symbol 显示 ? */ }

    // ── A 总量 ──
    const stat = (tag, pnl) => {
        const arr = [...pnl.values()];
        console.log(`${tag}: ${arr.length} 票 | 净额(netWithOpen) ${f2(sum(arr.map(r => r.netWithOpen)))} | ` +
            `胜 ${arr.filter(r => r.netWithOpen > 0).length}/${arr.length}（${(arr.filter(r => r.netWithOpen > 0).length / arr.length * 100).toFixed(1)}%）`);
    };
    console.log('════════ A. 两臂总量 ════════');
    stat('b2（基线）', b2Pnl);
    stat('gm（豁免臂）', gmPnl);
    console.log(`差分 gm − b2 = ${f2(sum([...gmPnl.values()].map(r => r.netWithOpen)) - sum([...b2Pnl.values()].map(r => r.netWithOpen)))}`);

    // ── B 共同买入 ──
    const both = [...gmPnl.keys()].filter(t => b2Pnl.has(t));
    const bothDiff = both.map(t => ({ t, d: gmPnl.get(t).netWithOpen - b2Pnl.get(t).netWithOpen }));
    const bTot = sum(both.map(t => b2Pnl.get(t).netWithOpen));
    const gTot = sum(both.map(t => gmPnl.get(t).netWithOpen));
    console.log(`\n════════ B. 共同买入 ${both.length} 票 ════════`);
    console.log(`  b2 侧合计 ${f2(bTot)} | gm 侧合计 ${f2(gTot)} | 逐票差合计 ${f2(gTot - bTot)}`);
    const moved = bothDiff.filter(x => Math.abs(x.d) > 1e-6).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    console.log(`  PnL 有差异票数 = ${moved.length}（触发时点偏移混合因素）`);
    for (const m of moved.slice(0, 8)) {
        console.log(`    ${sym.get(m.t) || m.t} ${m.t}\n      b2=${f2(b2Pnl.get(m.t).netWithOpen)} gm=${f2(gmPnl.get(m.t).netWithOpen)} diff=${f2(m.d)}`);
    }

    // ── C gm 独有票 ──
    const gmOnly = [...gmPnl.keys()].filter(t => !b2Pnl.has(t));
    const cBlock = [], cApprove = [], cNoRow = [];
    for (const t of gmOnly) {
        const row = b2Tpa.get(t);
        if (!row) cNoRow.push(t);
        else if (row.verdict === 'block') cBlock.push(t);
        else cApprove.push(t);
    }
    console.log(`\n════════ C. gm 独有买入 ${gmOnly.length} 票 ════════`);
    const line = (tag, arr) => {
        const p = arr.map(t => gmPnl.get(t).netWithOpen);
        console.log(`  ${tag}: ${arr.length} 票净 ${f2(sum(p))}（胜 ${p.filter(x => x > 0).length}/${arr.length}）`);
    };
    line('C1 豁免救回（b2 TPA=block）', cBlock);
    line('C2 b2 TPA=approve（时序/其它门扰动）', cApprove);
    line('C3 b2 无 TPA 行', cNoRow);
    console.log(`\n── C1 豁免救回票明细（净额降序；对拍 tnone 假想组 17 票 +4.315@79% 窗口）──`);
    const c1Detail = cBlock.map(t => {
        const g = gmTpa.get(t);
        const hf = (g && g.holding_factors) || {};
        return { t, pct: hf.TPAPre_gmgnUserPct, ex: hf.TPAPre_gmgnExempt, ts: hf.TPAPre_tokenScore, pnl: gmPnl.get(t).netWithOpen };
    }).sort((a, b) => b.pnl - a.pnl);
    for (const r of c1Detail) {
        console.log(`  ${sym.get(r.t) || '?'} ${r.t}\n    pct=${r.pct} exempt=${r.ex} ts=${r.ts} pnl=${f2(r.pnl)}`);
    }
    console.log(`\n── C2 明细 TOP8（净额降序）──`);
    for (const t of [...cApprove].sort((a, b) => gmPnl.get(b).netWithOpen - gmPnl.get(a).netWithOpen).slice(0, 8)) {
        const g = gmTpa.get(t); const hf = (g && g.holding_factors) || {};
        console.log(`  ${sym.get(t) || '?'} ${t} pnl=${f2(gmPnl.get(t).netWithOpen)} ts=${hf.TPAPre_tokenScore} pct=${hf.TPAPre_gmgnUserPct}`);
    }
    console.log(`── C3 明细（全部）──`);
    for (const t of cNoRow.sort((a, b) => gmPnl.get(b).netWithOpen - gmPnl.get(a).netWithOpen)) {
        const g = gmTpa.get(t); const hf = (g && g.holding_factors) || {};
        console.log(`  ${sym.get(t) || '?'} ${t} pnl=${f2(gmPnl.get(t).netWithOpen)} ts=${hf.TPAPre_tokenScore} pct=${hf.TPAPre_gmgnUserPct}`);
    }

    // ── D b2 独有票 ──
    const b2Only = [...b2Pnl.keys()].filter(t => !gmPnl.has(t));
    console.log(`\n════════ D. b2 独有买入 ${b2Only.length} 票（gm 机会成本侧）════════`);
    const dBlock = [], dApprove = [], dNoRow = [];
    for (const t of b2Only) {
        const row = gmTpa.get(t);
        if (!row) dNoRow.push(t);
        else if (row.verdict === 'block') dBlock.push(t);
        else dApprove.push(t);
    }
    const dl = (tag, arr) => {
        const p = arr.map(t => b2Pnl.get(t).netWithOpen);
        if (!arr.length) return console.log(`  ${tag}: 0 票`);
        console.log(`  ${tag}: ${arr.length} 票净 ${f2(sum(p))}（胜 ${p.filter(x => x > 0).length}/${arr.length}）`);
    };
    dl('D1 gm TPA=block（画像窗口变长分数变化）', dBlock);
    dl('D2 gm TPA=approve（时序扰动没买）', dApprove);
    dl('D3 gm 无 TPA 行（触发门剔除后未达）', dNoRow);
    const dAll = b2Only.map(t => b2Pnl.get(t).netWithOpen);
    console.log(`  b2 独有合计 ${f2(sum(dAll))}（gm 放弃的收益，负=放弃亏损票是好事）`);
    for (const t of [...b2Only].sort((a, b) => b2Pnl.get(b).netWithOpen - b2Pnl.get(a).netWithOpen).slice(0, 8)) {
        const g = gmTpa.get(t); const hf = (g && g.holding_factors) || {};
        const b2hf = (b2Tpa.get(t) || {}).holding_factors || {};
        console.log(`  ${sym.get(t) || '?'} ${t}\n    b2 pnl=${f2(b2Pnl.get(t).netWithOpen)} | gm侧 verdict=${g ? g.verdict : '无行'} ts=${hf.TPAPre_tokenScore ?? '-'}（b2 ts=${b2hf.TPAPre_tokenScore ?? '-'}）pct=${hf.TPAPre_gmgnUserPct ?? '-'}`);
    }

    // ── E gm 臂豁免审计（全量触发票里 exempt 命中分布）──
    let exHit = 0, exBuy = 0;
    for (const [t, r] of gmTpa) {
        const hf = r.holding_factors || {};
        if (hf.TPAPre_gmgnExempt === 1) { exHit++; if (gmPnl.has(t)) exBuy++; }
    }
    console.log(`\n════════ E. gm 臂豁免审计 ════════`);
    console.log(`  TPA 触发总数 ${gmTpa.size} | gmgnExempt=1 命中 ${exHit} | 其中买入 ${exBuy}`);
    const appr = [...gmTpa.values()].filter(r => r.verdict === 'approve').length;
    console.log(`  gm verdict 分布: approve ${appr} / block ${gmTpa.size - appr}`);
    const b2Appr = [...b2Tpa.values()].filter(r => r.verdict === 'approve').length;
    console.log(`  b2 verdict 分布: approve ${b2Appr} / block ${b2Tpa.size - b2Appr}`);

    process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
