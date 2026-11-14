// 一次性取证（182 跑）：ba5e/ea78 全生命周期轨迹（60s 桶聚合：笔数/买额/价格/curVs）——
// 回答「前期应该有比较好的点位」：07:39-07:52（ba5e）/07:32-10:00（ea78）各因子卡点。
// launch 地板锚=T130 min(常量,首买价)；fourmeme 主流档常量 4496173469e-18。
const { dbManager } = require('../../src/services/dbManager.js');

const FM_LAUNCH = 4496173469e-18;
const ROWS = [
  { key: 'ba5e(M4GA)', addr: '0xba5ed45b42479e0a75316de7bf990ec90a3e4444', from: '07:38:00', to: '08:10:00' },
  { key: 'ea78(吉祥)', addr: '0xea7886d590ba1d7d6d4e7761148ba26405c67777', from: '07:30:00', to: '10:25:00' },
];

async function main() {
  const client = await dbManager.getClient();
  for (const r of ROWS) {
    // 分窗拉取（每 20 分钟一窗，避免单窗过大）
    const from = new Date(`2026-11-05T${r.from}Z`).getTime();
    const to = new Date(`2026-11-05T${r.to}Z`).getTime();
    const ticks = [];
    for (let t = from; t < to; t += 20 * 60000) {
      const t2 = Math.min(t + 20 * 60000, to);
      const { data, error } = await client.from('wss_price_ticks')
        .select('block_time,price_bnb,bnb_amount,trade_type').eq('token_address', r.addr)
        .gte('block_time', new Date(t).toISOString()).lt('block_time', new Date(t2).toISOString())
        .order('block_time', { ascending: true }).limit(2000);
      if (error) { console.log(`${r.key} err ${error.message}`); break; }
      ticks.push(...(data || []));
    }
    console.log(`\n===== ${r.key} ticks=${ticks.length} =====`);
    if (!ticks.length) continue;
    // 首买价（T130 地板）
    const firstBuy = ticks.find((x) => x.trade_type === 'buy' && x.price_bnb > 0);
    const launch = Math.min(FM_LAUNCH, (firstBuy && firstBuy.price_bnb) || FM_LAUNCH);
    console.log(`launch=min(常量,首买)=${launch.toExponential(4)}（首买价 ${(firstBuy && firstBuy.price_bnb || 0).toExponential(4)}@${firstBuy ? firstBuy.block_time.slice(11, 19) : '-'}）`);
    // 60s 桶
    const t0 = new Date(ticks[0].block_time).getTime();
    const buckets = new Map();
    for (const x of ticks) {
      if (!(x.price_bnb > 0)) continue;
      const b = Math.floor((new Date(x.block_time).getTime() - t0) / 60000);
      const o = buckets.get(b) || { n: 0, buyBnb: 0, sellBnb: 0, lastP: 0, first: x.block_time.slice(11, 19) };
      o.n += 1;
      if (x.trade_type === 'buy') o.buyBnb += Number(x.bnb_amount || 0); else o.sellBnb += Number(x.bnb_amount || 0);
      o.lastP = x.price_bnb;
      buckets.set(b, o);
    }
    const keys = [...buckets.keys()].sort((a, b) => a - b);
    let cumBnb = 0; let cumN = 0;
    for (const k of keys.slice(0, 45)) {
      const o = buckets.get(k);
      cumBnb += o.buyBnb; cumN += o.n;
      // 注：cumBnb/cumN 为 60s 桶累加（含 sell 笔数计入 cumN）
      const curVs = ((o.lastP / launch - 1) * 100).toFixed(1);
      // t0a 里程碑：tc>=9 ∧ bv>=1 ∧ (holders 未知)
      const t0a = cumN >= 9 && cumBnb >= 1 ? (Math.abs(curVs) <= 27.5 ? 'T0A✓' : `t0a待价${curVs}`) : `量${cumN}/${cumBnb.toFixed(2)}`;
      console.log(`${o.first} 笔${String(o.n).padStart(3)} 累${String(cumN).padStart(3)} 累买${cumBnb.toFixed(2).padStart(6)}B curVs=${String(curVs).padStart(7)}% ${t0a}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
