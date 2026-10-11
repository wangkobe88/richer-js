#!/usr/bin/env node
// ============================================================================
// GMGN 豁免臂假想盈亏对拍（tnone 部分窗口，2026-10-11）
//
// 背景：tnone（37bd7349，去 tokenScore 门）被用户手动停在窗口 79%
// （10-07 15:45）。已落 trades=271 仍可用于部分对拍：豁免候选 =
// b2(fb4630c7) TPA verdict=block ∩ tnone 实际买入的票——这些票唯一差异
// 就是 tokenScore 门（其余门两臂逐字相同），tnone 的真实买卖路径
// =「豁免救回后会长成什么样」的实际样本。
//
// 对每张交集票在 b2 as_of 复刻 FA 累加（tmp_gmgn_dryrun_b2 同源）算
// gmgnUserPct，分组：
//   ≥60（豁免命中）：gm 臂会救回 → tnone 盈亏 = 豁免臂收益预估
//   <60（不豁免）：gm 臂仍拦（tokenScore 门照拦）→ tnone 盈亏 = gm 相对
//     tnone 的机会成本（这部分票 tnone 买了 gm 不买）
//   供 gm 臂(944292d6)跑完后正式差分参照。
//
// 用法（182）：node scripts/tmp_gmgn_pair_tnone.cjs
// ============================================================================
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const { AGGREGATOR_ROUTER_ADDRS } = require('../src/trading-engine/pre-check/aggregator-routers');

const B2 = 'fb4630c7-f4d4-4127-bf80-b440b5a82953';   // b2 = TPA wallet 重跑臂（3e57ed75 复刻）
const TNONE = '37bd7349-b3b7-4fb5-80af-f9f81615349c'; // tnone = 去 tokenScore 门（用户停在 79%）

const f2 = (x) => (Math.round(x * 10000) / 10000).toFixed(4);
const sum = (a) => a.reduce((s, x) => s + x, 0);

// ── FA 累加复刻（tmp_gmgn_dryrun_b2 同源）──
function initState(createEv) {
    const st = {
        _walletNetTokens: new Map(), _walletRoutedBuyBnb: new Map(),
    };
    if (createEv) { /* creator/supply 不影响占比复刻 */ }
    return st;
}
function feedTick(st, t) {
    const isBuy = t.trade_type === 'buy';
    const bnb = Number(t.bnb_amount) || 0;
    const tok = Number(t.token_amount) || 0;
    const w = t.sender_address || t.trader_address;
    if (!w) return;
    const cur = (st._walletNetTokens.get(w) || 0) + (isBuy ? tok : -tok);
    st._walletNetTokens.set(w, cur);
    if (isBuy && t.trader_address && AGGREGATOR_ROUTER_ADDRS.has(String(t.trader_address).toLowerCase())) {
        st._walletRoutedBuyBnb.set(w, (st._walletRoutedBuyBnb.get(w) || 0) + bnb);
    }
}
function gmgnUserPct(st) {
    let posTotal = 0, gmgnPos = 0;
    for (const [a, net] of st._walletNetTokens) {
        if (net <= 0) continue;
        posTotal += net;
        if ((st._walletRoutedBuyBnb.get(a) || 0) > 0) gmgnPos += net;
    }
    return posTotal > 0 ? Number(((gmgnPos / posTotal) * 100).toFixed(2)) : 0;
}

async function fetchAllTicks(sb, token, asOfIso) {
    const COLS = 'id,trade_type,trader_address,sender_address,bnb_amount,token_amount,block_time';
    const rows = [];
    let lastId = 0, guard = 0;
    while (guard++ < 500) {
        let q = sb.from('wss_price_ticks').select(COLS)
            .eq('token_address', token).gt('id', lastId)
            .order('id', { ascending: true }).limit(1000);
        if (asOfIso) q = q.lt('block_time', asOfIso);
        const page = await q;
        if (page.error) throw new Error('ticks: ' + page.error.message);
        rows.push(...page.data);
        if (page.data.length < 1000) break;
        lastId = page.data[page.data.length - 1].id;
    }
    return rows;
}

