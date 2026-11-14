// 一次性（182 跑）：v100 review 第二批 idx19 Flap 0xe622…7777——burst 豁免最密 5s 窗买卖构成对拍。
// 复刻生产拉数：block_number/log_index 倒序 limit 3000（pullLimit）+ .lte(block_time, 锚) → 内存正序。
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager.js');
const T = '0xe622a0ec83546b63db65e9b9bf5c225aec417777';
const ANCHOR = '2026-11-05T05:32:15.000Z';

async function main() {
  const sb = await dbManager.getClient();
  const { data, error } = await sb.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,price_outlier,trader_address,sender_address')
    .eq('token_address', T).lte('block_time', ANCHOR)
    .order('block_number', { ascending: false }).order('log_index', { ascending: false })
    .limit(3000);
  if (error) throw new Error(error.message);
  const rows = (data || []).slice().reverse();
  console.log('锚窗行数(生产同口径):', rows.length, '| 首行:', rows[0] && rows[0].block_time, '| 末行:', rows[rows.length - 1] && rows[rows.length - 1].block_time);

  const t0 = new Date(rows[0].block_time).getTime();
  const wave = rows.filter((r) => !r.price_outlier).map((r) => ({
    dt: (new Date(r.block_time).getTime() - t0) / 1000,
    side: r.trade_type === 'buy' ? 'BUY' : 'SELL', bnb: r.bnb_amount, price: r.price_bnb,
    wallet: (r.sender_address || r.trader_address || '').toLowerCase(),
  }));
  console.log('非 outlier 行:', wave.length);

  // 复刻 snapshot 滑窗：5s 窗按总笔数取最密（买+卖混计），wallets 全体、buyWallets 另计
  const BURST_WAVE_SEC = 5;
  let j = 0, curN = 0, curBuy = 0, curSell = 0, curBuyN = 0, curSellN = 0;
  let bestN = 0, best = null, bestI = -1;
  const curWallets = new Map();
  const curBuyWallets = new Map();
  for (let i = 0; i < wave.length; i++) {
    const t = wave[i];
    curN++;
    if (t.side === 'BUY') { curBuy += t.bnb || 0; curBuyN++; if (t.wallet) curBuyWallets.set(t.wallet, (curBuyWallets.get(t.wallet) || 0) + 1); }
    else { curSell += t.bnb || 0; curSellN++; }
    if (t.wallet) curWallets.set(t.wallet, (curWallets.get(t.wallet) || 0) + 1);
    while (t.dt - wave[j].dt > BURST_WAVE_SEC) {
      const u = wave[j];
      curN--;
      if (u.side === 'BUY') { curBuy -= u.bnb || 0; curBuyN--; if (u.wallet) { const n = curBuyWallets.get(u.wallet) - 1; if (n <= 0) curBuyWallets.delete(u.wallet); else curBuyWallets.set(u.wallet, n); } }
      else { curSell -= u.bnb || 0; curSellN--; }
      if (u.wallet) {
        const n = (curWallets.get(u.wallet) || 1) - 1;
        if (n <= 0) curWallets.delete(u.wallet); else curWallets.set(u.wallet, n);
      }
      j++;
    }
    if (curN > bestN) {
      bestN = curN; bestI = i;
      best = { endDt: +t.dt.toFixed(1), n: curN, buyN: curBuyN, sellN: curSellN, buyBnb: +curBuy.toFixed(4), sellBnb: +curSell.toFixed(4), wallets: curWallets.size, buyWallets: curBuyWallets.size };
    }
  }
  console.log('最密 5s 窗（复刻总笔数口径）:', JSON.stringify(best));
  console.log('生产锚 burstWaveBuyBnb=1.0403 / burstWaveWallets=10 → 对拍:');

  // 全窗 maxGap 复核
  let maxGap = 0;
  for (let i = 1; i < wave.length; i++) maxGap = Math.max(maxGap, wave[i].dt - wave[i - 1].dt);
  console.log('全窗 maxGapSec:', +maxGap.toFixed(0), '(生产=133)');

  // 最密窗前后明细（-25s..+3s）
  console.log('--- 最密窗附近明细 ---');
  for (let i = Math.max(0, bestI - 40); i <= bestI; i++) {
    const t = wave[i];
    if (t.dt >= best.endDt - 25) {
      console.log(`dt=${t.dt.toFixed(1)} ${t.side} ${(t.bnb || 0).toFixed(4)}B px=${t.price ? t.price.toExponential(3) : '-'} w=${t.wallet ? t.wallet.slice(-4) : '-'}`);
    }
  }
  // 买/卖 5s 窗各自最密（对照：若按买笔数选窗会是哪窗）
  let bBest = { n: 0 }, sBest = { n: 0 };
  for (let i = 0; i < wave.length; i++) {
    let bn = 0, bb = 0, sn = 0, sb2 = 0;
    for (let k = i; k < wave.length && wave[k].dt - wave[i].dt <= 5; k++) {
      if (wave[k].side === 'BUY') { bn++; bb += wave[k].bnb || 0; } else { sn++; sb2 += wave[k].bnb || 0; }
    }
    if (bn > bBest.n) bBest = { n: bn, buyBnb: +bb.toFixed(3), endDt: +wave[i].dt.toFixed(1) };
    if (sn > sBest.n) sBest = { n: sn, sellBnb: +sb2.toFixed(3), endDt: +wave[i].dt.toFixed(1) };
  }
  console.log('买侧最密 5s 窗:', JSON.stringify(bBest), '| 卖侧最密 5s 窗:', JSON.stringify(sBest));
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
