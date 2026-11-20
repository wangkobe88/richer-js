// 0x2b63 补充：原始信号行 + 实验 config
const { dbManager } = require('../src/services/dbManager');
const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
const TOKEN = '0x2b63c82ed1eb65e6298031c8cf5c307c26307777';

async function main() {
  const sb = dbManager.getClient();
  const { data: exp } = await sb.from('experiments').select('name,status,trading_mode,config').eq('id', EXP).single();
  if (exp) {
    console.log('EXP', exp.name, '| mode=', exp.trading_mode, '| status=', exp.status);
    const c = exp.config || {};
    console.log('config keys:', Object.keys(c).join(','));
    const fw = c.fourmemeWs || {};
    console.log('fourmemeWs keys:', Object.keys(fw).join(','));
    console.log('flapWs keys:', Object.keys(c.flapWs || {}).join(','));
    console.log('signalGateReal(backtest):', c.backtest?.signalGateReal, '| sourceExp=', c.backtest?.sourceExperimentId, '| win=', c.backtest?.startTime, '~', c.backtest?.endTime);
    for (const k of ['cheatCheck', 'buyPointCheck', 'gmgnCheck']) {
      console.log(`  ${k}:`, JSON.stringify(fw[k] || (c.flapWs || {})[k] || null));
    }
    console.log('strategies legs count:', (c.strategies || []).length);
    for (const s of c.strategies || []) {
      for (const leg of s.legs || []) {
        console.log('  leg:', leg.id || leg.name, '| side=', leg.side, '| signalGate=', !!leg.signalGate, '| cond=', String(leg.conditionText || '').slice(0, 120));
      }
    }
  }
  const { data: sigs } = await sb.from('strategy_signals').select('*').eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at');
  console.log('\n=== signal rows:', (sigs || []).length);
  for (const s of sigs || []) {
    const m = s.metadata || {};
    console.log('\nROW', s.created_at, '| type=', s.signal_type, '| reason=', s.reason, '| exec=', s.execution_status, '| price=', s.price);
    console.log('  meta keys:', Object.keys(m).join(','));
    if (m.signalGate) console.log('  signalGate:', JSON.stringify(m.signalGate));
    if (m.factorCheck) console.log('  factorCheck:', JSON.stringify(m.factorCheck).slice(0, 800));
    if (m.actFrontGate) console.log('  actFrontGate:', JSON.stringify(m.actFrontGate));
    if (m.cheatCheck) console.log('  cheatCheck:', JSON.stringify(m.cheatCheck).slice(0, 1200));
    if (m.buyPoint) console.log('  buyPoint:', JSON.stringify(m.buyPoint).slice(0, 1200));
    const fr = m.factorResults || m.factors || m.factorSnapshot || {};
    const keys = ['tradeCount', 'buyVolumeBnb', 'actTotalBnb', 'currentVsLaunchPct', 'tokenAgeSec', 'holdersExDust',
      'tradesNetBuyRatioLongWin', 'tradesNetBuyRatioShortWin', 'launchBundleClusterSize', 'launchFirstBlockWallets', 'launchFirstWaveWallets', 'launchMinVsFloorPct'];
    const got = keys.filter(k => fr[k] !== undefined);
    if (got.length) console.log('  factors:', got.map(k => k + '=' + fr[k]).join(' '));
    if (m.factorSnapshotKeys) console.log('  factorSnapshot keys:', m.factorSnapshotKeys);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
