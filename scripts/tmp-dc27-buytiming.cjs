#!/usr/bin/env node
/**
 * 临时脚本（182 跑）：v20 买点相对峰值位置——亏损票是否买在峰顶
 * 每票：v20 首笔 buy 的精确 executed_at → 买点前最近可靠价 → 全史峰/买后峰/末价
 */
const path = require('path');
const { dbManager } = require(path.join('/home/ubuntu/richer-js', 'src/services/dbManager'));
const V20 = 'bbbe2561-6a98-46a5-bf65-6038800dfb62';
const RC = '0xdc27f4256efafc5b979fa89aeea83efd1d797777';

async function main() {
    const db = dbManager.getClient();

    // v20 全部 buy trades（轻：单实验）
    const buys = [];
    for (let off = 0; ; off += 1000) {
        const { data, error } = await db
            .from('trades')
            .select('token_address,trade_direction,success,input_amount,output_amount,executed_at')
            .eq('experiment_id', V20)
            .eq('trade_direction', 'buy')
            .eq('success', true)
            .order('executed_at', { ascending: true })
            .range(off, off + 999);
        if (error) throw error;
        buys.push(...data);
        if (data.length < 1000) break;
    }
    const firstBuy = new Map(); // token → {ts, price: unit BNB 价近似=null}
    for (const b of buys) if (!firstBuy.has(b.token_address)) firstBuy.set(b.token_address, b.executed_at);
    console.log(`v20 buy tokens: ${firstBuy.size}`);

    const labels = new Map(
        JSON.parse(require('fs').readFileSync('/tmp/dc27-v20-tokens.json', 'utf8'))
            .map(t => [t.token, t.label])
    );

    const out = [];
    for (const [token, buyTs] of firstBuy) {
        // 拉 ticks（每票 keyset；v20 票量级几百行）
        const ticks = [];
        let fromId = 0;
        for (;;) {
            const { data, error } = await db
                .from('wss_price_ticks')
                .select('id,block_number,log_index,block_time,price_bnb,bnb_amount,trade_type,price_outlier')
                .eq('token_address', token)
                .gt('id', fromId)
                .order('id', { ascending: true })
                .limit(1000);
            if (error) throw error;
            ticks.push(...data);
            if (data.length < 1000) break;
            fromId = data[data.length - 1].id;
        }
        if (!ticks.length) continue;
        ticks.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
        const rel = ticks.filter(r => !r.price_outlier && r.price_bnb > 0 && (r.bnb_amount ?? 0) >= 0.001);
        if (!rel.length) continue;

        const tBuy = new Date(buyTs).getTime();
        let preBuy = null;      // 买点前最近可靠价
        let peakAll = 0;        // 全史峰
        let peakPost = 0;       // 买后峰
        let last = null;
        let peakAllAt = 0, firstRelAt = Infinity;
        for (const r of rel) {
            const t = new Date(r.block_time).getTime();
            if (t <= tBuy) preBuy = r;
            if (r.price_bnb > peakAll) { peakAll = r.price_bnb; peakAllAt = t; }
            if (t >= tBuy && r.price_bnb > peakPost) peakPost = r.price_bnb;
            last = r;
            if (t < firstRelAt) firstRelAt = t;
        }
        const buyP = preBuy ? preBuy.price_bnb : rel[0].price_bnb;
        const label = labels.get(token) || '?';
        out.push({
            token, label,
            buyLagSec: +((tBuy - firstRelAt) / 1000).toFixed(0),
            peakLagBuySec: +((peakAllAt - tBuy) / 1000).toFixed(0), // 峰相对买点：正=峰在买后
            buyAtRelPeak: +(buyP / peakAll).toFixed(3),               // 买价/全史峰（1=买在顶）
            postBuyMaxMul: peakPost > 0 ? +(peakPost / buyP).toFixed(2) : null, // 买后还能到几倍
            postBuyLastRel: +(last.price_bnb / buyP).toFixed(3),      // 末价/买价
            peakIsAfterBuy: peakAllAt >= tBuy,
        });
    }

    require('fs').writeFileSync('/tmp/dc27-buytiming.json', JSON.stringify(out));
    console.log(`analyzed: ${out.length}`);

    function med(vals) {
        const v = vals.filter(x => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
        return v.length ? v[Math.floor(v.length / 2)] : null;
    }
    const rc = out.find(r => r.token === RC);
    const win = out.filter(r => r.label === 'winner');
    const lose = out.filter(r => r.label === 'loser');
    console.log('\n=== buy timing: RC vs winner vs loser ===');
    console.log('RC:', JSON.stringify(rc));
    for (const k of ['buyLagSec', 'peakLagBuySec', 'buyAtRelPeak', 'postBuyMaxMul', 'postBuyLastRel']) {
        const wMed = med(win.map(r => r[k])), lMed = med(lose.map(r => r[k]));
        const pctLoserPeakAfter = lose.filter(r => r.peakIsAfterBuy).length / lose.length * 100;
        const pctWinPeakAfter = win.filter(r => r.peakIsAfterBuy).length / win.length * 100;
        console.log(`${k.padEnd(16)} RC=${String(rc ? rc[k] : '?').padStart(8)}  winner_med=${String(wMed).padStart(8)}  loser_med=${String(lMed).padStart(8)}`);
        if (k === 'peakLagBuySec') console.log(`  peak AFTER buy: winner ${pctWinPeakAfter.toFixed(0)}%  loser ${pctLoserPeakAfter.toFixed(0)}%`);
    }
    console.log('\n--- losers detail (worst 15 by postBuyLastRel) ---');
    for (const r of [...lose].sort((a, b) => a.postBuyLastRel - b.postBuyLastRel).slice(0, 15))
        console.log(`${r.token.slice(0, 10)} buyLag=${String(r.buyLagSec).padStart(4)}s peakLag=${String(r.peakLagBuySec).padStart(6)}s buyAtPeak=${r.buyAtRelPeak.toFixed(2)} postMax=${r.postBuyMaxMul}x last/buy=${r.postBuyLastRel.toFixed(2)}`);
    console.log('\n--- winners detail ---');
    for (const r of [...win].sort((a, b) => b.postBuyMaxMul - a.postBuyMaxMul))
        console.log(`${r.token.slice(0, 10)} buyLag=${String(r.buyLagSec).padStart(4)}s peakLag=${String(r.peakLagBuySec).padStart(6)}s buyAtPeak=${r.buyAtRelPeak.toFixed(2)} postMax=${r.postBuyMaxMul}x last/buy=${r.postBuyLastRel.toFixed(2)}`);

    dbManager.cleanup();
}
main().catch(e => { console.error(e); process.exit(1); });
