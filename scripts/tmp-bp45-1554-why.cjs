#!/usr/bin/env node
// ============================================================================
// 一次性（182 跑）：0x28ad2c7d bt-s02 为何 07:15:54 没买——
// 全 BUY 信号时刻+腿+门链结局 + 07:13:50-07:16:30 价格路径（秒级去重）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const BT2 = '19ab9c37-771c-483e-93ad-7137550c44d9';
const TOKEN = '0x28ad2c7d08d83a85467bd4afcfd673dfce564444';

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();

  const { data: sigs, error } = await db.from('strategy_signals')
    .select('id,created_at,metadata')
    .eq('experiment_id', BT2).eq('signal_type', 'BUY').eq('token_address', TOKEN)
    .order('created_at');
  if (error) throw new Error(error.message);
  console.log(`BUY 信号 ${sigs.length} 行：`);
  for (const s of sigs) {
    const m = s.metadata || {};
    const sg = m.signalGate || {};
    const bp = m.buyPoint || {};
    const a = bp.assessment || {};
    const ch = m.cheatCheck || {};
    console.log(`${s.created_at.slice(11, 19)} status=${s.status} leg=${sg.legId ?? sg.legName ?? '?'} trig=${sg.triggerNo ?? '?'} 综=${a.bucket ?? '?'}(${a.rule ?? '?'}) cheat=${ch.status ?? ch.grade ?? '?'} raw=${JSON.stringify(sg).slice(0, 220)}`);
  }

  const { data: ticks, error: e2 } = await db.from('wss_price_ticks')
    .select('block_time,price_bnb,trade_type,bnb_amount')
    .eq('token_address', TOKEN)
    .gte('block_time', '2026-11-05T07:13:50').lte('block_time', '2026-11-05T07:16:30')
    .order('block_number', { ascending: true });
  if (e2) throw new Error(e2.message);
  const first = ticks.find((t) => t.price_bnb && t.price_bnb > 0);
  console.log(`\n首可靠价=${first && first.price_bnb} @ ${first && first.block_time.slice(11, 19)}  ticks=${ticks.length}`);
  let lastSec = '';
  for (const t of ticks) {
    if (!t.price_bnb) continue;
    const sec = t.block_time.slice(11, 19);
    if (sec === lastSec) continue;
    lastSec = sec;
    const pct = ((t.price_bnb / first.price_bnb - 1) * 100).toFixed(1);
    console.log(`${sec} price=${Number(t.price_bnb).toPrecision(4)} vsLaunch=${pct}%`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
