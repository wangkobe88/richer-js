const { dbManager } = require('../src/services/dbManager');
const EXPS = {
  'd345': 'd3453504-03d5-480c-89e0-483db930361c',
  'd345b': 'c73b62be-bb1d-4acf-8002-652e5fb8a507',
  'bt-v150': '8ebaccce-62c6-4209-a2a0-40f361c49bf9',
  'bt-v156': 'b8ae9f2e-832f-42db-bbda-8d8701aecb63',
};
const AGG = new Set(['0x1de46006368997413a7d94e200039e51979c9b34','0x5fd90a56a429909cb76efa1c74f081cf83b82190']);
(async () => {
  const c = dbManager.getClient();
  const fires = new Map();
  for (const [name, id] of Object.entries(EXPS)) {
    const { data: sigs } = await c.from('strategy_signals')
      .select('token_address,token_symbol,created_at,metadata')
      .eq('experiment_id', id).eq('signal_type', 'SELL')
      .eq('metadata->>strategyId', 'sell_2_5')
      .order('created_at', { ascending: true }).limit(100);
    for (const s of sigs || []) {
      const key = s.token_address + '|' + Math.floor(new Date(s.created_at).getTime() / 60000);
      if (!fires.has(key) || name === 'bt-v156') fires.set(key, { exp: name, token: s.token_address, sym: s.token_symbol, t: s.created_at, status: s.metadata?.execution_status ?? 'executed' });
    }
  }
  console.log('token | 组 | 触发前120s: 买B/买笔/买家数/Top1买占%/卖B/卖家数 | 单边度(卖/(买+卖))%');
  for (const f of [...fires.values()].sort((a, b) => (a.exp > b.exp ? 1 : -1))) {
    const tFire = new Date(f.t).getTime();
    const { data: ticks } = await c.from('wss_price_ticks')
      .select('block_time,trade_type,bnb_amount,sender_address,trader_address')
      .eq('token_address', f.token)
      .gte('block_time', new Date(tFire - 120000).toISOString())
      .lte('block_time', new Date(tFire + 1000).toISOString())
      .order('block_time', { ascending: true }).limit(500);
    let buyB = 0, sellB = 0, buyN = 0;
    const buyers = new Map(), sellers = new Set();
    for (const t of ticks || []) {
      const w = (t.sender_address || t.trader_address || '').toLowerCase();
      const isAgg = AGG.has((t.trader_address || '').toLowerCase());
      if (t.trade_type === 'buy') { buyB += t.bnb_amount; buyN++; if (!isAgg) buyers.set(w, (buyers.get(w) || 0) + t.bnb_amount); }
      else { sellB += t.bnb_amount; if (!isAgg) sellers.add(w); }
    }
    const top1 = buyers.size ? Math.max(...buyers.values()) : 0;
    const one = buyB + sellB > 0 ? (sellB / (buyB + sellB) * 100) : null;
    console.log(`${f.sym.padEnd(10)} | ${f.exp}${f.status === 'blocked' ? '·拦' : ''} | 买=${buyB.toFixed(2)}B/${buyN}笔/${buyers.size}户 top1=${buyB > 0 ? (top1 / buyB * 100).toFixed(0) : '-'}% | 卖=${sellB.toFixed(2)}B/${sellers.size}户 | 单边度=${one === null ? '-' : one.toFixed(1)}%`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
