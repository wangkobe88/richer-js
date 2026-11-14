// 一次性取证（182 跑）：ea78(吉祥) 13:48:33 为啥没信号——用户指认买点在该时刻之前。
// ① token_create + 全天首笔（时区歧义裁决：13:48 北京=05:48Z vs 13:48Z）
// ② 全天 10min 桶轨迹（横盘段/涨上去时刻定位）
// ③ v98 ea78 全部信号（哪条腿触发过、cheat 门各拒在哪）
// ④ 13:40-14:00Z 细看（涨上去形状）。
const { dbManager } = require('../../src/services/dbManager.js');

const V98 = 'fe029df4-cd1f-490c-bfaf-f945feed287b';
const ADDR = '0xea7886d590ba1d7d6d4e7761148ba26405c67777';
const FL = 5.546e-9;

async function main() {
  const client = await dbManager.getClient();
  // 1) token_create
  const { data: ev } = await client.from('wss_events')
    .select('block_time,kind').eq('token_address', ADDR).eq('kind', 'token_create').limit(5);
  for (const e of (ev || [])) console.log(`token_create: ${e.block_time}`);

  // 2) 全天 10min 桶轨迹
  const ticks = [];
  for (let t = new Date('2026-11-05T00:00:00Z').getTime(); t < new Date('2026-11-05T20:00:00Z').getTime(); t += 20 * 60000) {
    const { data, error } = await client.from('wss_price_ticks')
      .select('block_time,price_bnb,bnb_amount,trade_type').eq('token_address', ADDR)
      .gte('block_time', new Date(t).toISOString()).lt('block_time', new Date(t + 20 * 60000).toISOString())
      .order('block_time', { ascending: true }).limit(2000);
    if (error) { console.log('tick err', error.message); break; }
    ticks.push(...(data || []));
  }
  const rows = ticks.filter((x) => x.price_bnb > 0);
  console.log(`全天(00-20Z)有效价行=${rows.length} 首行=${rows[0] ? rows[0].block_time : '无'}`);
  if (!rows.length) process.exit(0);
  const t0 = new Date(rows[0].block_time).getTime();
  const buckets = new Map();
  for (const x of rows) {
    const b = Math.floor((new Date(x.block_time).getTime() - t0) / 600000);
    const o = buckets.get(b) || { n: 0, buy: 0, first: x.block_time.slice(11, 19), minP: Infinity, maxP: 0, lastP: 0 };
    o.n++; if (x.trade_type === 'buy') o.buy += Number(x.bnb_amount || 0);
    o.minP = Math.min(o.minP, x.price_bnb); o.maxP = Math.max(o.maxP, x.price_bnb); o.lastP = x.price_bnl || x.price_bnb;
    buckets.set(b, o);
  }
  const firstBuy = rows.find((x) => x.trade_type === 'buy');
  const launch = Math.min(FL, (firstBuy && firstBuy.price_bnb) || FL);
  const vs = (p) => ((p / launch - 1) * 100).toFixed(1);
  for (const k of [...buckets.keys()].sort((a, b) => a - b)) {
    const o = buckets.get(k);
    console.log(`${o.first} n=${String(o.n).padStart(3)} 买=${o.buy.toFixed(2).padStart(6)}B min=${vs(o.minP).padStart(7)}% max=${vs(o.maxP).padStart(8)}% last=${vs(o.lastP).padStart(7)}%`);
  }

  // 3) v98 ea78 全部信号
  const { data: sigs } = await client.from('strategy_signals')
    .select('created_at,signal_type,action,executed,metadata').eq('experiment_id', V98)
    .eq('token_address', ADDR).order('created_at', { ascending: true }).limit(50);
  console.log(`\nv98 ea78 信号总数=${(sigs || []).length}`);
  for (const s of (sigs || [])) {
    const m = s.metadata || {};
    const cc = m.cheatCheck || {};
    const sg = m.signalGate || {};
    console.log(`${s.created_at.slice(5, 19)} ${s.signal_type} ${s.action} exec=${s.executed} | cheat.status=${cc.status || '-'} grade=${cc.grade || '-'} | sgKeys=${Object.keys(sg).slice(0, 8).join('/')}`);
  }
  if (sigs && sigs[0]) {
    const m = sigs[0].metadata || {};
    console.log('\n首信号 metadata 顶层键:', Object.keys(m).join(','));
    if (m.signalGate) console.log('signalGate:', JSON.stringify(m.signalGate).slice(0, 600));
  }

  // 4) 13:40-14:00Z 细看
  const { data: zoom } = await client.from('wss_price_ticks')
    .select('block_time,price_bnb,bnb_amount,trade_type').eq('token_address', ADDR)
    .gte('block_time', '2026-11-05T13:40:00').lt('block_time', '2026-11-05T14:00:00')
    .order('block_time', { ascending: true }).limit(800);
  const zr = (zoom || []).filter((x) => x.price_bnb > 0);
  console.log(`\n13:40-14:00Z 有效行=${zr.length}`);
  if (zr.length) {
    const mx = Math.max(...zr.map((x) => x.price_bnb));
    console.log(`首=${zr[0].block_time.slice(11, 19)} ${vs(zr[0].price_bnb)}% → max=${vs(mx)}% @${zr.find((x) => x.price_bnb === mx).block_time.slice(11, 19)} → 末=${zr[zr.length - 1].block_time.slice(11, 19)} ${vs(zr[zr.length - 1].price_bnb)}%`);
  }
  // 4b) 05:40-06:00Z（北京 13:48 解释）
  const { data: zoomBj } = await client.from('wss_price_ticks')
    .select('block_time,price_bnb').eq('token_address', ADDR)
    .gte('block_time', '2026-11-05T05:40:00').lt('block_time', '2026-11-05T06:00:00')
    .order('block_time', { ascending: true }).limit(10);
  console.log(`05:40-06:00Z 行数=${(zoomBj || []).length}（北京 13:48 解释 ${ (zoomBj||[]).length ? '有数据' : '无数据=排除' }）`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
