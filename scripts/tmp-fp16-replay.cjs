#!/usr/bin/env node
// FP16 端到端回放：真实 ticks 在买入锚时刻跑 buildBuyPointSnapshot + evaluateFactorPreBuy
// 目标=验证 28ad（restart 正票）与本案瓦尔哈（拦截面）在 FP16 下的判定
const { dbManager } = require('../src/services/dbManager');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot');
const { evaluateFactorPreBuy } = require('../src/market-analysis/factor-pre-buy-check');

const CASES = [
  { name: '本案瓦尔哈(拦截面)', tok: '0x5fb747c626da99bf83b01ac367832de3fb3e7777', platform: 'flap', anchor: '2026-10-12T08:04:43+00:00' },
];

async function sigsFor(sb, tok) {
  const { data, error } = await sb.from('strategy_signals')
    .select('experiment_id,created_at,signal_type')
    .eq('token_address', tok)
    .eq('signal_type', 'BUY')
    .eq('executed', true)
    .order('created_at', { ascending: true }).limit(30);
  if (error) throw new Error(error.message);
  return data || [];
}

async function replay(sb, name, tok, platform, anchorIso) {
  const anchorMs = new Date(anchorIso).getTime();
  const { data: rows, error } = await sb.from('wss_price_ticks')
    .select('block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token')
    .eq('token_address', tok)
    .lte('block_time', anchorIso)
    .order('block_time', { ascending: false }).limit(3000);
  if (error) throw new Error(error.message);
  const ordered = [...(rows || [])].reverse();
  // createdAt from wss_events token_create
  const { data: ev } = await sb.from('wss_events')
    .select('block_time,payload').eq('token_address', tok).eq('kind', 'token_create').limit(1);
  const createdAt = ev && ev[0] ? ev[0].block_time : null;
  const meta = { platform, totalSupply: platform === 'flap' ? 1e9 : 1e9, createdAt, creatorAddress: null };
  const snap = buildBuyPointSnapshot(ordered, meta, { capped: ordered.length >= 3000, anchorTickCount: ordered.length, signalInfo: null });
  const v = evaluateFactorPreBuy(snap);
  const bd = snap.buyDerived || {}, cd = snap.cheatDerived || {};
  console.log(`\n=== ${name} ${tok.slice(0, 10)}… 锚=${anchorIso}`);
  console.log(`  rows=${ordered.length} ath=${bd.athVsLaunchPct}% 总额=${bd.totalVolumeBnb}B minVsFloor=${bd.launchMinVsFloorPct}%`);
  console.log(`  burst: lastGap=${cd.burstLastGapSec}s sinceWaveEnd=${cd.burstSecSinceWaveEnd}s 波买=${cd.burstWaveSegBuyBnb}B 波卖占=${cd.burstWaveSegSellPct}%`);
  const g = (v.gates || []).find((x) => x.id === 'lifecycle_burst');
  console.log(`  FP16 gate: ${g ? `${g.hit ? '🚫HIT' : '放行'} | ${g.value}` : '(无)'}`);
  console.log(`  判定: pass=${v.pass} reason=${v.reason} arms=${JSON.stringify(v.arms).slice(0, 200)}`);
}

async function main() {
  const sb = dbManager.getClient();
  for (const c of CASES) await replay(sb, c.name, c.tok, c.platform, c.anchor);
  // 28ad：executed 信号全锚回放
  const s28 = await sigsFor(sb, '0x28ad2c7d08d83a85467bd4afcfd673dfce564444');
  console.log(`\n28ad executed BUY 信号 ${s28.length} 条（按实验分布）`);
  const byExp = {};
  for (const s of s28) byExp[s.experiment_id] = (byExp[s.experiment_id] || 0) + 1;
  console.log(JSON.stringify(byExp));
  // 全锚逐条回放（28ad 信号量大时抽前 8）
  const pick = s28.slice(0, 8);
  for (const s of pick) await replay(sb, `28ad#${s.created_at}`, '0x28ad2c7d08d83a85467bd4afcfd673dfce564444', 'fourmeme', s.created_at);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
