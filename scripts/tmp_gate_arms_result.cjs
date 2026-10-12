#!/usr/bin/env node
// ============================================================================
// pbc 门消融五臂 + tnone/notpa 终局对拍（2026-10-11）
//
// 臂清单（源全部 = 3e57ed75 窗口 1：10-04 12:47Z → 10-08 13:10Z）：
//   tnone 37bd7349 原门基线（用户停在 79%，参考口径）
//   v0   5517e3db 删 covered/top1 + router 50→30（er>=100 原样）
//   e50  3fcea181 v0 + er 右臂 100→50
//   eno  ae2e352d v0 + lag 门删右臂（lag<300 单臂）
//   enl  74a63f6a v0 + lag 门整条删
//   ec0  0c01d972 v0 + condition 删 cycle 子句 + config 删 tokenCycle 段
//   notpa 9e8892b7 TPA 整体不激活（pbc/condition 与 tnone 逐字同）
//
// 输出：
//   ① 总表（各臂全窗口原生净额）
//   ② 窗口对齐表（trades 截至 tnone 最后成交时刻 T，干净差分）
//   ③ er 变体差分（vs v0）：独有/共同票盈亏 + e50 独有票进场 er 值
//   ④ cycle 差分（ec0 vs v0）：ec0 独有票明细 + v0 侧 fire 时 tokenCycle 档
//   ⑤ notpa vs tnone（对齐）：净额差 + 信号数差（TPA 照跑 vs 不跑机制成本，
//      condition 无 TPA 门理论应 ≈0）
//
// 用法（182）：node scripts/tmp_gate_arms_result.cjs
// ============================================================================
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const ARMS = {
    tnone: '37bd7349-b3b7-4fb5-80af-f9f81615349c',
    v0: '5517e3db-608b-4572-bcc9-159fc46f3b26',
    e50: '3fcea181-3336-49ac-9023-bc8832a88d25',
    eno: 'ae2e352d-7573-48e8-9776-b20e74628e29',
    enl: '74a63f6a-3e11-4c41-8911-6f1873f81c06',
    ec0: '0c01d972-88ab-4aed-96fd-89804f323737',
    notpa: '9e8892b7-0e93-4df5-999f-09fd6c5d5388',
};

const f2 = (x) => (Math.round(x * 10000) / 10000).toFixed(4);
const sum = (a) => a.reduce((s, x) => s + x, 0);

/** FIFO per-token PnL（tmp_gmgn_pair 同款；trades 行带 created_at 供窗口对齐） */
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

async function fetchAll(sb, table, cols, expId) {
    const rows = [];
    let offset = 0;
    while (true) {
        let q = sb.from(table).select(cols).eq('experiment_id', expId);
        if (table === 'strategy_signals') q = q.eq('action', 'buy');
        const { data, error } = await q.order('id', { ascending: true })
            .range(offset, offset + 999);
        if (error) throw new Error(`${table}(${expId}): ` + error.message);
        rows.push(...data);
        if (data.length < 1000) break;
        offset += 1000;
    }
    return rows;
}

const fmtRow = (tag, pnl) => {
    const nets = [...pnl.values()].map(r => r.netWithOpen);
    const wins = nets.filter(x => x > 0).length;
    const n = pnl.size;
    return `  ${tag.padEnd(6)} 买token=${String(n).padStart(3)}  净额=${f2(sum(nets)).padStart(9)}  胜=${wins}/${n}${n ? `(${Math.round(wins / n * 100)}%)` : ''}  均票=${n ? f2(sum(nets) / n) : 'n/a'}`;
};

/** 差分票明细：only-in-A（A 买 B 未买），带 pnl 排序；cycle/er 增强从 signals 查 */
function diffDetail(tagA, tagB, pnlA, pnlB, meta /* arm→token→{cyc,er} */) {
    const only = [...pnlA.keys()].filter(t => !pnlB.has(t));
    const nets = only.map(t => pnlA.get(t).netWithOpen);
    console.log(`\n── 仅 ${tagA} 买入（${tagA}−${tagB} 独有 ${only.length} 票）──`);
    if (!only.length) return [];
    console.log(`  净额合计=${f2(sum(nets))}  胜=${nets.filter(x => x > 0).length}/${only.length}`);
    const sorted = only.sort((a, b) => pnlA.get(b).netWithOpen - pnlA.get(a).netWithOpen);
    const top = sorted.slice(0, 8).concat(sorted.slice(-4));
    for (const t of top) {
        const r = pnlA.get(t);
        const m = meta.get(t);
        const extra = m ? `  cyc=${m.cyc} er=${m.er}` : '';
        console.log(`    ${f2(r.netWithOpen).padStart(9)}  ${t}${extra}  ${r.buys}买${r.sells}卖`);
    }
    return sorted;
}

