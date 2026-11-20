require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const EXP = 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f';
const TOK = '0x06c78718d19d9a19721d4794f80606976e428888';
async function main() {
  const sb = dbManager.getClient();
  const { data: sigs } = await sb.from('strategy_signals')
    .select('id,created_at,signal_type,action,metadata').eq('experiment_id', EXP).eq('token_address', TOK)
    .order('created_at').limit(20);
  console.log('signals:', (sigs||[]).length);
  for (const s of sigs || []) {
    const md = s.metadata || {};
    const a = md.buyPoint && md.buyPoint.anchors || {};
    console.log('---', s.created_at, s.signal_type, s.action);
    if (md.actFrontGate) console.log('  actFront:', JSON.stringify(md.actFrontGate));
    if (md.factorCheck) console.log('  factorCheck pass:', md.factorCheck.pass, 'reason:', md.factorCheck.pvp && md.factorCheck.pvp.reason, JSON.stringify(md.factorCheck.pvp && md.factorCheck.pvp.trace));
    if (md.buyPoint) console.log('  bp:', md.buyPoint.status, md.buyPoint.passed, JSON.stringify(md.buyPoint.dimensions));
    console.log('  r60:', a.routerBuyPct60, 'age:', a.tokenAgeSec, 'athVs:', a.athVsLaunchPct, 'curVs:', a.currentVsLaunchPct,
      'win30买', a.win30BuyN, a.win30BuyBnb, '尾5买N', a.actNearTail5BuyN, '尾10卖钱包', a.actNearTail10SellWallets,
      'top1卖占比60', a.top1SellPct60, 'exitSellerCount60', a.exitSellerCount60, 'bundled', a.bundledBlockBnb, a.bundledBlockWallets);
  }
  const { data: trs } = await sb.from('trades')
    .select('trade_direction,input_currency,output_currency,input_amount,output_amount,success,executed_at')
    .eq('experiment_id', EXP).eq('token_address', TOK).order('executed_at').limit(30);
  let net = 0;
  for (const t of trs || []) {
    const bnb = t.trade_direction === 'buy' ? -Number(t.input_amount) : Number(t.output_amount);
    if (t.success) net += bnb;
    console.log('trade', t.executed_at, t.trade_direction, (t.input_currency === 'BNB' ? Number(t.input_amount).toFixed(4) : Number(t.output_amount).toFixed(4)), 'BNB', t.success ? '' : 'FAILED');
  }
  console.log('NET:', net.toFixed(4), 'BNB');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
