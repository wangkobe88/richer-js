#!/usr/bin/env node
// 一次性（182 跑）：D3.65 burst 波搜索段全窗化 对拍——
//   ①ba5e(M4GA 0xba5e…) 07:52:18 锚（v98 fe029df4 首 BUY 信号）：
//     D3.64 临近段口径 sbw=none/波键 0 → CD383 豁免结构性无法兑现；
//     D3.65 全窗化后期望：波两键收开盘六钱包波（~2.55B/6 户）、
//     sbw 题判 burst → 四腿（含 D3.66 出口价 exitVs≈+35.4≤40）→ 豁免达成 healthy。
//   ②ad80fb7a 反例（CD392 高位横盘票）：bt-v94 85cbad14 首信号锚——
//     期望出口价高位（间歇静默出口 +161.3>40）→ CD392 价格腿 fail-closed 豁免资格失。
// **D3.66/CD396（2026-11-10）判据源换锚 burstExitVsLaunchPct**：最后 ≥50s 静默段的
// 出口首可靠价 vs launch 地板 ≤+40——ba5e 出口 +35.4 放（不受 1000 行帽影响）、
// ad80 高位横盘出口 +161.3 拒、M4GA/CD383 原案 +2.9 放；旧键 startVs 纯观察留档。
// 全链真调 Jev（题集 D3.65 不变——D3.66 服务层 mapper-only）；--no-jev 只组装打锚数值不烧配额。
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const { buildSnapshotFromRows } = require_('../../src/market-analysis/cheat-snapshot.js');
const { buildCheatState } = require_('../../src/market-analysis/cheat-state-builder.js');
const { buildObservation } = require_('../../src/market-analysis/cheat-result-mapper.js');
const { gradeObservation, levelsFromObservation, CHEAT_GRADE_RULES_VERSION } = require_('../../src/market-analysis/cheat-grade.js');
const { CheatCheckService } = require_('../../src/market-analysis/CheatCheckService.js');
const sb = dbManager.getClient();

const NO_JEV = process.argv.includes('--no-jev');
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
// [tag, addr, 实验id（uuid 列不能 like，直接 eq 全值）, 期望]
const TARGETS = [
  ['ba5e', '0xba5ed45b42479e0a75316de7bf990ec90a3e4444', 'fe029df4-cd1f-490c-bfaf-f945feed287b', '豁免达成（全窗波证据→burst 资格臂在场→healthy）'],
  ['ad80', '0xad80fb7a03686a9a12952efa17312cf10e86ffff', '85cbad14-696f-49b2-baa4-a5407df4a2d2', '豁免资格失（D3.66 出口价高位>40 价格腿拒）'],
];

async function firstSignalAnchor(addr, expPrefix) {
  const { data, error } = await sb.from('strategy_signals')
    .select('created_at,experiment_id,metadata').eq('token_address', addr)
    .eq('experiment_id', expPrefix)
    .eq('signal_type', 'BUY').order('created_at', { ascending: true }).limit(5);
  if (error) throw new Error(`strategy_signals 查询失败: ${error.message}`);
  const hit = (data ?? [])[0];
  if (!hit) throw new Error(`${expPrefix.slice(0, 8)} 下未找到 ${addr.slice(0, 8)}… BUY 信号（宁停不冒充）`);
  return hit;
}

// 复刻生产 _pullTicksDb 形状（CheatCheckService line 1041）：tail pullLimit 行
//（链上真序倒序）=锚；满帽（==pullLimit）补 head headLimit 行保 launch 窗。
const PULL_LIMIT = 3000;
const HEAD_LIMIT = 300;
async function pullTicksToAnchor(token, anchorIso) {
  const { data: tailData, error: e1 } = await sb.from('wss_price_ticks')
    .select(TICK_COLS).eq('token_address', token)
    .lte('block_time', anchorIso)
    .order('block_number', { ascending: false })
    .order('log_index', { ascending: false })
    .limit(PULL_LIMIT);
  if (e1) throw new Error(`wss_price_ticks tail 查询失败: ${e1.message}`);
  const tailRows = tailData ?? [];
  if (!tailRows.length) throw new Error('锚截窗 0 行');
  if (tailRows.length < PULL_LIMIT) {
    const rows = tailRows.slice().reverse();
    return { rows, anchorTickCount: rows.length, capped: false };
  }
  const { data: headData, error: e2 } = await sb.from('wss_price_ticks')
    .select(TICK_COLS).eq('token_address', token)
    .lte('block_time', anchorIso)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(HEAD_LIMIT);
  if (e2) throw new Error(`wss_price_ticks head 查询失败: ${e2.message}`);
  const seen = new Set(tailRows.map((r) => `${r.block_number}:${r.log_index}`));
  const headOnly = (headData ?? []).filter((r) => !seen.has(`${r.block_number}:${r.log_index}`));
  const rows = headOnly.concat(tailRows.slice().reverse());
  return { rows, anchorTickCount: tailRows.length, capped: true };
}

