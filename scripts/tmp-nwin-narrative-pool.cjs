#!/usr/bin/env node
// ============================================================================
// T88 叙事通过票池回测：全史臂→长窗 M 笔换轨（用户质疑「20 vs 300 差异过大」）
//   样本=近 N 天 token_narrative rating ∈ {high, mid}（=2|3，买腿真实候选池——
//   fire 样本有选择偏差（净比门已过才进样本）、全量池无叙事过滤，本池补盲区）
//   锚 tN=叙事落定时刻（updated_at）；叙事通过后扫 45min，量门 buyB>=0.25；
//   各臂首次满足帧+进场质量（+30min peak/last，价格滤 outlier）：
//     cur = hist>=40 OR win20>=40（现行）
//     armM = winM>=40 OR win20>=40（M ∈ 50/80/100/150/200/300）
//   聚合：①各档满足率/首帧延迟（进场速度）②新增放行面 vs 翻车面双向收益
//        ③档间分歧（用户问题核心：M=100 vs 300 在叙事票上的真实差异）
//   用法：node scripts/tmp-nwin-narrative-pool.cjs [--days 10] [--stride 8]  （182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();

const argv = process.argv;
const DAYS = Number(argv.includes('--days') ? argv[argv.indexOf('--days') + 1] : 10);
const STRIDE = Number(argv.includes('--stride') ? argv[argv.indexOf('--stride') + 1] : 8);
const SCAN_MIN = 45, EVAL_MIN = 30, TH = 40, W20 = 20, DUST = 0.001;
const MS = [50, 80, 100, 150, 200, 300];

