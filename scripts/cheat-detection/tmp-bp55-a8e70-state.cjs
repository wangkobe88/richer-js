// 一次性探针（182 跑）：a8e70 锚 04:46:51 BP55 state [WALLETS] 段直读——验证「(最大单笔X)」直供与②判读材料。
const { dbManager } = require('../../src/services/dbManager.js');
const { buildBuyPointSnapshot } = require('../../src/market-analysis/buy-point-snapshot.js');
const { buildBuyPointState } = require('../../src/market-analysis/buy-point-state-builder.js');

const TOKEN = '0xa8e70ca07b68a07683c963513a26f2fa91647777';
const ANCHOR = '2026-11-05T04:46:51.000+00:00';

async function main() {
  const client = await dbManager.getClient();
  const { data: rows, error } = await client.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,sender_address,trader_address,tx_hash,log_index,block_number')
    .eq('token_address', TOKEN).lte('block_time', ANCHOR)
    .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(1000);
  if (error) throw new Error(error.message);
  const t0 = Date.parse(rows[0].block_time);
  const meta = { address: TOKEN, symbol: 'TEST', name: 'a8e70', createdAt: new Date(t0).toISOString(), creatorAddress: null, totalSupply: 1e9 };
  const lastP = Number(rows[rows.length - 1].price_bnb);
  const snap = buildBuyPointSnapshot(rows, meta, { signalInfo: { signalId: 'bp55-probe', createdAt: ANCHOR, strategyName: 'probe', firePriceBnb: lastP } });
  const st = buildBuyPointState(snap);
  const seg = st.state.split('\n[WALLETS]（按买入额降序')[1] || '';
  console.log('===== [WALLETS] 段 =====');
  console.log('[WALLETS]（按买入额降序' + seg.split('\n\n')[0]);
  console.log('\n===== 前列单笔 0.2 级扫描（≥0.19）=====');
  for (const e of snap.wallets.slice(0, 10)) {
    if (e.maxBuyBnb >= 0.19) console.log(`${e.w.slice(0, 10)} 单笔最大=${e.maxBuyBnb} 累计=${e.buyBnb.toFixed(4)} ×${e.buyN} ← 单笔 0.2 级`);
  }
  console.log(`单笔 ≥0.19 钱包数=${snap.wallets.filter((e) => e.maxBuyBnb >= 0.19).length}（双臂线=≥2）`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
