#!/usr/bin/env node
// ============================================================================
// 0x6b973c 捆绑案后续：uniformBuy 簇前置门量化验证（2026-10-12）
//
// 背景（docs/gm臂豁免反例分析-0x6b973c捆绑案.md）：gm 臂豁免把三方印证的
// 捆绑作弊盘（tokenScore 1.861 正确 block）翻成 approve——gmgnUserPct 单维度
// 区分不了「真散户热度盘」vs「捆绑伪装盘」。本案 uniform 簇 50%/37.5%，
// 因子已计算未被引用（uniformBuyCluster 已弃用口径）。
//
// 本脚本回答三件事：
//   A. gm 臂豁免救回票（block_reasons 含 gmgn_exempt）按 uniformRatio 分桶——
//      豁免里混了几张捆绑票、亏多少；
//   B. notpa（TPA 去除）实买票同样分桶——丢弃 TPA 后捆绑票付出的真实代价；
//   C. 阈值模拟：豁免+uniform 前置门（<X 才豁免）各档净效应——定阈值。
//
// uniform 值口径：token 首个 buy fire 的 preBuyCheckFactors.earlyTradesUniformBuyClusterRatio
// （0-1 或 0-100 兼容，统一归一到 0-1）。
//
// 用法（182）：node scripts/tmp_gmgn_exempt_uniform.cjs
// ============================================================================
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const GM = '944292d6-abe9-435b-8240-bb73b8e7429c';   // gm 臂（GMGN 剔除+豁免60）
const NOTPA = '9e8892b7-0e93-4df5-999f-09fd6c5d5388'; // notpa（TPA 整体不激活）
const ANCHOR = '0x6b973ce6ae7fe37941a3c76af04ec05d3f837777'; // 反例锚定票

const f2 = (x) => (Math.round(x * 10000) / 10000).toFixed(4);
const sum = (a) => a.reduce((s, x) => s + x, 0);

