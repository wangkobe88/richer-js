#!/usr/bin/env node
// ============================================================================
// 早晚票门配对回测对拍（create-corpus-lag-pair.cjs 产物）
// 用法：node scripts/compare-corpus-lag-pair.cjs <R1_ID> <R0_ID>
//
// 拉取口径（防 statement timeout，参照 compare-hg55-pair）：jsonb 路径窄列
//   strategy_signals: action='buy' AND (status='executed' OR status='failed')
//     metadata->trendFactors->>earlyReturn / metadata->preBuyCheckFactors->>narrativeCorpusLagSec
//   trades: buy/sell 成功腿（BNB 口径 net = Σ卖BNB − Σ买BNB）
// 差分 = R1 门臂 − R0 基线 = 晚票门净效应；被拦票 = R0 有 executed 买而 R1 无。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const [R1, R0] = process.argv.slice(2);
if (!R1 || !R0) { console.error('用法: node scripts/compare-corpus-lag-pair.cjs <R1_ID> <R0_ID>'); process.exit(1); }

const { dbManager } = require('../src/services/dbManager');

async function load(expId) {
  const client = dbManager.getClient();
  const [sigRes, buyRes, sellRes] = await Promise.all([
    client.from('strategy_signals')
      .select(`id, token_address, token_symbol, status, reason,
        metadata->trendFactors->>earlyReturn as er,
        metadata->preBuyCheckFactors->>narrativeCorpusLagSec as lag,
        metadata->preBuyCheckFactors->>earlyTradesUniqueWallets as uw,
        metadata->preBuyCheckFactors->>platform as platform`)
      .eq('experiment_id', expId).eq('action', 'buy').in('status', ['executed', 'failed'])
      .order('created_at', { ascending: true }).limit(2000),
    client.from('trades')
      .select('token_address, token_symbol, trade_direction, input_amount, output_amount')
      .eq('experiment_id', expId).eq('success', true).eq('trade_direction', 'buy')
      .order('created_at', { ascending: true }).limit(3000),
    client.from('trades')
      .select('token_address, token_symbol, trade_direction, input_amount, output_amount')
      .eq('experiment_id', expId).eq('success', true).eq('trade_direction', 'sell')
      .order('created_at', { ascending: true }).limit(3000),
  ]);
  if (sigRes.error) throw new Error('signals: ' + sigRes.error.message);
  if (buyRes.error) throw new Error('trades.buy: ' + buyRes.error.message);
  if (sellRes.error) throw new Error('trades.sell: ' + sellRes.error.message);

  // 净额（BNB）：买腿 input_amount=BNB，卖腿 output_amount=BNB
  const net = new Map();
  for (const t of buyRes.data) {
    const cur = net.get(t.token_address) || { sym: t.token_symbol, buy: 0, sell: 0 };
    cur.buy += Number(t.input_amount) || 0; net.set(t.token_address, cur);
  }
  for (const t of sellRes.data) {
    const cur = net.get(t.token_address) || { sym: t.token_symbol, buy: 0, sell: 0 };
    cur.sell += Number(t.output_amount) || 0; net.set(t.token_address, cur);
  }
  for (const [k, v] of net) v.net = v.sell - v.buy;

  // executed 买票集合（多轮买算一次）+ 首 signal 因子
  const executed = new Map();
  for (const s of sigRes.data) {
    if (s.status !== 'executed') continue;
    if (!executed.has(s.token_address)) {
      executed.set(s.token_address, {
        sym: s.token_symbol, er: Number(s.er), lag: s.lag == null ? null : Number(s.lag),
        uw: s.uw == null ? null : Number(s.uw), platform: s.platform || '',
        reason: s.reason || '',
      });
    }
  }
  return { net, executed, sigCount: sigRes.data.length };
}

(async () => {
  const A = await load(R1), B = await load(R0);
  const total = exp => {
    let t = 0; for (const v of exp.net.values()) t += v.net; return t;
  };
  console.log(`\nR1 门臂（lag<300 OR er>=100）: ${A.executed.size} 买票 / 净 ${total(A).toFixed(4)} BNB / signals ${A.sigCount}`);
  console.log(`R0 基线:                       ${B.executed.size} 买票 / 净 ${total(B).toFixed(4)} BNB / signals ${B.sigCount}`);
  console.log(`门净效应（R1−R0）: ${(total(A) - total(B)).toFixed(4)} BNB\n`);

  // 门放行/拦截分桶（按 R0 票逐张对照）
  let passN = 0, passNet = 0, blockN = 0, blockNet = 0;
  const blocks = [];
  for (const [addr, info] of B.executed) {
    const n = B.net.get(addr)?.net ?? 0;
    if (A.executed.has(addr)) { passN++; passNet += n; }
    else { blockN++; blockNet += n; blocks.push({ addr, ...info, net: n }); }
  }
  console.log(`共同票: ${passN} 张 / 净 ${passNet.toFixed(4)} BNB`);
  console.log(`R1 拦掉: ${blockN} 张 / 净 ${blockNet.toFixed(4)} BNB${blockNet < 0 ? '（避亏）' : '（误拦）'}\n`);

  if (blocks.length) {
    console.log('被拦票（地址 | sym | lag | er | uw | 平台 | 盈亏BNB）:');
    blocks.sort((a, b) => a.net - b.net);
    for (const b of blocks) {
      console.log(`  ${b.addr} | ${b.sym || '?'} | lag=${b.lag ?? 'null'} er=${b.er?.toFixed?.(1) ?? '?'} uw=${b.uw ?? '?'} | ${b.platform || '?'} | ${b.net.toFixed(4)}`);
    }
  }
  // R1 独有票（理论上应为零——门只能拦不能放；非零 = 时序扰动，需人工看）
  const onlyA = [...A.executed.keys()].filter(a => !B.executed.has(a));
  if (onlyA.length) {
    console.log(`\n⚠️ R1 独有票 ${onlyA.length} 张（门只能拦不能放，非零=时序扰动）:`);
    for (const a of onlyA) {
      const info = A.executed.get(a);
      console.log(`  ${a} | ${info.sym} | lag=${info.lag ?? 'null'} er=${info.er?.toFixed?.(1) ?? '?'} | net=${(A.net.get(a)?.net ?? 0).toFixed(4)}`);
    }
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
