#!/usr/bin/env node
/**
 * 临时脚本（182 跑）：Rocketcar 同期 flap cohort 对照聚合
 * 窗口=2026-10-17 05:00–07:30 UTC 的 token_create（清单文件随行携带）
 * 重查询：per-batch 50 token .in() + id keyset 分页（红线：.in ≤50、keyset 无 max-rows 坑）
 */
const path = require('path');
const { dbManager } = require(path.join('/home/ubuntu/richer-js', 'src/services/dbManager'));

const RC = '0xdc27f4256efafc5b979fa89aeea83efd1d797777';
const W_FROM = '2026-10-17T05:00:00', W_TO = '2026-10-17T07:30:00';

function walletOf(r) { return (r.sender_address || r.trader_address || '').toLowerCase(); }

function metrics(createTs, ticks) {
    ticks.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
    const t0 = new Date(ticks[0].block_time).getTime();
    const tEnd = new Date(ticks[ticks.length - 1].block_time).getTime();
    const createT = new Date(createTs).getTime();

    const rel = ticks.filter(r => !r.price_outlier && r.price_bnb > 0 && (r.bnb_amount ?? 0) >= 0.001);
    let peak = null, first = null, last = null;
    for (const r of rel) {
        if (!first) first = r;
        if (!peak || r.price_bnb > peak.price_bnb) peak = r;
        last = r;
    }
    const fb = ticks.filter(r => r.trade_type === 'buy');
    const sb = ticks.filter(r => r.trade_type === 'sell');
    const buyBnb = fb.reduce((s, r) => s + (r.bnb_amount || 0), 0);
    const sellBnb = sb.reduce((s, r) => s + (r.bnb_amount || 0), 0);

    const perWallet = new Map();
    for (const r of fb) {
        const w = walletOf(r); if (!w) continue;
        perWallet.set(w, (perWallet.get(w) || 0) + (r.bnb_amount || 0));
    }
    const buysSorted = [...perWallet.values()].sort((a, b) => b - a);
    const top1 = buysSorted[0] || 0, top5 = buysSorted.slice(0, 5).reduce((s, v) => s + v, 0);

    const w300 = new Set(), w60 = new Set(); let buyBnb300 = 0, buyBnb60 = 0;
    for (const r of fb) {
        const dt = new Date(r.block_time).getTime() - createT;
        if (dt <= 300000) { w300.add(walletOf(r)); buyBnb300 += r.bnb_amount || 0; }
        if (dt <= 60000) { w60.add(walletOf(r)); buyBnb60 += r.bnb_amount || 0; }
    }

    // 同块等额簇（鲸元卷口径）
    const byBlock = new Map();
    for (const r of ticks) {
        if (!byBlock.has(r.block_number)) byBlock.set(r.block_number, []);
        byBlock.get(r.block_number).push(r.bnb_amount || 0);
    }
    let eqBlocks = 0;
    for (const amts of byBlock.values()) {
        amts.sort((a, b) => a - b);
        for (let i = 1; i < amts.length; i++)
            if (amts[i] > 0.01 && Math.abs(amts[i] - amts[i - 1]) / amts[i] < 1e-5) { eqBlocks++; break; }
    }

    // 尾段：最后 120s
    let tailTicks = 0, tailBuy = 0, tailSell = 0;
    for (const r of ticks) {
        if (tEnd - new Date(r.block_time).getTime() <= 120000) {
            tailTicks++;
            if (r.trade_type === 'buy') tailBuy++; else tailSell++;
        }
    }

    const f = p => p > 0 ? +p.toExponential(4) : null;
    return {
        nTicks: ticks.length,
        spanSec: Math.round((tEnd - t0) / 1000),
        lifeEndMin: +(((tEnd - createT) / 60000)).toFixed(1),
        firstP: first ? f(first.price_bnb) : null,
        peakP: peak ? f(peak.price_bnb) : null,
        lastP: last ? f(last.price_bnb) : null,
        peakMul: first && peak ? +(peak.price_bnb / first.price_bnb).toFixed(2) : null,
        lastPeak: peak && last ? +(last.price_bnb / peak.price_bnb).toFixed(3) : null,
        lastFirst: first && last ? +(last.price_bnb / first.price_bnb).toFixed(2) : null,
        peakAtSec: peak ? Math.round((new Date(peak.block_time).getTime() - t0) / 1000) : null,
        wallets: perWallet.size,
        w60: w60.size, w300: w300.size,
        buyBnb60: +buyBnb60.toFixed(2), buyBnb300: +buyBnb300.toFixed(2),
        top1Share: buyBnb > 0 ? +(top1 / buyBnb * 100).toFixed(1) : null,
        top5Share: buyBnb > 0 ? +(top5 / buyBnb * 100).toFixed(1) : null,
        nBuy: fb.length, nSell: sb.length,
        buyBnb: +buyBnb.toFixed(2), sellBnb: +sellBnb.toFixed(2),
        netBnb: +(buyBnb - sellBnb).toFixed(2),
        eqBlocks, totalBlocks: byBlock.size,
        tailTicks, tailBuy, tailSell,
    };
}

