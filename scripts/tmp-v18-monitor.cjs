#!/usr/bin/env node
// v18 例行健康盘点（182 跑）：实验行 status / trades 汇总 / 净持仓 / 已实现盈亏
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');

const V18 = 'd3be1662-5dba-430c-a79a-a861e9d5ef06';

(async () => {
  const sb = dbManager.getClient();

  // 1) 实验行 status
  const { data: exp, error: e1 } = await sb.from('experiments')
    .select('id,experiment_name,status,started_at,stopped_at').eq('id', V18).single();
  if (e1) console.log('[exp] ERROR', e1.message);
  else console.log(`[exp] ${exp.status} | started=${exp.started_at} | stopped=${exp.stopped_at ?? '-'}`);

  // 2) trades 汇总 + 净持仓 + 已实现盈亏（BNB 口径）
  const { data: trades, error: e2 } = await sb.from('trades')
    .select('token_symbol,token_address,trade_direction,trade_status,input_amount,output_amount,success,executed_at')
    .eq('experiment_id', V18).order('executed_at').limit(1000);
  if (e2) { console.log('[trades] ERROR', e2.message); }
  else {
    const ok = trades.filter(t => t.success);
    const buys = ok.filter(t => String(t.trade_direction).toLowerCase() === 'buy');
    const sells = ok.filter(t => String(t.trade_direction).toLowerCase() === 'sell');
    const fails = trades.filter(t => !t.success);
    const spent = buys.reduce((s, t) => s + Number(t.input_amount || 0), 0);
    const recv = sells.reduce((s, t) => s + Number(t.output_amount || 0), 0);
    console.log(`[trades] total=${trades.length} buy=${buys.length} sell=${sells.length} failed=${fails.length} | spent=${spent.toFixed(5)} recv=${recv.toFixed(5)} realizedPnl=${(recv - spent).toFixed(5)} BNB`);
    const net = {};
    const lastAt = {};
    for (const t of ok) {
      const k = `${t.token_symbol} ${t.token_address}`;
      const amt = String(t.trade_direction).toLowerCase() === 'buy'
        ? Number(t.output_amount || 0) : -Number(t.input_amount || 0);
      net[k] = (net[k] || 0) + amt;
      lastAt[k] = t.executed_at;
    }
    const open = Object.entries(net).filter(([, v]) => v > 1e-6);
    console.log(`[positions] open=${open.length}`);
    for (const [k, v] of open) console.log(`    OPEN ${k} net=${v.toPrecision(6)} last=${lastAt[k]}`);
    for (const t of fails.slice(-5)) console.log(`    FAILED ${t.token_symbol} ${t.trade_direction} ${t.executed_at} status=${t.trade_status}`);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
