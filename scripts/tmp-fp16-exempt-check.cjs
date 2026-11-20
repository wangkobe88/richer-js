#!/usr/bin/env node
// FP16 深破豁免验证：ASTER/28ad 全史总量是否 <15B（总量腿是否已天然保护真重启票）
const { dbManager } = require('../src/services/dbManager');
const TOKENS = [
  ['ASTER', '0x31e2037870d82ba8b634287f972ec926373a7777'],
  ['28ad', '0x28ad2c7d08d83a85467bd4afcfd673dfce564444'],
  ['本案瓦尔哈', '0x5fb747c626da99bf83b01ac367832de3fb3e7777'],
];

async function main() {
  const sb = dbManager.getClient();
  for (const [name, tok] of TOKENS) {
    const { data, error } = await sb.from('wss_price_ticks')
      .select('block_time,trade_type,bnb_amount,price_bnb,price_outlier')
      .eq('token_address', tok).order('block_time', { ascending: true }).limit(3000);
    if (error) throw new Error(error.message);
    let buy = 0, sell = 0, buyN = 0, sellN = 0;
    const rel = [];
    for (const r of data || []) {
      const b = Number(r.bnb_amount || 0);
      if (String(r.trade_type).toLowerCase() === 'buy') { buy += b; buyN++; } else { sell += b; sellN++; }
      if (r.price_bnb && !r.price_outlier) rel.push(Number(r.price_bnb));
    }
    const total = buy + sell;
    let hi = -Infinity, lo = Infinity;
    for (const p of rel) { hi = Math.max(hi, p); lo = Math.min(lo, p); }
    console.log(`${name} ${tok.slice(0, 10)}…: 全史(${data.length}行${data.length >= 3000 ? '⚠满帽' : ''}) 买${buy.toFixed(2)}B/${buyN}笔 卖${sell.toFixed(2)}B/${sellN}笔 **总量${total.toFixed(2)}B** 首可靠${rel[0] ? rel[0].toPrecision(4) : '-'} hi/lo=${(hi / lo).toFixed(2)}x`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
