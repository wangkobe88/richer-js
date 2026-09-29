const { dbManager } = require('./src/services/dbManager.js');
(async () => {
  const addr = '0x1684e8f48e3a408d77b02adafddb7acc88b17777';
  const createdMs = new Date('2026-09-28T20:04:13+00:00').getTime();
  const client = dbManager.getClient();
  const { data: ticks } = await client
    .from('wss_price_ticks')
    .select('price_bnb, bnb_amount, trader_address, trade_type, block_time')
    .eq('token_address', addr)
    .order('block_time', { ascending: true });
  const rel = t => ((new Date(t.block_time).getTime() - createdMs) / 1000).toFixed(0);

  console.log('===== 0xb1000000 无买入净卖出(场外分发)明细 =====');
  for (const t of ticks.filter(t => t.trader_address.toLowerCase().startsWith('0xb1000000'))) {
    console.log(`+${rel(t)}s ${t.trade_type} ${t.bnb_amount.toFixed(4)} BNB @ ${(t.price_bnb/4.977e-9*100-100).toFixed(1)}%`);
  }

  console.log('\n===== 0x1de460f3 (对倒主力) 交易时间线 =====');
  for (const t of ticks.filter(t => t.trader_address.toLowerCase().startsWith('0x1de460f3'))) {
    console.log(`+${rel(t)}s ${t.trade_type.padEnd(4)} ${t.bnb_amount.toFixed(4)} BNB @ ${(t.price_bnb/4.977e-9*100-100).toFixed(1)}%`);
  }

  console.log('\n===== 峰值前后的交易(+142% 拉升段) =====');
  let peakIdx = 0, peakP = 0;
  ticks.forEach((t, i) => { if (t.price_bnb > peakP) { peakP = t.price_bnb; peakIdx = i; } });
  for (const t of ticks.slice(Math.max(0, peakIdx - 12), peakIdx + 6)) {
    console.log(`+${rel(t)}s ${t.trader_address.slice(0, 10)} ${t.trade_type.padEnd(4)} ${t.bnb_amount.toFixed(4)} BNB @ ${(t.price_bnb/4.977e-9*100-100).toFixed(1)}%`);
  }

  console.log('\n===== 前 120s 完整逐笔 =====');
  for (const t of ticks.filter(t => new Date(t.block_time).getTime() - createdMs <= 120000)) {
    console.log(`+${rel(t)}s ${t.trader_address.slice(0, 10)} ${t.trade_type.padEnd(4)} ${t.bnb_amount.toFixed(4)} BNB @ ${(t.price_bnb/4.977e-9*100-100).toFixed(1)}%`);
  }

  // 跨票画像:这些嫌疑钱包在其他票的行为
  const suspects = ['0x1de460f363af910f51726def188f9004276bf4bc','0x168303a9','0x317131b1','0x77c539cc','0x00e834e2','0x3544af3c','0xb6864c01','0x17d43b94','0x39dccc59','0xb1000000'];
  // wallet_offline_profiles 有画像
  const { data: prof } = await client
    .from('wallet_offline_profiles')
    .select('address, bad_action_rate, aggregated_trade_count, token_count, first_seen, last_seen')
    .in('address', suspects.map(s => s.length === 42 ? s : s + '0000000000000000000000000000000000000000'.slice(s.length - 2)));
  console.log('\n===== 嫌疑钱包离线画像(wallet_offline_profiles) =====');
  console.log(prof ? JSON.stringify(prof, null, 1) : 'null');

  // 也查一下完整地址前缀匹配
  const { data: profAll } = await client.from('wallet_offline_profiles').select('address, bad_action_rate, aggregated_trade_count, token_count').limit(1);
  console.log('profile 表可查:', profAll ? 'yes' : 'no');

  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