async function main() {
    const db = dbManager.getClient();
    const list = JSON.parse(require('fs').readFileSync('/tmp/dc27-cohort-tokens.json', 'utf8'))
        .filter(t => t.ts >= W_FROM && t.ts < W_TO);
    console.log(`cohort window ${W_FROM} → ${W_TO}: ${list.length} tokens`);

    const tokenMeta = new Map(list.map(t => [t.token, t]));

    // 通用批拉（flapOnly：cohort 批过滤 platform=flap；v20 票不限平台）
    async function pullBatch(batch, flapOnly) {
        const got = new Map(batch.map(t => [t, []]));
        let fromId = 0;
        for (;;) {
            let q = db
                .from('wss_price_ticks')
                .select('id,token_address,block_number,log_index,block_time,price_bnb,bnb_amount,token_amount,trade_type,trader_address,sender_address,price_outlier')
                .in('token_address', batch)
                .gt('id', fromId)
                .order('id', { ascending: true })
                .limit(1000);
            if (flapOnly) q = q.eq('platform', 'flap');
            const { data, error } = await q;
            if (error) throw error;
            for (const r of data) got.get(r.token_address)?.push(r);
            if (data.length < 1000) break;
            fromId = data[data.length - 1].id;
        }
        return got;
    }

    // 批 50 拉 cohort ticks
    const BATCH = 50;
    const all = new Map();
    for (let i = 0; i < list.length; i += BATCH) {
        const batch = list.slice(i, i + BATCH).map(t => t.token);
        const got = await pullBatch(batch, true);
        for (const [t, rows] of got) if (rows.length) all.set(t, rows);
        console.log(`cohort batch ${i / BATCH + 1}/${Math.ceil(list.length / BATCH)} done, cumulative tokens-with-ticks=${all.size}`);
    }

    const results = [];
    for (const [token, ticks] of all) {
        const m = metrics(tokenMeta.get(token).ts, ticks);
        m.token = token; m.tax = tokenMeta.get(token).tax;
        m.creator = tokenMeta.get(token).creator;
        results.push(m);
    }
    // create 了但零 tick 的也记录（死盘/quote 换算跳行）
    const zeroTick = list.filter(t => !all.has(t.token)).length;
    console.log(`tokens with ticks: ${all.size}, zero-tick: ${zeroTick}`);

    // ---- v20 票（label=loser/winner/rc；不限 platform）----
    const v20 = JSON.parse(require('fs').readFileSync('/tmp/dc27-v20-tokens.json', 'utf8'));
    const v20ByToken = new Map(v20.map(t => [t.token, t]));
    const v20All = new Map();
    for (let i = 0; i < v20.length; i += BATCH) {
        const batch = v20.slice(i, i + BATCH).map(t => t.token);
        const got = await pullBatch(batch, false);
        for (const [t, rows] of got) if (rows.length) v20All.set(t, rows);
        console.log(`v20 batch ${i / BATCH + 1}/${Math.ceil(v20.length / BATCH)} done, with-ticks=${v20All.size}`);
    }
    // v20 票 create 时间：用首 tick 近似（cohortMeta 无这些票）——首窗指标以首 tick 为锚的口径差异标注
    const v20Results = [];
    for (const [token, ticks] of v20All) {
        const meta = v20ByToken.get(token);
        const anchor = meta.firstBuy ? meta.firstBuy + ':00' : null;
        const m = metrics(ticks[0].block_time, ticks); // create 锚=首 tick（缺 create 行）
        m.token = token; m.label = meta.label; m.sym = meta.sym;
        m.pnlBnb = meta.pnl; m.pnlPct = meta.pnlPct;
        v20Results.push(m);
    }
    require('fs').writeFileSync('/tmp/dc27-v20-metrics.json', JSON.stringify(v20Results));
    console.log(`v20 tokens with ticks: ${v20All.size}/${v20.length}, saved /tmp/dc27-v20-metrics.json`);

    require('fs').writeFileSync('/tmp/dc27-cohort-metrics.json', JSON.stringify(results));
    console.log('saved /tmp/dc27-cohort-metrics.json');

    // ---- 分布摘要 + Rocketcar 分位 ----
    const rc = results.find(r => r.token === RC);
    if (!rc) throw new Error('Rocketcar not in results!');
    console.log('\n=== Rocketcar metrics ===');
    console.log(JSON.stringify(rc, null, 1));

    function dist(key, fmt) {
        const vals = results.map(r => r[key]).filter(v => typeof v === 'number' && isFinite(v));
        vals.sort((a, b) => a - b);
        const q = p => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
        const rank = vals.filter(v => v < rc[key]).length;
        console.log(`${key.padEnd(12)} n=${vals.length}  p25=${fmt(q(0.25))} p50=${fmt(q(0.5))} p75=${fmt(q(0.75))} p90=${fmt(q(0.9))} max=${fmt(vals[vals.length-1])}  | RC=${fmt(rc[key])}  pct=${(rank/vals.length*100).toFixed(1)}%`);
    }
    console.log('\n=== cohort distribution vs Rocketcar (pct = % of cohort below RC) ===');
    dist('nTicks', v => v);
    dist('spanSec', v => v + 's');
    dist('lifeEndMin', v => v + 'm');
    dist('peakMul', v => v + 'x');
    dist('lastPeak', v => (v * 100).toFixed(0) + '%');
    dist('lastFirst', v => v + 'x');
    dist('peakAtSec', v => v + 's');
    dist('wallets', v => v);
    dist('w300', v => v);
    dist('w60', v => v);
    dist('buyBnb300', v => v + '');
    dist('top1Share', v => v + '%');
    dist('top5Share', v => v + '%');
    dist('netBnb', v => v + '');
    dist('tailTicks', v => v);
    dist('eqBlocks', v => v + '');

    // 税币/蓝筹粗分
    const tax = results.filter(r => r.tax);
    console.log(`\ntaxToken=true: ${tax.length}/${results.length}  (RC tax=${rc.tax})`);

    // ---- v20 三组（RC / winner / loser）中位数对比 ----
    function med(vals) {
        const v = vals.filter(x => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
        if (!v.length) return null;
        return v[Math.floor(v.length / 2)];
    }
    const rcM = v20Results.find(r => r.token === RC);
    const win = v20Results.filter(r => r.label === 'winner');
    const lose = v20Results.filter(r => r.label === 'loser');
    console.log('\n=== v20 three-group medians (RC vs winner vs loser) ===');
    console.log(`groups: RC(n=1) winner(n=${win.length}) loser(n=${lose.length})`);
    const keys = ['nTicks','spanSec','lifeEndMin','peakMul','lastPeak','lastFirst','peakAtSec','wallets','w60','w300','buyBnb300','top1Share','top5Share','netBnb','tailTicks','eqBlocks'];
    for (const k of keys) {
        console.log(`${k.padEnd(12)} RC=${String(rcM ? rcM[k] : '?').padStart(9)}  winner_med=${String(med(win.map(r => r[k]))).padStart(9)}  loser_med=${String(med(lose.map(r => r[k]))).padStart(9)}`);
    }

    dbManager.cleanup();
}
main().catch(e => { console.error(e); process.exit(1); });
