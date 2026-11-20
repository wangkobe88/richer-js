const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0x397ada63ce5f5c13885b4893b7f4e01c046a7777';
const WALLET = '0x41ccc209d3ba4e81ef0c1fcb6d191127fb5b42f5';
const T0 = '2026-10-19T13:05:52'; // token_create
const T0MS = Date.parse(T0 + 'Z');

async function main() {
  const sb = dbManager.getClient();

  // 1) 该钱包在本票的全部行
  const { data: wrows, error: werr } = await sb.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,sender_address,trader_address')
    .eq('token_address', TOKEN)
    .gte('block_time', T0)
    .lt('block_time', '2026-10-19T14:00:00')
    .or(`sender_address.eq.${WALLET},trader_address.eq.${WALLET}`)
    .order('block_time', { ascending: true })
    .limit(400);
  if (werr) throw werr;
  console.log('0x41ccc 行数:', wrows.length);
  let buy = 0, sell = 0;
  for (const r of wrows) {
    const dt = (Date.parse(r.block_time) - T0MS) / 1000;
    const isBuy = r.trade_type === 'buy';
    if (isBuy) buy += Number(r.bnb_amount); else sell += Number(r.bnb_amount);
    console.log('W t+' + dt.toFixed(1) + 's', r.block_time, isBuy ? 'BUY' : 'SELL', 'bnb=', r.bnb_amount, 'px=', r.price_bnb, 'sender=', (r.sender_address || '').slice(0, 10), 'trader=', (r.trader_address || '').slice(0, 10));
  }
  console.log('Σbuy=', buy.toFixed(4), 'Σsell=', sell.toFixed(4), 'net=', (buy - sell).toFixed(4));

  // 2) 首 13 分钟概览
  const { data: head } = await sb.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,price_bnb,sender_address')
    .eq('token_address', TOKEN)
    .gte('block_time', T0)
    .lt('block_time', '2026-10-19T13:12:00')
    .order('block_time', { ascending: true })
    .limit(1500);
  const ts = head || [];
  console.log('\n首窗(13:05:52~13:12)行数:', ts.length);
  let firstPx = null, maxPx = 0, maxPxT = null;
  for (const r of ts) {
    const p = Number(r.price_bnb);
    if (p > 0) { if (firstPx == null) firstPx = p; if (p > maxPx) { maxPx = p; maxPxT = r.block_time; } }
  }
  console.log('firstPx=', firstPx, 'maxPx=', maxPx, '@', maxPxT, 'max/first=', ((maxPx / firstPx - 1) * 100).toFixed(1) + '%');

  // 3) 买点(13:07:19)前后 30s 全行
  console.log('\n-- 13:07:00~13:07:50 行（买点窗）:');
  for (const r of ts) {
    if (r.block_time >= '2026-10-19T13:07:00' && r.block_time <= '2026-10-19T13:07:50') {
      const w = ((r.sender_address || '') === WALLET || (r.trader_address || '') === WALLET) ? ' ★41ccc' : '';
      console.log(r.block_time.slice(11), r.trade_type === 'buy' ? 'B' : 'S', Number(r.bnb_amount).toFixed(4), '@', Number(r.price_bnb).toPrecision(4), w);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