const pct = (a) => parseFloat((a * 100).toFixed(2));
const q = (arr, p) => {
    if (!arr.length) return null;
    const s = [...arr].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

async function fetchTicks(token) {
    const rows = [];
    let afterId = 0;
    for (;;) {
        const { data: page, error } = await db.from('wss_price_ticks')
            .select('id, trade_type, price_bnb, bnb_amount, price_outlier, block_number, log_index, block_time')
            .eq('token_address', token).gt('id', afterId)
            .order('id', { ascending: true }).limit(1000);
        if (error) throw new Error(error.message);
        if (!page || !page.length) break;
        rows.push(...page);
        afterId = page[page.length - 1].id;
        if (page.length < 1000) break;
    }
    rows.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
    return rows;
}

function tailRatio(evts, n) {
    let b = 0, s = 0;
    for (let j = Math.max(0, evts.length - n); j < evts.length; j++) {
        if (evts[j].buy) b += evts[j].bnb; else s += evts[j].bnb;
    }
    return b > 0 ? (b - s) / b * 100 : -Infinity;
}

function evalEntry(prices, ts, entryPrice) {
    if (!entryPrice || entryPrice <= 0) return null;
    const win = prices.filter((p) => p.ts > ts && p.ts <= ts + EVAL_MIN * 60);
    if (win.length < 3) return null;
    let peak = 0, last = 0;
    for (const p of win) { if (p.price > peak) peak = p.price; last = p.price; }
    return { peak: pct((peak - entryPrice) / entryPrice), last: pct((last - entryPrice) / entryPrice) };
}

/** 重放：tN 前建环（全史），tN 起记各臂首满足帧 */
function replay(ticks, tN) {
    let buyB = 0, sellB = 0;
    const evts = [], prices = [];
    let cur = null;
    const arm = {};
    for (const m of MS) arm[m] = null;
    let tNFrame = null;
    const scanEnd = tN + SCAN_MIN * 60, evEnd = tN + (SCAN_MIN + EVAL_MIN) * 60;
    for (const t of ticks) {
        if (t.bt > evEnd) break;
        if (t.bnb >= DUST) {
            if (t.buy) buyB += t.bnb; else sellB += t.bnb;
            evts.push({ ts: t.bt, buy: t.buy, bnb: t.bnb });
        }
        if (!t.out) prices.push({ ts: t.bt, price: t.price });
        if (t.bt <= tN) {
            tNFrame = {
                hist: buyB > 0 ? (buyB - sellB) / buyB * 100 : -100,
                w20: tailRatio(evts, W20),
                n: evts.length,
            };
            for (const m of MS) tNFrame['w' + m] = tailRatio(evts, m);
            continue;
        }
        if (t.bt > scanEnd) continue;
        if (buyB < 0.25) continue; // 量门近似
        const hist = buyB > 0 ? (buyB - sellB) / buyB * 100 : -100;
        const w20 = tailRatio(evts, W20);
        if (!cur && (hist >= TH || w20 >= TH)) cur = { ts: t.bt, price: t.price, byHist: hist >= TH };
        for (const m of MS) {
            if (arm[m]) continue;
            const wm = tailRatio(evts, m);
            if (wm >= TH || w20 >= TH) arm[m] = { ts: t.bt, price: t.price, byLong: wm >= TH };
        }
    }
    return { cur, arm, prices, tNFrame };
}

async function main() {
    const t0 = new Date(Date.now() - DAYS * 86400e3).toISOString();
    // 叙事通过票（rating 2|3）；updated_at=最新分析落定时刻=叙事通过锚
    // rating=六信封终态投影（resolveFinalRating 顺序链的终列 final_result->>rating；
    // 直查终列等价于 resolveFinalRating 返回 high/mid 的形状——早信封出终值的行
    // final_result 同样落终值（save 链整行写）；锚=analyzed_at）
    const { data: rows, error } = await db.from('token_narrative')
        .select('token_address, analyzed_at, final_result->>rating as rating')
        .in('final_result->>rating', ['high', 'mid'])
        .gte('analyzed_at', t0)
        .order('analyzed_at', { ascending: false })
        .limit(20000);
    if (error) throw new Error(error.message);
    const pool = rows.filter((_, i) => i % STRIDE === 0);
    console.log(`${DAYS}d 叙事通过=${rows.length} 抽样 stride=${STRIDE} → ${pool.length} 票`);

    const out = [];
    let done = 0, active = 0;
    for (const r of pool) {
        try {
            const raw = await fetchTicks(r.token_address);
            const ticks = raw.map((x) => ({
                bt: new Date(x.block_time).getTime() / 1000, buy: x.trade_type === 'buy',
                bnb: x.bnb_amount, price: x.price_bnb, out: x.price_outlier,
            }));
            if (ticks.length < 15) continue;
            const tN = new Date(r.analyzed_at).getTime() / 1000;
            if (tN <= ticks[0].bt) continue; // 叙事早于首 tick（盲区形状，无法锚定）
            const rep = replay(ticks, tN);
            active++;
            const rec = { token: r.token_address, rating: r.rating, n: ticks.length, tNFrame: rep.tNFrame };
            rec.cur = rep.cur;
            rec.curEv = rep.cur ? evalEntry(rep.prices, rep.cur.ts, rep.cur.price) : null;
            for (const m of MS) {
                rec['a' + m] = rep.arm[m];
                rec['aEv' + m] = rep.arm[m] ? evalEntry(rep.prices, rep.arm[m].ts, rep.arm[m].price) : null;
                if (rec['a' + m] && rec.cur) rec['d' + m] = Math.round((rec['a' + m].ts - rec.cur.ts));
            }
            out.push(rec);
        } catch (e) { out.push({ token: r.token_address, err: e.message }); }
        if (++done % 100 === 0) console.log(`  …${done}/${pool.length}（活跃 ${active}）`);
    }
    require('fs').writeFileSync('/tmp/nwin-narrative-pool.json', JSON.stringify(out));

    const ok = out.filter((r) => !r.err);
    console.log(`\n活跃票（≥15 tick 且可锚定）=${ok.length}`);
    const curOK = ok.filter((r) => r.cur);
    console.log(`现行臂满足=${curOK.length}/${ok.length}`);
    const curPeaks = curOK.map((r) => r.curEv?.peak).filter((x) => x != null);
    console.log(`现行首帧进场 peak p25/50/75=${q(curPeaks, .25)}%/${q(curPeaks, .5)}%/${q(curPeaks, .75)}% peak≤0=${curPeaks.filter((x) => x <= 0).length}`);

    console.log(`\n=== 各 M 档（叙事通过后 45min 首满足）===`);
    for (const m of MS) {
        const sat = ok.filter((r) => r['a' + m]);
        const peaks = sat.map((r) => r['aEv' + m]?.peak).filter((x) => x != null);
        const lasts = sat.map((r) => r['aEv' + m]?.last).filter((x) => x != null);
        // 分歧面：M 满足且现行不满足（新增）/ 现行满足且 M 不满足（翻车）
        const add = sat.filter((r) => !r.cur);
        const flip = curOK.filter((r) => !r['a' + m]);
        const addP = add.map((r) => r['aEv' + m]?.peak).filter((x) => x != null);
        const flipP = flip.map((r) => r.curEv?.peak).filter((x) => x != null);
        // 首帧延迟差（两臂都满足的票）：d>0=M 晚、d<0=M 早
        const ds = sat.filter((r) => r.cur).map((r) => r['d' + m]);
        console.log(`M=${m}: 满足=${sat.length}  首帧 vs 现行：早=${ds.filter((x) => x < 0).length} 同=${ds.filter((x) => x === 0).length} 晚=${ds.filter((x) => x > 0).length}`
            + `  peak p25/50/75=${q(peaks, .25)}/${q(peaks, .5)}/${q(peaks, .75)}%  lastSum=${lasts.reduce((a, b) => a + b, 0).toFixed(1)}`);
        console.log(`      新增（M放/现行不放）=${add.length}（peak p50=${q(addP, .5)}%）  翻车（现行放/M不放）=${flip.length}（peak p50=${q(flipP, .5)}%）`);
    }

    console.log(`\n=== tN 决策帧（叙事落定时刻各窗值）===`);
    const ff = ok.filter((r) => r.tNFrame);
    const row = (name, fn) => {
        const vals = ff.map(fn).filter((x) => x !== -Infinity && x != null);
        console.log(`  ${name}: p10/p25/p50/p75=${q(vals, .1).toFixed(1)}/${q(vals, .25).toFixed(1)}/${q(vals, .5).toFixed(1)}/${q(vals, .75).toFixed(1)}`);
    };
    row('hist 全史', (r) => r.tNFrame.hist);
    row('win20 短窗', (r) => r.tNFrame.w20);
    for (const m of MS) row('win' + m, (r) => r.tNFrame['w' + m]);
    console.log(`  tN 帧笔数 p25/50/75=${q(ff.map((r) => r.tNFrame.n), .25)}/${q(ff.map((r) => r.tNFrame.n), .5)}/${q(ff.map((r) => r.tNFrame.n), .75)}`);

    dbManager.destroy?.();
    process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
