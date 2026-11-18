#!/usr/bin/env node
const { dbManager } = require('../src/services/dbManager');

const EXP = '9b31baf4-bdd3-4ebb-9031-2a1603f34633';
const TOKEN = '0x6957ace830287a43996bc218fec5c025b17f7777';

async function main() {
  const sb = dbManager.getClient();
  const { data: exp } = await sb.from('experiments').select('id,name,trading_mode,status,config').eq('id', EXP).limit(1);
  const x = exp && exp[0];
  console.log('=== 实验 ===');
  console.log(`name=${x?.name} mode=${x?.trading_mode} status=${x?.status}`);
  const cfg = x?.config || {};
  const fw = cfg.fourmemeWs || {};
  console.log('灰度键:', JSON.stringify({
    factorCheck: fw.buyPointCheck?.factorCheck?.enabled,
    actFrontGate: fw.cheatCheck?.actFrontGate?.enabled,
    cheatCheck: fw.cheatCheck?.enabled,
    buyPointCheck: fw.buyPointCheck?.enabled,
    signalGateReal: cfg.backtest?.signalGateReal,
  }));

  const { data: sigs } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(30);
  console.log('\n=== 信号行 ===', sigs?.length, '行');
  for (const s of sigs || []) {
    console.log(JSON.stringify({ id: s.id, at: s.created_at, strat: s.strategy_id, action: s.action, status: s.execution_status, reason: s.execution_reason, fail: s.failure_reason, price: s.price }));
  }
  let buyAt = null;
  for (const s of sigs || []) {
    if (s.action === 'BUY' && (s.execution_status === 'executed' || !buyAt)) buyAt = s.created_at;
    console.log(`\n--- metadata ${s.id} (${s.created_at}) ---`);
    console.log(JSON.stringify(s.metadata, null, 1));
  }

  // buy_point_analyses
  const { data: bp } = await sb.from('buy_point_analyses')
    .select('*').eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(20);
  console.log('\n=== buy_point_analyses ===', bp?.length, '行');
  for (const r of bp || []) {
    const d = r.assessment || r;
    console.log(JSON.stringify({ at: r.created_at, level: r.level, rule: r.rule, pattern: d?.market_pattern, entry: d?.entry_shape, act: d?.activity_level, holder: d?.holder_concentration, exempt: d?.exempt, digestKeys: r.snapshot_digest ? Object.keys(r.snapshot_digest) : null }));
  }

  // trades
  const { data: tr } = await sb.from('trades')
    .select('*').eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(20);
  console.log('\n=== trades ===', tr?.length, '行');
  for (const t of tr || []) {
    console.log(JSON.stringify({ at: t.created_at, side: t.side, price: t.price, qty: t.quantity, bnb: t.bnb_amount, pnl: t.profit_loss }));
  }
  const buyTrade = (tr || []).find(t => t.side === 'buy');
  console.log('buyTrade at =', buyTrade?.created_at, 'signal buyAt =', buyAt);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
