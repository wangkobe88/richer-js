#!/usr/bin/env node
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOK = '0xbda9abd9e7f9afefabfd0965c9d6f07153347777';
const EXP = '03273fe9-faf2-4cc0-9a76-ecfb0f36b529';
(async () => {
  const db = dbManager.getClient();
  const ev = await db.from('wss_events').select('block_time, payload').eq('token_address', TOK).eq('kind', 'token_create').limit(1);
  const t0 = new Date(ev.data[0].block_time).getTime();
  console.log('创建:', ev.data[0].block_time, new Date(t0).toISOString());
  const r = await db.from('wss_price_ticks')
    .select('trade_type, trader_address, sender_address, price_bnb, bnb_amount, token_amount, block_time, block_number, log_index')
    .eq('token_address', TOK).order('id', { ascending: true }).limit(400);
  if (r.error) throw new Error(r.error.message);
  const rows = r.data.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
  const CONST = 5.546338e-9;
  console.log('\n=== 出生后前 120s 全部成交（价=vs 常量发行价涨幅）===');
  for (const x of rows) {
    const sec = (new Date(x.block_time).getTime() - t0) / 1000;
    if (sec > 120) break;
    const w = (x.sender_address || x.trader_address || '').slice(0, 8);
    console.log(`+${sec.toFixed(0).padStart(4)}s ${x.trade_type.padEnd(4)} bnb=${Number(x.bnb_amount).toFixed(4).padStart(7)} px=${Number(x.price_bnb).toExponential(3)} (+${(Number(x.price_bnb) / CONST * 100 - 100).toFixed(1).padStart(6)}%) w=${w}`);
  }
  // gap>30s
  console.log('\n=== gap>30s ===');
  for (let i = 1; i < rows.length; i++) {
    const dt = (new Date(rows[i].block_time).getTime() - new Date(rows[i-1].block_time).getTime()) / 1000;
    if (dt > 30) console.log(`gap +${((new Date(rows[i-1].block_time).getTime()-t0)/1000).toFixed(0)}s -> +${((new Date(rows[i].block_time).getTime()-t0)/1000).toFixed(0)}s (${dt.toFixed(0)}s)`);
  }
  const sig = await db.from('strategy_signals').select('created_at, reason, metadata').eq('experiment_id', EXP).eq('token_address', TOK).order('created_at', { ascending: true }).limit(5);
  if (sig.error) throw new Error(sig.error.message);
  console.log('\n=== bt-v186 信号行 ===');
  for (const s of sig.data) {
    const sec = (new Date(s.created_at).getTime() - t0) / 1000;
    console.log(`+${sec.toFixed(0)}s ${s.reason} (curVs≈${s.metadata && s.metadata.signalGate ? '' : ''}${s.metadata && s.metadata.factorCheck && s.metadata.factorCheck.gates ? '' : ''})`);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
