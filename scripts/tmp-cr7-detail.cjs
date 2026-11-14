const path = require('path'); require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();
(async () => {
  const T = '0xe05dbebf96c62c377eb51d0c09e42e966c0f7777';
  const EXP = 'eb561ceb-32ed-4218-94ef-4fb263b3b869';
  // 该实验此票全部 BUY 信号 metadata（cheatCheck 段 + 锚价）
  const { data: sigs, error } = await db.from('strategy_signals')
    .select('created_at,metadata').eq('experiment_id', EXP).eq('token_address', T)
    .eq('signal_type', 'BUY').order('created_at', { ascending: true }).limit(15);
  if (error) { console.log('err', error.message); process.exit(1); }
  for (const s of sigs || []) {
    const m = s.metadata || {};
    const cc = m.cheatCheck || {};
    const lv = cc.levels || {};
    const an = cc.anchors || {};
    console.log(`\n=== ${s.created_at} ===`);
    console.log(`grade=${cc.grade} reasons=${JSON.stringify(cc.reasons || null)} exempt=${JSON.stringify(cc.exempt || null)}`);
    console.log(`act=${cc.buckets?.activityLevel ?? m.buckets?.activityLevel ?? '?'} sbw=${lv.stallBurstWave} pump=${lv.slowGrindPump} spike=${lv.burstSpikeConcentration} hold=${lv.holdingsBalance} wash=${lv.washPair}`);
    console.log(`burst锚 gap=${an.burstMaxGapSec} buy=${an.burstWaveBuyBnb} wallets=${an.burstWaveWallets}`);
    console.log(`recheck=${JSON.stringify(m.signalGate?.recheckResult ?? null)} priceBack=${m.signalGate?.priceBackToAlmostLaunch ?? '?'}`);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
