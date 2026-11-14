// 一次性取证（182 跑）续：① ba5e 07:38-07:53 60s 桶 curVs 轨迹（确认 +693% 过山车形状）
// ② 07:52:37 首信号完整 metadata（gate_blocked 从何而来——此前无检测行？）
// ③ v98 ba5e 信号总数与最早行（防 limit 截断误判）。
const { dbManager } = require('../../src/services/dbManager.js');

const V98 = 'fe029df4-cd1f-490c-bfaf-f945feed287b';
const ADDR = '0xba5ed45b42479e0a75316de7bf990ec90a3e4444';
const FM_LAUNCH = 4496173469e-18;

async function main() {
  const client = await dbManager.getClient();
  // 1) 信号总数+最早 5 行（不限 type）
  const { data: all } = await client.from('strategy_signals')
    .select('created_at,signal_type,action,executed').eq('experiment_id', V98)
    .eq('token_address', ADDR).order('created_at', { ascending: true }).limit(50);
  console.log(`v98 ba5e 信号总数(≤50)=${(all || []).length}`);
  for (const s of (all || []).slice(0, 6)) console.log(`  ${s.created_at.slice(5, 19)} ${s.signal_type} ${s.action} exec=${s.executed}`);
  // 2) 首行完整 metadata
  if (all && all[0]) {
    const { data: full } = await client.from('strategy_signals')
      .select('metadata').eq('experiment_id', V98).eq('token_address', ADDR)
      .eq('created_at', all[0].created_at).limit(3);
    for (const r of (full || [])) {
      const m = r.metadata || {};
      console.log(`\n@${all[0].created_at.slice(5, 19)} metadata 顶层键:`, Object.keys(m).join(','));
      console.log('cheatCheck 全文:', JSON.stringify(m.cheatCheck || {}, null, 1).slice(0, 2400));
    }
  }
  // 3) 60s 桶轨迹
  const ticks = [];
  for (let t = new Date('2026-11-05T07:38:00Z').getTime(); t < new Date('2026-11-05T07:53:30Z').getTime(); t += 10 * 60000) {
    const { data, error } = await client.from('wss_price_ticks')
      .select('block_time,price_bnb,bnb_amount,trade_type').eq('token_address', ADDR)
      .gte('block_time', new Date(t).toISOString()).lt('block_time', new Date(t + 10 * 60000).toISOString())
      .order('block_time', { ascending: true }).limit(2000);
    if (error) break;
    ticks.push(...(data || []));
  }
  const t0 = new Date(ticks[0].block_time).getTime();
  const buckets = new Map();
  for (const x of ticks) {
    if (!(x.price_bnb > 0)) continue;
    const b = Math.floor((new Date(x.block_time).getTime() - t0) / 60000);
    const o = buckets.get(b) || { n: 0, buy: 0, first: x.block_time.slice(11, 19), minP: Infinity, maxP: 0, lastP: 0 };
    o.n++;
    if (x.trade_type === 'buy') o.buy += Number(x.bnb_amount || 0);
    o.minP = Math.min(o.minP, x.price_bnb); o.maxP = Math.max(o.maxP, x.price_bnb); o.lastP = x.price_bnb;
    buckets.set(b, o);
  }
  const firstBuy = ticks.find((x) => x.trade_type === 'buy' && x.price_bnb > 0);
  const launch = Math.min(FM_LAUNCH, (firstBuy && firstBuy.price_bnb) || FM_LAUNCH);
  console.log(`\nlaunch=${launch.toExponential(4)}（首买 ${firstBuy ? firstBuy.block_time.slice(11, 19) : '-'} @${(firstBuy || {}).price_bnb}）`);
  const vs = (p) => ((p / launch - 1) * 100).toFixed(1);
  for (const k of [...buckets.keys()].sort((a, b) => a - b)) {
    const o = buckets.get(k);
    console.log(`${o.first} n=${String(o.n).padStart(3)} 买=${o.buy.toFixed(2).padStart(6)}B min=${vs(o.minP).padStart(7)}% max=${vs(o.maxP).padStart(8)}% last=${vs(o.lastP).padStart(7)}%`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
