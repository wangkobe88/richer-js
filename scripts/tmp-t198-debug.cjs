require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot');
(async () => {
  const sb = dbManager.getClient();
  const arbSet = new Set();
  { let after = null;
    for (;;) {
      let q = sb.from('gmgn_wallet_profiles').select('address,tags').order('address').limit(1000);
      if (after) q = q.gt('address', after);
      const { data } = await q; if (!data || !data.length) break;
      for (const r of data) if ((r.tags || []).some((t) => ['arbitrager','sandwich_bot','wash_trader'].includes(t))) arbSet.add(r.address.toLowerCase());
      after = data[data.length - 1].address;
      if (data.length < 1000) break;
    } }
  const TOK = '0x64ed2dab6a566e0077c8922fc73d9ae6ab577777';
  const { data: sig } = await sb.from('strategy_signals').select('created_at')
    .eq('experiment_id', '7ae8e398-c875-454a-942b-bc1accfacd53').eq('token_address', TOK)
    .eq('signal_type', 'BUY').not('metadata->buyPoint->anchors->routerBuyPct60', 'is', null)
    .order('created_at').limit(1);
  console.log('anchor:', sig[0] && sig[0].created_at);
  const { data: rows } = await sb.from('wss_price_ticks').select('*').eq('token_address', TOK)
    .lte('block_time', sig[0].created_at).order('block_number').order('log_index').limit(3000);
  console.log('rows:', rows.length);
  const meta = { address: TOK, symbol: '', name: '', createdAt: rows[0].block_time, creatorAddress: null, totalSupply: 1e9 };
  const snap = buildBuyPointSnapshot(rows, meta, { arbBotWallets: arbSet });
  console.log('wallets N:', (snap.wallets || []).length);
  console.log('wallet[0] keys:', snap.wallets && snap.wallets[0] && Object.keys(snap.wallets[0]).join(','));
  const d = snap.buyDerived;
  console.log('arbBotHoldCircPct:', d.arbBotHoldCircPct, 'holderN:', d.arbBotHolderN, 'oversellBnb:', d.oversellBnb, 'anchorWalletN:', d.anchorWalletN);
  if (snap.wallets) {
    let inSet = 0;
    for (const e of snap.wallets) if (arbSet.has(e.w)) inSet++;
    console.log('wallets 内 arbBot 命中户数:', inSet, '| w 样本:', snap.wallets.slice(0, 3).map(e => e.w));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
