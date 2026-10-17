#!/usr/bin/env node
/**
 * 临时脚本：Rocketcar 0xdc27…7777 单币全生命周期画像（本地小结果：840 ticks 全拉）
 */
const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0xdc27f4256efafc5b979fa89aeea83efd1d797777';

async function main() {
    const db = dbManager.getClient();

    // 全量拉取（840 行，keyset 无需——单 token 全量 select）
    const rows = [];
    let fromId = 0;
    for (;;) {
        const { data, error } = await db
            .from('wss_price_ticks')
            .select('id,block_number,log_index,block_time,price_bnb,price_usd,bnb_amount,token_amount,trade_type,trader_address,sender_address,price_outlier,quote_token')
            .eq('token_address', TOKEN)
            .gt('id', fromId)
            .order('id', { ascending: true })
            .limit(1000);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 1000) break;
        fromId = data[data.length - 1].id;
    }
    console.log(`total ticks: ${rows.length}`);

    // 链上真序
    rows.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);

    const t0 = new Date(rows[0].block_time).getTime();
    const tEnd = new Date(rows[rows.length - 1].block_time).getTime();
    const lifeSec = (tEnd - t0) / 1000;
    console.log(`lifecycle: ${rows[0].block_time} → ${rows[rows.length-1].block_time}  (${(lifeSec/60).toFixed(1)} min, ${rows.length} ticks)`);

    // ---- 价格轨迹（可靠价链：剔除 outlier + 尘 tick + 零价）----
    const dust = rows.filter(r => (r.bnb_amount ?? 0) < 0.001);
    const outl = rows.filter(r => r.price_outlier);
    console.log(`dust ticks (<0.001 BNB): ${dust.length} (${(dust.length/rows.length*100).toFixed(1)}%)  outlier: ${outl.length}`);

    const rel = rows.filter(r => !r.price_outlier && r.price_bnb > 0 && (r.bnb_amount ?? 0) >= 0.001);
    let peak = null, min = null;
    for (const r of rel) {
        if (!peak || r.price_bnb > peak.price_bnb) peak = r;
        if (!min || r.price_bnb < min.price_bnb) min = r;
    }
    const last = rel[rel.length - 1] || rows[rows.length - 1];
    const first = rel[0] || rows[0];
    const fmtP = p => p.toExponential(4);
    console.log(`\nprice (reliable): first=${fmtP(first.price_bnb)} @+0s  min=${fmtP(min.price_bnb)} @+${((new Date(min.block_time)-t0)/1000).toFixed(0)}s`);
    console.log(`peak=${fmtP(peak.price_bnb)} @+${((new Date(peak.block_time)-t0)/1000).toFixed(0)}s (${((new Date(peak.block_time)-t0)/60000).toFixed(1)}min)  last=${fmtP(last.price_bnb)} @+${((new Date(last.block_time)-t0)/1000).toFixed(0)}s`);
    console.log(`peak/first = ${(peak.price_bnb/first.price_bnb).toFixed(2)}x   last/peak = ${(last.price_bnb/peak.price_bnb*100).toFixed(1)}%   last/first = ${(last.price_bnb/first.price_bnb).toFixed(2)}x`);
    if (first.price_usd || peak.price_usd) {
        console.log(`price_usd: first=${first.price_usd?.toExponential(3)} peak=${peak.price_usd?.toExponential(3)} last=${last.price_usd?.toExponential(3)}`);
    }

    // ---- 时间分桶轨迹（每分钟可靠价末值 + 峰值）----
    console.log('\n--- per-minute reliable price track ---');
    const byMin = new Map();
    for (const r of rel) {
        const m = Math.floor((new Date(r.block_time) - t0) / 60000);
        if (!byMin.has(m)) byMin.set(m, { n: 0, last: null, hi: 0, lo: Infinity, bnb: 0 });
        const b = byMin.get(m);
        b.n++; b.last = r.price_bnb; b.hi = Math.max(b.hi, r.price_bnb); b.lo = Math.min(b.lo, r.price_bnb); b.bnb += r.bnb_amount || 0;
    }
    for (const [m, b] of [...byMin.entries()].sort((a, b) => a[0] - b[0])) {
        console.log(`+${String(m).padStart(3)}min  ticks=${String(b.n).padStart(3)}  lo=${fmtP(b.lo)} hi=${fmtP(b.hi)} close=${fmtP(b.last)}  vol=${b.bnb.toFixed(3)} BNB`);
    }

    // ---- 买卖腿 / 资金流 ----
    const buys = rows.filter(r => r.trade_type === 'buy');
    const sells = rows.filter(r => r.trade_type === 'sell');
    const buyBnb = buys.reduce((s, r) => s + (r.bnb_amount || 0), 0);
    const sellBnb = sells.reduce((s, r) => s + (r.bnb_amount || 0), 0);
    console.log(`\nbuys=${buys.length} (${buyBnb.toFixed(3)} BNB)  sells=${sells.length} (${sellBnb.toFixed(3)} BNB)  net=+${(buyBnb-sellBnb).toFixed(3)} BNB`);

    // ---- 钱包口径（sender||trader）----
    const wallet = r => (r.sender_address || r.trader_address || '').toLowerCase();
    const perWallet = new Map();
    for (const r of rows) {
        const w = wallet(r);
        if (!w) continue;
        if (!perWallet.has(w)) perWallet.set(w, { buyBnb: 0, sellBnb: 0, nBuy: 0, nSell: 0, firstTs: r.block_time });
        const p = perWallet.get(w);
        if (r.trade_type === 'buy') { p.buyBnb += r.bnb_amount || 0; p.nBuy++; }
        else { p.sellBnb += r.bnb_amount || 0; p.nSell++; }
    }
    console.log(`unique wallets: ${perWallet.size}`);
    const top = [...perWallet.entries()].sort((a, b) => b[1].buyBnb - a[1].buyBnb).slice(0, 12);
    console.log('\n--- top-12 buyers (wallet=sender||trader) ---');
    for (const [w, p] of top) {
        console.log(`${w}  buy=${p.buyBnb.toFixed(4)} BNB (${p.nBuy}tx)  sell=${p.sellBnb.toFixed(4)} (${p.nSell}tx)`);
    }
    const totBuy = buyBnb || 1;
    const top1 = top[0] ? top[0][1].buyBnb / totBuy * 100 : 0;
    const top5 = top.slice(0, 5).reduce((s, [, p]) => s + p.buyBnb, 0) / totBuy * 100;
    console.log(`\ntop1 buy share = ${top1.toFixed(1)}%   top5 = ${top5.toFixed(1)}%`);

    // GMGN 聚合路由占比（trader 层）
    const GMGN = '0x1de4609c4b1e9dbdc7e5ba3592a82e2ee2a56c4bc'.toLowerCase();
    const routerBnb = rows.filter(r => (r.trader_address || '').toLowerCase() === GMGN && r.trade_type === 'buy').reduce((s, r) => s + (r.bnb_amount || 0), 0);
    console.log(`GMGN router buy share (trader layer): ${(routerBnb / totBuy * 100).toFixed(1)}%`);

    // ---- 首窗行为 ----
    for (const win of [60, 90, 300, 600]) {
        const wrows = rows.filter(r => new Date(r.block_time) - t0 <= win * 1000);
        const wb = wrows.filter(r => r.trade_type === 'buy');
        const wBnb = wb.reduce((s, r) => s + (r.bnb_amount || 0), 0);
        const wWal = new Set(wb.map(wallet).filter(Boolean)).size;
        console.log(`first ${String(win).padStart(3)}s: ticks=${wrows.length} buys=${wb.length} wallets=${wWal} buyBnb=${wBnb.toFixed(3)}`);
    }

    // ---- 大单 ----
    const big = rows.filter(r => (r.bnb_amount || 0) >= 0.5).sort((a, b) => b.bnb_amount - a.bnb_amount).slice(0, 8);
    console.log('\n--- top-8 single trades by BNB ---');
    for (const r of big) {
        console.log(`+${((new Date(r.block_time)-t0)/1000).toFixed(0)}s  ${r.trade_type==='buy'?'BUY ':'SELL'} ${r.bnb_amount.toFixed(3)} BNB @${fmtP(r.price_bnb)} out=${r.price_outlier?1:0} w=${wallet(r).slice(0,10)}…`);
    }

    // ---- 同块等额簇（鲸元卷案口径：相对差<1e-5）----
    const byBlock = new Map();
    for (const r of rows) {
        if (!byBlock.has(r.block_number)) byBlock.set(r.block_number, []);
        byBlock.get(r.block_number).push(r);
    }
    let clusterHits = 0;
    for (const [blk, rs] of byBlock) {
        const amts = rs.map(r => r.bnb_amount || 0).sort((a, b) => a - b);
        for (let i = 1; i < amts.length; i++) {
            if (amts[i] > 0.01 && Math.abs(amts[i] - amts[i-1]) / amts[i] < 1e-5) { clusterHits++; break; }
        }
    }
    console.log(`\nsame-block equal-amount cluster blocks (rel-diff<1e-5, >0.01 BNB): ${clusterHits} / ${byBlock.size} blocks`);

    // ---- 尾部行为：最后 10 笔 ----
    console.log('\n--- last 10 trades ---');
    for (const r of rows.slice(-10)) {
        console.log(`+${((new Date(r.block_time)-t0)/1000).toFixed(0)}s  ${r.trade_type==='buy'?'BUY ':'SELL'} ${(r.bnb_amount||0).toFixed(4)} BNB @${fmtP(r.price_bnb)} w=${wallet(r).slice(0,10)}…`);
    }

    dbManager.cleanup();
}

main().catch(e => { console.error(e); process.exit(1); });