/** FIFO per-token PnL（tmp_gmgn_dryrun_b2 同款） */
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

    // ① b2 TPA 行 → block 票集（token → as_of）
    const blockAsOf = new Map();
    {
        let offset = 0;
        while (true) {
            const { data, error } = await sb.from('token_position_analyses')
                .select('token_address,as_of,verdict').eq('experiment_id', B2)
                .eq('verdict', 'block').order('token_address', { ascending: true })
                .range(offset, offset + 999);
            if (error) throw new Error('tpa: ' + error.message);
            for (const r of data) blockAsOf.set(r.token_address, r.as_of);
            if (data.length < 1000) break;
            offset += 1000;
        }
    }
    console.log(`b2 verdict=block 票数 = ${blockAsOf.size}`);

    // ② tnone trades → 买票集 + FIFO PnL
    const trades = [];
    {
        let offset = 0;
        while (true) {
            const { data, error } = await sb.from('trades')
                .select('token_address,trade_direction,input_amount,output_amount,success,trade_status')
                .eq('experiment_id', TNONE).order('id', { ascending: true })
                .range(offset, offset + 999);
            if (error) throw new Error('trades: ' + error.message);
            trades.push(...data);
            if (data.length < 1000) break;
            offset += 1000;
        }
    }
    const pnl = pnlByToken(trades);
    console.log(`tnone trades = ${trades.length}（买票 ${pnl.size}，窗口截至 10-07 15:45 ≈79%）`);

    // ③ 交集：b2 block ∩ tnone 买入（tnone 买入但 b2 被 tokenScore 门拦的唯一差异票）
    const inter = [...pnl.keys()].filter(t => blockAsOf.has(t));
    console.log(`交集（豁免候选全集）= ${inter.length} 票`);

    // ④ 逐票复刻 gmgnUserPct（并发 6）
    const recs = [];
    for (let i = 0; i < inter.length; i += 6) {
        await Promise.all(inter.slice(i, i + 6).map(async (token) => {
            const asOfIso = blockAsOf.get(token);
            const ticks = await fetchAllTicks(sb, token, asOfIso);
            const st = initState();
            for (const t of ticks) feedTick(st, t);
            const p = pnl.get(token);
            recs.push({ token, pct: gmgnUserPct(st), pnl: p.netWithOpen, buys: p.buys, sells: p.sells });
        }));
        process.stdout.write(`  … ${Math.min(i + 6, inter.length)}/${inter.length}\r`);
    }
    recs.sort((a, b) => b.pnl - a.pnl);

    // ⑤ 分组输出
    const hit = recs.filter(r => r.pct >= 60);
    const miss = recs.filter(r => r.pct < 60);
    const line = (tag, a) => `${tag}: ${a.length} 票净 ${f2(sum(a.map(r => r.pnl)))}（胜 ${a.filter(r => r.pnl > 0).length}/${a.length}，已平 ${a.filter(r => r.sells > 0).length}）`;
    console.log(`\n════════ 豁免候选分组（b2 block ∩ tnone 买入）════════`);
    console.log(`  ${line('豁免命中 gmgnUserPct≥60（gm 臂会救回）', hit)}`);
    console.log(`  ${line('不豁免     gmgnUserPct<60（gm 臂仍拦）', miss)}`);

    console.log(`\n── 命中票明细（净额降序；token / pct / pnl / 买卖笔数）──`);
    for (const r of hit) console.log(`  ${r.token}  pct=${r.pct}  pnl=${f2(r.pnl)}  ${r.buys}买${r.sells}卖`);
    console.log(`\n── 不豁免票 TOP10 净额（gm 相对 tnone 的机会成本侧）──`);
    for (const r of miss.slice(0, 10)) console.log(`  ${r.token}  pct=${r.pct}  pnl=${f2(r.pnl)}  ${r.buys}买${r.sells}卖`);

    console.log(`\n⚠ tnone 窗口仅 79%（10-07 15:45 后的豁免候选无样本）；正式差分待 gm 臂 944292d6 跑完`);
    process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
