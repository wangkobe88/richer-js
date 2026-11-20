require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const { data } = await sb.from('strategy_signals').select('metadata')
    .eq('id', '6096cd38-f0c7-474c-b40f-993951183015').single();
  const a = data.metadata.buyPoint.anchors;
  console.log(JSON.stringify({
    tokenAgeSec: a.tokenAgeSec, currentVsLaunchPct: a.currentVsLaunchPct, curVsAth: a.currentVsAthPct,
    athVsLaunchPct: a.athVsLaunchPct, chg5Pct: a.chg5Pct, chg30Pct: a.chg30Pct,
    burst5N: a.burst5N, burst5BuyBnb: a.burst5BuyBnb, bundledBlockWallets: a.bundledBlockWallets,
    bundledBlockBnb: a.bundledBlockBnb, nearMaxUp5Pct: a.nearMaxUp5Pct, nearMaxDn5Pct: a.nearMaxDn5Pct,
    actNearTail5BuyN: a.actNearTail5BuyN, actNearTail7BuyN: a.actNearTail7BuyN,
    routerBuyPct60: a.routerBuyPct60, win30SellN: a.win30SellN, exitSellerCount60: a.exitSellerCount60
  }, null, 1));
  const legs = data.metadata.legName || data.metadata.strategyName || data.metadata.leg;
  console.log('leg:', legs, '| signalGate:', JSON.stringify(data.metadata.signalGate));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
