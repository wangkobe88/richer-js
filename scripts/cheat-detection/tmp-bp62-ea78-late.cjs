// 一次性取证（182 跑）：ea78(吉祥 flap) 10:19-14:10 轨迹——用户问 13:48:33 点位为何没信号。
// FL 常量锚 5.546e-9；对照十三腿触发消耗（四腿 t0a/t0b/t2/t3 已于 09:59-10:18 消耗）。
const { dbManager } = require('../../src/services/dbManager.js');

const FL_LAUNCH = 5.546e-9;
const ADDR = '0xea7886d590ba1d7d6d4e7761148ba26405c67777';

async function main() {
  const client = await dbManager.getClient();
  const ticks = [];
  for (let t = new Date('2026-11-05T10:19:00Z').getTime(); t < new Date('2026-11-05T14:10:00Z').getTime(); t += 20 * 60000) {
    const t2 = t + 20 * 60000;
    const { data, error } = await client.from('wss_price_ticks')
      .select('block_time,price_bnb,bnb_amount,trade_type').eq('token_address', ADDR)
      .gte('block_time', new Date(t).toISOString()).lt('block_time', new Date(t2).toISOString())
      .order('block_time', { ascending: true }).limit(2000);
    if (error) { console.log('err', error.message); break; }
    ticks.push(...(data || []));
  }
  console.log('ticks=', ticks.length);
  if (!ticks.length) return process.exit(0);
  const t0 = new Date(ticks[0].block_time).getTime();
  const buckets = new Map();
  for (const x of ticks) {
    if (!(x.price_bnb > 0)) continue;
    const b = Math.floor((new Date(x.block_time).getTime() - t0) / 60000);
    const o = buckets.get(b) || { n: 0, buyBnb: 0, sellBnb: 0, lastP: 0, first: x.block_time.slice(11, 19), minP: Infinity };
    o.n += 1;
    if (x.trade_type === 'buy') o.buyBnb += Number(x.bnb_amount || 0); else o.sellBnb += Number(x.bnb_amount || 0);
    o.lastP = x.price_bnb; o.minP = Math.min(o.minP, x.price_bnb);
    buckets.set(b, o);
  }
  // 累计从 0 起点（全史累计要从 07:32 起算——这里用 1.07B@10:18 为底续算）
  let cumBnb = 1.07; let cumN = 117;
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  for (const k of keys) {
    const o = buckets.get(k);
    cumBnb += o.buyBnb; cumN += o.n;
    const curVs = ((o.lastP / FL_LAUNCH - 1) * 100).toFixed(1);
    const minVs = ((o.minP / FL_LAUNCH - 1) * 100).toFixed(1);
    console.log(`${o.first} 笔${String(o.n).padStart(3)} 累买${cumBnb.toFixed(2)}B curVs=${String(curVs).padStart(7)}% 桶内最低=${String(minVs).padStart(7)}%`);
  }
  // 13:48 前后逐笔
  console.log('\n13:44-13:55 逐笔:');
  for (const x of ticks) {
    const ts = x.block_time.slice(11, 19);
    if (ts >= '13:44:00' && ts <= '13:55:00') {
      console.log(`  ${ts} ${x.trade_type} ${Number(x.bnb_amount).toFixed(3)}B curVs=${((x.price_bnb / FL_LAUNCH - 1) * 100).toFixed(1)}%`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
