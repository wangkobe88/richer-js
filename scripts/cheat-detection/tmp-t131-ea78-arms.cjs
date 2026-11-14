// 一次性取证（182 跑）：T131 新更早买入臂参数定标——ea78 开盘 05:48:00-05:49:00
// 逐 tick 重放四组门（t0a 9/1/6 现行、候选 7/1/4[笔数门=minTicks 降 7 配套]、
// 对照 7/1/3 与 8/1/4），确认：① 7/8 笔时刻 holders 实际值；② 候选臂价格窗内可触发；
// ③ 触发时点 curVs（BP/CD minTicks 双预门同刻过线）。
const { dbManager } = require('../../src/services/dbManager.js');

const ADDR = '0xea7886d590ba1d7d6d4e7761148ba26405c67777';
const FL = 5.546e-9;
const rel = (x) => x.price_bnb > 0 && !/[oO]utlier/.test(String(x.price_outlier || ''));

async function main() {
  const client = await dbManager.getClient();
  const { data } = await client.from('wss_price_ticks')
    .select('block_time,price_bnb,bnb_amount,trade_type,sender_address,trader_address,price_outlier')
    .eq('token_address', ADDR)
    .gte('block_time', '2026-11-05T05:48:00').lt('block_time', '2026-11-05T05:49:00')
    .order('block_time', { ascending: true }).limit(500);
  const ticks = data || [];
  const firstBuy = ticks.find((x) => x.trade_type === 'buy' && rel(x));
  const launch = Math.min(FL, (firstBuy && firstBuy.price_bnb) || FL);
  const vs = (p) => ((p / launch - 1) * 100);

  let n = 0, buyVol = 0; const wallets = new Map();
  const hits = { t0a: null, arm74: null, arm73: null, arm84: null };
  const mark = (k, x, curVs) => { hits[k] = { t: x.block_time.slice(11, 19), curVs: +curVs.toFixed(1), n, buyVol: +buyVol.toFixed(2), w: wallets.size }; };
  for (const x of ticks) {
    n++;
    if (x.trade_type === 'buy') {
      const w = x.sender_address || x.trader_address;
      buyVol += Number(x.bnb_amount || 0);
      wallets.set(w, (wallets.get(w) || 0) + Number(x.bnb_amount || 0));
    }
    const curVs = rel(x) ? vs(x.price_bnb) : null;
    const row = `${x.block_time.slice(11, 23)} n=${String(n).padStart(2)} 买额=${Number(x.bnb_amount || 0).toFixed(3)} curVs=${curVs == null ? '-' : curVs.toFixed(1) + '%'} | cum: buyVol=${buyVol.toFixed(2)}B wallets=${wallets.size}`;
    if (curVs != null && curVs <= 27.5) {
      console.log(`  ≤27.5 ${row}`);
      if (!hits.t0a && n >= 9 && buyVol >= 1 && wallets.size >= 6) mark('t0a', x, curVs);
      if (!hits.arm74 && n >= 7 && buyVol >= 1 && wallets.size >= 4) mark('arm74', x, curVs);
      if (!hits.arm73 && n >= 7 && buyVol >= 1 && wallets.size >= 3) mark('arm73', x, curVs);
      if (!hits.arm84 && n >= 8 && buyVol >= 1 && wallets.size >= 4) mark('arm84', x, curVs);
    } else {
      console.log(`  窗外  ${row}`);
    }
  }
  console.log('\nlaunch=', launch.toExponential(4), `（${launch < FL ? 'T130 地板=首买价' : 'FL 常量'}）`);
  console.log('t0a 9/1/6 首满足:', JSON.stringify(hits.t0a));
  console.log('候选臂 7/1/4 首满足:', JSON.stringify(hits.arm74));
  console.log('对照臂 7/1/3 首满足:', JSON.stringify(hits.arm73));
  console.log('对照臂 8/1/4 首满足:', JSON.stringify(hits.arm84));
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
