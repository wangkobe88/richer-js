// 182 跑：0x48ce...7777 从 05:32:52 起的完整后续（到当前 max id）
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager.js');
const TOKEN = '0x48ce79731e040194fcfa71496a94090a28f57777';
const FROM_ID = 11145436; // 05:32:52 那笔

const ts = (v) => (typeof v === 'number' ? v : Date.parse(v));

async function main() {
  const c = await dbManager.getClient();
  const { data: maxRow } = await c.from('wss_price_ticks').select('id,block_time').order('id', { ascending: false }).limit(1);
  const maxId = Number(maxRow[0].id);
  console.log(`当前 max id=${maxId} (${maxRow[0].block_time})，从 ${FROM_ID} 扫到头`);

  const rows = [];
  let lastId = FROM_ID - 1;
  for (let i = 0; i < 500; i++) {
    const { data, error } = await c.from('wss_price_ticks')
      .select('id,block_time,token_address,bnb_amount,price_bnb,price_outlier')
      .gt('id', lastId).order('id', { ascending: true }).limit(1000);
    if (error) throw error;
    if (!data || !data.length) break;
    for (const r of data) {
      lastId = Number(r.id);
      if (r.token_address === TOKEN) rows.push(r);
    }
    if (data.length < 1000 || lastId >= maxId) break;
  }
  rows.sort((a, b) => Number(a.id) - Number(b.id));
  console.log(`05:32:52 之后该票全部 ticks = ${rows.length}`);
  let prev = null;
  for (const r of rows) {
    const dust = Number(r.bnb_amount) < 0.001;
    let gap = '';
    if (!dust && prev != null) gap = ` gap=${((ts(r.block_time) - prev) / 1000).toFixed(0)}s`;
    if (!dust) prev = ts(r.block_time);
    console.log(`${r.block_time} id=${r.id} bnb=${r.bnb_amount}${dust ? ' [尘]' : ''} price=${Number(r.price_bnb).toExponential(4)}` +
      `${r.price_outlier ? ' [outlier]' : ''}${gap}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
