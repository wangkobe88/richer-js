require('dotenv').config({ path: './config/.env' });
const fs = require('fs');
const s = JSON.parse(fs.readFileSync('tmp-diag-c01c-signal1.json', 'utf8'));
const tf = s.metadata.trendFactors || {};
const keys = Object.keys(tf);
console.log('--- act* 滑窗(10s) + 量级键 ---');
for (const k of keys) {
  if (/^act|^trade|^buyVolume|^sellVolume|^holders|^tokenAge|^age$|^currentVsLaunch|^quiet|^recentBlock|mcap|FromPeak/i.test(k)) {
    console.log(' ', k, '=', JSON.stringify(tf[k]));
  }
}
