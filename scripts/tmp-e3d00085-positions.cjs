// 一次性查询：e3d00085 重启前持仓点查（卡账本净额口径——Σ买卡−Σ卖卡，非行计数）
const { dbManager } = require('../src/services/dbManager.js');

const EXP = 'e3d00085-b796-4973-91fc-05013c438488';

async function main() {
  const client = await dbManager.getClient();
  const { data: trades, error } = await client
    .from('trades')
    .select('token_address,trade_direction,trade_status,input_amount,output_amount,input_currency,created_at,metadata')
    .eq('experiment_id', EXP)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw error;
  console.log(`=== trades: ${trades?.length ?? 0} 行 ===`);
  const net = new Map();
  const flag = [];
  for (const t of trades || []) {
    const ct = t.metadata?.cardTrade;
    const addr = t.token_address;
    const side = (t.trade_direction ?? '').toLowerCase();
    if (!net.has(addr)) net.set(addr, { cards: 0, buyRows: 0, sellRows: 0, noCtRows: [] });
    const e = net.get(addr);
    if (side === 'buy') {
      e.buyRows++;
      if (ct?.cards) e.cards += ct.cards; else e.noCtRows.push(`buy@${t.created_at}`);
    } else if (side === 'sell') {
      e.sellRows++;
      if (ct && typeof ct.before === 'number' && typeof ct.after === 'number') e.cards -= (ct.before - ct.after);
      else { e.noCtRows.push(`sell(疑全清)@${t.created_at}`); e.fullCloseNoCt = true; }
    }
  }
  let anyNet = false;
  for (const [addr, e] of net) {
    const suspect = e.cards !== 0 || e.noCtRows.length > 0;
    if (e.cards !== 0 || suspect) {
      anyNet = anyNet || e.cards !== 0;
      console.log(`${addr}: netCards=${e.cards} buyRows=${e.buyRows} sellRows=${e.sellRows}${e.noCtRows.length ? ' 无cardTrade行=' + e.noCtRows.join(';') : ''}`);
    }
  }
  if (!anyNet) console.log('卡账本净额全零' + (net.size ? `（${net.size} 票有交易史）` : '（无交易行）'));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
