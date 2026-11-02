// b3d4 深挖：twitter_info 全文 + final details 全量 + trades + token create 事件
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0xb3d4d7faf25bec37960be028fbc40bf500957777';

(async () => {
  const db = dbManager.getClient();

  const { data: tn } = await db
    .from('token_narrative')
    .select('*')
    .eq('token_address', ADDR);
  const row = tn[0];

  console.log('=== twitter_info 原文 ===');
  console.log(JSON.stringify(row.twitter_info, null, 1).slice(0, 4000));

  console.log('\n=== final_result.details 全量（截 6000） ===');
  const fin = row.final_result;
  console.log(JSON.stringify(fin, null, 1).slice(0, 6000));

  console.log('\n=== raw_api_data keys ===');
  const rad = row.raw_api_data || {};
  console.log(Object.keys(rad).join(','));
  if (rad.tokenMeta) console.log('tokenMeta:', JSON.stringify(rad.tokenMeta).slice(0, 300));
  if (rad.appendixInfo) console.log('appendixInfo:', JSON.stringify(rad.appendixInfo).slice(0, 500));
  if (rad.aveInfo) console.log('aveInfo:', JSON.stringify(rad.aveInfo).slice(0, 500));

  // trades：这票有没有被买
  const { data: trades, error: et } = await db
    .from('trades')
    .select('*')
    .eq('token_address', ADDR)
    .order('trade_time', { ascending: true })
    .limit(20);
  if (et) console.log('trades error:', et.message);
  else {
    console.log('\n=== trades 行数:', trades.length);
    for (const t of trades) {
      console.log(`${t.side} qty=${t.quantity} price=${t.price_bnb ?? t.price} bnb=${t.bnb_amount} time=${t.trade_time} exp=${t.experiment_id} pnl=${t.pnl_bnb ?? t.realized_pnl}`);
    }
  }

  // token_create 事件：创建时间 + creator
  const { data: evs, error: ee } = await db
    .from('wss_events')
    .select('kind,block_number,block_time,payload')
    .eq('token_address', ADDR)
    .order('block_number', { ascending: true })
    .limit(5);
  if (ee) console.log('events error:', ee.message);
  else {
    console.log('\n=== wss_events 行数:', evs.length);
    for (const e of evs) {
      const p = e.payload || {};
      console.log(`${e.kind} block=${e.block_number} time=${e.block_time} creator=${p.creator} name=${p.name} symbol=${p.symbol} twitter=${p.twitterUrl ?? p.twitter}`);
    }
  }

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
