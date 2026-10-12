#!/usr/bin/env node
// ============================================================================
// 临时查询：某 token 前几笔买入是否走 GMGN 路由（trader=0x1de460…4bc）
// 用法（182）：node scripts/tmp_check_gmgn_buys.cjs <token_address> [前N笔默认20]
// ============================================================================
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const GMGN = '0x1de460f363af910f51726def188f9004276bf4bc';

async function main() {
    const token = (process.argv[2] || '').toLowerCase();
    const topN = parseInt(process.argv[3] || '20', 10);
    if (!/^0x[0-9a-f]{40}$/.test(token)) throw new Error('用法: node tmp_check_gmgn_buys.cjs <token> [N]');

    const sb = dbManager.getClient();
    const { data, error } = await sb.from('wss_price_ticks')
        .select('block_number,log_index,tx_hash,trade_type,trader_address,sender_address,bnb_amount,token_amount,block_time')
        .eq('token_address', token)
        .eq('trade_type', 'buy')
        .order('block_number', { ascending: true })
        .order('log_index', { ascending: true })
        .limit(topN);
    if (error) throw new Error(error.message);

    console.log(`token ${token} 前 ${data.length} 笔买入（链上真序）:`);
    console.log('#  block_time            bnb      trader(截短)                       sender(截短)                        GMGN?');
    let gmgnCnt = 0, gmgnBnb = 0, totBnb = 0;
    data.forEach((r, i) => {
        const isG = (r.trader_address || '').toLowerCase() === GMGN;
        const bnb = r.bnb_amount || 0;
        totBnb += bnb;
        if (isG) { gmgnCnt++; gmgnBnb += bnb; }
        console.log(
            String(i + 1).padStart(2) + '  ' +
            String(r.block_time).padEnd(21) + ' ' +
            String(bnb.toFixed(4)).padStart(8) + '  ' +
            String(r.trader_address || 'NULL').padEnd(34).slice(0, 34) + ' ' +
            String(r.sender_address || 'NULL').padEnd(34).slice(0, 34) + ' ' +
            (isG ? 'GMGN' : '-')
        );
    });
    console.log(`\nGMGN 行: ${gmgnCnt}/${data.length}，GMGN BNB ${gmgnBnb.toFixed(4)}/${totBnb.toFixed(4)} (${totBnb > 0 ? (gmgnBnb / totBnb * 100).toFixed(1) : 0}%)`);

    // 全窗 GMGN 占比（首 90s 早窗 + 全部行）
    const { data: all, error: e2 } = await sb.from('wss_price_ticks')
        .select('block_time,trader_address,bnb_amount,trade_type')
        .eq('token_address', token);
    if (e2) throw new Error(e2.message);
    const buys = all.filter(r => r.trade_type === 'buy');
    const t0 = buys.length ? new Date(buys[0].block_time).getTime() : 0;
    const w90 = buys.filter(r => new Date(r.block_time).getTime() - t0 <= 90_000);
    const g90 = w90.filter(r => (r.trader_address || '').toLowerCase() === GMGN);
    const b = (a) => a.reduce((s, r) => s + (r.bnb_amount || 0), 0);
    console.log(`首90s买行: ${w90.length} 笔 / ${b(w90).toFixed(4)} BNB；GMGN ${g90.length} 笔 / ${b(g90).toFixed(4)} BNB (${w90.length ? (b(g90) / b(w90) * 100).toFixed(1) : 0}%)`);
    console.log(`全部买行: ${buys.length} 笔 / ${b(buys).toFixed(4)} BNB`);
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
