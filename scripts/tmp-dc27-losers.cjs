#!/usr/bin/env node
/**
 * 临时脚本：v20 实验亏损票清单（本地小结果：单实验 trades 全拉 + FIFO 粗配对）
 */
const { dbManager } = require('../src/services/dbManager');
const V20 = 'bbbe2561-6a98-46a5-bf65-6038800dfb62';
const RC = '0xdc27f4256efafc5b979fa89aeea83efd1d797777';

async function main() {
    const db = dbManager.getClient();
    const trades = [];
    for (let off = 0; ; off += 1000) {
        const { data, error } = await db
            .from('trades')
            .select('id,token_address,token_symbol,trade_direction,trade_status,input_amount,output_amount,unit_price,success,executed_at,metadata')
            .eq('experiment_id', V20)
            .order('id', { ascending: true })
            .range(off, off + 999);
        if (error) throw error;
        trades.push(...data);
        if (data.length < 1000) break;
    }
    console.log(`v20 trades: ${trades.length} (success=${trades.filter(t=>t.success).length})`);

    const rcTrades = trades.filter(t => t.token_address === RC);
    console.log(`\nRocketcar traded by v20: ${rcTrades.length}`);
    for (const t of rcTrades) console.log(' ', t.trade_direction, t.trade_status, 'in=', t.input_amount, 'out=', t.output_amount, t.executed_at);

    // per-token BNB 配对（只算 success）
    const per = new Map();
    for (const t of trades) {
        if (!t.success) continue;
        const a = t.token_address;
        if (!per.has(a)) per.set(a, { sym: t.token_symbol, buyBnb: 0, sellBnb: 0, nBuy: 0, nSell: 0, firstBuy: null, lastSell: null });
        const p = per.get(a);
        if (t.trade_direction === 'buy') { p.buyBnb += Number(t.input_amount) || 0; p.nBuy++; if (!p.firstBuy) p.firstBuy = t.executed_at; }
        else { p.sellBnb += Number(t.output_amount) || 0; p.nSell++; p.lastSell = t.executed_at; }
    }
    const rows = [...per.entries()].map(([addr, p]) => ({
        addr, sym: p.sym, buyBnb: +p.buyBnb.toFixed(4), sellBnb: +p.sellBnb.toFixed(4),
        pnl: +(p.sellBnb - p.buyBnb).toFixed(4),
        pnlPct: p.buyBnb > 0 ? +(((p.sellBnb - p.buyBnb) / p.buyBnb) * 100).toFixed(1) : null,
        nBuy: p.nBuy, nSell: p.nSell, firstBuy: p.firstBuy?.slice(5, 16), lastSell: p.lastSell?.slice(5, 16),
    })).sort((a, b) => a.pnl - b.pnl);

    console.log(`\ntokens traded: ${rows.length}`);
    console.log('\n=== all tokens by pnl (BNB) ===');
    for (const r of rows) {
        console.log(`${r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(4).padStart(8)} (${String(r.pnlPct).padStart(7)}%)  buy=${r.buyBnb} sell=${r.sellBnb} ${r.nBuy}b/${r.nSell}s  ${r.firstBuy}→${r.lastSell ?? 'HOLD'}  ${r.sym} ${r.addr}`);
    }
    const losers = rows.filter(r => r.pnl < -0.0005);
    console.log(`\nlosers (<-0.0005): ${losers.length}, winners: ${rows.length - losers.length}`);
    require('fs').writeFileSync('/tmp/dc27-v20-tokens.json', JSON.stringify(rows.map(r => ({
        token: r.addr, sym: r.sym, pnl: r.pnl, pnlPct: r.pnlPct, firstBuy: r.firstBuy,
        label: r.addr === RC ? 'rc' : (r.pnl < -0.0005 ? 'loser' : 'winner'),
    })), null, 1));
    console.log('saved /tmp/dc27-v20-tokens.json');
    dbManager.cleanup();
}
main().catch(e => { console.error(e); process.exit(1); });
