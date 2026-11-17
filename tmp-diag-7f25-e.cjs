require('dotenv').config({ path: './config/.env' });
const fs = require('fs');
const s = JSON.parse(fs.readFileSync('tmp-diag-7f25-signal2.json', 'utf8'));
const an = (s.metadata.buyPoint||{}).anchors || {};
console.log('--- BP 砸块族锚（malicious_dump 四腿原料）---');
for (const k of ['dumpBlockBnb','dumpBlockSellers','dumpBlockDropPct','dumpBlockTopSellerPct','dumpBlockSecToAnchor','dumpBlockFollowBuyBnb','dumpBlockFollowBuyRatio',
                 'dump2BlockBnb','dump2BlockSellers','dump2BlockDropPct','dump2BlockSecToAnchor','dump2BlockFollowBuyBnb','dump2BlockFollowBuyRatio']) {
  console.log(' ', k, '=', JSON.stringify(an[k]));
}
console.log('\n--- 位置/量级锚 ---');
for (const k of ['currentVsLaunchPct','curVsMinGapPct','minVsLaunchPct','athVsLaunchPct','totalVolumeBnb','currentVsAthPct','secSinceAth','tokenAgeSec','bundledBlockWallets','bundledBlockBnb','exactEqualBlockMaxWallets']) {
  console.log(' ', k, '=', JSON.stringify(an[k]));
}
console.log('\n--- 尾窗/act ---');
for (const k of ['actNearTail10TickN','actNearTail10SellWallets','actNearTail5BuyN','actNearTail5BuyBnb','actThroughputBnbPerMin','actNearSegBnbPerMin']) {
  console.log(' ', k, '=', JSON.stringify(an[k]));
}
