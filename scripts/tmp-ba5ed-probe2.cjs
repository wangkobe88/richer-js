const path = require('path'); require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();
(async () => {
  const T = '0xba5ed45b42479e0a75316de7bf990ec90a3e4444';
  const from = '2026-11-05T07:34:00+00:00', to = '2026-11-05T08:30:00+00:00';
  // ticks 覆盖（block_time 索引窗 + token 内存过滤，防 token_address 无索引坑）
  const { data: tk, error: e1, count } = await db.from('wss_price_ticks')
    .select('id,block_time,price_bnb,bnb_amount,trader_address,sender_address')
    .gte('block_time', from).lte('block_time', to).limit(50000);
  if (e1) { console.log('ticks err', e1.message); process.exit(1); }
  const rows = (tk || []).filter(r => (r.token_address || '').toLowerCase() === T || true); // token col未取，先看总量
  // 需要token列，改内存过滤：上面没select token——重查一列
  const { data: tk2 } = await db.from('wss_price_ticks')
    .select('token_address,block_time,price_bnb,bnb_amount')
    .gte('block_time', from).lte('block_time', to).limit(50000);
  const mine = (tk2 || []).filter(r => (r.token_address || '').toLowerCase() === T);
  console.log(`窗内总行=${(tk2||[]).length} 本票行=${mine.length}`);
  if (mine.length) {
    console.log('首行', JSON.stringify(mine[0]));
    console.log('末行', JSON.stringify(mine[mine.length - 1]));
    let maxP = 0, maxRow = null; const first = mine.find(r => r.price_bnb > 0);
    for (const r of mine) if (r.price_bnb > maxP) { maxP = r.price_bnb; maxRow = r; }
    console.log(`首价=${first && first.price_bnb} 最高=${maxP} @${maxRow && maxRow.block_time}`);
  }
  // 基底谱系
  const ids = ['4b3fa2a9-b9c5-4e46-85c9-ae6e6c423d50'];
  const { data: ex } = await db.from('experiments').select('id,experiment_name,config->backtest,config->strategiesConfig->libraryRefs').eq('id', ids[0]).limit(1);
  if (ex && ex[0]) {
    const bt = ex[0].backtest || {};
    console.log('src4b3fa2a9:', ex[0].experiment_name, 'win=', bt.startTime || bt.start_time || bt.windowStart || Object.keys(bt).join(','));
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
