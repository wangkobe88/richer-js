#!/usr/bin/env node
// ============================================================================
// T87 回放扫描：净买门 OR 臂窗口载体 10s 时间窗 vs 最近 N 笔窗（0xdf7a 案 Q3）
//   样本=近 10 天 BUY signal 票（318 票）；per-token keyset 分页拉 ticks
//   重放口径对齐 FA：尘门 bnb_amount>=0.001 入环；outlier/迟到行流量照计（价格评估
//   侧才滤 outlier）；链上真序 (block_number, log_index)；扫窗=首 tick 后 45min，
//   进场收益评估 +30min。
//   N 候选 10/15/20/25/30；输出 /tmp/nwin-scan.json + stdout 摘要。
// 用法：node scripts/tmp-nwin-scan.cjs   （182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();

const DAYS = 10, SCAN_MIN = 45, EVAL_MIN = 30, TH = 40, W10 = 10000;
const NS = [10, 15, 20, 25, 30];
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
    // 链上真序（bigserial 分配序≠提交序）
    rows.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
    return rows;
}

function replay(ticks, fireSec) {
    const t0 = ticks[0].bt;
    const scanEnd = t0 + SCAN_MIN * 60;
    const evEnd = t0 + (SCAN_MIN + EVAL_MIN) * 60;
    let buyB = 0, sellB = 0;
    const evts = []; // {ts,buy,bnb}
    let firstA = null; // 10s 版 OR 臂首次满足
    const firstB = {}; // N 版
    const prices = []; // {ts, price, out} 评估用
    for (const k of NS) firstB[k] = null;
    // per-tick OR 臂差异段（模拟量门）：segA={start,price} ora假orb真（N 版新增段）／segR=反向（N 版丢失段=风险）
    const segAdd = {}, segLose = {};
    for (const k of NS) { segAdd[k] = []; segLose[k] = []; }
    let fireFrame = null;
    let i = 0;
    for (const t of ticks) {
        if (t.bt > evEnd) break;
        if (t.bnb >= DUST) {
            if (t.buy) buyB += t.bnb; else sellB += t.bnb;
            evts.push({ ts: t.bt, buy: t.buy, bnb: t.bnb });
        }
        if (!t.out) prices.push({ ts: t.bt, price: t.price });
        // fire 决策帧：block_time <= fireSec 的最后事件后恰一次捕获
        if (fireSec != null && t.bt <= fireSec) {
            fireFrame = { hist: buyB > 0 ? (buyB - sellB) / buyB * 100 : -100,
                winT10: winRatio(evts, t.bt - W10) };
            for (const k of NS) fireFrame['win' + k] = tailRatio(evts, k);
        }
        if (t.bt > scanEnd) continue; // 扫窗内才判定过线（评估窗继续累计价格）
        if (firstA && NS.every((k) => firstB[k])) continue;
        const hist = buyB > 0 ? (buyB - sellB) / buyB * 100 : -100;
        const volOk = buyB >= 0.25; // 模拟量门（buy-v2 承接门近似）：挡首帧假过线
        if (!firstA && volOk && (hist >= TH || winRatio(evts, t.bt - W10) >= TH)) {
            firstA = { ts: t.bt, price: t.price, byHist: hist >= TH, win10: winRatio(evts, t.bt - W10) };
        }
        for (const k of NS) {
            if (firstB[k]) continue;
            if (volOk && (hist >= TH || tailRatio(evts, k) >= TH)) {
                firstB[k] = { ts: t.bt, price: t.price, byHist: hist >= TH, winN: tailRatio(evts, k) };
            }
        }
        // per-tick 模拟门（量门 AND OR 臂）差异
        if (buyB >= 0.25) {
            const ora = hist >= TH || winRatio(evts, t.bt - W10) >= TH;
            for (const k of NS) {
                const orb = hist >= TH || tailRatio(evts, k) >= TH;
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
        i++;
    }
    // 差异段转进场评估：取每段首帧
    const segAddEv = {}, segLoseCnt = {};
    for (const k of NS) {
        segAddEv[k] = segAdd[k].map((g) => ({ g, ev: evalEntry(prices, g.start, g.price) })).filter((x) => x.ev);
        segLoseCnt[k] = segLose[k].length;
    }
    return { firstA, firstB, prices, fireFrame, segAddEv, segLoseCnt };
}

function winRatio(evts, cutoff) {
    let b = 0, s = 0;
    for (const e of evts) {
        if (e.ts < cutoff) continue;
        if (e.buy) b += e.bnb; else s += e.bnb;
    }
    return b > 0 ? (b - s) / b * 100 : -Infinity; // 零买=null 语义（恒不过线）
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
            const rec = { token, exp: meta.exp.slice(0, 8), n: ticks.length };
            rec.A = rep.firstA && { ts: rep.firstA.ts, price: rep.firstA.price, byHist: rep.firstA.byHist };
            for (const k of NS) rec['B' + k] = rep.firstB[k] && { ts: rep.firstB[k].ts, price: rep.firstB[k].price, byHist: rep.firstB[k].byHist };
            rec.evA = rec.A ? evalEntry(rep.prices, rec.A.ts, rec.A.price) : null;
            rec.fireFrame = rep.fireFrame;
            rec.segLose = rep.segLoseCnt;
            for (const k of NS) {
                rec['evB' + k] = rec['B' + k] ? evalEntry(rep.prices, rec['B' + k].ts, rec['B' + k].price) : null;
                rec['seg' + k] = rep.segAddEv[k].map((x) => ({ start: x.g.start, price: x.g.price, ev: x.ev }));
            }
            out.push(rec);
        } catch (e) {
            out.push({ token, err: e.message });
        }
        if (++done % 50 === 0) console.log(`  …${done}/${tokens.size}`);
    }

    // ── 聚合 ──
    const ok = out.filter((r) => !r.err && !r.skip);
    const ff = ok.filter((r) => r.fireFrame);
    console.log(`\n=== fire 帧三值拆解（n=${ff.length}）===`);
    const histCarry = ff.filter((r) => r.fireFrame.hist >= TH);
    const win10Carry = ff.filter((r) => r.fireFrame.hist < TH && r.fireFrame.winT10 >= TH);
    console.log(`  全史臂扛=${histCarry.length}（N 版零影响）  10s 窗臂扛=${win10Carry.length}`);
    for (const k of NS) {
        const lose = win10Carry.filter((r) => r.fireFrame['win' + k] < TH);
        console.log(`  N=${k}: 10s 扛中 N 窗<40=${lose.length}（替换后拦掉=回归风险面）`);
    }
    console.log(`  fire 帧 win10=null（10s 零买，慢热形状基数）=${ff.filter((r) => r.fireFrame.winT10 === -Infinity).length} 票`);
    console.log(`  fire 帧 win10<40 且非 null=${ff.filter((r) => r.fireFrame.winT10 < TH && r.fireFrame.winT10 !== -Infinity).length} 票`);

    console.log(`\n=== per-tick 差异段（模拟量门 AND OR 臂；45min 窗）===`);
    for (const k of NS) {
        const segs = ok.flatMap((r) => (r['seg' + k] || []).map((g) => ({ token: r.token, ...g })));
        const peaks = segs.map((g) => g.ev.peak), lasts = segs.map((g) => g.ev.last);
        const loseCnt = ok.reduce((a, r) => a + (r.segLose[k] || 0), 0);
        const loseTokens = ok.filter((r) => (r.segLose[k] || 0) > 0).length;
        console.log(`  N=${k}: 新增段=${segs.length}（票 ${new Set(segs.map((g) => g.token)).size}）`
            + ` peak p25/50/75=${q(peaks, .25)}%/${q(peaks, .5)}%/${q(peaks, .75)}%`
            + ` 末价 p50=${q(lasts, .5)}% peak≤0 占比=${Math.round(peaks.filter((x) => x <= 0).length / Math.max(1, peaks.length) * 100)}%`
            + ` | 丢失段=${loseCnt}（票 ${loseTokens}）`);
    }

    // MUSK2028 案票对照
    const musk = out.find((r) => r.token && r.token.startsWith('0x8f53'));
    if (musk) console.log(`\nMUSK2028 案票对照: fireFrame=${JSON.stringify(musk.fireFrame)}\n  seg20=${JSON.stringify(musk.seg20)}`);

    require('fs').writeFileSync('/tmp/nwin-scan.json', JSON.stringify(out, null, 1));
    console.log('\n明细 → /tmp/nwin-scan.json');
    process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
