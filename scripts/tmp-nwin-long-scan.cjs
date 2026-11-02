#!/usr/bin/env node
// ============================================================================
// T88 回放扫描：全史臂 tradesNetBuyRatio → 长窗 N 笔尾窗换轨（0xdf7a 案 T87 后续）
//   对拍：现行 OR 臂（hist>=40 OR win20>=40）vs 新案（winNL>=40 OR win20>=40）
//   NL 候选 50/80/100/150/200/300；样本=近 10 天 BUY signal 票。
//   重放口径对齐 FA：尘门 0.001；链上真序；45min 扫窗 +30min 评估；量门 buyB>=0.25。
//   输出 /tmp/nwin-long-scan.json + stdout 摘要。
// 用法：node scripts/tmp-nwin-long-scan.cjs   （182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();

const DAYS = 10, SCAN_MIN = 45, EVAL_MIN = 30, TH = 40, W20 = 20;
const NL = [50, 80, 100, 150, 200, 300];
const DUST = 0.001;

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
    if (entryPrice <= 0) return null;
    const win = prices.filter((p) => p.ts > ts && p.ts <= ts + EVAL_MIN * 60);
    if (win.length < 3) return null;
    let peak = 0, last = 0;
    for (const p of win) { if (p.price > peak) peak = p.price; last = p.price; }
    return { peak: pct((peak - entryPrice) / entryPrice), last: pct((last - entryPrice) / entryPrice) };
}

function replay(ticks, fireSec) {
    const t0 = ticks[0].bt;
    const scanEnd = t0 + SCAN_MIN * 60;
    const evEnd = t0 + (SCAN_MIN + EVAL_MIN) * 60;
    let buyB = 0, sellB = 0;
    const evts = [];
    const prices = [];
    let firstCur = null;                  // 现行 OR 臂（hist OR win20）
    const firstLng = {};                  // 新案 OR 臂（winNL OR win20）
    for (const k of NL) firstLng[k] = null;
    const segAdd = {}, segLose = {};      // 新案新增段 / 新案丢失段
    for (const k of NL) { segAdd[k] = []; segLose[k] = []; }
    let fireFrame = null;
    for (const t of ticks) {
        if (t.bt > evEnd) break;
        if (t.bnb >= DUST) {
            if (t.buy) buyB += t.bnb; else sellB += t.bnb;
            evts.push({ ts: t.bt, buy: t.buy, bnb: t.bnb });
        }
        if (!t.out) prices.push({ ts: t.bt, price: t.price });
        if (fireSec != null && t.bt <= fireSec) {
            fireFrame = { hist: buyB > 0 ? (buyB - sellB) / buyB * 100 : -100, win20: tailRatio(evts, 20) };
            for (const k of NL) fireFrame['win' + k] = tailRatio(evts, k);
        }
        if (t.bt > scanEnd) continue;
        if (firstCur && NL.every((k) => firstLng[k])) continue;
        const hist = buyB > 0 ? (buyB - sellB) / buyB * 100 : -100;
        const w20 = tailRatio(evts, W20);
        const volOk = buyB >= 0.25;
        if (!firstCur && volOk && (hist >= TH || w20 >= TH)) {
            firstCur = { ts: t.bt, price: t.price, byHist: hist >= TH };
        }
        for (const k of NL) {
            if (firstLng[k]) continue;
            const wk = tailRatio(evts, k);
            if (volOk && (wk >= TH || w20 >= TH)) {
                firstLng[k] = { ts: t.bt, price: t.price, byLong: wk >= TH };
            }
        }
        if (volOk) {
            const ora = hist >= TH || w20 >= TH;
            for (const k of NL) {
                const orb = tailRatio(evts, k) >= TH || w20 >= TH;
                const sa = segAdd[k], sl = segLose[k];
                if (orb && !ora) {
                    if (!sa.length || sa[sa.length - 1].end != null) sa.push({ start: t.bt, price: t.price, end: null });
                    else sa[sa.length - 1].end = t.bt;
                }
                if (ora && !orb) {
                    if (!sl.length || sl[sl.length - 1].end != null) sl.push({ start: t.bt, price: t.price, end: null });
                    else sl[sl.length - 1].end = t.bt;
                }
            }
        }
    }
    const segAddEv = {}, segLoseEv = {};
    for (const k of NL) {
        segAddEv[k] = segAdd[k].map((g) => ({ g, ev: evalEntry(prices, g.start, g.price) })).filter((x) => x.ev);
        segLoseEv[k] = segLose[k].map((g) => ({ g, ev: evalEntry(prices, g.start, g.price) })).filter((x) => x.ev);
    }
    return { firstCur, firstLng, prices, fireFrame, segAddEv, segLoseEv };
}

