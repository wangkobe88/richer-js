// 0xe9e8 门链轨迹：为何 burst 中卖占比高未拦
const { dbManager } = require('../src/services/dbManager');
const EXP = '2bdf98ab-d85f-40fa-84b5-d79099e1006c';
const TOKEN = '0xe9e82d1fa74283991dec5543453373ec836b7777';

async function main() {
  const sb = dbManager.getClient();
  const { data: exp } = await sb.from('experiments').select('name,status,trading_mode,config').eq('id', EXP).single();
  if (exp) {
    console.log('EXP', exp.name, '| mode=', exp.trading_mode, '| status=', exp.status);
    const c = exp.config || {};
    const fw = c.fourmemeWs || {};
    const fl = c.flapWs || {};
    for (const [tag, w] of [['fourmemeWs', fw], ['flapWs', fl]]) {
      if (!Object.keys(w).length) continue;
      console.log(`${tag}:`, JSON.stringify({
        cheatCheck: w.cheatCheck || null,
        buyPointCheck: w.buyPointCheck || null,
        factorCheckGate: w.buyPointCheck?.factorCheck || null,
      }, null, 1));
    }
    if (c.backtest) console.log('backtest:', JSON.stringify({ sourceExperimentId: c.backtest.sourceExperimentId, startTime: c.backtest.startTime, endTime: c.backtest.endTime, signalGateReal: c.backtest.signalGateReal }));
  }

  const { data: sigs } = await sb.from('strategy_signals').select('*').eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at');
  console.log('\n=== signal rows:', (sigs || []).length);
  for (const s of sigs || []) {
    const m = s.metadata || {};
    console.log('\nROW', s.created_at, '| type=', s.signal_type, '| action=', s.action, '| reason=', s.reason, '| exec=', s.execution_status, '| price=', s.price);
    if (m.signalGate) console.log('  signalGate:', JSON.stringify(m.signalGate));
    if (m.factorCheck) console.log('  factorCheck:', JSON.stringify(m.factorCheck).slice(0, 900));
    if (m.actFrontGate) console.log('  actFrontGate:', JSON.stringify(m.actFrontGate));
    if (m.cheatCheck) console.log('  cheatCheck:', JSON.stringify(m.cheatCheck).slice(0, 1500));
    if (m.buyPoint) console.log('  buyPoint:', JSON.stringify(m.buyPoint).slice(0, 1500));
    const fr = m.factorResults || m.factors || {};
    const keys = ['tradeCount', 'actTotalBnb', 'currentVsLaunchPct', 'tokenAgeSec', 'tradesNetBuyRatioLongWin', 'tradesNetBuyRatioShortWin'];
    const got = keys.filter(k => fr[k] !== undefined);
    if (got.length) console.log('  factors:', got.map(k => k + '=' + fr[k]).join(' '));
  }

  const { data: cds, error: e2 } = await sb.from('cheat_detection')
    .select('*').eq('token_address', TOKEN)
    .order('anchor_at', { ascending: true }).limit(20);
  if (e2) { console.log('cd err', e2.message); }
  console.log('\n=== cheat_detection rows:', (cds || []).length);
  for (const cd of cds || []) {
    const d = cd.digest || {};
    console.log('\nCD', cd.anchor_at, '| qver=', cd.question_version, '| verdict=', cd.verdict,
      '| grade=', cd.grade, '| gradeReasons=', JSON.stringify(cd.grade_reasons || cd.gradeReasons || null));
    const lv = d.levels || d.levelsFromObservation || {};
    console.log('  levels.activityLevel=', lv.activityLevel, '| stallBurstWave=', lv.stallBurstWave, '| washPair=', lv.washPair);
    const an = d.anchors || {};
    const seg = {
      burstWaveSegBuyBnb: an.burstWaveSegBuyBnb ?? d.burstWaveSegBuyBnb,
      burstWaveSegSellBnb: an.burstWaveSegSellBnb ?? d.burstWaveSegSellBnb,
      burstWaveSegSellPct: an.burstWaveSegSellPct ?? d.burstWaveSegSellPct,
      burstLastGapSec: an.burstLastGapSec, burstSecSinceWaveEnd: an.burstSecSinceWaveEnd,
      burstWaveBuyBnb: an.burstWaveBuyBnb, burstWaveWallets: an.burstWaveWallets,
      burstWaveWalletNetBnb: an.burstWaveWalletNetBnb, burstWaveSellBackPct: an.burstWaveSellBackPct,
    };
    console.log('  burst anchors:', JSON.stringify(seg));
    if (d.exempt || d.exemptDenied) console.log('  exempt:', JSON.stringify({ exempt: d.exempt, exemptDenied: d.exemptDenied }));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
