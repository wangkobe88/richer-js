#!/usr/bin/env node
// ============================================================================
// 一次性脚本：bt-v75（415749ba）回测结果验证（列名已按实测修正：
//   cheat_detection/buy_point_analyses 时间列=analyzed_at、归属列=source_experiment_id；
//   strategy_signals 状态=executed 布尔；trades 方向=trade_direction、额=input/output_amount）
//   1. persist 隔离——两全局表 source_experiment_id=EXP 零行 + analyzed_at 回测窗零行
//   2. 门链判定分布——BUY 信号 metadata 三段（signalGate/cheatCheck/buyPoint）
//   3. 成交明细——episode 配对盈亏
// 只读查询；182 跑。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const EXP = 'b67513a8-a389-4297-86d0-868a5b8eab1a';

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();

  // ── 1. persist 隔离验证（persist:false 硬编码注入的实证）──
  for (const t of ['cheat_detection', 'buy_point_analyses']) {
    const q1 = await db.from(t).select('id').eq('source_experiment_id', EXP);
    const q2 = await db.from(t).select('id').gte('analyzed_at', '2026-11-07T07:00:00Z');
    console.log(`[persist] ${t}: by_experiment=${q1.error ? 'ERR ' + q1.error.message : q1.data.length} | analyzed_at>=07:00Z=${q2.error ? 'ERR ' + q2.error.message : q2.data.length}`);
  }

  // ── 2. BUY 信号 metadata 三段分布 ──
  const { data: sigs, error: e2 } = await db.from('strategy_signals')
    .select('id,token_address,token_symbol,executed,metadata,created_at')
    .eq('experiment_id', EXP).eq('signal_type', 'BUY');
  if (e2) throw new Error('signals 读取失败: ' + e2.message);
  console.log(`\n[signals] BUY 信号总数: ${sigs.length}（executed=true: ${sigs.filter(s => s.executed).length}）`);

  const stat = {
    hasSg: 0, hasCheat: 0, hasBp: 0,
    cheatGrade: {}, cheatCached: 0, cheatFailOpen: 0,
    bpBucket: {}, bpInsufficient: 0, bpFail: 0,
    legTrigger: {}, cross: {},
  };
  for (const s of sigs) {
    const m = s.metadata || {};
    if (m.signalGate) {
      stat.hasSg++;
      const name = (m.strategyName || String(m.signalGate.legId || '')).replace('买入策略 ', '');
      stat.legTrigger[name] = (stat.legTrigger[name] || 0) + 1;
    }
    const c = m.cheatCheck;
    let g = '无cheat段';
    if (c) {
      stat.hasCheat++;
      g = c.grade || c.status || 'n/a';
      if (c.cached) stat.cheatCached++;
      if (['fail_open', 'timeout', 'error', 'fail', 'disabled', 'skipped'].includes(c.status)) stat.cheatFailOpen++;
    }
    const b = m.buyPoint;
    let bb = '无BP段';
    if (b) {
      stat.hasBp++;
      bb = b.bucket || b.assessment || b.status || 'n/a';
      if (b.status === 'insufficient_ticks') stat.bpInsufficient++;
      if (['fail', 'timeout', 'error', 'disabled'].includes(b.status)) stat.bpFail++;
    }
    stat.cheatGrade[g] = (stat.cheatGrade[g] || 0) + 1;
    stat.bpBucket[bb] = (stat.bpBucket[bb] || 0) + 1;
    const key = `${g} × ${bb}`;
    stat.cross[key] = (stat.cross[key] || 0) + 1;
  }
  console.log('[segments] signalGate 段:', stat.hasSg, '| cheatCheck 段:', stat.hasCheat, '| buyPoint 段:', stat.hasBp);
  console.log('[cheat] grade 分布:', JSON.stringify(stat.cheatGrade), '| cached 粘滞秒回:', stat.cheatCached, '| fail-open:', stat.cheatFailOpen);
  console.log('[bp] bucket 分布:', JSON.stringify(stat.bpBucket), '| insufficient 放行:', stat.bpInsufficient, '| fail:', stat.bpFail);
  console.log('[legs] 触发腿分布:', JSON.stringify(stat.legTrigger));
  console.log('[cross] cheat × BP 交叉（降序）:');
  for (const k of Object.keys(stat.cross).sort((a, b) => stat.cross[b] - stat.cross[a])) console.log(`   ${String(stat.cross[k]).padStart(4)}  ${k}`);

  // ── 3. 成交明细 ──
  const { data: trades, error: e3 } = await db.from('trades')
    .select('id,token_address,token_symbol,trade_direction,input_currency,input_amount,output_currency,output_amount,unit_price,executed_at,metadata')
    .eq('experiment_id', EXP).order('executed_at', { ascending: true });
  if (e3) throw new Error('trades 读取失败: ' + e3.message);
  console.log(`\n[trades] 总笔数: ${trades.length}（方向分布: ${
    JSON.stringify(trades.reduce((m, t) => (m[t.trade_direction] = (m[t.trade_direction] || 0) + 1, m), {}))}）`);
  const eps = new Map();
  for (const t of trades) {
    if (!eps.has(t.token_address)) eps.set(t.token_address, { symbol: t.token_symbol, buys: [], sells: [] });
    const e = eps.get(t.token_address);
    (t.trade_direction === 'buy' ? e.buys : e.sells).push(t);
  }
  console.log(`[episodes] ${eps.size} token:`);
  let totPnl = 0, openPos = 0;
  for (const [addr, e] of eps) {
    // 买=input BNB；卖=output BNB（input_currency/output_currency 实测核对方向）
    const buyBnb = e.buys.reduce((s, t) => s + (t.input_currency === 'BNB' ? t.input_amount : 0), 0);
    const sellBnb = e.sells.reduce((s, t) => s + (t.output_currency === 'BNB' ? t.output_amount : 0), 0);
    const pnl = sellBnb - buyBnb;
    totPnl += pnl;
    if (e.buys.length && !e.sells.length) openPos++;
    const first = e.buys[0] || e.sells[0];
    console.log(`  ${(e.symbol || '?').padEnd(14)} ${addr.slice(0, 10)}… 买${e.buys.length}(${buyBnb.toFixed(4)}) 卖${e.sells.length}(${sellBnb.toFixed(4)}) → ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)}${e.buys.length && !e.sells.length ? '（未平仓）' : ''}`);
  }
  console.log(`[episodes] 合计: ${totPnl >= 0 ? '+' : ''}${totPnl.toFixed(4)} BNB | 未平仓 token: ${openPos}`);
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
