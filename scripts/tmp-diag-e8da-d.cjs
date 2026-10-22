#!/usr/bin/env node
/** 临时诊断 D:0xe8da…7777 (MAYA/flap) 逐 tick 重放 v28 买条件找拦截门 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const ADDR = '0xe8da305a2ea91281592e5a8e4565ad9aaa3c7777';
const TOTAL_SUPPLY = 1e9;
const CREATE_MS = Date.parse('2026-10-21T16:00:31Z'); // token_create block_time
const RATING_READY_MS = Date.parse('2026-10-21T16:00:35.442Z'); // round1 完成 rating=3
const GRAD_MS = Date.parse('2026-10-21T16:00:49Z');

async function main() {
  const db = dbManager.getClient();
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error } = await db.from('wss_price_ticks')
      .select('id,block_time,block_number,log_index,trade_type,token_amount,bnb_amount,price_bnb,price_usd,sender_address,trader_address')
      .eq('token_address', ADDR).order('block_number', { ascending: true }).order('log_index', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw error;
    if (!data.length) break;
    rows.push(...data); offset += data.length;
    if (offset > 5000) break;
  }
  console.log('ticks:', rows.length);

  const net = new Map();
  let cumBuy = 0, holders = 0, holderCross = null, buyCross = null;
  const routerAddr = '0x1de4609f9e057942f4c7b2d5b95c1a9c41f4bc'.toLowerCase(); // 前缀对拍用全量行
  let routerBuys = 0, buyTrades = 0;
  const perWallet = new Map();

  const fmt = ms => new Date(ms).toISOString().slice(14, 23);
  let ratingSet = false;

  for (const r of rows) {
    const isBuy = r.trade_type === 'buy';
    const wallet = (r.sender_address || r.trader_address || '').toLowerCase();
    const bnb = Number(r.bnb_amount) || 0;
    const t = Date.parse(r.block_time);
    const tk = Number(r.token_amount) || 0;

    // holders 净持仓
    if (wallet) {
      const prev = net.get(wallet) || 0;
      const cur = prev + (isBuy ? tk : -tk);
      net.set(wallet, cur);
      if (prev <= 0 && cur > 0) holders++;
      else if (prev > 0 && cur <= 0) holders--;
    }
    if (isBuy) {
      cumBuy += bnb;
      buyTrades++;
      if ((r.trader_address || '').toLowerCase().startsWith('0x1de460')) routerBuys++;
      perWallet.set(wallet, (perWallet.get(wallet) || 0) + 1);
    }
    const mcap = (Number(r.price_usd) || 0) * TOTAL_SUPPLY;
    const age = (t - CREATE_MS) / 1000;
    const routerPct = buyTrades ? (routerBuys / buyTrades) * 100 : null;
    const maxPerWallet = perWallet.size ? Math.max(...perWallet.values()) : 0;
    const rating = t >= RATING_READY_MS ? 3 : null;
    if (t >= RATING_READY_MS) ratingSet = true;

    if (!buyCross && cumBuy >= 1.25) buyCross = { t: fmt(t), age: +age.toFixed(1), mcap: Math.round(mcap) };
    if (!holderCross && holders >= 10) holderCross = { t: fmt(t), age: +age.toFixed(1), mcap: Math.round(mcap) };

    // 买条件逐门(只对 rating=3 段评估; 每 5 tick 打一行)
    const gates = {
      ageLT90: age < 90,
      mcap3500: mcap > 3500,
      mcap12000: mcap < 12000,
      rating: rating === 3,
      flapArm: mcap < 4500 || (routerPct != null && routerPct >= 30),
      perWalletLT4: maxPerWallet < 4,
      buyVol125: cumBuy >= 1.25,
      holders10: holders >= 10,
    };
    const allOk = Object.values(gates).every(Boolean);
    if (allOk || (ratingSet && t % 1 < 500)) {
      console.log(fmt(t), 'age=' + age.toFixed(1), 'mcap=' + Math.round(mcap), 'cumBuy=' + cumBuy.toFixed(2),
        'holders=' + holders, 'routerPct=' + (routerPct == null ? '-' : routerPct.toFixed(0)),
        'maxPerWallet=' + maxPerWallet, 'rating=' + rating, allOk ? ' ★ALL PASS★' : '');
    }
  }

  console.log('\n=== 汇总 ===');
  console.log('rating=3 就绪时刻:', fmt(RATING_READY_MS), '毕业:', fmt(GRAD_MS), '可买窗=', ((GRAD_MS - RATING_READY_MS) / 1000).toFixed(1) + 's');
  console.log('buyVolumeBnb>=1.25 首破:', JSON.stringify(buyCross));
  console.log('holders>=10 首破:', JSON.stringify(holderCross));
  console.log('终态: cumBuy=', cumBuy.toFixed(2), 'holders=', holders, 'routerBuys/buyTrades=', routerBuys + '/' + buyTrades);
  console.log('maxPerWallet=', perWallet.size ? Math.max(...perWallet.values()) : 0);

  // mcap 轨迹关键点
  const mcaps = rows.map(r => (Number(r.price_usd) || 0) * TOTAL_SUPPLY);
  console.log('mcap first/last/max:', Math.round(mcaps[0]), Math.round(mcaps[mcaps.length - 1]), Math.round(Math.max(...mcaps)));
  const cross4500 = rows.find(r => (Number(r.price_usd) || 0) * TOTAL_SUPPLY >= 4500);
  const cross12000 = rows.find(r => (Number(r.price_usd) || 0) * TOTAL_SUPPLY >= 12000);
  console.log('mcap>=4500 时刻:', cross4500 ? cross4500.block_time.slice(14, 23) : 'never');
  console.log('mcap>=12000 时刻:', cross12000 ? cross12000.block_time.slice(14, 23) : 'never');

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
