#!/usr/bin/env node
// ============================================================================
// TPA tokenScore 门纯效应：b2 vs tnone 四臂对齐对拍（2026-10-12）
//
// 背景：用户方向输入「TPA 直接豁免/去除可能不对」+ 0xac5174ec 洞察（前期持有者
// 有问题但票不能否定——作弊者卖掉后散户接盘又起来）。uniform 前置门已被
// tmp_gmgn_exempt_uniform.cjs 否决（全阈值负效应）。本脚本回答剩下的问题：
// **TPA tokenScore 门拦掉的票，到底是金子还是炸弹**——tnone（无门）实买而
// b2（带 2.5 门）未买（≤T 对齐）的票 = 门拦截票，其 tnone 盈亏 = 门放弃的盈亏。
//
// 臂（同源 3e57ed75 系、同窗 10-04→10-08，b2 vs tnone 唯一差异 = condition 的
// TPAPre_tokenScore > 2.5 门）：
//   tnone 37bd7349 去门（TPA 照跑落表）
//   b2    fb4630c7 带门 2.5（3e57ed75 的 wallet 口径重跑）
//   notpa 9e8892b7 TPA 整体不激活（pbc/condition 与 tnone 逐字同）
//   gm    944292d6 GMGN 剔除+豁免 60（带门+豁免臂）
//
// ★ FIFO 一律 (created_at,id) 时间序（2026-10-12 trades id 序虚高坑，与
//   tmp_gmgn_exempt_uniform.cjs 同款修复）。
//
// 用法（182）：node scripts/tmp_tpa_gate_effect.cjs
// ============================================================================
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const ARMS = {
    tnone: '37bd7349-b3b7-4fb5-80af-f9f81615349c',
    b2: 'fb4630c7-f4d4-4127-bf80-b440b5a82953',
    notpa: '9e8892b7-0e93-4df5-999f-09fd6c5d5388',
    gm: '944292d6-abe9-435b-8240-bb73b8e7429c',
};
const CASE_AC = '0xac5174ec0623c09fd76fb1483a91f5e60e897777'; // 用户点名票（豁免/门方向参照）
const CASE_6B = '0x6b973ce6ae7fe37941a3c76af04ec05d3f837777'; // 反例锚定票（正确拦截）

const f2 = (x) => (Math.round(x * 10000) / 10000).toFixed(4);
const sum = (a) => a.reduce((s, x) => s + x, 0);

function pnlByToken(trades) {
    const rows = [...trades].sort((a, b) =>
        String(a.created_at).localeCompare(String(b.created_at)) || (a.id - b.id));
    const by = new Map();
    for (const t of rows) {
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
        r.netWithOpen = r.received - r.spent + r.queue.reduce((s, q) => s + q.cost, 0);
        delete r.queue;
        if (r.buys === 0) by.delete(addr);
    }
    return by;
}

async function fetchAll(sb, table, cols, expId) {
    const rows = [];
    let offset = 0;
    while (true) {
        const { data, error } = await sb.from(table).select(cols)
            .eq('experiment_id', expId).order('id', { ascending: true }).range(offset, offset + 999);
        if (error) throw new Error(`${table}: ` + error.message);
        rows.push(...data);
        if (data.length < 1000) break;
        offset += 1000;
    }
    return rows;
}

