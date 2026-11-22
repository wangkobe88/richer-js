#!/usr/bin/env node
/**
 * 一次性脚本（不进 git）：FP28·早窗启动失败死盘 误拦取证
 * token=0xb6eeb994aa5ea8e2b5bd4fde8e57e15b0ecd7777 @ bt-v164 (9e9163de)
 * 用户观察：信号在一波小 burst 中途触发，锚后立即跟着买入 → nearTail7BuyN（锚前窗）
 * 结构性看不到正在形成的 burst。验证：信号 metadata + 锚 ±150s ticks 时间线。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXP_ID = '9e9163de-a677-4d39-9c33-9ec9df05e400';
const TOKEN = '0xb6eeb994aa5ea8e2b5bd4fde8e57e15b0ecd7777';

(async () => {
  const db = dbManager.getClient();

  // 1) 信号行（含门链 metadata）
  const sig = await db.from('strategy_signals').select('*')
    .eq('experiment_id', EXP_ID).eq('token_address', TOKEN)
    .order('created_at', { ascending: true });
  if (sig.error) throw new Error(sig.error.message);
  console.log(`== 信号行 ${sig.data.length} 条 ==`);
  for (const s of sig.data) {
    console.log(`  [${s.signal_type}] ${s.created_at} status=${s.status} action=${s.action}`);
    if (s.metadata) {
      const m = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata;
      if (m.factorCheck) {
        console.log('    factorCheck.digest =', JSON.stringify(m.factorCheck.digest || m.factorCheck, null, 2).slice(0, 2000));
      }
      const fa = m.factorSnapshot || m.factors;
      if (fa) {
        const keys = ['tokenAgeSec','athVsLaunchPct','currentVsLaunchPct','actBuyBnb','actTotalBnb','actTrades','quietSpanMs'];
        const pick = {};
        for (const k of keys) if (fa[k] !== undefined) pick[k] = fa[k];
        console.log('    fire 因子摘录 =', JSON.stringify(pick));
      }
      console.log('    metadata 顶层键 =', Object.keys(m).join(','));
      if (m.signalGate) console.log('    signalGate =', JSON.stringify(m.signalGate).slice(0, 600));
      if (m.trendFactors) console.log('    trendFactors =', JSON.stringify(m.trendFactors).slice(0, 600));
      console.log('    execution =', m.execution_reason, '/', m.execution_status);
      if (m.factorCheck && m.factorCheck.gates) {
        const lf = m.factorCheck.gates.filter(g => g.id === 'launch_fail_dead' || g.id === 'act_idle' || g.id === 'fam_holding_thin');
        for (const g of lf) console.log(`    门[${g.id}] hit=${g.hit} value=${g.value}`);
      }
    }
  }

  // 2) token_create 锚
  const ev = await db.from('wss_events').select('created_at,payload')
    .eq('kind', 'token_create').eq('token_address', TOKEN).limit(2);
  if (ev.error) throw new Error(ev.error.message);
  const createAt = ev.data[0] && new Date(ev.data[0].created_at);
  console.log(`\n== token_create = ${ev.data[0] ? ev.data[0].created_at : '无'} ==`);

  // 3) 锚 ±150s ticks（单票小读取）
  const anchor = new Date(sig.data[0].created_at);
  const from = new Date(anchor.getTime() - 150_000).toISOString();
  const to = new Date(anchor.getTime() + 600_000).toISOString();
  const tk = await db.from('wss_price_ticks').select(
    'block_number,log_index,block_time,trade_type,price_bnb,bnb_amount,trader_address,sender_address,price_outlier'
  ).eq('token_address', TOKEN).gte('block_time', from).lte('block_time', to)
    .order('block_time', { ascending: true }).limit(1000);
  if (tk.error) throw new Error(tk.error.message);
  const rows = tk.data;
  console.log(`== ticks ${rows.length} 行（${from.slice(11,19)} ~ ${to.slice(11,19)} UTC）==`);

  const t0 = createAt || new Date(rows[0].block_time);
  const rel = (r) => ((new Date(r.block_time) - anchor) / 1000).toFixed(1).padStart(7);
  const relCreate = ((anchor - t0) / 1000).toFixed(1);
  console.log(`锚（信号 fire）距 token_create = ${relCreate}s\n`);
  console.log('  t(锚)  t±s   blk:idx   side  bnb      price');
  let buyBefore7 = 0, buyAfter = [];
  for (const r of rows) {
    const dt = (new Date(r.block_time) - anchor) / 1000;
    if (dt <= 0 && dt >= -7 && String(r.trade_type).toLowerCase() === 'buy') buyBefore7++;
    if (dt > 0 && String(r.trade_type).toLowerCase() === 'buy') buyAfter.push(r);
    console.log(`  ${rel(r)}s  ${String(r.block_number).slice(-6)}:${String(r.log_index).padStart(4)}  ${String(r.trade_type).toLowerCase() === 'buy' ? 'BUY ' : 'SELL'}  ${(r.bnb_amount || 0).toFixed(4).padStart(8)}  ${(r.price_bnb || 0).toExponential(3)}${r.price_outlier ? ' [outlier]' : ''}`);
  }
  console.log(`\n锚前 7s BUY 笔数(nearTail7BuyN 口径) = ${buyBefore7}`);
  console.log(`锚后 150s 内 BUY 笔数 = ${buyAfter.length}，合计 ${(buyAfter.reduce((s, r) => s + (r.bnb_amount || 0), 0)).toFixed(4)} BNB`);

  // 4) 锚后价格走势（每 15s 采样最新价）
  console.log('\n锚后价格路径（每 15s 采样）：');
  let cursor = 0;
  for (let s = 30; s <= 600; s += 30) {
    while (cursor < rows.length && (new Date(rows[cursor].block_time) - anchor) / 1000 <= s) cursor++;
    const last = rows[cursor - 1];
    if (!last || (new Date(last.created_at) - anchor) / 1000 < 0) continue;
    console.log(`  +${String(s).padStart(3)}s  price=${(last.price_bnb || 0).toExponential(3)}`);
  }

  // 5) 本实验该票 trades（预期 0=被拦未买）
  const tr = await db.from('trades').select('id,trade_type,bnb_amount,price_bnb,executed_at,profit_loss_bnb')
    .eq('experiment_id', EXP_ID).eq('token_address', TOKEN);
  if (tr.error) throw new Error(tr.error.message);
  console.log(`\n== 本实验 trades = ${tr.data.length} 条 ==`);
  for (const t of tr.data) console.log(`  ${t.executed_at || ''} ${t.side} ${(t.bnb_amount || 0).toFixed(4)} @ ${(t.price_bnb || 0).toExponential(3)} pnl=${t.profit_loss_bnb}`);

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
