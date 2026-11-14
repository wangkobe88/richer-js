#!/usr/bin/env node
// ============================================================================
// 一次性（182 跑）：重建 07:15:45 锚 state，打印回调题三层证据行
// （pullback_entry=poor 0.53 vs neutral 0.41 刀口——看 Jev 权衡的材料）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const TOKEN = '0x28ad2c7d08d83a85467bd4afcfd673dfce564444';
const ANCHOR = '2026-11-05T07:15:45';

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot');
  const { buildBuyPointState } = require('../src/market-analysis/buy-point-state-builder');

  // token meta（wss_events token_create）
  const { data: ev } = await db.from('wss_events')
    .select('platform,payload,block_time').eq('kind', 'token_create').eq('token_address', TOKEN)
    .order('id', { ascending: true }).limit(3);
  const meta = (ev || []).find((r) => r.payload && r.payload.symbol);

  const { data: rows, error } = await db.from('wss_price_ticks')
    .select('block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token')
    .eq('token_address', TOKEN).lte('block_time', ANCHOR)
    .order('block_number', { ascending: false }).order('log_index', { ascending: false }).limit(300);
  if (error) throw new Error(error.message);
  const win = (rows || []).slice().reverse();
  console.log(`锚窗行数=${win.length} 首=${win[0] && win[0].block_time} 末=${win[win.length - 1] && win[win.length - 1].block_time}`);

  const snap = buildBuyPointSnapshot(win, meta, { anchorTickCount: win.length });
  const d = snap.buyDerived || {};
  const { state } = buildBuyPointState(snap);

  // 数值锚快照
  const keys = ['maxChg5Pct', 'athVsLaunchPct', 'minVsLaunchPct', 'currentVsLaunchPct', 'currentVsAthPct', 'maxDrawdownPct', 'chg30Pct', 'secSinceAth'];
  for (const k of keys) console.log(k + '=' + (d[k] ?? '?'));
  console.log('nearTail5=' + JSON.stringify(d.nearTail5));
  console.log('holdersDelta60=' + d.holdersDelta60, 'holdersNow=' + d.holdersNow);

  // state 里回调题读的证据行
  const lines = state.split('\n');
  console.log('---- state 证据行（卖压/钱包前列/筹码/活跃度/价格/尾段）----');
  const kw = ['卖压', '卖出', 'WALLETS', '前列', '筹码', '持仓', '活跃', '尾段', '价格', '回撤', 'ATH', '高点', '买盘中位', '近窗', 'buy60', '【'];
  for (const l of lines) {
    if (kw.some((k) => l.includes(k))) console.log(l.slice(0, 240));
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
