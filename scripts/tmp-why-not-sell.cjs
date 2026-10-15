#!/usr/bin/env node
/** 临时诊断（本地单条点查）：0x8ff9…7777 为何不卖出 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const ADDR = (process.argv[2] || '0x8ff900181e50ed68926dada17f6d6650fe1e7777').toLowerCase();

async function main() {
  const db = dbManager.getClient();

  // 1. 当前 running 实验
  const exp = await db.from('experiments').select('id,name,status,mode,platform,config').eq('status', 'running').limit(5);
  console.log('=== running 实验 ===');
  for (const e of exp.data || []) console.log(e.id, e.name, e.status, e.mode, e.platform);

  // 2. 该 token 的 trades（买卖全量）
  const tr = await db.from('trades').select('*').eq('token_address', ADDR).order('executed_at').limit(50);
  console.log('\n=== trades ===');
  for (const t of tr.data || []) {
    console.log(JSON.stringify({
      exp: (t.experiment_id || '').slice(0, 8), side: t.side, status: t.status,
      executed_at: t.executed_at, bnb: t.bnb_amount, tokens: t.token_amount,
      price: t.price, price_bnb: t.price_bnb, err: (t.error_message || '').slice(0, 200),
      meta_keys: t.metadata ? Object.keys(t.metadata) : null,
      card: t.metadata && t.metadata.cardTrade, reason: t.metadata && (t.metadata.reason || t.metadata.sellReason || t.metadata.legName),
    }));
  }

  // 3. 该 token 的 signals（卖腿评估轨迹）
  const sg = await db.from('strategy_signals').select('id,side,status,created_at,price,metadata').eq('token_address', ADDR).order('created_at').limit(100);
  console.log('\n=== signals ===');
  for (const s of sg.data || []) {
    console.log(JSON.stringify({
      id: (s.id || '').slice(0, 8), side: s.side, status: s.status, created_at: s.created_at, price: s.price,
      profitPct: s.metadata && s.metadata.profitPercent,
      leg: s.metadata && s.metadata.legName,
      reason: s.metadata && (s.metadata.reason || s.metadata.rejectedReason),
      keys: s.metadata ? Object.keys(s.metadata).slice(0, 25) : null,
    }));
  }

  // 4. 监控池状态
  const mp = await db.from('token_monitoring_pool').select('*').eq('token_address', ADDR).limit(5);
  console.log('\n=== monitoring_pool ===');
  for (const m of mp.data || []) console.log(JSON.stringify({ exp: (m.experiment_id || '').slice(0, 8), status: m.status, pool: m.pool, updated: m.updated_at, meta: m.metadata ? Object.keys(m.metadata) : null }));

  // 5. 该 token 最近 ticks（有没有断流/价格现状）
  const tk = await db.from('wss_price_ticks').select('block_time,price_bnb,trade_type,bnb_amount').eq('token_address', ADDR).order('block_time', { ascending: false }).limit(8);
  console.log('\n=== 最近 ticks（倒序 8 条） ===');
  for (const t of tk.data || []) console.log(t.block_time, 'px_bnb=', t.price_bnb, t.trade_type, 'bnb=', t.bnb_amount);

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
