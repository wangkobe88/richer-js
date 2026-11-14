// 一次性取证（182 跑）：ea78 开盘 05:48:04-05:50:30 逐秒重放 t0a 四门
// （tradeCount>=9 ∧ buyVolumeBnb>=1 ∧ holdersExDust>=6[近似=distinct 买钱包] ∧ curVs<=27.5）
// ——用户质询「13:48:33（北京）为啥没信号、买点应该在这之前」=开盘前 29 秒窗口。
// 另取 4 条 BUY 信号明细（legId/reasons）。
const { dbManager } = require('../../src/services/dbManager.js');

const V98 = 'fe029df4-cd1f-490c-bfaf-f945feed287b';
const ADDR = '0xea7886d590ba1d7d6d4e7761148ba26405c67777';
const FL = 5.546e-9;
const rel = (x) => x.price_bnb > 0 && !/[oO]utlier/.test(String(x.price_outlier || ''));

async function main() {
  const client = await dbManager.getClient();
  const ticks = [];
  for (let t = new Date('2026-11-05T05:48:00Z').getTime(); t < new Date('2026-11-05T05:50:30Z').getTime(); t += 30 * 1000) {
    const { data, error } = await client.from('wss_price_ticks')
      .select('block_time,price_bnb,bnb_amount,trade_type,sender_address,trader_address,price_outlier')
      .eq('token_address', ADDR)
      .gte('block_time', new Date(t).toISOString()).lt('block_time', new Date(t + 30 * 1000).toISOString())
      .order('block_time', { ascending: true }).limit(500);
    if (error) { console.log('err', error.message); break; }
    ticks.push(...(data || []));
  }
  const firstBuy = ticks.find((x) => x.trade_type === 'buy' && rel(x));
  const launch = Math.min(FL, (firstBuy && firstBuy.price_bnb) || FL);
  const vs = (p) => ((p / launch - 1) * 100).toFixed(1);
  console.log(`ticks=${ticks.length} 首行=${ticks[0].block_time} 首买=${firstBuy ? firstBuy.block_time.slice(11, 23) : '-'}@${firstBuy && firstBuy.price_bnb.toExponential(3)} launch=${launch.toExponential(4)}（${launch < FL ? 'T130 地板=首买价' : 'FL 常量'}）`);

  // 5s 桶重放（开盘形状总览）
  const t0 = new Date(ticks[0].block_time).getTime();
  let n = 0, buyVol = 0; const wallets = new Map();
  const b5 = new Map();
  let left275 = null, firstAll = null, first275down = null;
  for (const x of ticks) {
    n++;
    const w = x.sender_address || x.trader_address;
    if (x.trade_type === 'buy') { buyVol += Number(x.bnb_amount || 0); wallets.set(w, (wallets.get(w) || 0) + 1); }
    const b = Math.floor((new Date(x.block_time).getTime() - t0) / 5000);
    const o = b5.get(b) || { n: 0, buy: 0, minP: Infinity, maxP: 0, ts: x.block_time.slice(11, 19) };
    o.n++; if (x.trade_type === 'buy') o.buy += Number(x.bnb_amount || 0);
    if (rel(x)) { o.minP = Math.min(o.minP, x.price_bnb); o.maxP = Math.max(o.maxP, x.price_bnb); }
    b5.set(b, o);
    const curVs = rel(x) ? (x.price_bnb / launch - 1) * 100 : null;
    if (curVs != null && curVs > 27.5 && left275 === null) left275 = { t: x.block_time.slice(11, 23), curVs: +curVs.toFixed(1), n, buyVol: +buyVol.toFixed(2), holders: wallets.size };
    if (curVs != null && curVs <= 27.5 && first275down === null) first275down = { t: x.block_time.slice(11, 23), curVs: +curVs.toFixed(1), n, buyVol: +buyVol.toFixed(2), holders: wallets.size };
    if (n >= 9 && buyVol >= 1 && wallets.size >= 6 && curVs != null && curVs <= 27.5 && firstAll === null) {
      firstAll = { t: x.block_time.slice(11, 23), curVs: +curVs.toFixed(1), n, buyVol: +buyVol.toFixed(2), holders: wallets.size };
    }
  }
  for (const k of [...b5.keys()].sort((a, b) => a - b)) {
    const o = b5.get(k);
    console.log(`t+${String(k * 5).padStart(3)}s ${o.ts} n=${String(o.n).padStart(3)} 买=${o.buy.toFixed(2).padStart(6)}B 可靠价=[${o.minP === Infinity ? '-' : vs(o.minP)}%, ${o.maxP ? vs(o.maxP) : '-'}%]`);
  }
  console.log('\n首个可靠价 ≤27.5%:', JSON.stringify(first275down));
  console.log('curVs 永久离开 ≤27.5%(首破):', JSON.stringify(left275));
  console.log('t0a 四门首次同时满足:', JSON.stringify(firstAll), firstAll ? '' : '← 全程未同时满足');

  // 四条 BUY 信号明细
  const { data: sigs } = await client.from('strategy_signals')
    .select('created_at,metadata').eq('experiment_id', V98).eq('token_address', ADDR)
    .eq('signal_type', 'BUY').order('created_at', { ascending: true }).limit(10);
  for (const s of (sigs || [])) {
    const m = s.metadata || {}; const cc = m.cheatCheck || {}; const sg = m.signalGate || {};
    console.log(`\n信号 ${s.created_at.slice(11, 19)} leg=${sg.legId} tri=${sg.triggerNo}/${sg.maxTriggers} grade=${cc.grade} act=${cc.buckets && cc.buckets.activityLevel}`);
    console.log('  reasons=', JSON.stringify((cc.reasons || []).map((r) => r.code)));
    console.log('  status=', cc.status, ' cached=', cc.cached, ' exempt=', JSON.stringify(cc.exempt || null));
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
