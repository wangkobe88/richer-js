const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();
  // v59 实验行（单行）
  const { data: exps, error: eExp } = await client.from('experiments')
    .select('id,experiment_name,status,created_at').ilike('experiment_name', 'v59%').order('created_at', { ascending: false }).limit(3);
  if (eExp) console.error('experiments err:', eExp.message);
  console.log('experiments:', JSON.stringify(exps, null, 1));
  if (!exps || !exps.length) process.exit(1);
  const expId = exps[0].id;
  // 持仓确认：买卖腿对账（卡账本净额口径的粗筛=买卡数 vs 卖卡数）
  const { data: buys } = await client.from('trades')
    .select('token_address,metadata').eq('experiment_id', expId).eq('side', 'buy').select('token_address,metadata,amount_bnb,quantity');
  const { data: sells } = await client.from('trades')
    .select('token_address').eq('experiment_id', expId).eq('side', 'sell');
  const bCnt = {}, sCnt = {};
  for (const t of (buys || [])) bCnt[t.token_address] = (bCnt[t.token_address] || 0) + 1;
  for (const t of (sells || [])) sCnt[t.token_address] = (sCnt[t.token_address] || 0) + 1;
  const tokens = new Set([...Object.keys(bCnt), ...Object.keys(sCnt)]);
  const open = [];
  for (const tk of tokens) {
    const net = (bCnt[tk] || 0) - (sCnt[tk] || 0);
    if (net > 0) open.push({ token: tk, buyRows: bCnt[tk], sellRows: sCnt[tk] });
  }
  console.log('buy_rows:', (buys || []).length, 'sell_rows:', (sells || []).length);
  console.log('open_positions(by row count):', JSON.stringify(open));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