async function main() {
    const sb = dbManager.getClient();

    // ── 拉全量：每臂 trades + buy signals ──
    const trades = {}, signals = {};
    for (const [arm, id] of Object.entries(ARMS)) {
        trades[arm] = await fetchAll(sb, 'trades',
            'token_address,trade_direction,input_amount,output_amount,success,trade_status,created_at', id);
        signals[arm] = await fetchAll(sb, 'strategy_signals', 'id,token_address,created_at,metadata', id);
        console.log(`[拉取] ${arm}: trades=${trades[arm].length} buySignals=${signals[arm].length}`);
    }

    // tnone 最后成交时刻 = 窗口对齐锚 T（79% 截断）
    let tAnchor = null;
    for (const t of trades.tnone) if (t.created_at && (!tAnchor || t.created_at > tAnchor)) tAnchor = t.created_at;
    console.log(`\n窗口对齐锚 T = tnone 最后成交 ${tAnchor}`);

    // ── metadata 增强：token → 最后一次 fire 的 tokenCycle / earlyReturn ──
    const metaOf = (arm) => {
        const m = new Map();
        for (const s of signals[arm]) {
            const f = (s.metadata || {}).preBuyCheckFactors || {};
            const cyc = (s.metadata || {}).trendFactors?.tokenCycle;
            const prev = m.get(s.token_address);
            // 取 er 非 null 的最后一次（买点证据），否则最新
            if (!prev || (f.earlyReturn != null && prev.er == null)) {
                m.set(s.token_address, { cyc: prev?.cyc ?? cyc, er: f.earlyReturn != null ? Math.round(f.earlyReturn) : prev?.er });
            }
            if (cyc != null) { const cur = m.get(s.token_address); cur.cyc = cyc; }
        }
        return m;
    };
    const metaV0 = metaOf('v0'), metaEnl = metaOf('enl'), metaE50 = metaOf('e50');

    // ── ① 总表（全窗口原生）──
    const pnlAll = {};
    for (const arm of Object.keys(ARMS)) pnlAll[arm] = pnlByToken(trades[arm]);
    console.log(`\n════ ① 总表（全窗口原生；tnone 为 79% 截断参考）════`);
    for (const arm of Object.keys(ARMS)) console.log(fmtRow(arm, pnlAll[arm]));

    // ── ② 窗口对齐表（trades ≤ T）──
    console.log(`\n════ ② 窗口对齐表（trades 截至T=${tAnchor}）════`);
    const pnlAl = {};
    for (const arm of Object.keys(ARMS)) {
        const cut = trades[arm].filter(t => !t.created_at || t.created_at <= tAnchor);
        pnlAl[arm] = pnlByToken(cut);
        console.log(fmtRow(arm, pnlAl[arm]));
    }

    // ── ③ er 变体差分（vs v0，全窗口）──
    console.log(`\n════ ③ er 变体差分（vs v0，全窗口）════`);
    for (const arm of ['e50', 'eno', 'enl']) {
        const a = pnlAll[arm], b = pnlAll.v0;
        const common = [...a.keys()].filter(t => b.has(t));
        let dNet = 0;
        for (const t of common) dNet += a.get(t).netWithOpen - b.get(t).netWithOpen;
        console.log(`\n◆ ${arm} vs v0：共同 ${common.length} 票 同票净额差合计=${f2(dNet)}（同票不同买点）`);
        diffDetail(arm, 'v0', a, b, arm === 'e50' ? metaE50 : (arm === 'enl' ? metaEnl : metaV0));
        diffDetail('v0', arm, b, a, metaV0);
    }

    // ── ④ cycle 差分（ec0 vs v0，全窗口）──
    console.log(`\n════ ④ cycle 门差分（ec0 vs v0，全窗口）════`);
    {
        const a = pnlAll.ec0, b = pnlAll.v0;
        const common = [...a.keys()].filter(t => b.has(t));
        let dNet = 0;
        for (const t of common) dNet += a.get(t).netWithOpen - b.get(t).netWithOpen;
        console.log(`◆ 共同 ${common.length} 票 同票净额差合计=${f2(dNet)}`);
        diffDetail('ec0', 'v0', a, b, metaV0);
        diffDetail('v0', 'ec0', b, a, metaV0);
    }

    // ── ⑤ notpa vs tnone（窗口对齐 + 信号数）──
    console.log(`\n════ ⑤ notpa vs tnone（TPA 不跑 vs 照跑落表；对齐窗口）════`);
    {
        const a = pnlAl.notpa, b = pnlAl.tnone;
        const onlyA = [...a.keys()].filter(t => !b.has(t));
        const onlyB = [...b.keys()].filter(t => !a.has(t));
        console.log(`  notpa 独有 ${onlyA.length} 票 净=${f2(sum(onlyA.map(t => a.get(t).netWithOpen)))}`);
        console.log(`  tnone 独有 ${onlyB.length} 票 净=${f2(sum(onlyB.map(t => b.get(t).netWithOpen)))}`);
        const common = [...a.keys()].filter(t => b.has(t));
        let dNet = 0;
        for (const t of common) dNet += a.get(t).netWithOpen - b.get(t).netWithOpen;
        console.log(`  共同 ${common.length} 票 同票净额差=${f2(dNet)}（机制扰动，理论≈0）`);
        const sigCut = (arm) => signals[arm].filter(s => !s.created_at || s.created_at <= tAnchor).length;
        console.log(`  信号数（≤T）：notpa=${sigCut('notpa')} tnone=${sigCut('tnone')}`);
    }

    process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
