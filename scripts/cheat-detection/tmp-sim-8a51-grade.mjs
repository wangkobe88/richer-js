#!/usr/bin/env node
/**
 * 模拟实验 cheat 门后处理(182 跑):对 sim 实验全部成功买入 token,
 * 锚=首笔成功买 created_at + settle 4s,真调 Jev → grade 三态 → 门动作映射。
 * 与 run.mjs --experiment 同源组装链,但不写 fixtures(纯分析)。
 * 用法: node scripts/cheat-detection/tmp-sim-8a51-grade.mjs <simExpId> [对照组源expId]
 */
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { writeFileSync } from 'fs';
import { createRequire } from 'module';
import { interpret, anchorCountAt } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIM = process.argv[2];
const CTRL = process.argv[3] || null;
const SETTLE_MS = 4000;
const PULL_LIMIT = 3000;

const require_ = createRequire(import.meta.url);
const { buildSnapshotFromRows } = require_('../../src/market-analysis/cheat-snapshot.js');
const { gradeObservation, CHEAT_GRADE_RULES_VERSION } = require_('../../src/market-analysis/cheat-grade.js');
const { buildCheatState } = require_('../../src/market-analysis/cheat-state-builder.js');
const { buildObservation } = require_('../../src/market-analysis/cheat-result-mapper.js');
const { buildCheatQuestions, CHEAT_QUESTIONS_VERSION } = await import('../../src/market-analysis/llm/cheat-questions.mjs');
const { JevClient } = await import('../../src/narrative/analyzer/llm/JevClient.mjs');

const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';

function sb() {
  const { dbManager } = require_('../../src/services/dbManager.js');
  return dbManager.getClient();
}

async function fetchFirstBuys(experimentId) {
  const { data, error } = await sb().from('trades')
    .select('token_address,token_symbol,created_at')
    .eq('experiment_id', experimentId)
    .eq('trade_direction', 'buy')
    .eq('success', true)
    .order('created_at', { ascending: true })
    .limit(1000);
  if (error) throw new Error(`trades 查询失败: ${error.message}`);
  const byToken = new Map();
  for (const r of data ?? []) {
    const addr = String(r.token_address || '').toLowerCase();
    if (!addr || !r.created_at) continue;
    if (!byToken.has(addr)) byToken.set(addr, { addr, symbol: r.token_symbol || '?', firstBuyAt: r.created_at });
  }
  return [...byToken.values()];
}

async function pullFull(token) {
  const { data, error } = await sb().from('wss_price_ticks')
    .select(TICK_COLS)
    .eq('token_address', token)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(PULL_LIMIT + 1);
  if (error) throw new Error(`wss_price_ticks 查询失败: ${error.message}`);
  const rows = data ?? [];
  const capped = rows.length > PULL_LIMIT;
  return { rows: capped ? rows.slice(0, PULL_LIMIT) : rows, capped };
}

async function loadTokenMeta(token) {
  const { data, error } = await sb().from('wss_events')
    .select('platform,payload,block_time')
    .eq('kind', 'token_create')
    .eq('token_address', token)
    .order('id', { ascending: true })
    .limit(5);
  if (error) throw new Error(`wss_events 查询失败: ${error.message}`);
  const hit = (data ?? []).find((r) => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
  const p = hit ? hit.payload : {};
  return {
    address: token, symbol: p.symbol || null, name: p.name || null, platform: hit ? hit.platform : null,
    createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null),
    creatorAddress: p.creator || null, createTxHash: p.txHash || p.tx_hash || null,
    totalSupply: p.totalSupply ?? ((hit && (hit.platform === 'flap' || hit.platform === 'gang')) ? 1e9 : null),
  };
}

function quoteTokenOf(rowsAsc) {
  for (let i = rowsAsc.length - 1; i >= 0; i--) {
    const q = rowsAsc[i].quote_token;
    if (q) return q;
  }
  return null;
}

const obsAnchors = (d) => ({
  sameBlockHoldPct: d.sameBlockHoldPct, equalBandHoldPct: d.equalBandHoldPct, bundleBuyPct: d.bundleBuyPct,
  top1HoldSupplyPct: d.top1HoldSupplyPct, top1HoldCircPct: d.top1HoldCircPct,
  washPairCount: d.washPairCount, washPairSellPct: d.washPairSellPct, washPairBuyPct: d.washPairBuyPct,
  top2HoldSupplyPct: d.top2HoldSupplyPct, top1Top2HoldSupplyPct: d.top1Top2HoldSupplyPct,
  top1Top2FirstBuyGapSec: d.top1Top2FirstBuyGapSec, clusterHoldSupplyPct: d.clusterHoldSupplyPct,
  t1PlusClusterSupplyPct: d.t1PlusClusterSupplyPct,
  burstMaxGapSec: d.maxGapSec, burstWaveBuyBnb: d.burstWaveBuyBnb, burstWaveWallets: d.burstWaveWallets,
  noBuySellPct: d.noBuySellPct, maxBlockBuyCount: d.maxBlockBuyCount, maxBlockBuyPct: d.maxBlockBuyPct,
  maxBlockPreGapSec: d.maxBlockPreGapSec, sameAmountWalletPct: d.sameAmountWalletPct,
  creatorPeakHoldSupplyPct: d.creatorPeakHoldSupplyPct, sameBlockHoldCircPct: d.sameBlockHoldCircPct,
  equalBandHoldCircPct: d.equalBandHoldCircPct, clusterRoundTripPct: d.clusterRoundTripPct,
  clusterRoundTripSellPct: d.clusterRoundTripSellPct, clusterRoundTripBlocks: d.clusterRoundTripBlocks,
  spikeBuyPctInBurst: d.spikeBuyPctInBurst, spikeHoldPctAll: d.spikeHoldPctAll, anchorBuySellRatio: d.anchorBuySellRatio,
});

