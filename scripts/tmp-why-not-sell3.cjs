#!/usr/bin/env node
/** 临时诊断 3：experiments/signals select(*) 修正列名 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const ADDR = '0x8ff900181e50ed68926dada17f6d6650fe1e7777';
const EXP_ID = '203570e3-6117-4841-bc50-936461e78a8a';

async function main() {
  const db = dbManager.getClient();

  const exp = await db.from('experiments').select('*').eq('id', EXP_ID).limit(1);
  if (exp.error) console.log('exp error:', exp.error.message);
  for (const e of exp.data || []) {
    const { config, ...rest } = e;
    console.log('=== 实验行 ===');
    console.log(JSON.stringify(rest, null, 1).slice(0, 1200));
    console.log('\n=== config 卖腿/机制 ===');
    const cfg = config || {};
    const sc = cfg.strategiesConfig || {};
    const legs = sc.legs || [];
    for (const l of legs) console.log('leg:', JSON.stringify(l).slice(0, 600));
    console.log('stopLoss:', JSON.stringify(cfg.stopLoss));
    console.log('positionManagement:', JSON.stringify(cfg.positionManagement));
    console.log('fourmemeWs 相关键:', JSON.stringify(Object.keys(cfg.fourmemeWs || {})));
  }

  const sg = await db.from('strategy_signals').select('*').eq('token_address', ADDR).order('created_at').limit(50);
  if (sg.error) console.log('signals error:', sg.error.message);
  console.log('\n=== signals ===');
  for (const s of sg.data || []) {
    console.log(JSON.stringify({
      id: (s.id || '').slice(0, 8), created_at: s.created_at,
      status: s.signal_status || s.status, direction: s.signal_direction || s.direction || s.side,
      price: s.price, exp: (s.experiment_id || '').slice(0, 8),
      reason: s.metadata && (s.metadata.reason || s.metadata.legName),
      meta: s.metadata ? JSON.stringify(s.metadata).slice(0, 400) : null,
    }));
  }

  // 该实验最近其它票的卖出（证明卖腿机制活着）
  const recentSells = await db.from('trades').select('token_symbol,trade_direction,trade_status,executed_at,token_address').eq('experiment_id', EXP_ID).order('executed_at', { ascending: false }).limit(15);
  console.log('\n=== 该实验最近 15 笔 trades（新→旧） ===');
  for (const t of recentSells.data || []) console.log(t.executed_at, t.trade_direction, t.trade_status, (t.token_symbol || t.token_address.slice(0, 8)));

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
