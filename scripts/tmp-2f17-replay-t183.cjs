#!/usr/bin/env node
// 临时重放（T183 端到端验证）：bt-v150 0x2f17…7777 真实 ticks + 真实聪明钱名单
// （smartmoney-accum.json）过 FA → 卖出时刻因子 → judgeFactorSellFilter（P5 pump 腿）
// 预期：18:23:49 卖出帧 smartHold 拦截成立（sinceLastSmartBigBuySec≈2 / recentSmartSellBnb=0）
const path = require('path');
const assert = require('assert');
const { dbManager } = require('../src/services/dbManager');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator.js');
const { normalizeFactorSellFilterConfig, judgeFactorSellFilter } = require('../src/trading-engine/core/factor-sell-filter');

const TOKEN = '0x2f17249e8d291ecb422fc5c0fc0eb313b7a57777';
const BUY_AT = Date.parse('2026-10-12T18:23:15Z');   // 成交买入（price≈6.54e-9）
const SELL_AT = Date.parse('2026-10-12T18:23:49Z');  // P5 全清帧（pp=57.54）
const P5 = { id: 'sell_p5', name: 'P5', condition: 'realHoldDuration >= 30 AND sinceEntryNetBuyRatio >= 90 AND sinceEntryBuyBnb >= 1' };
const P7 = { id: 'sell_p7', name: 'P7', condition: 'profitPercent > 100' };

async function main() {
    await FourMemeFactorAggregator.loadSmartMoneyWallets();
    await FourMemeFactorAggregator.loadFamousCopyWallets();

    const sb = dbManager.getClient();
    const rows = [];
    let from = 0;
    while (true) {
        const { data } = await sb.from('wss_price_ticks')
            .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,sender_address,trader_address,price_outlier,tx_hash')
            .eq('token_address', TOKEN).order('block_time', { ascending: true }).range(from, from + 999);
        if (!data || data.length === 0) break;
        rows.push(...data); from += 1000;
        if (data.length < 1000) break;
    }
    console.log(`ticks=${rows.length}`);
    // 链上真序（同 block_time 秒内行按 (block, logIndex) 定序——引擎装载口径；
    // 按 block_time 排序会因同秒行乱序触发 chainLate 拦截真价链=重放伪影）
    rows.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));

    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken(TOKEN, { createdAtMs: Date.parse(rows[0].block_time), totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    let buySet = false;
    for (const r of rows) {
        const ts = Date.parse(r.block_time);
        fa.processTick({
            token_address: TOKEN, trade_type: r.trade_type, trader_address: r.trader_address,
            sender_address: r.sender_address, price_bnb: r.price_bnb, price_usd: null,
            bnb_amount: r.bnb_amount, token_amount: 0, block_number: r.block_number,
            timestamp: ts, tx_hash: r.tx_hash, log_index: r.log_index, price_outlier: r.price_outlier,
        });
        if (!buySet && ts >= BUY_AT) {
            fa.setBuyState(TOKEN, { buyPriceBnb: 6.542451003575252e-9, buyTime: ts });
            buySet = true;
        }
        if (ts > SELL_AT) break;
    }

    const f = fa.buildFactorMap(TOKEN, SELL_AT);
    console.log(`卖出帧因子: pp=${f.profitPercent?.toFixed(2)} sinceLastSmartBigBuySec=${f.sinceLastSmartBigBuySec} recentSmartSellBnb=${f.recentSmartSellBnb} sinceLastFamousBigBuySec=${f.sinceLastFamousBigBuySec}`);

    const cfg = normalizeFactorSellFilterConfig({ enabled: true }).normalized;
    const r5 = judgeFactorSellFilter(cfg, f, P5);
    console.log(`P5（pump 腿）判定: blocked=${r5.blocked} rule=${r5.rule} pumpArm=${r5.info.pumpArmJurisdiction}`);
    const r7 = judgeFactorSellFilter(cfg, f, P7);
    console.log(`P7（非 pump 对照）判定: blocked=${r7.blocked}`);

    assert.strictEqual(r5.blocked, true, 'P5 泵失衡臂应被 smartHold 拦截');
    assert.strictEqual(r5.rule, 'smart_hold');
    assert.strictEqual(r5.info.pumpArmJurisdiction, true);
    assert.strictEqual(r7.blocked, false, 'P7 pp<100 存量语义放行');
    assert.ok(f.sinceLastSmartBigBuySec != null && f.sinceLastSmartBigBuySec <= 180, '聪明钱大买在窗内');
    console.log('✅ T183 端到端重放：立法案帧被 smartHold 精确拦截（P5 pump 管辖）');
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
