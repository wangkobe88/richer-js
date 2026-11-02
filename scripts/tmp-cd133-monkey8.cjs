const path = require('path');
const { dbManager } = require(path.join(__dirname, '../src/services/dbManager'));
const D827 = '0xd827bc26713cb6412f4d163766938dee3d0c7777';
async function main() {
  const client = dbManager.getClient();
  const one = await client.from('cheat_detection').select('*').limit(1);
  if (one.error) { console.log('ERR ' + one.error.message); process.exit(1); }
  const cols = Object.keys(one.data[0] || {});
  console.log('cheat_detection 列: ' + cols.join(','));
  const tsCol = cols.find(c => /at|time/i.test(c));
  console.log('时间列候选: ' + tsCol);
  // d827 的行
  const cd = await client.from('cheat_detection').select('*').eq('token_address', D827);
  if (cd.error) { console.log('ERR ' + cd.error.message); process.exit(1); }
  console.log('\n== d827 cheat_detection ' + cd.data.length + ' 行');
  const sortCol = cols.includes('analysis_time') ? 'analysis_time' : (cols.includes('analyzed_at') ? 'analyzed_at' : tsCol);
  cd.data.sort((a, b) => String(a[sortCol]).localeCompare(String(b[sortCol])));
  for (const r of cd.data) {
    const d = r.snapshot_digest || {};
    console.log('-- ' + r[sortCol] + ' verdict=' + r.verdict + ' grade=' + d.grade + ' v=' + d.gradeVersion + ' tickCount=' + d.tickCount + ' capped=' + d.capped + ' watermark=' + d.watermark);
    console.log('   phenomena=' + JSON.stringify(d.phenomena));
    console.log('   extLevels=' + JSON.stringify(d.extLevels) + ' act=' + d.activityLevel + ' dom=' + d.bundledDominance);
    console.log('   anchors=' + JSON.stringify(d.anchors));
    console.log('   famous=' + JSON.stringify(d.famous));
    console.log('   reasons=' + JSON.stringify(d.gradeReasons));
  }
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
