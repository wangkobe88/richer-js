const path = require('path');
const { dbManager } = require(path.join(__dirname, '../src/services/dbManager'));
const TOK = '0xe8e0c8737701105824403a5aaccd0030018a7777';
async function main() {
  const client = dbManager.getClient();
  const t = await client.from('wss_price_ticks')
    .select('block_number, log_index, trade_type, bnb_amount, token_amount, sender_address, trader_address')
    .eq('token_address', TOK).order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(50);
  if (t.error) throw new Error(t.error.message);
  console.log('==== 全史 ticks（' + t.data.length + ' 行，链上真序）');
  for (const r of t.data) {
    console.log(`blk ${r.block_number}.${r.log_index} ${r.trade_type === 'buy' ? '买' : '卖'} ${Number(r.bnb_amount).toFixed(4)} BNB ${Math.round(Number(r.token_amount||0)/1e6)}Mtok trader=${(r.trader_address||'').slice(0,10)} sender=${(r.sender_address||'NULL').slice(0,10)}`);
  }
  const d = await client.from('cheat_detection')
    .select('analyzed_at, answers_raw')
    .eq('token_address', TOK).order('analyzed_at').limit(2);
  if (d.error) throw new Error(d.error.message);
  const ans = (d.data[0].answers_raw || {}).answers || [];
  console.log('\n==== Jev 作答（首行 ' + d.data[0].analyzed_at + '，model=' + (d.data[0].answers_raw||{}).model + '）');
  for (const a of ans) {
    const s = JSON.stringify(a);
    if (/insider|coordinated|sell_disp|equal_amount/.test(s)) console.log(s.slice(0, 400));
  }
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
