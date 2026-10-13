#!/usr/bin/env node
// ============================================================================
// g80u40 双门对拍（g0 基线 vs g2 双门，同窗同源）
// 输出：两臂净值/票数对比 + 被门拦掉票清单（带地址/两因子值/g0 盈亏）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const G0 = '4a7aa1ae-2b4b-4131-b61b-6d236a7d9d0c';
const G2 = '943f65ff-12c0-472d-8bed-10ee23e49885';

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();

  async function arm(id) {
    const tr = await db.from('trades').select('token_address,token_symbol,trade_direction,input_amount,output_amount,trade_status')
      .eq('experiment_id', id).eq('trade_status', 'success');
    const tok = new Map();
    for (const t of tr.data || []) {
      const a = t.token_address;
      if (!tok.has(a)) tok.set(a, { sym: t.token_symbol, inBnb: 0, outBnb: 0, buyN: 0, sellN: 0 });
      const o = tok.get(a);
      if (t.trade_direction === 'buy') { o.inBnb += Number(t.input_amount) || 0; o.buyN++; }
      else { o.outBnb += Number(t.output_amount) || 0; o.sellN++; }
    }
    for (const [a, o] of tok) o.pnl = +(o.outBnb - o.inBnb).toFixed(4);
    return tok;
  }
  const [t0, t2] = [await arm(G0), await arm(G2)];
  const sum = m => +[...m.values()].reduce((s, o) => s + o.pnl, 0).toFixed(4);
  const wins = m => [...m.values()].filter(o => o.pnl > 0).length;

  console.log(`g0 基线 : ${t0.size} 票 | 净 ${sum(t0)} BNB | 赢 ${wins(t0)}`);
  console.log(`g2 双门 : ${t2.size} 票 | 净 ${sum(t2)} BNB | 赢 ${wins(t2)}`);

  const blocked = [...t0.keys()].filter(a => !t2.has(a));
  const added = [...t2.keys()].filter(a => !t0.has(a));
  console.log(`\n被门拦掉 ${blocked.length} 票（g0 净贡献 ${+blocked.reduce((s, a) => s + t0.get(a).pnl, 0).toFixed(4)} BNB）：`);
  // 取 g0 信号因子做归因
  for (const a of blocked) {
    const s = await db.from('strategy_signals').select('metadata')
      .eq('experiment_id', G0).eq('token_address', a).eq('signal_type', 'BUY').limit(1);
    const md = s.data?.[0]?.metadata || {};
    const pf = md.preBuyCheckFactors || {};
    const tf = md.tpaFactors || {};
    const o = t0.get(a);
    console.log(`  ${o.pnl >= 0 ? '+' : ''}${o.pnl} ${o.sym} ${a}`
      + ` | bundler=${pf.gmgnBundlerWalletRatio} covered=${pf.gmgnRiskCovered}`
      + ` gmgnUserPct@fire=${tf.TPAPre_gmgnUserPct}${o.sellN < o.buyN ? ' (g0持仓未清)' : ''}`);
  }
  if (added.length) console.log(`\n⚠ g2 多出 ${added.length} 票（理论上门只拦不放，多出=时序副作用需查）：`, added.join(', '));
  const common = [...t0.keys()].filter(a => t2.has(a));
  let drift = 0, driftN = 0;
  for (const a of common) { const d = +(t2.get(a).pnl - t0.get(a).pnl).toFixed(4); if (Math.abs(d) > 1e-6) { drift += d; driftN++; } }
  if (driftN) console.log(`\n⚠ 共同票 PnL 漂移 ${driftN} 只合计 ${+drift.toFixed(4)} BNB（卖腿时序受 fire 延迟影响）`);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
