const { dbManager } = require('../src/services/dbManager');
(async () => {
  const sb = dbManager.getClient();
  const TOKEN = '0xf38f48cfe9e84920e7de4d47823a0fba95a87777';
  const T0 = '2026-10-04T05:50:10Z', T1 = '2026-10-04T05:53:30Z';
  const { data: ticks, error } = await sb.from('wss_price_ticks')
    .select('price_bnb,bnb_amount,trader_address,sender_address,tx_hash,log_index,block_number,trade_type,block_time,price_outlier')
    .eq('token_address', TOKEN).gte('block_time', T0).lte('block_time', T1)
    .order('id', { ascending: true }).limit(2000);
  if (error) { console.error('ERR', error.message); process.exit(1); }
  console.log('rows:', ticks.length);
  const sf = ticks.filter(t=>t.sender_address).length;
  console.log('sender filled:', sf, '/', ticks.length);
  const LAUNCH = 4496173469e-18;
  ticks.forEach((t,i) => {
    const w = (t.sender_address||t.trader_address||'').slice(0,8);
    const curVs = t.price_bnb ? ((Number(t.price_bnb)/LAUNCH-1)*100).toFixed(1) : '-';
    console.log(`${i+1}\t${String(t.block_time).slice(11,19)}\tblk${String(t.block_number).slice(-6)}\t${t.trade_type}\t${Number(t.bnb_amount).toFixed(4)}B\t${Number(t.price_bnb).toExponential(3)}\t+${curVs}%\t${w}${t.price_outlier?'\tOUT':''}`);
  });
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
