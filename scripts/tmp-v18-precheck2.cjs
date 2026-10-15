// v18 重建前盘点 2：净持仓（trade_direction 口径）+ 完整 config 落盘（182 跑）
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');

const V17 = '203570e3-6117-4841-bc50-936461e78a8a';

(async () => {
  const sb = dbManager.getClient();
  const { data: expRows } = await sb.from('experiments').select('*').eq('id', V17).limit(1);
  const exp = expRows[0];
  fs.writeFileSync('/tmp/v17-config.json', JSON.stringify(exp.config, null, 2));
  console.log('trading_mode:', exp.trading_mode, '| strategy_type:', exp.strategy_type, '| blockchain:', exp.blockchain, '| kline_type:', exp.kline_type);
  console.log('config -> /tmp/v17-config.json');

  // 净持仓：trade_direction buy/sell × token 卡数（sold_cards）
  const { data: trades, error } = await sb.from('trades')
    .select('token_symbol,token_address,trade_direction,trade_status,input_currency,output_currency,input_amount,output_amount,sold_cards,success,executed_at')
    .eq('experiment_id', V17).order('executed_at').limit(500);
  if (error) { console.log('trades error:', error.message); return; }
  const pos = {};
  for (const t of trades) {
    if (!t.success) continue;
    const k = `${t.token_symbol} ${t.token_address}`;
    pos[k] = pos[k] || { buy: 0, sell: 0, buyCards: 0, sellCards: 0, lastAt: null };
    if (String(t.trade_direction).toLowerCase() === 'buy') {
      pos[k].buy++;
      pos[k].buyCards += Number(t.output_amount || 0) > 0 ? 1 : 0;
    } else {
      pos[k].sell++;
      if (t.sold_cards != null) pos[k].sellCards += Number(t.sold_cards) || 0;
    }
    pos[k].lastAt = t.executed_at;
  }
  console.log('\n== v17 净方向统计（success only）==');
  const open = Object.entries(pos).filter(([, v]) => v.buy > 0);
  console.log('有买入的 token 数:', open.length);
  for (const [k, v] of open) console.log(`  ${k}: buy=${v.buy} sell=${v.sell} soldCards=${v.sellCards} last=${v.lastAt}`);
  const onlySell = Object.entries(pos).filter(([, v]) => v.buy === 0);
  console.log('纯卖 token 数（应为手工卖/外部处置）:', onlySell.length);
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
