// 一次性（182 跑）：ba5e 前 20 笔逐笔 + n=7/9/12/15 各时点 holdersExDust 近似重放
//（净持仓 token ≥ holderDustBnb(0.015)/launch 的钱包数——与 FA 尘门口径对齐）。
const { dbManager } = require('../../src/services/dbManager.js');
const T = '0xba5ed45b42479e0a75316de7bf990ec90a3e4444';
const FM = 4496173469e-18;

async function main() {
  const sb = await dbManager.getClient();
  const { data: rows } = await sb.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,token_amount,price_bnb,trader_address,sender_address')
    .eq('token_address', T).order('id', { ascending: true }).limit(60);
  const launch = FM;
  const dustTokens = 0.015 / launch;
  const net = new Map(); // wallet → net tokens
  console.log(`尘门=${(dustTokens / 1e6).toFixed(1)}M token`);
  let n = 0;
  for (const r of rows || []) {
    n++;
    const w = ((r.sender_address || r.trader_address || '') + '').toLowerCase();
    const tokens = r.trade_type === 'buy' ? (r.token_amount || 0) : -(r.token_amount || 0);
    net.set(w, (net.get(w) || 0) + tokens);
    let holders = 0;
    for (const v of net.values()) if (v >= dustTokens) holders++;
    const curVs = r.price_bnb > 0 ? ((r.price_bnb / launch - 1) * 100).toFixed(1) + '%' : '-';
    if (n <= 20 || [25, 30].includes(n)) {
      console.log(`n=${n} ${r.block_time.slice(11, 19)} ${r.trade_type === 'buy' ? '买' : '卖'} ${(r.bnb_amount || 0).toFixed(4)}B ${w.slice(0, 10)} curVs=${curVs} 累计钱包=${net.size} holdersExDust≈${holders}`);
    }
    if (n === 20) break;
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
