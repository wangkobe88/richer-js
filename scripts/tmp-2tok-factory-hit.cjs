require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const EXP = 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f';
const FACTORY_CREATOR = '0x6ce58d1fa9c7b1d8ea29245bf9cb19dd1250f408';
const WIN = ['2026-10-02T00:00:00Z', '2026-10-06T23:59:59Z'];

// MOLLY 演员前缀（补全自两票 ticks）
const MOLLY_ACTORS = ['0x04d7cae549', '0x97a1f8a927', '0x46f76803fc', '0x37e7b8367b', '0x4eebe13b5e', '0x5f4a337238', '0xcf5780a876'];
const CI_ACTORS = ['0x7f282a3313', '0xa1426c6f65', '0x02c6818691', '0xb87cbdb785', '0xf539901b4c', '0x81eab38f83'];
const BOT = '0x975c7c048e028b4b5a9ccf508a8d308ea5d7d881';

async function main() {
  const sb = dbManager.getClient();
  // 工厂票全集
  let afterId = 0, factoryToks = [];
  while (true) {
    const { data: rows } = await sb.from('wss_events')
      .select('id,block_time,token_address,payload->creator,payload->symbol')
      .eq('kind', 'token_create').gte('block_time', WIN[0]).lte('block_time', WIN[1])
      .gt('id', afterId).limit(1000);
    if (!rows || !rows.length) break;
    afterId = Math.max(...rows.map(r => r.id));
    for (const r of rows) if ((r.creator || '').toLowerCase() === FACTORY_CREATOR) factoryToks.push({ addr: r.token_address, sym: r.symbol, t: r.block_time });
    if (rows.length < 1000) break;
  }
  console.log(`工厂票 ${factoryToks.length} 个`);

  // 本实验信号命中工厂票
  const { data: sigs } = await sb.from('strategy_signals')
    .select('token_address,token_symbol,created_at,executed,metadata->signalGate as sg')
    .eq('experiment_id', EXP).eq('signal_type', 'BUY').order('created_at').limit(3000);
  const buyToks = new Set((sigs || []).map(s => s.token_address));
  const factoryHits = factoryToks.filter(f => buyToks.has(f.addr));
  console.log(`实验 BUY 信号 ${sigs?.length} 条，其中工厂票 ${factoryHits.length} 个`);
  const hitSet = new Set(factoryHits.map(f => f.addr));

  // 成交盈亏（工厂票）
  const { data: trs } = await sb.from('trades')
    .select('token_address,token_symbol,trade_direction,input_amount,output_amount,created_at')
    .eq('experiment_id', EXP).order('created_at').limit(3000);
  const pnl = new Map();
  for (const t of trs || []) {
    const e = pnl.get(t.token_address) || { sym: t.token_symbol, buy: 0, sell: 0 };
    if (t.trade_direction === 'buy') e.buy += Number(t.input_amount || 0);
    else e.sell += Number(t.output_amount || 0);
    pnl.set(t.token_address, e);
  }
  let fBuy = 0, fSell = 0, n = 0, list = [];
  for (const [addr, e] of pnl) {
    if (!hitSet.has(addr)) continue;
    n++; fBuy += e.buy; fSell += e.sell;
    list.push({ addr, sym: e.sym, p: e.sell - e.buy, pct: (e.sell - e.buy) / e.buy * 100 });
  }
  list.sort((a, b) => a.p - b.p);
  console.log(`工厂票成交 ${n} 票 | 买 ${fBuy.toFixed(2)}B 卖 ${fSell.toFixed(2)}B | Σ${(fSell - fBuy).toFixed(3)}B`);
  for (const l of list) console.log(`  ${l.p >= 0 ? '+' : ''}${l.p.toFixed(4)}B (${l.pct.toFixed(1)}%) ${l.sym} ${l.addr.slice(0, 10)}…`);

  // MOLLY/CI 演员在工厂票上的复现：抽工厂票中被买的 + CI/MOLLY 时间邻近的票拉 ticks 钱包
  const near = factoryToks.filter(f => Math.abs(new Date(f.t) - new Date('2026-10-03T15:44:53Z')) < 3600e3 || Math.abs(new Date(f.t) - new Date('2026-10-04T07:30:52Z')) < 3600e3);
  const probe = [...new Set([...near.map(f => f.addr), ...list.map(l => l.addr)])].slice(0, 12);
  console.log(`\n抽 ${probe.length} 个工厂票查演员复现（±1h 邻近+已成交）`);
  for (const t of probe) {
    const { data: rows } = await sb.from('wss_price_ticks').select('sender_address,block_time,trade_type,bnb_amount').eq('token_address', t).limit(300);
    if (!rows || !rows.length) continue;
    const seen = new Set(rows.map(r => (r.sender_address || '').toLowerCase()));
    const mHit = MOLLY_ACTORS.filter(a => [...seen].some(s => s.startsWith(a)));
    const cHit = CI_ACTORS.filter(a => [...seen].some(s => s.startsWith(a)));
    const bot = seen.has(BOT);
    const sym = near.find(f => f.addr === t)?.sym || '?';
    if (mHit.length || cHit.length || bot) console.log(`  ${sym} ${t.slice(0, 10)}… n=${rows.length} MOLLY演员:${mHit.join(',') || '-'} CI演员:${cHit.join(',') || '-'} bot:${bot ? '√' : '-'}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
