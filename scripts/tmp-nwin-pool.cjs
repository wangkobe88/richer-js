#!/usr/bin/env node
// ============================================================================
// T87 全量票池扫描：净买门 OR 臂 10s 时间窗 vs N 笔窗——新增放行面/拦截面双向质量
//   （fire 票样本有选择偏差：被净比门拦的票无 signal 行；本版扫全量抽样票池）
//   口径：尘门 bnb>=0.001 入环；链上真序；扫窗 45min；量门近似 buyB>=0.25；
//   差异 tick=hist<40 时两窗分叉：
//     新增面 ADD: winT10<40(含 null) && winN>=40  → N 版会放、现行不放
//     拦截面 BLOCK: winT10>=40 && winN<40          → 现行会放、N 版不放（若其它门同刻满足）
//   进场质量=帧后 30min peak/last（价格滤 outlier）；基准=每票现行版首个 OR 真帧
//   用法：node scripts/tmp-nwin-pool.cjs [--stride 40]   （182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();

const DAYS = 10, SCAN_MIN = 45, EVAL_MIN = 30, TH = 40, W10 = 10000, DUST = 0.001;
const NS = [10, 15, 20, 25, 30];
const STRIDE = Number(require('process').argv.includes('--stride')
    ? process.argv[process.argv.indexOf('--stride') + 1] : 40);

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

