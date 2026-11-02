#!/usr/bin/env node
/** 一次性（四票实际买卖执行取证，不进 git）。 */
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const sb = dbManager.getClient();
const ADDRS = [
  '0xec74ec6b297fbe318ff09da24023319a36737777',
  '0x5a3f19b5bd587c4a127096ff37f6c9d59f007777',
  '0x43705ac9eb429777f3d993d854a29bcd61837777',
  '0xd827bc26713cb6412f4d163766938dee3d0c7777',
];
for (const ADDR of ADDRS) {
  const { data: trs } = await sb.from('trades')
    .select('trade_type,amount_bnb,price_bnb,created_at,metadata').eq('token_address', ADDR)
    .order('created_at', { ascending: true }).limit(30);
  console.log(`${ADDR.slice(0, 10)}… trades=${trs?.length ?? 0}`);
  for (const t of trs ?? []) {
    const m = t.metadata || {};
    const reason = m.stopLoss?.reason || m.cardTrade ? 'card' : (m.cheatExit ? 'CHEAT_EXIT' : '');
    console.log(`  ${t.created_at} ${t.trade_type} ${Number(t.amount_bnb).toFixed(4)} BNB @${Number(t.price_bnb).toExponential(2)} ${reason}`);
  }
}
