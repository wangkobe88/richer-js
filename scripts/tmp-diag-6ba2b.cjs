#!/usr/bin/env node
/** 临时诊断:0x6ba2…7777 第三段——实验行/signals by id/价格轨迹统计 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const ADDR = '0x6ba259ea425b06ca7a032bec2c86f017ffbd7777';
const EXP = '203570e3-6117-4841-bc50-936461e78a8a';

async function main() {
  const db = dbManager.getClient();
  console.log('now_utc:', new Date().toISOString());

  // 1. 实验 eq 完整 id
  const exp = await db.from('experiments').select('id,name,status,mode,platform,updated_at').eq('id', EXP).limit(1);
  console.log('exp(eq):', JSON.stringify(exp.data));

  // 2. signals by id
  for (const sid of ['442e90ac-0ba9-4d92-9eb7-43904cfe7690', '5c807835-f6e4-4630-8b4c-8fde127cf7a1']) {
    const s = await db.from('strategy_signals').select('id,side,status,created_at,price,token_address,experiment_id').eq('id', sid).limit(1);
    console.log('signal:', sid.slice(0, 8), JSON.stringify(s.data));
  }

  // 3. 该 token ticks 统计(单 token 点查,走索引)
  const cnt = await db.from('wss_price_ticks').select('id', { count: 'exact', head: true }).eq('token_address', ADDR);
  console.log('ticks count:', cnt.count);

  // 4. 买入后的轨迹:拉 block_time + price_bnb + price_outlier(分页 ≤2000)
  const rows = [];
  let curId = 0;
  for (;;) {
    const r = await db.from('wss_price_ticks')
      .select('id,block_time,block_number,price_bnb,bnb_amount,trade_type,price_outlier')
      .eq('token_address', ADDR).gt('id', curId).order('id', { ascending: true }).limit(1000);
    const page = r.data || [];
    if (!page.length) break;
    rows.push(...page);
    curId = page[page.length - 1].id;
    if (page.length < 1000) break;
  }
  console.log('pulled rows:', rows.length);
  // 买锚(11:40:45 UTC 执行,fire 略早)
  const BUY_MS = Date.parse('2026-10-15T11:40:45.815+00:00');
  const after = rows.filter(r => Date.parse(r.block_time) >= BUY_MS - 60_000);
  let hi = null, hiT = null, lo = null, loT = null;
  for (const r of after) {
    if (r.price_bnb == null || r.price_outlier) continue;
    if (hi == null || r.price_bnb > hi) { hi = r.price_bnb; hiT = r.block_time; }
    if (lo == null || r.price_bnb < lo) { lo = r.price_bnb; loT = r.block_time; }
  }
  const last = after[after.length - 1];
  console.log('after-buy rows:', after.length,
    '| hi_bnb:', hi, '@', hiT,
    '| lo_bnb:', lo, '@', loT,
    '| last:', last && last.block_time, last && last.price_bnb, 'outlier=', last && last.price_outlier);
  // 最高点之后回撤轨迹(每 30s 采样)
  const hiMs = Date.parse(hiT);
  console.log('\n=== 回撤采样(最高点后每 30s 的非离群价)===');
  let nextMs = hiMs;
  const byT = after.filter(r => r.price_bnb != null && !r.price_outlier);
  while (nextMs <= Date.parse(last.block_time)) {
    const win = byT.filter(r => Date.parse(r.block_time) >= nextMs && Date.parse(r.block_time) < nextMs + 30_000);
    if (win.length) {
      const px = win[win.length - 1].price_bnb;
      const dd = (px / hi - 1) * 100;
      console.log(new Date(nextMs).toISOString(), 'px=', px.toExponential(4), 'vs_hi=', dd.toFixed(1) + '%', 'n=', win.length);
    }
    nextMs += 30_000;
  }

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
