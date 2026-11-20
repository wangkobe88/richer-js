#!/usr/bin/env node
// 0x51d9 案 v3：完整 metadata + trades 细节
const { dbManager } = require('../src/services/dbManager');

const EXP = '9b31baf4-bdd3-4ebb-9031-2a1603f34633';
const TOKEN = '0x51d9e3602362daece382c7925d2e3a1a2b1c7777';

async function main() {
  const sb = dbManager.getClient();

  const { data: sigs, error: e1 } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(80);
  if (e1) throw new Error(e1.message);

  // 第 3 条信号（成交的那条 buy_1_2）完整 metadata 顶层键
  const s3 = sigs[2];
  console.log('=== buy_1_2 信号 metadata 顶层键:', Object.keys(s3.metadata || {}).join(','));
  const md = s3.metadata || {};
  if (md.factorSnapshot) {
    const fs_ = md.factorSnapshot;
    const keys = ['tradeCount','currentVsLaunchPct','launchMinVsFloorPct','athVsLaunchPct','tokenAgeSec','buyVolumeBnb','actTotalBnb','holdersExDust','totalBuyBnb','minVsLaunchPct'];
    const out = {};
    for (const k of keys) if (fs_[k] !== undefined) out[k] = fs_[k];
    console.log('factorSnapshot 摘要:', JSON.stringify(out));
    console.log('factorSnapshot 全键数:', Object.keys(fs_).length);
  }
  // 找含因子的段
  for (const k of Object.keys(md)) {
    const v = md[k];
    if (v && typeof v === 'object' && (v.tradeCount !== undefined || (v.factors && v.factors.tradeCount !== undefined))) {
      console.log(`metadata.${k} 含 tradeCount=`, v.tradeCount ?? v.factors.tradeCount, ' curVs=', v.currentVsLaunchPct ?? v.factors?.currentVsLaunchPct);
    }
  }

  // SELL 信号完整 metadata
  const s4 = sigs[3];
  console.log('\n=== SELL 信号 metadata:', JSON.stringify(s4.metadata || {}).slice(0, 1500));

  const { data: tr, error: e2 } = await sb.from('trades')
    .select('*')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(10);
  if (e2) throw new Error(e2.message);
  for (const x of tr) {
    console.log(`\n${x.created_at} dir=${x.trade_direction} in=${x.input_amount} ${x.input_currency} out=${x.output_amount} ${x.output_currency} unit=${x.unit_price} status=${x.trade_status} cards=${x.sold_cards}`);
    const m = x.metadata || {};
    console.log('  trade meta:', JSON.stringify({buyPriceBnb: m.buyPriceBnb, profitPercent: m.profitPercent, peakProfitPct: m.peakProfitPct, sellReason: m.sellReason || m.reason || m.why, strategyId: m.strategyId || m.strategy_id}).slice(0, 400));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