async function loadTokenMeta(token) {
  const { data, error } = await sb.from('wss_events')
    .select('platform,payload,block_time')
    .eq('kind', 'token_create').eq('token_address', token)
    .order('id', { ascending: true }).limit(5);
  if (error) throw new Error(`wss_events 查询失败: ${error.message}`);
  const hit = (data ?? []).find((r) => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
  const p = hit ? hit.payload : {};
  const createdAt = p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null);
  return {
    address: token, symbol: p.symbol || null, name: p.name || null,
    platform: hit ? hit.platform : null, createdAt, creatorAddress: p.creator || null,
    createTxHash: p.txHash || p.tx_hash || null,
    totalSupply: p.totalSupply ?? ((hit && (hit.platform === 'flap' || hit.platform === 'gang')) ? 1e9 : null),
  };
}

function quoteTokenOf(rowsAsc) {
  for (let i = rowsAsc.length - 1; i >= 0; i--) if (rowsAsc[i].quote_token) return rowsAsc[i].quote_token;
  return null;
}

const f = (v, suf = '') => (v === null || v === undefined ? '-' : v + suf);

for (const [tag, addr, expPrefix, expect] of TARGETS) {
  console.log(`\n== ${tag} ${addr} ==\n期望：${expect}`);
  try {
    const sig = await firstSignalAnchor(addr, expPrefix);
    const prodCc = (sig.metadata && sig.metadata.cheatCheck) || {};
    console.log(`锚=实验 ${sig.experiment_id.slice(0, 8)} 首信号 ${sig.created_at.slice(5, 19)}（生产当时 grade=${prodCc.grade ?? '?'} sbw=${prodCc.levels ? prodCc.levels.stallBurstWave : '?'} 波=${prodCc.anchors ? prodCc.anchors.burstWaveBuyBnb : '?'}B/${prodCc.anchors ? prodCc.anchors.burstWaveWallets : '?'}户 startVs=${prodCc.anchors ? prodCc.anchors.burstWaveStartVsLaunchPct : '?'}）`);
    const pull = await pullTicksToAnchor(addr, sig.created_at);
    const rows = pull.rows;
    const meta = { ...await loadTokenMeta(addr), quoteToken: quoteTokenOf(rows) };
    const snapshot = buildSnapshotFromRows(rows, meta, { capped: pull.capped, anchorTickCount: pull.anchorTickCount });
    const { state, promptChars } = buildCheatState(snapshot);
    const d = snapshot.derived;
    console.log(`锚窗=${rows.length} 行${pull.capped ? `（满帽 capped anchorTickCount=${pull.anchorTickCount}）` : ''}（${rows[0].block_time.slice(5, 19)} → ${rows[rows.length - 1].block_time.slice(5, 19)}）| 买${d.buyN}/${d.totalBuyBnb.toFixed(2)}B 卖${d.sellN}/${d.totalSellBnb.toFixed(2)}B | state ${promptChars} chars`);
    console.log(`D3.65/D3.66 波五键：gap=${f(d.maxGapSec, 's')} 波买=${f(d.burstWaveBuyBnb, 'B')} 波户=${f(d.burstWaveWallets)} startVs(旧·观察)=${f(d.burstWaveStartVsLaunchPct, '%')} exitVs(D3.66 判据源)=${f(d.burstExitVsLaunchPct, '%')}`);

    if (NO_JEV) { console.log('--no-jev 未烧 Jev'); continue; }

    const { JevClient } = await import('../../src/narrative/analyzer/llm/JevClient.mjs');
    const q = await import('../../src/market-analysis/llm/cheat-questions.mjs');
    const res = await JevClient.ask(state, q.buildCheatQuestions(), { timeoutMs: 30000, label: `d365-${tag}` });
    const obs = buildObservation(res.answers, {
      sameBlockHoldPct: d.sameBlockHoldPct, equalBandHoldPct: d.equalBandHoldPct, bundleBuyPct: d.bundleBuyPct,
      washPairCount: d.washPairCount, washPairSellPct: d.washPairSellPct, washPairBuyPct: d.washPairBuyPct,
      top1HoldSupplyPct: d.top1HoldSupplyPct, top1HoldCircPct: d.top1HoldCircPct,
      top2HoldSupplyPct: d.top2HoldSupplyPct, top1Top2HoldSupplyPct: d.top1Top2HoldSupplyPct,
      top1Top2FirstBuyGapSec: d.top1Top2FirstBuyGapSec,
      posHolderCount: d.posHolderCount, top1Top2HoldCircPct: d.top1Top2HoldCircPct, top3HoldCircPct: d.top3HoldCircPct,
      clusterHoldSupplyPct: d.clusterHoldSupplyPct, t1PlusClusterSupplyPct: d.t1PlusClusterSupplyPct,
      burstMaxGapSec: d.maxGapSec, burstWaveBuyBnb: d.burstWaveBuyBnb, burstWaveWallets: d.burstWaveWallets,
      burstWaveStartVsLaunchPct: d.burstWaveStartVsLaunchPct,
      burstExitVsLaunchPct: d.burstExitVsLaunchPct,
      noBuySellPct: d.noBuySellPct, noBuySellVolumePct: d.noBuySellVolumePct, routerEntryBuyPct: d.routerEntryBuyPct,
      maxBlockBuyCount: d.maxBlockBuyCount, maxBlockBuyPct: d.maxBlockBuyPct,
      maxBlockPreGapSec: d.maxBlockPreGapSec, sameAmountWalletPct: d.sameAmountWalletPct,
      creatorPeakHoldSupplyPct: d.creatorPeakHoldSupplyPct,
      sameBlockHoldCircPct: d.sameBlockHoldCircPct, equalBandHoldCircPct: d.equalBandHoldCircPct,
      clusterRoundTripPct: d.clusterRoundTripPct, clusterRoundTripSellPct: d.clusterRoundTripSellPct,
      clusterRoundTripBlocks: d.clusterRoundTripBlocks,
      spikeBuyPctInBurst: d.spikeBuyPctInBurst, spikeHoldPctAll: d.spikeHoldPctAll,
      anchorBuySellRatio: d.anchorBuySellRatio,
      exactEqualBlockBuyPct: d.exactEqualBlockBuyPct, exactEqualBlockClusterCount: d.exactEqualBlockClusterCount,
      exactEqualBlockMaxWallets: d.exactEqualBlockMaxWallets,
      pumpStablePoints: d.pumpStablePoints, pumpStableSpanSec: d.pumpStableSpanSec, pumpStableR2: d.pumpStableR2,
      pumpStableSlopePctPerMin: d.pumpStableSlopePctPerMin, pumpRisePerBuyBnb: d.pumpRisePerBuyBnb,
      pumpSellTickCountPct: d.pumpSellTickCountPct,
      postStallSpanSec: d.postStallSpanSec, postStallBuyBnb: d.postStallBuyBnb,
      postStallBuyerCount: d.postStallBuyerCount, postStallFreshBuyerPct: d.postStallFreshBuyerPct,
      postStallEqualClusterPct: d.postStallEqualClusterPct, postStallMaxBlockBuyPct: d.postStallMaxBlockBuyPct,
    });
    let anchorSellCount = 0;
    for (const r of rows) if (r.trade_type !== 'buy') anchorSellCount++;
    const graded = gradeObservation(obs, {
      famousLevel: d.famousDominanceLevel ?? null,
      famousFollowerTop3Pct: d.famousFollowerTop3Pct ?? null,
      famousGroupBuyPct: d.famousGroupBuyPct ?? null,
      anchorSellCount,
    });
    const { levels, buckets, anchors } = levelsFromObservation(obs, {
      famousDominancePct: d.famousDominancePct ?? null,
      famousDominanceLevel: d.famousDominanceLevel ?? null,
    });
    const svc = new CheatCheckService({ enabled: true, gate: { activityExemptLevels: ['high', 'ultra'] } }, null, {});
    const burstEligible = svc._isStallBurstExempt(levels, anchors);
    const resObj = { grade: graded.grade, reasons: graded.reasons, version: graded.version, levels, buckets, anchors };
    const after = svc._applyActivityExempt(resObj);
    console.log(`sbw 桶=${f(buckets.stallBurstWave)}（levels=${f(levels.stallBurstWave)}） act=${f(buckets.activityLevel)} pump=${f(levels.slowGrindPump)} wash=${f(levels.washPair)}`);
    console.log(`levelsFromObservation 波五键：gap=${f(anchors.burstMaxGapSec, 's')} 波买=${f(anchors.burstWaveBuyBnb, 'B')} 波户=${f(anchors.burstWaveWallets)} startVs(旧)=${f(anchors.burstWaveStartVsLaunchPct, '%')} exitVs=${f(anchors.burstExitVsLaunchPct, '%')}`);
    console.log(`_isStallBurstExempt=${burstEligible} | grade 前=${graded.grade}(${(graded.reasons || []).map((x) => x.code).join('|') || 'clean'}) 后=${after.grade}${after.exempt ? ` exempt=${JSON.stringify(after.exempt)}` : ''}${after.exemptDenied ? ` denied=${after.exemptDenied}` : ''}`);
    console.log(burstEligible && after.grade === 'healthy' ? `✅ ${tag} 豁免资格臂在场` : (!burstEligible && graded.grade !== 'healthy' ? `✅ ${tag} 豁免资格失（原判保持 ${after.grade}）` : `⚠️ ${tag} 读数人工核对`));
  } catch (e) {
    console.error(`❌ ${tag} ${e.message}`);
  }
}
console.log(`\n（题集 ${'D3.65'} / 分级 ${CHEAT_GRADE_RULES_VERSION} / 全链真调 Jev）`);
process.exit(0);
