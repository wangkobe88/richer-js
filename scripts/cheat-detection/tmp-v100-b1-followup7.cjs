// 一次性（182 跑）：域错配影响面——BNB 盘票（정책콕/英伟达SI）trades 的 token 数量级 vs quote 盘（苹果SI）
// BNB 盘买入 token=bnb/price 若 price=USD 域则同样低估 ~700 倍 → 全局记账 bug；若 BNB 域则仅 quote 盘错
const { dbManager } = require('../../src/services/dbManager.js');
const EXP = '11fc182a-b051-4665-857c-5c14e6713334';
const ts = (s) => String(s || '').slice(11, 19);

(async () => {
  const c = await dbManager.getClient();
  const tokens = [
    ['정책콕(BNB盘)', '0x9d147fa0e447d98cf1a7ac32f114f6d0b9877777'],
    ['英伟达SI(BNB盘)', '0x67ad68e06abb97572fe24c5c7b7c0fe47b8d7777'],
    ['苹果SI(quote盘)', '0xc9bf4530033f6497002d228296fedb45036f7777'],
  ];
  for (const [label, addr] of tokens) {
    const { data: trades } = await c.from('trades').select('*')
      .eq('experiment_id', EXP).eq('token_address', addr).order('id');
    console.log(`--- ${label} trades ${trades ? trades.length : 0} 行 ---`);
    for (const t of (trades || []).slice(0, 4)) {
      const inA = Number(t.input_amount), outA = Number(t.output_amount);
      console.log(`${ts(t.executed_at || t.created_at)} ${t.trade_direction} in=${inA} out=${outA.toExponential(4)} unit=${Number(t.unit_price).toExponential(4)} 隐含 out/in=${(outA / inA).toExponential(4)}`);
    }
    // 对照 tick 价：取首信号附近 price_bnb
    const { data: tk } = await c.from('wss_price_ticks').select('price_bnb,price_usd,quote_token')
      .eq('token_address', addr).order('id', { ascending: true }).limit(1);
    if (tk && tk[0]) console.log(`  首 tick price_bnb=${Number(tk[0].price_bnb).toExponential(4)} price_usd=${tk[0].price_usd ? Number(tk[0].price_usd).toExponential(4) : 'null'} quote=${tk[0].quote_token || 'NULL'}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
