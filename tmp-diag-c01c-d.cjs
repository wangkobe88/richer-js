require('dotenv').config({ path: './config/.env' });
const fs = require('fs');
const s = JSON.parse(fs.readFileSync('tmp-diag-c01c-signal1.json', 'utf8'));
const md = s.metadata;
const c = md.cheatCheck;
console.log('grade:', c.grade, '| status:', c.status, '| cached:', c.cached);
console.log('reasons:', JSON.stringify(c.reasons, null, 2));
console.log('exempt:', JSON.stringify(c.exempt, null, 2));
console.log('\nbuckets.activityLevel:', c.buckets.activityLevel, '| levels.activityLevel:', c.levels.activityLevel);
console.log('buckets.stallBurstWave:', c.buckets.stallBurstWave, '| levels.stallBurstWave:', c.levels.stallBurstWave);
console.log('\n--- all buckets ---');
for (const k of Object.keys(c.buckets)) console.log(' ', k, '=', c.buckets[k], '(score', c.levels[k], ')');
console.log('\nsignalGate:', JSON.stringify(md.signalGate, null, 2));
console.log('\nexecution_reason:', md.execution_reason, '| execution_status:', md.execution_status);
console.log('price:', md.price);
// 活跃度相关 anchors
const A = c.anchors;
const pick = ['burstMaxGapSec','burstWaveBuyBnb','burstWaveWallets','burstWaveNetBnb','burstWaveWalletNetBnb','burstExitVsLaunchPct','noBuySellPct','top1HoldCircPct','spanInfo'];
for (const k of Object.keys(A).filter(k => /burst|noBuy/i.test(k))) console.log('anchor', k, '=', JSON.stringify(A[k]));
