#!/usr/bin/env node
const { dbManager } = require('../src/services/dbManager');

const EXP = '9b31baf4-bdd3-4ebb-9031-2a1603f34633';
const TOKEN = '0x65104a556200d2ac4fc0462c14b240e3ca307777';

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
    alwaysRecheck: fw.cheatCheck?.gate?.alwaysRecheck,
    strategies: (cfg.strategies || []).map(s => s.name),
  }));

  const { data: sigs } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(20);
  console.log('\n=== 信号行 ===', sigs?.length, '行');
  for (const s of sigs || []) {
    console.log(JSON.stringify({ id: s.id, at: s.created_at, strat: s.strategy_id, action: s.action, status: s.execution_status, reason: s.execution_reason, fail: s.failure_reason, price: s.price }));
  }
  // 完整 metadata dump 第一条 BUY + 被拒的
  if (sigs && sigs.length) {
    for (const s of sigs) {
      console.log(`\n--- metadata ${s.id} (${s.created_at}) ---`);
      console.log(JSON.stringify(s.metadata, null, 1));
    }
  }

  // cheat_detection 行
  const { data: cd } = await sb.from('cheat_detection')
    .select('*').eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(30);
  console.log('\n=== cheat_detection ===', cd?.length, '行');
  for (const r of cd || []) {
    console.log(JSON.stringify({ at: r.created_at, verdict: r.verdict, grade: r.grade, reasons: r.grade_reasons, gateMode: r.gate_mode, obs: r.observation ? { act: r.observation.activityLevel, anchors: r.observation.anchors } : null }));
  }

  // trades
  const { data: tr } = await sb.from('trades')
    .select('*').eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(20);
  console.log('\n=== trades ===', tr?.length, '行');
  for (const t of tr || []) {
    console.log(JSON.stringify({ at: t.created_at, side: t.side, price: t.price, qty: t.quantity, bnb: t.bnb_amount, pnl: t.profit_loss, meta: t.metadata ? Object.keys(t.metadata) : null }));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
