const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

// 两持仓票的最新 tick 现价（单票点查）算浮盈亏
const TOKENS = [
  { addr: '0x74b538c08d2d9063a4223cfc43939cf8e2bc7777', symbol: '兔星星', buyBnb: null },
  { addr: '0x5ba9a7ae67e1c46affcc9a26521e766fcf927777', symbol: '禁毒喵', buyBnb: null },
];
const BUYS = {
  '0x74b538c08d2d9063a4223cfc43939cf8e2bc7777': { bnb: 0.004, tokens: 765800.5016886584, at: '03:16' },
  '0x5ba9a7ae67e1c46affcc9a26521e766fcf927777': { bnb: 0.004, tokens: 476930.60695947625, at: '06:48' },
};

async function main() {
  const db = dbManager.getClient();
  for (const t of TOKENS) {
    const r = await db.from('wss_price_ticks').select('price_bnb,price_usd,block_time,token_amount')
      .eq('token_address', t.addr).order('id', { ascending: false }).limit(1);
    const tick = (r.data || [])[0];
    const buy = BUYS[t.addr];
    if (!tick) { console.log(`${t.symbol}: 无 tick（断流/死票）`); continue; }
    const curUsd = Number(tick.price_usd);
    const buyUnitUsd = buy.bnb * 718.85 / buy.tokens; // 买时 bnbUsd≈718.85 近似
    const pnl = (curUsd / buyUnitUsd - 1) * 100;
    const worthBnb = curUsd * buy.tokens / 718.85;
    console.log(`${t.symbol} ${t.addr}`);
    console.log(`  买于 ${buy.at} UTC 0.004 BNB → ${Math.round(buy.tokens)} 枚`);
    console.log(`  最新 tick: block_time=${tick.block_time} price_usd=${curUsd.toExponential(4)}`);
    console.log(`  浮盈亏 ≈ ${pnl.toFixed(1)}%，现值 ≈ ${worthBnb.toFixed(6)} BNB`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
