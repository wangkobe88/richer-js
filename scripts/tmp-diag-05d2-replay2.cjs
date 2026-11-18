// 精确毫秒重放 +20s~+60s 段：T113 两条件在哪个 tick 首次同时满足、确认窗内何时翻假
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0x05d26fcacc92500d1de680ee3b428cd2dbe17777';
const BUY_MS = Date.parse('2026-11-02T08:41:07+00:00');

(async () => {
  const c = await dbManager.getClient();
  const { data: rows } = await c.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb')
    .eq('token_address', ADDR)
    .gte('block_time', '2026-11-02T08:40:00+00:00')
    .lte('block_time', '2026-11-02T08:42:30+00:00')
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(2000);

  let buy = 0, sell = 0;
  const recs = [];
  for (const r of rows || []) {
    const t = Date.parse(r.block_time);
    if (t < BUY_MS) continue;
    const amt = r.bnb_amount || 0;
    if (r.trade_type === 'buy') buy += amt; else sell += amt;
    recs.push({ t, holdMs: t - BUY_MS, ratio: (buy + sell) > 0 ? (buy - sell) / (buy + sell) * 100 : null,
      type: r.trade_type, amt, buy, sell });
  }
  console.log('tick 时间(UTC) | hold(ms) | type | amt | ratio% | 两条件同时满足?');
  let armed = false;
  for (const p of recs) {
    const both = p.holdMs >= 30000 && p.ratio != null && p.ratio >= 90;
    if (p.holdMs >= 15000 && p.holdMs <= 65000) {
      console.log(`  ${new Date(p.t).toISOString()}  +${(p.holdMs / 1000).toFixed(3)}s  ${p.type} ${p.amt.toFixed(4)}  ratio=${p.ratio == null ? 'null' : p.ratio.toFixed(2)}  ${both ? '← FIRE' : ''}`);
    }
    if (both && !armed) armed = true;
  }
  console.log(`\n两条件首次同时满足: ${armed ? '存在(见 ← FIRE 行)' : '不存在'}`);
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
