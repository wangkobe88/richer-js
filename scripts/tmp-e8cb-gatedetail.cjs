#!/usr/bin/env node
// 0xe8cb 第三步：门链 metadata 全文 + trades 盈亏 + 实验行
const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0xe8cb59a8c2118292c38ebd6061d05c09a9227777';
const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';

async function main() {
  const sb = dbManager.getClient();

  const { data: exp } = await sb.from('experiments').select('*').eq('id', EXP).limit(1);
  if (exp && exp[0]) {
    const e = exp[0];
    const keys = Object.keys(e);
    console.log(`=== 实验 ${e.name} mode=${e.trading_mode} status=${e.status} created=${e.created_at}`);
    const cfg = e.config || e.configuration || {};
    console.log(`窗口: ${JSON.stringify(cfg.backtest || {}).slice(0, 300)}`);
  } else {
    console.log('experiments 行查询为空');
  }

  const { data: sigs } = await sb.from('strategy_signals')
    .select('id,created_at,signal_type,metadata').eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true });
  for (const s of sigs || []) {
    console.log(`\n======== [${s.created_at.slice(11, 19)}] ${s.signal_type} ========`);
    const m = s.metadata || {};
    for (const k of ['factorCheck', 'actFrontGate', 'cheatCheck', 'buyPoint', 'signalGate']) {
      if (m[k] != null) console.log(`--- ${k}:\n${JSON.stringify(m[k], null, 1).slice(0, 2600)}`);
    }
    if (m.factorResults) {
      const fr = m.factorResults;
      const pick = {};
      for (const f of ['currentVsLaunchPct', 'tradeCount', 'buyVolumeBnb', 'holdersExDust', 'actTotalBnb', 'tokenAgeSec', 'launchBundleClusterSize', 'launchFirstBlockWallets', 'launchFirstWaveWallets', 'tradesNetBuyRatioLongWin', 'tradesNetBuyRatioShortWin', 'top2HolderCircPct', 'currentPriceBnb', 'mcapUsd']) if (fr[f] !== undefined) pick[f] = fr[f];
      console.log(`--- fire 因子摘要: ${JSON.stringify(pick)}`);
    }
  }

  const { data: trades } = await sb.from('trades')
    .select('*').eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true });
  console.log(`\n=== trades ${trades?.length ?? 0} 行 ===`);
  let pnl = 0;
  for (const t of trades || []) {
    const inB = +t.input_amount || 0, outB = +t.output_amount || 0;
    console.log(`${t.created_at.slice(11, 19)} ${t.trade_direction} status=${t.trade_status} in=${inB} out=${outB} unit=${t.unit_price} ${t.signal_id ? '' : '(非信号)'}`);
    if (t.trade_direction === 'buy') pnl -= inB; else pnl += outB;
  }
  console.log(`毛盈亏(买in-卖out, BNB): ${pnl.toFixed(6)}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
