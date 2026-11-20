const { dbManager } = require('../src/services/dbManager');
const EXP = '2bdf98ab-d85f-40fa-84b5-d79099e1006c';
const TOKEN = '0x419c12c85c034f7e9f2d8a6a4de604059db77777';
async function main() {
  const sb = dbManager.getClient();
  const { data: sigs } = await sb.from('strategy_signals').select('*').eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at');
  for (const s of sigs || []) {
    const m = s.metadata || {};
    console.log('ROW', s.created_at, '| type=', s.signal_type, '| reason=', s.reason, '| price=', s.price);
    if (m.actFrontGate) console.log('  actFrontGate:', JSON.stringify(m.actFrontGate));
    if (m.cheatCheck) {
      const cc = m.cheatCheck;
      console.log('  cheatCheck.grade=', cc.grade, '| sbw=', cc.levels?.stallBurstWave, '| act=', cc.levels?.activityLevel);
      const an = cc.anchors || {};
      console.log('  burst anchors: burstWaveBuyBnb=', an.burstWaveBuyBnb, 'wallets=', an.burstWaveWallets, 'maxGapSec=', an.burstMaxGapSec, 'segSellPct=', an.burstWaveSegSellPct);
    }
    if (m.burstCooldownInfo) console.log('  burstCooldownInfo:', JSON.stringify(m.burstCooldownInfo));
  }
  const { data: ts } = await sb.from('trades').select('trade_direction,input_amount,output_amount,unit_price,created_at,signal_id').eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at');
  for (const t of ts || []) console.log('TRADE', t.created_at, t.trade_direction, 'in=', t.input_amount, 'out=', t.output_amount, 'unit=', t.unit_price);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