function pnlByToken(trades) {
    // ★ 时间序修复（2026-10-12 0x6b973c 案）：trades 行 id=bigserial 分配序≠提交序
    // （回测 BacktestWriteBuffer 攒批落库），sell 行 id 可先于 buy → FIFO 卖出时 queue 空
    // → 未消耗 cost 留存 + received 直接落袋 = 净额虚高（notpa 实测 +30.6 BNB 虚高）。
    // 一律按 (created_at, id) 时间序重排后再 FIFO。
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

async function fetchAll(sb, table, cols, expId, action) {
    const rows = [];
    let offset = 0;
    while (true) {
        let q = sb.from(table).select(cols).eq('experiment_id', expId);
        if (action) q = q.eq('action', action);
        const { data, error } = await q.order('id', { ascending: true }).range(offset, offset + 999);
        if (error) throw new Error(`${table}: ` + error.message);
        rows.push(...data);
        if (data.length < 1000) break;
        offset += 1000;
    }
    return rows;
}

/** token → 首个 buy fire 的 uniformRatio（归一 0-1；null=因子缺失） */
function firstUniform(signals) {
    const m = new Map();
    for (const s of signals) {
        if (m.has(s.token_address)) continue;
        const f = (s.metadata || {}).preBuyCheckFactors || {};
        let r = f.earlyTradesUniformBuyClusterRatio;
        if (r == null) r = null;
        else if (r > 1) r = r / 100;
        m.set(s.token_address, r);
    }
    return m;
}

const BUCKETS = [[0, .1], [.1, .3], [.3, .5], [.5, 1.01]];
const bName = (i) => i === 0 ? '<10%' : i === 1 ? '[10,30%)' : i === 2 ? '[30,50%)' : '≥50%';

function bucketOf(r) {
    if (r == null) return -1;
    for (let i = 0; i < BUCKETS.length; i++) if (r >= BUCKETS[i][0] && r < BUCKETS[i][1]) return i;
    return BUCKETS.length - 1;
}

function printBuckets(tag, recs /* {token,pnl,uni} */) {
    console.log(`\n── ${tag}（${recs.length} 票）按 uniformRatio 分桶 ──`);
    const nulls = recs.filter(r => r.uni == null);
    if (nulls.length) console.log(`  [null 因子缺失]: ${nulls.length} 票 净=${f2(sum(nulls.map(r => r.pnl)))} 胜=${nulls.filter(r => r.pnl > 0).length}`);
    for (let i = 0; i < BUCKETS.length; i++) {
        const b = recs.filter(r => bucketOf(r.uni) === i);
        if (!b.length) { console.log(`  ${bName(i)}: 0 票`); continue; }
        console.log(`  ${bName(i)}: ${b.length} 票 净=${f2(sum(b.map(r => r.pnl)))} 胜=${b.filter(r => r.pnl > 0).length}/${b.length}${b.length ? `(${Math.round(b.filter(r => r.pnl > 0).length / b.length * 100)}%)` : ''}`);
    }
}

function topBottom(recs, n = 6) {
    const s = [...recs].sort((a, b) => b.pnl - a.pnl);
    return s.slice(0, n).concat(s.slice(-n));
}

async function main() {
    const sb = dbManager.getClient();

    // ── gm 臂 ──
    const tpa = await fetchAll(sb, 'token_position_analyses', 'token_address,verdict,block_reasons,holding_factors', GM);
    const gmTrades = await fetchAll(sb, 'trades', 'id,token_address,trade_direction,input_amount,output_amount,success,trade_status,created_at', GM);
    const gmSig = await fetchAll(sb, 'strategy_signals', 'id,token_address,metadata', GM, 'buy');
    const gmPnl = pnlByToken(gmTrades);
    const gmUni = firstUniform(gmSig);
    const exempt = tpa.filter(r => (r.block_reasons || []).includes('gmgn_exempt'));
    console.log(`gm 臂：TPA 行 ${tpa.length}（approve ${tpa.filter(r => r.verdict === 'approve').length} / block ${tpa.filter(r => r.verdict === 'block').length}）| 豁免救回 ${exempt.length} 票 | 实买 ${gmPnl.size} 票 | 信号 ${gmSig.length}`);

    // ── notpa ──
    const npTrades = await fetchAll(sb, 'trades', 'id,token_address,trade_direction,input_amount,output_amount,success,trade_status,created_at', NOTPA);
    const npSig = await fetchAll(sb, 'strategy_signals', 'id,token_address,metadata', NOTPA, 'buy');
    const npPnl = pnlByToken(npTrades);
    const npUni = firstUniform(npSig);

    const anchorA = { token: ANCHOR, pnl: gmPnl.get(ANCHOR)?.netWithOpen ?? 0, uni: gmUni.get(ANCHOR) };
    const anchorN = { token: ANCHOR, pnl: npPnl.get(ANCHOR)?.netWithOpen ?? 0, uni: npUni.get(ANCHOR) };
    console.log(`notpa：实买 ${npPnl.size} 票 | 锚定票 gm={f2(anchorA.pnl)}(uni=${anchorA.uni}) notpa=${f2(anchorN.pnl)}(uni=${anchorN.uni})`);

    // ── A. gm 豁免票 uniform 分桶 ──
    const exRecs = exempt.map(r => {
        const gmgn = r.holding_factors?.TPAPre_gmgnUserPct;
        return { token: r.token_address, pnl: gmPnl.get(r.token_address)?.netWithOpen ?? null, uni: gmUni.get(r.token_address), gmgn, score: r.holding_factors?.TPAPre_tokenScore };
    });
    // 未实买的豁免票 pnl=null（触发即买入未必——豁免放行后还有其它门；单列）
    const bought = exRecs.filter(r => r.pnl != null);
    const notBought = exRecs.filter(r => r.pnl == null);
    console.log(`\n════ A. gm 臂豁免救回 ${exempt.length} 票（实买 ${bought.length}，未实买 ${notBought.length}——后者被其它门拦，前置门对它们无差）════`);
    printBuckets('A1. 豁免实买票', bought);
    console.log(`  豁免实买合计净额 = ${f2(sum(bought.map(r => r.pnl)))}`);
    console.log(`  ── 豁免票明细（uniform≥0.3 的全部 + 净额最差 6 票；uni/gmgnPct/score/pnl）──`);
    const hiUni = bought.filter(r => r.uni != null && r.uni >= .3);
    for (const r of hiUni) console.log(`    uni=${(r.uni * 100).toFixed(0)}% gmgn=${r.gmgn} score=${r.score} pnl=${f2(r.pnl)} ${r.token}`);
    for (const r of topBottom(bought.filter(r => !hiUni.includes(r)), 4)) {
        console.log(`    uni=${r.uni == null ? 'null' : (r.uni * 100).toFixed(0) + '%'} gmgn=${r.gmgn} score=${r.score} pnl=${f2(r.pnl)} ${r.token}`);
    }

    // ── B. notpa 实买票 uniform 分桶 ──
    console.log(`\n════ B. notpa（TPA 去除）实买 ${npPnl.size} 票 uniform 分桶 ════`);
    const npRecs = [...npPnl.keys()].map(t => ({ token: t, pnl: npPnl.get(t).netWithOpen, uni: npUni.get(t) }));
    printBuckets('B1. notpa 全部实买票', npRecs);
    const npHi = npRecs.filter(r => r.uni != null && r.uni >= .3);
    console.log(`  ── notpa uniform≥30% 票明细（全部；uni/pnl）──`);
    for (const r of [...npHi].sort((a, b) => b.pnl - a.pnl)) console.log(`    uni=${(r.uni * 100).toFixed(0)}% pnl=${f2(r.pnl)} ${r.token}`);

    // ── C. 阈值模拟 ──
    console.log(`\n════ C. 阈值模拟（对实买票；被门排除的票视为不买）════`);
    for (const X of [.2, .3, .4, .5]) {
        const gmKeep = bought.filter(r => r.uni == null || r.uni < X);
        const gmDrop = bought.filter(r => r.uni != null && r.uni >= X);
        const gmNet = sum(gmKeep.map(r => r.pnl));
        const npKeep = npRecs.filter(r => r.uni == null || r.uni < X);
        const npDrop = npRecs.filter(r => r.uni != null && r.uni >= X);
        const npNet = sum(npKeep.map(r => r.pnl));
        console.log(`  X=${X * 100}%：gm豁免+前置门 净=${f2(gmNet)}（弃 ${gmDrop.length} 票 ${f2(sum(gmDrop.map(r => r.pnl)))}）| notpa+uniform门 净=${f2(npNet)}（弃 ${npDrop.length} 票 ${f2(sum(npDrop.map(r => r.pnl)))}）`);
    }
    console.log(`  基线：gm 豁免净=${f2(sum(bought.map(r => r.pnl)))}（${bought.length} 票）| notpa 净=${f2(sum(npRecs.map(r => r.pnl)))}（${npRecs.length} 票）`);

    process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
