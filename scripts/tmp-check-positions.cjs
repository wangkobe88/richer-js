const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const EXP = 'bbbe2561-6a98-46a5-bf65-6038800dfb62';

// 重启前持仓确认：FIFO 口径——该实验全部 live 交易，per token 买-卖轧差（全清腿 sellPercentage=1 视为清零）
async function main() {
  const db = dbManager.getClient();
  const r = await db.from('trades').select('token_symbol,token_address,trade_direction,input_amount,output_amount,trade_status,executed_at,metadata')
    .eq('experiment_id', EXP).eq('is_virtual_trade', false)
    .order('executed_at').limit(500);
  const rows = r.data || [];
  console.log(`live trades total=${rows.length}`);
  const net = new Map(); // addr -> {symbol, buys, sells, tokenNet, bnbNet}
  for (const t of rows) {
    if (t.trade_status !== 'success') continue;
    const k = t.token_address;
    const e = net.get(k) || { symbol: t.token_symbol, buys: 0, sells: 0, tokenNet: 0, lastAt: t.executed_at };
    if (t.trade_direction === 'buy') { e.buys++; e.tokenNet += Number(t.output_amount); }
    else { e.sells++; e.tokenNet -= Number(t.input_amount); }
    e.lastAt = t.executed_at;
    net.set(k, e);
  }
  const open = [...net.entries()].filter(([, e]) => e.buys > e.sells || Math.abs(e.tokenNet) > 1e-6);
  console.log('open positions (FIFO net ≠ 0):', open.length);
  for (const [addr, e] of open) console.log(JSON.stringify({ addr, ...e }));
  const last = rows[rows.length - 1];
  console.log('last trade:', last && JSON.stringify({ tok: last.token_symbol, dir: last.trade_direction, at: last.executed_at }));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
