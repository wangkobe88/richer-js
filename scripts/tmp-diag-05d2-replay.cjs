// 05d2 票 sinceEntryNetBuyRatio tick 级重放：买入后是否曾有时刻 (realHoldDuration>=30 ∧ ratio>=90)
// 口径对齐 FA：全量 tick 无 skip（回测尘 tick 原样喂）、资金不滤 outlier、isBuy=trade_type==='buy'
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0x05d26fcacc92500d1de680ee3b428cd2dbe17777';
const BUY_MS = Date.parse('2026-11-02T08:41:07+00:00');
const END_MS = Date.parse('2026-11-02T08:44:47+00:00');

(async () => {
  const c = await dbManager.getClient();
  // 拉买入前一点到全清的行（单票几分钟窗口，小查询）
  const { data: rows } = await c.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb')
    .eq('token_address', ADDR)
    .gte('block_time', '2026-11-02T08:40:00+00:00')
    .lte('block_time', '2026-11-02T08:45:30+00:00')
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(2000);
  console.log(`窗口内 ticks=${(rows||[]).length}`);

  let buy = 0, sell = 0;
  const curve = [];
  for (const r of rows || []) {
    const t = Date.parse(r.block_time);
    if (t < BUY_MS) continue; // 入场锚前不计
    const amt = r.bnb_amount || 0;
    if (r.trade_type === 'buy') buy += amt; else sell += amt;
    const ratio = (buy + sell) > 0 ? (buy - sell) / (buy + sell) * 100 : null;
    const hold = Math.round((t - BUY_MS) / 1000);
    curve.push({ hold, ratio, buy, sell, price: r.price_bnb });
  }
  // 找 hold>=30 后 ratio 峰值与是否过 90
  let maxRatio = -Infinity, maxAt = null;
  for (const p of curve) {
    if (p.hold < 30 || p.ratio == null) continue;
    if (p.ratio > maxRatio) { maxRatio = p.ratio; maxAt = p; }
  }
  const hit = curve.find(p => p.hold >= 30 && p.ratio != null && p.ratio >= 90);
  console.log(`hold>=30 后 ratio 峰值 = ${maxRatio.toFixed(2)} @ hold=${maxAt?.hold}s`);
  console.log(`是否曾有 (hold>=30 ∧ ratio>=90) → ${hit ? `是 @ hold=${hit.hold}s` : '否'}`);
  // 抽样打印曲线（每 10s 一点 + 头 40s 每秒）
  console.log('\nratio 曲线（holdSec: ratio% [Σ买/Σ卖] price）:');
  let lastSec = -10;
  for (const p of curve) {
    if (p.hold <= 40 || p.hold - lastSec >= 10) {
      console.log(`  +${p.hold}s  ratio=${p.ratio == null ? 'null' : p.ratio.toFixed(1)}%  buy=${p.buy.toFixed(3)} sell=${p.sell.toFixed(3)}  price=${p.price}`);
      lastSec = p.hold;
    }
  }
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
