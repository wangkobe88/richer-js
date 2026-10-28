#!/usr/bin/env node
// ============================================================================
// T89b 人气门 OR→AND 分析：叙事通过票池「无人问津 vs 有人玩」分界
//   用户问题：叙事通过的票里，无人问津票与有人玩票的 buyVolumeBnb/holders
//   分界在哪里；OR 门（现行 主1.25|10 / 早期0.25|4）放进多少死票。
//   样本=近 N 天 token_narrative rating∈{high,mid}（=2|3，真实买腿候选池）。
//   口径（FA 近似）：尘门 bnb>=0.001；wallet=sender||trader；
//   buyVolumeBnb=尘门后累计买入；holders=净买入 BNB>0 的钱包数（bnb 域近似
//   FA token 域净持仓——价变时有差异，分界分析足够）；age 锚=首 tick。
//   结局分组（数据截止）：dead=全史 buyB<3 / mid=3-10 / alive>=10。
//   矩阵（per-tick 等冲破）：早期窗 age<=600s / 主腿窗 叙事锚后 45min，
//   各 (X AND Y) 组合对三组的达标率 + 对照现行 OR + 死票 OR 误放形状明细。
// 用法：node scripts/tmp-pop-and-gate-analysis.cjs [--days 10] [--stride 4] （182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();

const argv = process.argv;
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };
const DAYS = argOf('--days', 10);
const STRIDE = argOf('--stride', 4);
const DUST = 0.001;
const DEAD = 3, ALIVE = 10;               // 全史 buyB 分组线
const EARLY_X = [0.1, 0.15, 0.2, 0.25], EARLY_Y = [3, 4, 5];
const MAIN_X = [0.75, 1.0, 1.25], MAIN_Y = [6, 8, 10];
const SCAN_MIN = 45;                       // 主腿近似窗：叙事锚后 45min（同 T88 口径）