async function main() {
    const sb = dbManager.getClient();

    const trades = {}, tpaB2 = new Map();
    for (const [arm, id] of Object.entries(ARMS)) {
        trades[arm] = await fetchAll(sb, 'trades',
            'id,token_address,trade_direction,input_amount,output_amount,success,trade_status,created_at', id);
    }
    // b2 的 TPA 行（token → score/verdict/gmgnPct）——门拦截票的分数来源
    for (const r of await fetchAll(sb, 'token_position_analyses',
        'token_address,verdict,block_reasons,holding_factors', ARMS.b2)) {
        tpaB2.set(r.token_address, {
            score: r.holding_factors?.TPAPre_tokenScore,
            verdict: r.verdict,
            gmgn: r.holding_factors?.TPAPre_gmgnUserPct,
            reasons: r.block_reasons || [],
        });
    }

    // T = tnone 最后成交（79% 截断锚）
    let T = null;
    for (const t of trades.tnone) if (t.created_at && (!T || t.created_at > T)) T = t.created_at;
    console.log(`窗口对齐锚 T = tnone 最后成交 ${T}`);

    // ── ① 四臂对齐净额 ──
    console.log(`\n════ ① 四臂对齐净额（trades ≤ T）════`);
    const pnl = {};
    for (const arm of Object.keys(ARMS)) {
        pnl[arm] = pnlByToken(trades[arm].filter(t => !t.created_at || t.created_at <= T));
        const nets = [...pnl[arm].values()].map(r => r.netWithOpen);
        const w = nets.filter(x => x > 0).length;
        console.log(`  ${arm.padEnd(6)} 买=${String(pnl[arm].size).padStart(3)}  净=${f2(sum(nets)).padStart(9)}  胜=${w}/${pnl[arm].size}`);
    }
    console.log(`  （b2−tnone 差 = tokenScore 门净效应；notpa−tnone 差 = TPA 机制扰动，理论 ≈0）`);

    // ── ② tokenScore 门拦截票明细 ──
    console.log(`\n════ ② 门拦截票（tnone 实买且 b2 未买，≤T；其 tnone 盈亏 = 门放弃的盈亏）════`);
    const blocked = [...pnl.tnone.keys()].filter(t => !pnl.b2.has(t));
    const recs = blocked.map(t => ({
        token: t, pnl: pnl.tnone.get(t).netWithOpen,
        score: tpaB2.get(t)?.score ?? null, verdict: tpaB2.get(t)?.verdict ?? '无TPA行',
    })).sort((a, b) => a.pnl - b.pnl);
    const bWin = recs.filter(r => r.pnl > 0), bLose = recs.filter(r => r.pnl <= 0);
    console.log(`  拦截合计 ${recs.length} 票：放弃赢 ${bWin.length} 票 ${f2(sum(bWin.map(r => r.pnl)))} / 避免亏 ${bLose.length} 票 ${f2(sum(bLose.map(r => r.pnl)))}`);
    console.log(`  （门净效应 = 放弃赢 − 避免亏的绝对值 = ${f2(sum(bWin.map(r => r.pnl)) + sum(bLose.map(r => r.pnl)))}；负数 = 门在贴钱）`);
    console.log(`  ── 明细（pnl 升序；score=b2 TPA 行 tokenScore，verdict=b2 判定）──`);
    for (const r of recs) console.log(`    ${f2(r.pnl).padStart(9)}  score=${r.score == null ? 'null' : r.score}  ${r.verdict}  ${r.token}`);

    // ── ③ 反向（b2 买 tnone 未买：时序扰动对照，应极少）──
    const rev = [...pnl.b2.keys()].filter(t => !pnl.tnone.has(t));
    console.log(`\n  反向（b2 有 tnone 无）${rev.length} 票（时序扰动对照）`);
    for (const t of rev) console.log(`    ${f2(pnl.b2.get(t).netWithOpen).padStart(9)}  ${t}`);

    // ── ④ 两张案例票定位 ──
    console.log(`\n════ ④ 案例票定位 ════`);
    for (const [tag, tok] of [['0xac5174ec（用户点名·散户接盘票）', CASE_AC], ['0x6b973c（反例锚定·捆绑票）', CASE_6B]]) {
        const b2r = tpaB2.get(tok);
        console.log(`  ${tag}`);
        console.log(`    b2 TPA: score=${b2r?.score} verdict=${b2r?.verdict} gmgnPct=${b2r?.gmgn}`);
        for (const arm of Object.keys(ARMS)) {
            const r = pnl[arm].get(tok);
            console.log(`    ${arm.padEnd(6)} ${r ? `买，净 ${f2(r.netWithOpen)}` : '未买'}`);
        }
    }

    process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
