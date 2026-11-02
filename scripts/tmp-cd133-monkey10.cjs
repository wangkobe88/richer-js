const path = require('path');
const { dbManager } = require(path.join(__dirname, '../src/services/dbManager'));
const { gradeObservation } = require(path.join(__dirname, '../src/market-analysis/cheat-grade.js'));
async function main() {
  const client = dbManager.getClient();
  for (const [tok, label] of [
    ['0xd827bc26713cb6412f4d163766938dee3d0c7777', '真猴子 d827'],
    ['0xe8e0c8737701105824403a5aaccd0030018a7777', '同名票 e8e0'],
  ]) {
    const cd = await client.from('cheat_detection').select('analyzed_at, verdict, snapshot_digest')
      .eq('token_address', tok).order('analyzed_at', { ascending: true });
    const last = cd.data[cd.data.length - 1];
    const d = last.snapshot_digest || {};
    console.log('== ' + label + '（末行 ' + last.analyzed_at + '，共 ' + cd.data.length + ' 行）');
    console.log('   G8 进程判定: grade=' + d.grade + ' reasons=' + JSON.stringify(d.gradeReasons));
    const obs = { phenomena: d.phenomena, extLevels: d.extLevels, activityLevel: d.activityLevel, bundledDominance: d.bundledDominance, anchors: d.anchors };
    const extras = {
      famousLevel: d.famous ? d.famous.level : null,
      famousFollowerTop3Pct: d.famous ? d.famous.followerTop3Pct : null,
      famousGroupBuyPct: null, anchorSellCount: d.anchorSellCount ?? null,
    };
    const g = gradeObservation(obs, extras);
    console.log('   G11 重放  : grade=' + g.grade + ' reasons=' + JSON.stringify(g.reasons) + '（version=' + g.version + '）');
    console.log('   extLevels=' + JSON.stringify(d.extLevels));
    console.log('');
  }
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
