#!/usr/bin/env node
// 临时查证：9b31baf4 实验 + 0x6075…7777 为什么放行买入（famous 全部卖出还接盘）
const fs = require('fs');
const path = require('path');
const { dbManager } = require('../src/services/dbManager');

const EXP = '9b31baf4-bdd3-4ebb-9031-2a1603f34633';
const TOKEN = '0x6075e97a4553c71ec1ef1a5bb29200e184f17777';

function loadRoster() {
  const p = path.resolve(__dirname, '../config/rosters/famous-copy-wallets.json');
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const arr = Array.isArray(j) ? j : (j.wallets || j.addresses || []);
    return arr.map((x) => (typeof x === 'string' ? x.toLowerCase() : String(x.address || x.wallet || '').toLowerCase())).filter(Boolean);
  } catch (e) { console.log('roster read fail:', e.message); return []; }
}

async function main() {
  const sb = dbManager.getClient();
  const roster = new Set(loadRoster());
  console.log(`famous roster size=${roster.size}`);

  const { data: exp, error: e1 } = await sb.from('experiments')
    .select('id,experiment_name,trading_mode,status,config,created_at').eq('id', EXP).limit(1);
  if (e1) throw new Error(e1.message);
  const x = exp && exp[0];
  if (!x) { console.log('experiment not found'); return; }
  const cfg = x.config || {};
  const fm = cfg.fourmemeWs || {};
  console.log(`\n=== 实验 ${EXP}`);
  console.log(`name=${x.experiment_name} mode=${x.trading_mode} status=${x.status} platform=${cfg.platform}`);
  console.log(`cheatCheck.enabled=${fm.cheatCheck && fm.cheatCheck.enabled}`);
  console.log(`buyPointCheck=${JSON.stringify(fm.buyPointCheck || null)}`);
  console.log(`actFrontGate=${JSON.stringify((fm.cheatCheck || {}).actFrontGate || null)}`);
  console.log(`buySignalCooldownMs=${fm.buySignalCooldownMs} maxPerToken=${fm.buySignalMaxPerToken}`);

  // 信号全量
  const { data: sigs, error: e2 } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(60);
  if (e2) throw new Error(e2.message);
  console.log(`\n=== 信号 ${sigs.length} 条`);
  for (const s of sigs) {
    const md = s.metadata || {};
    const sg = md.signalGate || {};
    const fc = md.factorCheck;
    const af = md.actFrontGate;
    const cc = md.cheatCheck;
    const bp = md.buyPoint;
    console.log(`\n- [${s.created_at}] type=${s.signal_type} strat=${s.strategy_name || '-'} status=${s.execution_status} reason=${(s.reason || '').slice(0, 80)}`);
    if (sg.legId || sg.triggerNo) console.log(`  signalGate: leg=${sg.legId} triggerNo=${sg.triggerNo}`);
    if (fc) console.log(`  factorCheck: status=${fc.status} pass=${fc.pass} reason=${fc.reason}`);
    if (af) console.log(`  actFront: ${JSON.stringify(af).slice(0, 220)}`);
    if (cc) {
      const info = cc.info || {};
      console.log(`  cheatCheck: grade=${cc.grade || info.grade} status=${cc.status || info.status} reasons=${JSON.stringify(cc.reasons || info.reasons || []).slice(0, 160)}`);
      if (cc.levels) console.log(`    act=${cc.levels.activityLevel} sbw=${cc.levels.stallBurstWave}`);
      if (cc.exempt || info.exempt) console.log(`    exempt=${JSON.stringify(cc.exempt || info.exempt)}`);
      if (cc.exemptDenied) console.log(`    exemptDenied=${cc.exemptDenied}`);
    }
    if (bp) {
      console.log(`  buyPoint: status=${bp.status} bucket=${bp.bucket || (bp.assessment && bp.assessment.overall) || '-'} rule=${bp.rule || '-'} ${bp.exempt ? 'exempt=' + JSON.stringify(bp.exempt) : ''}`);
      const d = bp.digest || {};
      const qual = d.qualities || {};
      if (Object.keys(qual).length) console.log(`    qualities: ${JSON.stringify(qual)}`);
      if (d.answers) console.log(`    answers: ${JSON.stringify(d.answers).slice(0, 300)}`);
    }
  }

  // 成交
  const { data: trs, error: e4 } = await sb.from('trades')
    .select('*').eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(40);
  if (e4) throw new Error(e4.message);
  console.log(`\n=== 成交 ${trs.length} 笔`);
  for (const t of trs) {
    console.log(`- [${t.created_at}] ${t.trade_type} bnb=${t.bnb_amount} price=${t.price_bnb} qty=${t.token_amount} pnl=${t.profit_loss_bnb != null ? t.profit_loss_bnb : (t.metadata && t.metadata.profitLossBnb) || '-'}`);
  }

  // 锚窗 ticks 概况 + famous 行为
  const { data: ticks, error: e3 } = await sb.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,sender_address,trader_address,price_outlier')
    .eq('token_address', TOKEN)
    .order('block_time', { ascending: true }).limit(1000);
  if (e3) throw new Error(e3.message);
  console.log(`\n=== ticks 行数=${ticks.length}`);
  if (!ticks.length) return;
  const t0 = new Date(ticks[0].block_time).getTime();
  let buyN = 0, sellN = 0, buyB = 0, sellB = 0;
  const famEvents = [];
  for (const r of ticks) {
    const w = ((r.sender_address || r.trader_address) || '').toLowerCase();
    const isBuy = String(r.trade_type).toLowerCase() === 'buy';
    if (isBuy) { buyN++; buyB += Number(r.bnb_amount || 0); } else { sellN++; sellB += Number(r.bnb_amount || 0); }
    if (roster.has(w)) {
      famEvents.push({ t: r.block_time, sec: ((new Date(r.block_time).getTime() - t0) / 1000).toFixed(1), type: r.trade_type, bnb: r.bnb_amount, w: w.slice(0, 10) });
    }
  }
  console.log(`total buy=${buyN}/${buyB.toFixed(3)}B sell=${sellN}/${sellB.toFixed(3)}B span=${((new Date(ticks[ticks.length - 1].block_time).getTime() - t0) / 60000).toFixed(1)}min`);
  console.log(`\n=== famous roster 命中行=${famEvents.length}`);
  const byWallet = {};
  for (const f of famEvents) {
    (byWallet[f.w] = byWallet[f.w] || []).push(f);
    console.log(`  t+${f.sec}s ${f.type} ${f.bnb} ${f.w}`);
  }
  for (const [w, evs] of Object.entries(byWallet)) {
    let buy = 0, sell = 0;
    for (const e of evs) { if (String(e.type).toLowerCase() === 'buy') buy += Number(e.bnb); else sell += Number(e.bnb); }
    console.log(`  wallet ${w}: buy=${buy.toFixed(4)} sell=${sell.toFixed(4)} net=${(buy - sell).toFixed(4)} firstT=${evs[0].sec}s lastT=${evs[evs.length - 1].sec}s`);
  }
  // 首信号时刻前后 5s 内的概况
  if (sigs.length) {
    const sigTs = new Date(sigs[0].created_at).getTime();
    let near = { b: 0, s: 0, bn: 0, sn: 0 };
    for (const r of ticks) {
      const ts = new Date(r.block_time).getTime();
      if (ts <= sigTs && ts > sigTs - 30000) {
        if (String(r.trade_type).toLowerCase() === 'buy') { near.bn++; near.b += Number(r.bnb_amount || 0); }
        else { near.sn++; near.s += Number(r.bnb_amount || 0); }
      }
    }
    console.log(`\n首信号前 30s: buy=${near.bn}/${near.b.toFixed(3)}B sell=${near.sn}/${near.s.toFixed(3)}B`);
    console.log(`首信号 t+${((sigTs - t0) / 1000).toFixed(1)}s（token 首行起算）`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
