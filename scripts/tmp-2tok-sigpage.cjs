require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const EXP = 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f';
const FACTORY_CREATOR = '0x6ce58d1fa9c7b1d8ea29245bf9cb19dd1250f408';
const WIN = ['2026-10-02T00:00:00Z', '2026-10-06T23:59:59Z'];

async function main() {
  const sb = dbManager.getClient();
  // 工厂票全集
  let afterId = 0; const factory = new Map();
  while (true) {
    const { data: rows } = await sb.from('wss_events')
      .select('id,block_time,token_address,payload->creator,payload->symbol')
      .eq('kind', 'token_create').gte('block_time', WIN[0]).lte('block_time', WIN[1])
      .gt('id', afterId).limit(1000);
    if (!rows || !rows.length) break;
    afterId = Math.max(...rows.map(r => r.id));
    for (const r of rows) if ((r.creator || '').toLowerCase() === FACTORY_CREATOR) factory.set(r.token_address, r.symbol || '?');
    if (rows.length < 1000) break;
  }
  // BUY 信号 offset 分页全量
  let all = [];
  for (let off = 0; ; off += 1000) {
    const { data: rows } = await sb.from('strategy_signals')
      .select('id,token_address,token_symbol,created_at,executed,reason')
      .eq('experiment_id', EXP).eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).range(off, off + 999);
    if (!rows || !rows.length) break;
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  console.log(`BUY 信号全量 ${all.length} 条`);
  const hits = all.filter(s => factory.has(s.token_address));
  console.log(`工厂票 BUY 信号 ${hits.length} 条：`);
  for (const h of hits) console.log(`  ${h.created_at?.slice(5, 19)} ${h.token_symbol} ${h.token_address.slice(0, 10)}… executed=${h.executed} ${h.reason?.slice(0, 30)}`);

  // trades offset 分页全量算工厂票盈亏
  const trs = [];
  for (let off = 0; ; off += 1000) {
    const { data: rows } = await sb.from('trades')
      .select('id,token_address,token_symbol,trade_direction,input_amount,output_amount,created_at')
      .eq('experiment_id', EXP)
      .order('created_at', { ascending: true }).range(off, off + 999);
    if (!rows || !rows.length) break;
    trs.push(...rows);
    if (rows.length < 1000) break;
  }
  const pnl = new Map();
  for (const t of trs) {
    if (!factory.has(t.token_address)) continue;
    const e = pnl.get(t.token_address) || { sym: t.token_symbol, buy: 0, sell: 0 };
    if (t.trade_direction === 'buy') e.buy += Number(t.input_amount || 0); else e.sell += Number(t.output_amount || 0);
    pnl.set(t.token_address, e);
  }
  let tot = 0;
  for (const [a, e] of pnl) { tot += e.sell - e.buy; console.log(`  工厂成交 ${e.sym}: ${((e.sell - e.buy) >= 0 ? '+' : '') + (e.sell - e.buy).toFixed(4)}B`); }
  console.log(`实验总成交 ${trs.length} 笔，工厂票 Σ${tot.toFixed(4)}B`);

  // PooCoin 形状（CI 前 14 分钟的工厂票）
  const { data: pc } = await sb.from('wss_price_ticks')
    .select('block_time,trade_type,sender_address,bnb_amount,block_number,price_bnb')
    .eq('token_address', '0xd176da7895caa56961b256c3070196b3523e7777').order('block_time').limit(320);
  const launch = 5.2667566536721975e-9;
  console.log(`\nPooCoin 逐笔 ${pc?.length} 行（launch 常量口径 ${((5.2667566536721975e-9/5.2667566536721975e-9)-1).toFixed(0)}）`);
  for (const r of pc || []) {
    const w = (r.sender_address || '').toLowerCase();
    console.log(`  ${r.block_time?.slice(11, 19)} blk${r.block_number} ${r.trade_type === 'buy' ? '买' : '卖'} ${Number(r.bnb_amount).toFixed(3)}B ${w.slice(0, 10)}… ${r.price_bnb ? ((Number(r.price_bnb)/launch-1)*100).toFixed(1) : '?'}%`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