async function gradeOne(t) {
  const { rows, capped } = await pullFull(t.addr);
  if (!rows.length) return { addr: t.addr, symbol: t.symbol, note: 'no-ticks', action: 'pass(fail-open)' };
  const anchorAt = new Date(Date.parse(t.firstBuyAt) + SETTLE_MS).toISOString();
  const rawAnchor = anchorCountAt(rows, anchorAt);
  if (rawAnchor < 1) return { addr: t.addr, symbol: t.symbol, note: 'anchor=0', action: 'pass(fail-open)' };
  const anchorN = Math.min(rawAnchor, PULL_LIMIT);
  const window = rows.slice(0, anchorN);
  const meta = { ...await loadTokenMeta(t.addr), quoteToken: quoteTokenOf(window) };
  const snapshot = buildSnapshotFromRows(window, meta, { capped: capped && rawAnchor > PULL_LIMIT, anchorTickCount: anchorN });
  const d = snapshot.derived;
  if (window.length < 8) return { addr: t.addr, symbol: t.symbol, anchorN, note: 'minTicks<8', action: 'pass(无判定)' };
  const { state } = buildCheatState(snapshot);
  const res = await JevClient.ask(state, buildCheatQuestions(), { timeoutMs: 30000, label: 'sim-cheat-gate' });
  const interp = interpret(buildObservation(res.answers, obsAnchors(d)));
  const graded = gradeObservation(interp, {
    famousLevel: d.famousDominanceLevel ?? null,
    famousFollowerTop3Pct: d.famousFollowerTop3Pct ?? null,
    famousGroupBuyPct: d.famousGroupBuyPct ?? null,
    anchorSellCount: d.sellN,
  });
  const action = graded.grade === 'cheat' ? 'REJECT(拉黑)' : graded.grade === 'unhealthy' ? 'REJECT' : 'pass';
  return {
    addr: t.addr, symbol: t.symbol, platform: meta.platform, firstBuyAt: t.firstBuyAt, anchorN,
    grade: graded.grade, reasons: graded.reasons.map((x) => x.code), action,
    act: interp.activityLevel?.bucket ?? null, sbw: interp.extLevels?.stall_burst_wave ?? null,
    spike: interp.extLevels?.burst_spike_concentration ?? null,
    hold: interp.extLevels?.holdings_balance ?? null, wash: interp.extLevels?.wash_pair ?? null,
    sbHold: d.sameBlockHoldPct ?? null, noBuySell: d.noBuySellPct ?? null,
  };
}

(async () => {
  if (!SIM) { console.error('用法: tmp-sim-8a51-grade.mjs <simExpId> [ctrlExpId]'); process.exit(2); }
  const out = { ranAt: new Date().toISOString(), sim: SIM, ctrl: CTRL, questionVersion: CHEAT_QUESTIONS_VERSION, rulesVersion: CHEAT_GRADE_RULES_VERSION, simResults: [], ctrlResults: [] };
  const simTargets = await fetchFirstBuys(SIM);
  console.log(`SIM ${SIM}: ${simTargets.length} 票成功买入;锚=首买+${SETTLE_MS}ms;题集 ${CHEAT_QUESTIONS_VERSION}\n`);
  for (let i = 0; i < simTargets.length; i++) {
    const t = simTargets[i];
    try {
      const r = await gradeOne(t);
      out.simResults.push(r);
      console.log(`[${i + 1}/${simTargets.length}] ${(r.symbol || '?').slice(0, 14).padEnd(14)} ${r.addr.slice(0, 10)}… 锚=${r.anchorN ?? '-'} → grade=${r.grade ?? '-'} ${r.action} ${r.note ? `(${r.note})` : `act=${r.act} sbw=${r.sbw} spike=${r.spike} hold=${r.hold} wash=${r.wash} sbHold=${r.sbHold}% 纯卖=${r.noBuySell}%`}`);
    } catch (e) {
      out.simResults.push({ addr: t.addr, symbol: t.symbol, error: e.message, action: 'pass(fail-open)' });
      console.log(`[${i + 1}/${simTargets.length}] ${(t.symbol || '?').slice(0, 14).padEnd(14)} ❌ ${e.message} → pass(fail-open)`);
    }
  }
  if (CTRL) {
    const ctrlTargets = await fetchFirstBuys(CTRL);
    console.log(`\nCTRL ${CTRL}(实际实验): ${ctrlTargets.length} 票成功买入`);
    for (const t of ctrlTargets) {
      try {
        const r = await gradeOne(t);
        out.ctrlResults.push(r);
        console.log(`CTRL ${(r.symbol || '?').slice(0, 14).padEnd(14)} ${r.addr.slice(0, 10)}… → grade=${r.grade ?? '-'} ${r.action} ${r.note ? `(${r.note})` : ''}`);
      } catch (e) {
        out.ctrlResults.push({ addr: t.addr, symbol: t.symbol, error: e.message });
        console.log(`CTRL ${(t.symbol || '?').slice(0, 14)} ❌ ${e.message}`);
      }
    }
  }
  const archPath = resolve(HERE, 'data', `sim-gate-${SIM.slice(0, 8)}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(archPath, JSON.stringify(out, null, 2), 'utf8');
  const dist = {};
  for (const r of out.simResults) { const k = r.grade ?? (r.error ? 'error' : r.note ?? '?'); dist[k] = (dist[k] || 0) + 1; }
  console.log('\ngrade 分布:', JSON.stringify(dist), '\n存档:', archPath);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