function winRatio(evts, cutoff) {
    let b = 0, s = 0;
    for (const e of evts) { if (e.ts < cutoff) continue; if (e.buy) b += e.bnb; else s += e.bnb; }
    return b > 0 ? (b - s) / b * 100 : -Infinity;
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

function replay(ticks) {
    const t0 = ticks[0].bt;
    const scanEnd = t0 + SCAN_MIN * 60, evEnd = t0 + (SCAN_MIN + EVAL_MIN) * 60;
    let buyB = 0, sellB = 0;
    const evts = [], prices = [];
    let baseA = null; // 现行版首个 OR 真帧（量门下）
    const firstAdd = {}, firstBlock = {};
    for (const k of NS) { firstAdd[k] = null; firstBlock[k] = null; }
    for (const t of ticks) {
        if (t.bt > evEnd) break;
        if (t.bnb >= DUST) {
            if (t.buy) buyB += t.bnb; else sellB += t.bnb;
            evts.push({ ts: t.bt, buy: t.buy, bnb: t.bnb });
        }
        if (!t.out) prices.push({ ts: t.bt, price: t.price });
        if (t.bt > scanEnd) continue;
        if (buyB < 0.25) continue; // 量门近似
        const hist = buyB > 0 ? (buyB - sellB) / buyB * 100 : -100;
        const wT = winRatio(evts, t.bt - W10);
        const ora = hist >= TH || wT >= TH;
        if (!baseA && ora) baseA = { ts: t.bt, price: t.price };
        for (const k of NS) {
            const wN = tailRatio(evts, k);
            if (hist < TH && !ora && wN >= TH && !firstAdd[k]) firstAdd[k] = { ts: t.bt, price: t.price, hist, wT, wN };
            if (hist < TH && ora && wN < TH && !firstBlock[k]) firstBlock[k] = { ts: t.bt, price: t.price, hist, wT, wN };
        }
    }
    return { baseA, firstAdd, firstBlock, prices };
}

async function main() {
    const t0 = new Date(Date.now() - DAYS * 86400e3).toISOString();
    const rows = [];
    let afterId = 0;
    for (;;) {
        const { data: page, error } = await db.from('wss_events')
            .select('id, platform, payload->>token')
            .eq('kind', 'token_create').gte('created_at', t0).gt('id', afterId)
            .order('id', { ascending: true }).limit(1000);
        if (error) throw new Error(error.message);
        if (!page || !page.length) break;
        rows.push(...page);
        afterId = page[page.length - 1].id;
        if (page.length < 1000) break;
    }
    const pool = rows.filter((r) => (r.platform === 'fourmeme' || r.platform === 'flap') && r.token)
        .filter((_, i) => i % STRIDE === 0);
    console.log(`10d 创建=${rows.length} 抽样 stride=${STRIDE} → ${pool.length} 票`);

    const out = [];
    let done = 0, active = 0;
    for (const r of pool) {
        try {
            const raw = await fetchTicks(r.token);
            const ticks = raw.map((x) => ({
                bt: new Date(x.block_time).getTime() / 1000, buy: x.trade_type === 'buy',
                bnb: x.bnb_amount, price: x.price_bnb, out: x.price_outlier,
            }));
            if (ticks.length < 15) continue; // 死票/极冷票（N 窗永远凑不齐证据）
            active++;
            const rep = replay(ticks);
            const rec = { token: r.token, plat: r.platform, n: ticks.length,
                base: rep.baseA ? { ts: rep.baseA.ts, price: rep.baseA.price } : null,
                baseEv: rep.baseA ? evalEntry(rep.prices, rep.baseA.ts, rep.baseA.price) : null };
            for (const k of NS) {
                rec['add' + k] = rep.firstAdd[k];
                rec['addEv' + k] = rep.firstAdd[k] ? evalEntry(rep.prices, rep.firstAdd[k].ts, rep.firstAdd[k].price) : null;
                rec['blk' + k] = rep.firstBlock[k];
                rec['blkEv' + k] = rep.firstBlock[k] ? evalEntry(rep.prices, rep.firstBlock[k].ts, rep.firstBlock[k].price) : null;
            }
            out.push(rec);
        } catch (e) { out.push({ token: r.token, err: e.message }); }
        if (++done % 200 === 0) console.log(`  …${done}/${pool.length}（活跃 ${active}）`);
    }

    const ok = out.filter((r) => !r.err);
    console.log(`\n活跃票（≥15 tick）=${ok.length}`);
    const baseEv = ok.map((r) => r.baseEv).filter(Boolean);
    console.log(`基准=现行 OR 真帧（n=${ok.filter((r) => r.base).length}）peak p25/50/75=${q(baseEv.map((e) => e.peak), .25)}%/${q(baseEv.map((e) => e.peak), .5)}%/${q(baseEv.map((e) => e.peak), .75)}%`);

    for (const k of NS) {
        const adds = ok.filter((r) => r['add' + k]);
        const evs = adds.map((r) => r['addEv' + k]).filter(Boolean);
        const peaks = evs.map((e) => e.peak);
        const blks = ok.filter((r) => r['blk' + k]);
        const bev = blks.map((r) => r['blkEv' + k]).filter(Boolean);
        const bpeaks = bev.map((e) => e.peak);
        const pureAdd = adds.filter((r) => !r.base); // 现行版全 45min 无 OR 真帧=纯新增放行票
        console.log(`\nN=${k}: 新增面=${adds.length}（纯新增=${pureAdd.length}）  拦截面=${blks.length}`);
        if (evs.length) console.log(`  新增进场 peak p25/50/75=${q(peaks, .25)}%/${q(peaks, .5)}%/${q(peaks, .75)}% peak≤0=${Math.round(peaks.filter((x) => x <= 0).length / peaks.length * 100)}% 末价 p50=${q(evs.map((e) => e.last), .5)}%`);
        if (bev.length) console.log(`  拦截帧 peak p25/50/75=${q(bpeaks, .25)}%/${q(bpeaks, .5)}%/${q(bpeaks, .75)}%（深负=N 版拦得对）`);
        const pe = pureAdd.map((r) => r['addEv' + k]).filter(Boolean).map((e) => e.peak);
        if (pe.length) console.log(`  纯新增票进场 peak p25/50/75=${q(pe, .25)}%/${q(pe, .5)}%/${q(pe, .75)}%`);
    }

    require('fs').writeFileSync('/tmp/nwin-pool.json', JSON.stringify(out, null, 1));
    console.log('\n明细 → /tmp/nwin-pool.json');
    process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