async function main() {
    const t0 = new Date(Date.now() - DAYS * 86400e3).toISOString();
    const { data: sigs, error } = await db.from('strategy_signals')
        .select('token_address, created_at, experiment_id')
        .eq('signal_type', 'BUY').gte('created_at', t0).limit(3000);
    if (error) throw new Error(error.message);
    const tokens = new Map();
    for (const s of sigs) {
        const cur = tokens.get(s.token_address);
        if (!cur || s.created_at < cur.fire) tokens.set(s.token_address, { fire: s.created_at, exp: s.experiment_id });
    }
    console.log(`样本票=${tokens.size}`);

    const out = [];
    let done = 0;
    for (const [token, meta] of tokens) {
        try {
            const raw = await fetchTicks(token);
            const ticks = raw.map((r) => ({
                bt: new Date(r.block_time).getTime() / 1000,
                buy: r.trade_type === 'buy',
                bnb: r.bnb_amount, price: r.price_bnb, out: r.price_outlier,
            }));
            if (ticks.length < 5) { out.push({ token, skip: 'few_ticks' }); continue; }
            const fireSec = meta.fire ? new Date(meta.fire).getTime() / 1000 : null;
            const rep = replay(ticks, fireSec);
            const rec = { token, exp: meta.exp.slice(0, 8), n: ticks.length, fireFrame: rep.fireFrame };
            rec.C = rep.firstCur && { ts: rep.firstCur.ts, price: rep.firstCur.price, byHist: rep.firstCur.byHist };
            for (const k of NL) {
                rec['L' + k] = rep.firstLng[k] && { ts: rep.firstLng[k].ts, price: rep.firstLng[k].price, byLong: rep.firstLng[k].byLong };
            }
            rec.evC = rec.C ? evalEntry(rep.prices, rec.C.ts, rec.C.price) : null;
            for (const k of NL) {
                rec['evL' + k] = rec['L' + k] ? evalEntry(rep.prices, rec['L' + k].ts, rec['L' + k].price) : null;
                rec['add' + k] = rep.segAddEv[k].map((x) => ({ start: x.g.start, price: x.g.price, ev: x.ev }));
                rec['lose' + k] = rep.segLoseEv[k].map((x) => ({ start: x.g.start, price: x.g.price, ev: x.ev }));
            }
            out.push(rec);
        } catch (e) {
            out.push({ token, err: e.message });
        }
        if (++done % 50 === 0) console.log(`  …${done}/${tokens.size}`);
    }
    require('fs').writeFileSync('/tmp/nwin-long-scan.json', JSON.stringify(out));

    // ── 聚合 ──
    const ok = out.filter((r) => !r.err && !r.skip);
    const ff = ok.filter((r) => r.fireFrame);
    const CASE = ['0x8f531e8ebcbad9ec2c402e112b6b22bea52f7777', '0xdf7a5f8356ef771128e8bde49527409981c47777'];

    console.log(`\n=== fire 帧拆解（n=${ff.length}）===`);
    const histCarry = ff.filter((r) => r.fireFrame.hist >= TH);
    const shortCarry = ff.filter((r) => r.fireFrame.hist < TH && r.fireFrame.win20 >= TH);
    console.log(`  全史臂扛=${histCarry.length}  短窗20臂扛=${shortCarry.length}  双臂全空=${ff.filter((r) => r.fireFrame.hist < TH && r.fireFrame.win20 < TH).length}`);
    for (const k of NL) {
        // 回归面 ①：全史扛的票 winK 也不扛（win20 也不扛才真翻车）
        const regress = histCarry.filter((r) => r.fireFrame['win' + k] < TH && r.fireFrame.win20 < TH);
        // 回归面 ②：短窗扛但长窗+短窗都不过（不可能——win20 恒在 OR 臂里，恒不丢）＝零
        console.log(`  N=${k}: 全史扛中(winK<40 且 win20<40)=${regress.length} 票翻车  `
            + `hist 扛票 winK 分布 p10=${q(histCarry.map((r) => r.fireFrame['win' + k]), 0.1)}`);
    }

    console.log(`\n=== per-tick 差异段（模拟量门 AND OR 臂；45min 窗）===`);
    for (const k of NL) {
        const adds = ok.flatMap((r) => (r['add' + k] || []).map((g) => ({ token: r.token, ...g })));
        const loses = ok.flatMap((r) => (r['lose' + k] || []).map((g) => ({ token: r.token, ...g })));
        const ap = adds.map((g) => g.ev.peak), al = adds.map((g) => g.ev.last);
        const lp = loses.map((g) => g.ev.peak), ll = loses.map((g) => g.ev.last);
        console.log(`  N=${k}: 新增段=${adds.length}（票${new Set(adds.map((g) => g.token)).size}）peak p25/p50/p75=${q(ap, .25)}/${q(ap, .5)}/${q(ap, .75)} peak<=0=${ap.filter((x) => x <= 0).length}  lastSum=${al.reduce((a, b) => a + b, 0).toFixed(1)}`);
        console.log(`        丢失段=${loses.length}（票${new Set(loses.map((g) => g.token)).size}）peak p25/p50/p75=${q(lp, .25)}/${q(lp, .5)}/${q(lp, .75)} peak<=0=${lp.filter((x) => x <= 0).length}  lastSum=${ll.reduce((a, b) => a + b, 0).toFixed(1)}`);
    }

    console.log(`\n=== 首过线提前量（L 比 C 早；只统计两臂都有过线的票）===`);
    for (const k of NL) {
        const both = ok.filter((r) => r.C && r['L' + k]);
        const earlier = both.filter((r) => r['L' + k].ts < r.C.ts);
        const later = both.filter((r) => r['L' + k].ts > r.C.ts);
        const dEv = earlier.map((r) => (r['evL' + k].last - r.evC.last));
        console.log(`  N=${k}: 两臂都过=${both.length} L 更早=${earlier.length} L 更晚=${later.length}`
            + ` 早进场 last 收益差 p25/p50/p75=${q(dEv, .25)}/${q(dEv, .5)}/${q(dEv, .75)}`);
    }

    console.log(`\n=== 案票决策帧 ===`);
    for (const c of CASE) {
        const r = ok.find((x) => x.token.toLowerCase() === c.toLowerCase());
        if (r) console.log(`  ${r.token.slice(0, 10)}… fireFrame=${JSON.stringify(r.fireFrame && Object.fromEntries(Object.entries(r.fireFrame).map(([kk, v]) => [kk, v === -Infinity ? 'null' : v.toFixed(1)])))}`);
        else console.log(`  ${c.slice(0, 10)}… 不在样本`);
    }
    dbManager.destroy?.();
}
main().catch((e) => { console.error(e); process.exit(1); });