const q = (arr, p) => {
    if (!arr.length) return null;
    const s = [...arr].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const f2 = (x) => (x == null ? '—' : Number(x).toFixed(2));

async function fetchTicks(token) {
    const rows = [];
    let afterId = 0;
    for (;;) {
        const { data: page, error } = await db.from('wss_price_ticks')
            .select('id, trade_type, price_bnb, bnb_amount, price_outlier, block_number, log_index, block_time, sender_address, trader_address')
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

/** 重放：帧流（尘门后 buyB/holders），全史标签，时点快照，两窗首达标 */
function replay(raw, tN) {
    const t0 = new Date(raw[0].block_time).getTime() / 1000;
    let buyB = 0;
    const net = new Map();          // wallet -> 净买入 BNB
    const buyWallets = new Set();
    const frames = [];              // {t, age, buyB, holders, buy, bnb}
    let trades = 0, peakPrice = 0;
    for (const x of raw) {
        const t = new Date(x.block_time).getTime() / 1000;
        const bnb = x.bnb_amount || 0;
        if (x.trade_type === 'buy' && (x.price_bnb || 0) > peakPrice) peakPrice = x.price_bnb;
        if (bnb < DUST) continue;
        const w = String(x.sender_address || x.trader_address || '').toLowerCase();
        trades++;
        if (x.trade_type === 'buy') { buyB += bnb; net.set(w, (net.get(w) || 0) + bnb); buyWallets.add(w); }
        else net.set(w, (net.get(w) || 0) - bnb);
        let holders = 0;
        for (const v of net.values()) if (v > 0) holders++;
        frames.push({ t, age: t - t0, buyB, holders, buy: x.trade_type === 'buy', bnb, price: x.price_bnb, outlier: x.price_outlier });
    }
    const totalBuyBnb = buyB;
    // 时点快照（age<=T 最后一帧）
    const snap = (T) => {
        let r = null;
        for (const fr of frames) { if (fr.age <= T) r = fr; else break; }
        return r;
    };
    // 窗内任意帧同时达标（AND）或任一达标（OR）——首达标时刻
    const firstHit = (pred, fromT, toT) => {
        for (const fr of frames) { if (fr.t >= fromT && fr.t <= toT && pred(fr)) return fr; }
        return null;
    };
    const earlyEnd = t0 + 600;
    const mainEnd = tN + SCAN_MIN * 60;
    return { t0, frames, totalBuyBnb, trades, buyWallets: buyWallets.size, peakPrice, snap, firstHit, earlyEnd, mainEnd };
}

function groupOf(totalBuyBnb) {
    if (totalBuyBnb < DEAD) return 'dead';
    if (totalBuyBnb < ALIVE) return 'mid';
    return 'alive';
}

async function main() {
    const tSince = new Date(Date.now() - DAYS * 86400e3).toISOString();
    const { data: rows, error } = await db.from('token_narrative')
        .select('token_address, analyzed_at, final_result->>rating as rating')
        .in('final_result->>rating', ['high', 'mid'])
        .gte('analyzed_at', tSince)
        .order('analyzed_at', { ascending: false })
        .limit(20000);
    if (error) throw new Error(error.message);
    const pool = rows.filter((_, i) => i % STRIDE === 0);
    console.log(`${DAYS}d 叙事通过=${rows.length} stride=${STRIDE} → ${pool.length} 票`);

    const recs = [];
    let done = 0;
    for (const r of pool) {
        try {
            const raw = await fetchTicks(r.token_address);
            if (raw.length < 15) continue;
            const tN = new Date(r.analyzed_at).getTime() / 1000;
            const rep = replay(raw, tN);
            if (tN <= rep.t0) continue; // 叙事早于首 tick（盲区形状）
            const g = groupOf(rep.totalBuyBnb);
            const rec = {
                token: r.token_address, rating: r.rating, group: g,
                totalBuyBnb: Math.round(rep.totalBuyBnb * 1000) / 1000,
                trades: rep.trades, buyWallets: rep.buyWallets, nTicks: raw.length,
                snap120: rep.snap(120), snap300: rep.snap(300), snap600: rep.snap(600),
                tNFrame: (() => { let x = null; for (const fr of rep.frames) { if (fr.t <= tN) x = fr; else break; } return x; })(),
                earlyOR: rep.firstHit((fr) => fr.buyB >= 0.25 || fr.holders >= 4, rep.t0, rep.earlyEnd),
                earlyAND: {}, mainOR: rep.firstHit((fr) => fr.buyB >= 1.25 || fr.holders >= 10, tN, rep.mainEnd),
                mainAND: {},
            };
            for (const X of EARLY_X) for (const Y of EARLY_Y)
                rec.earlyAND[X + '_' + Y] = rep.firstHit((fr) => fr.buyB >= X && fr.holders >= Y, rep.t0, rep.earlyEnd);
            for (const X of MAIN_X) for (const Y of MAIN_Y)
                rec.mainAND[X + '_' + Y] = rep.firstHit((fr) => fr.buyB >= X && fr.holders >= Y, tN, rep.mainEnd);
            recs.push(rec);
        } catch (e) { recs.push({ token: r.token_address, err: e.message }); }
        if (++done % 100 === 0) console.log(`  …${done}/${pool.length}`);
    }
    require('fs').writeFileSync('/tmp/pop-and.json', JSON.stringify(recs));
    const ok = recs.filter((r) => !r.err);
    const gs = { dead: ok.filter((r) => r.group === 'dead'), mid: ok.filter((r) => r.group === 'mid'), alive: ok.filter((r) => r.group === 'alive') };
    console.log(`\n活跃票=${ok.length}（dead<${DEAD}BNB: ${gs.dead.length} / mid ${DEAD}-${ALIVE}: ${gs.mid.length} / alive>=${ALIVE}: ${gs.alive.length}）`);

    // A. 两组时点快照分布
    console.log(`\n=== A. 时点快照 buyVolumeBnb / holders 分布（p25/p50/p75）===`);
    for (const g of ['dead', 'mid', 'alive']) {
        const arr = gs[g];
        if (!arr.length) continue;
        for (const T of [120, 300, 600]) {
            const bs = arr.map((r) => r['snap' + T]?.buyB).filter((x) => x != null);
            const hs = arr.map((r) => r['snap' + T]?.holders).filter((x) => x != null);
            console.log(`  ${g.padEnd(5)} age${T}s: buyB ${f2(q(bs, .25))}/${f2(q(bs, .5))}/${f2(q(bs, .75))}  holders ${q(hs, .25)}/${q(hs, .5)}/${q(hs, .75)}`);
        }
        const tb = arr.map((r) => r.totalBuyBnb), tw = arr.map((r) => r.trades), bw = arr.map((r) => r.buyWallets);
        console.log(`  ${g.padEnd(5)} 全史  : buyB ${f2(q(tb, .25))}/${f2(q(tb, .5))}/${f2(q(tb, .75))}  trades ${q(tw, .25)}/${q(tw, .5)}/${q(tw, .75)}  buyWallets ${q(bw, .25)}/${q(bw, .5)}/${q(bw, .75)}`);
    }

    // B. 早期臂矩阵（age<=600s 窗内首达标率）
    console.log(`\n=== B. 早期臂（600s 窗）达标率：现行 OR(0.25|4) vs AND 候选 ===`);
    const rate = (arr, fn) => arr.length ? Math.round(arr.filter(fn).length / arr.length * 100) : 0;
    console.log(`  OR 0.25|4      : dead ${rate(gs.dead, (r) => r.earlyOR)}%  mid ${rate(gs.mid, (r) => r.earlyOR)}%  alive ${rate(gs.alive, (r) => r.earlyOR)}%`);
    for (const Y of EARLY_Y) for (const X of EARLY_X)
        console.log(`  AND ${X} & ${Y}: dead ${rate(gs.dead, (r) => r.earlyAND[X + '_' + Y])}%  mid ${rate(gs.mid, (r) => r.earlyAND[X + '_' + Y])}%  alive ${rate(gs.alive, (r) => r.earlyAND[X + '_' + Y])}%`);

    // C. 主腿矩阵（叙事锚后 45min 窗）
    console.log(`\n=== C. 主腿（叙事锚后 45min 窗）达标率：现行 OR(1.25|10) vs AND 候选 ===`);
    console.log(`  OR 1.25|10      : dead ${rate(gs.dead, (r) => r.mainOR)}%  mid ${rate(gs.mid, (r) => r.mainOR)}%  alive ${rate(gs.alive, (r) => r.mainOR)}%`);
    for (const Y of MAIN_Y) for (const X of MAIN_X)
        console.log(`  AND ${X} & ${Y}: dead ${rate(gs.dead, (r) => r.mainAND[X + '_' + Y])}%  mid ${rate(gs.mid, (r) => r.mainAND[X + '_' + Y])}%  alive ${rate(gs.alive, (r) => r.mainAND[X + '_' + Y])}%`);

    // D. 死票 OR 误放形状（用户担心的两类：多人微买 / 单钱包刷量）
    console.log(`\n=== D. dead 组 OR 误放形状 ===`);
    const dEarly = gs.dead.filter((r) => r.earlyOR);
    const dMain = gs.dead.filter((r) => r.mainOR);
    const shape = (arr, key, X, Y) => {
        const many = arr.filter((r) => r[key] && r[key].holders >= Y && r[key].buyB < X).length;
        const one = arr.filter((r) => r[key] && r[key].buyB >= X && r[key].holders < Y).length;
        return { many, one };
    };
    const se = shape(dEarly, 'earlyOR', 0.25, 4), sm = shape(dMain, 'mainOR', 1.25, 10);
    console.log(`  早期 OR 过门死票=${dEarly.length}（多人微买 holders>=4&buyB<0.25: ${se.many} / 单钱包刷量 buyB>=0.25&holders<4: ${se.one}）`);
    console.log(`  主腿 OR 过门死票=${dMain.length}（holders>=10&buyB<1.25: ${sm.many} / buyB>=1.25&holders<10: ${sm.one}）`);
    console.log(`  dead 组 tN 帧 buyB/holders p50=${f2(q(gs.dead.map((r) => r.tNFrame?.buyB), .5))} / ${q(gs.dead.map((r) => r.tNFrame?.holders), .5)}；alive 组=${f2(q(gs.alive.map((r) => r.tNFrame?.buyB), .5))} / ${q(gs.alive.map((r) => r.tNFrame?.holders), .5)}`);

    dbManager.destroy?.();
    process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
