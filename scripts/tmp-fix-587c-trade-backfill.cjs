#!/usr/bin/env node
// ============================================================================
// 补记账修正（T92 KYA 0x587c…7777 already-known 误判案）：
//   21:02:16 链上卖出 tx 0x0fff…c83 实际成功（status=1，实收 0.0042089268551733835
//   BNB），但广播层撞 already known 被误判失败 → trade 行缺失 → token-returns
//   页把 0.006 本金记成 -100%。本脚本补一行真实卖出 trade + 重算实验 stats。
//
//   重放安全（_loadHoldingsLive 口径核对过）：
//   - 补行 sell 939203.17 → remainRatio=0 → qty=0；粉尘行在 qty=0 时直接跳过
//   - 卡账本：补行 cardTrade.after=0 → 删卡（粉尘行无 cardTrade 不动）
//   - 页面 FIFO：买 0.006 → 补行卖收 0.004209 → 粉尘行 matched 0 → -29.6%
//
//   幂等：已存在同 txHash 补行则跳过（manualCorrection.txHash 唯一标识）。
//   用法：node scripts/tmp-fix-587c-trade-backfill.cjs [--commit]
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const crypto = require('crypto');
const { dbManager } = require('../src/services/dbManager.js');

const EXP = 'd41b9c29-2a06-4178-908a-cd97b33e497f';
const TOKEN = '0x587c61b4a5052b7e5e0563be61b9be0a0aa27777';
const TX_HASH = '0x0fff7b00131159db8fa546ad8841f44031a05e82bbe26c2bb6524652ee6e2c83';
const SIGNAL_ID = 'e834e9ad-9539-4f35-9f72-ce7e87eda120';
const SELL_QTY = 939203.171190483;            // tick #46 token_amount（=买入量 bit 一致）
const SELL_BNB = 0.0042089268551733835;        // tick #46 bnb_amount（事件净收款）
const SELL_AT = '2026-10-28T21:02:16+00:00';   // 块 130349778 时间
// 成交时点 BNB/USD（tick #45 21:02:07 pxUsd/pxBnb 反推，与 #47 一致）
const BNB_USD = 0.000003442539094002005 / 4.5767710402847364e-9;

async function main() {
    const db = dbManager.getClient();
    const commit = process.argv.includes('--commit');

    // 幂等检查：该 token 全部 trades 里是否已有本 txHash 补行
    const { data: existing } = await db.from('trades')
        .select('id,metadata').eq('token_address', TOKEN).eq('experiment_id', EXP);
    const dup = (existing || []).find(t => t.metadata?.manualCorrection?.txHash === TX_HASH);
    if (dup) {
        console.log('已存在补行，跳过:', dup.id);
        return;
    }

    const unitPrice = SELL_BNB / SELL_QTY * BNB_USD;
    const row = {
        id: crypto.randomUUID(),
        experiment_id: EXP,
        token_symbol: 'KYA',
        token_address: TOKEN,
        token_id: null,
        trade_direction: 'sell',
        trade_status: 'success',
        input_currency: 'KYA',
        output_currency: 'BNB',
        input_amount: SELL_QTY,
        output_amount: SELL_BNB,
        unit_price: unitPrice,
        success: true,
        is_virtual_trade: false,
        created_at: SELL_AT,
        executed_at: SELL_AT,
        signal_id: SIGNAL_ID,
        chain: 'bsc',
        sold_cards: null,
        metadata: {
            txHash: TX_HASH,
            method: 'swapExactInput',
            bnbUsd: BNB_USD,
            cardTrade: { cards: 3, before: 3, after: 0 },
            reason: '补记账：21:02:16 链上卖出已成功（回执 status=1 块 130349778，实收 0.0042089268551733835 BNB），广播层撞 already known 被误判失败致 trade 行缺失；2026-10-29 人工核实链上回执后补行',
            manualCorrection: {
                at: new Date().toISOString(),
                case: 'T92 already known 误判（v51 KYA 案）',
                txHash: TX_HASH,
                blockNumber: 130349778,
                gasUsed: 697289,
            },
        },
    };

    console.log('unit_price(BNB→USD 域):', unitPrice);
    console.log('BNB/USD:', BNB_USD);
    console.log('预期页面 returnRate:', ((SELL_BNB - 0.006) / 0.006 * 100).toFixed(2) + '%');

    if (!commit) {
        console.log('\n[dry-run] 将插入行（--commit 生效）:');
        console.log(JSON.stringify({ ...row, metadata: { ...row.metadata, reason: row.metadata.reason.slice(0, 50) + '…' } }, null, 1));
        return;
    }

    const { error } = await db.from('trades').insert([row]);
    if (error) throw new Error(`补行失败: ${error.message}`);
    console.log('\n✅ 补行完成:', row.id);

    // 重算实验 stats（web-server /api/experiments/*/refresh-stats 同款逻辑）
    const { ExperimentStatsService } = require('../src/web/services/ExperimentStatsService');
    const stats = await new ExperimentStatsService().calculateExperimentStats(EXP);
    const { error: updErr } = await db.from('experiments').update({ stats }).eq('id', EXP);
    if (updErr) throw new Error(`stats 更新失败: ${updErr.message}`);
    console.log('✅ stats 重算完成:', JSON.stringify(stats));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
