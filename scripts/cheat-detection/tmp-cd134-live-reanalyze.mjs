#!/usr/bin/env node
// 一次性（182 跑）：五张现场票当前代码（D3.34 题集+G11 分级）全链重析——非 digest
// 重放，真调 Jev。锚=每票 cheat_detection 末次真析行 anchor_tick_count（防马后炮，
// 对齐生产最后一次判定的证据窗）。CD134 触发（用户「跑一下我报的 case 当前的结果，
// 不是老数据」）。--dry 只组装不烧 Jev。
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const { buildSnapshotFromRows } = require_('../../src/market-analysis/cheat-snapshot.js');
const { buildCheatState } = require_('../../src/market-analysis/cheat-state-builder.js');
const { buildObservation } = require_('../../src/market-analysis/cheat-result-mapper.js');
const { gradeObservation, CHEAT_GRADE_RULES_VERSION } = require_('../../src/market-analysis/cheat-grade.js');
const sb = dbManager.getClient();

const DRY = process.argv.includes('--dry');
// --no-jev=只组装打 derived 锚数值（确定性，不烧 Jev）
const NO_JEV = process.argv.includes('--no-jev');
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
const ADDRS = [
  ['MAI', '0x732bd5190992ecb2365e080c2d3d37880cb17777'],
  ['RAM', '0xec74ec6b297fbe318ff09da24023319a36737777'],
  ['眉眉', '0x5a3f19b5bd587c4a127096ff37f6c9d59f007777'],
  ['에코', '0x43705ac9eb429777f3d993d854a29bcd61837777'],
  ['猴子币', '0xd827bc26713cb6412f4d163766938dee3d0c7777'],
];

async function lastAnalysisRow(addr) {
  const { data, error } = await sb.from('cheat_detection')
    .select('analyzed_at,anchor_tick_count,snapshot_digest')
    .eq('token_address', addr)
    .order('analyzed_at', { ascending: true })
    .limit(50);
  if (error) throw new Error(`cheat_detection 查询失败: ${error.message}`);
  const rows = (data ?? []).filter((r) => r.snapshot_digest && r.snapshot_digest.grade);
  if (!rows.length) throw new Error('无带 grade 真析行');
  return rows[rows.length - 1];
}

async function pullTicksToAnchor(token, n) {
  const { data, error } = await sb.from('wss_price_ticks')
    .select(TICK_COLS).eq('token_address', token)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(n);
  if (error) throw new Error(`wss_price_ticks 查询失败: ${error.message}`);
  const rows = data ?? [];
  if (rows.length < n) throw new Error(`锚截窗不足：锚=${n} 实际=${rows.length}（宁停不冒充）`);
  return rows;
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

const out = [];
for (const [name, addr] of ADDRS) {
  const last = await lastAnalysisRow(addr);
  const anchorN = last.anchor_tick_count;
  const prodGrade = last.snapshot_digest.grade;
  const prodReasons = (last.snapshot_digest.gradeReasons || []).map((x) => x.code).join('|');
  console.log(`\n== ${name} ${addr.slice(0, 8)}… 锚=${anchorN}（生产末行 ${prodGrade}@${last.analyzed_at} ${prodReasons}）==`);
  try {
    const rows = await pullTicksToAnchor(addr, anchorN);
    const meta = { ...await loadTokenMeta(addr), quoteToken: quoteTokenOf(rows) };
    const snapshot = buildSnapshotFromRows(rows, meta, { capped: false, anchorTickCount: anchorN });
    const { state, promptChars } = buildCheatState(snapshot);
    const d = snapshot.derived;
    console.log(`  买${d.buyN}/${d.totalBuyBnb.toFixed(2)} 卖${d.sellN}/${d.totalSellBnb.toFixed(2)} 钱包${d.walletCount} | state ${promptChars} chars`);
    if (NO_JEV) {
      const f = (v, suf = '') => (v === null || v === undefined ? '-' : v + suf);
      console.log(`  锚值：同块簇持仓=${f(d.sameBlockHoldPct, '%')} 近等额簇持仓=${f(d.equalBandHoldPct, '%')} 簇买入=${f(d.bundleBuyPct, '%')} | top1供/流=${f(d.top1HoldSupplyPct, '%')}/${f(d.top1HoldCircPct, '%')} t2=${f(d.top2HoldSupplyPct, '%')} Σ2=${f(d.top1Top2HoldSupplyPct, '%')} ∪簇=${f(d.t1PlusClusterSupplyPct, '%')} Δ前二首买=${f(d.top1Top2FirstBuyGapSec, 's')} | 纯卖=${f(d.noBuySellPct, '%')} wash=${f(d.washPairCount, '对')}/卖占${f(d.washPairSellPct, '%')} | famous=${f(d.famousDominanceLevel)}(${f(d.famousDominancePct, '%')}) top3=${f(d.famousFollowerTop3Pct, '%')} 集团买=${f(d.famousGroupBuyPct, '%')} | 波买=${f(d.burstWaveBuyBnb)} ${f(d.burstWaveWallets, '户')} gap=${f(d.maxGapSec, 's')} | 同块簇=${(d.sameBlockClusters ?? []).length} 等额簇=${(d.equalClusters ?? []).length}`);
      continue;
    }
    if (DRY) { console.log('  --dry 未烧 Jev'); continue; }
    const { JevClient } = await import('../../src/narrative/analyzer/llm/JevClient.mjs');
    const q = await import('../../src/market-analysis/llm/cheat-questions.mjs');
    const res = await JevClient.ask(state, q.buildCheatQuestions(), { timeoutMs: 30000, label: 'cheat-cd134-live' });
    const interp = buildObservation(res.answers, {
      sameBlockHoldPct: d.sameBlockHoldPct, equalBandHoldPct: d.equalBandHoldPct, bundleBuyPct: d.bundleBuyPct,
      top1HoldSupplyPct: d.top1HoldSupplyPct, top1HoldCircPct: d.top1HoldCircPct,
      washPairCount: d.washPairCount, washPairSellPct: d.washPairSellPct, washPairBuyPct: d.washPairBuyPct,
      top2HoldSupplyPct: d.top2HoldSupplyPct, top1Top2HoldSupplyPct: d.top1Top2HoldSupplyPct,
      top1Top2FirstBuyGapSec: d.top1Top2FirstBuyGapSec, clusterHoldSupplyPct: d.clusterHoldSupplyPct,
      t1PlusClusterSupplyPct: d.t1PlusClusterSupplyPct, burstMaxGapSec: d.maxGapSec,
      burstWaveBuyBnb: d.burstWaveBuyBnb, burstWaveWallets: d.burstWaveWallets, noBuySellPct: d.noBuySellPct,
    });
    const graded = gradeObservation(interp, {
      famousLevel: d.famousDominanceLevel ?? null,
      famousFollowerTop3Pct: d.famousFollowerTop3Pct ?? null,
      famousGroupBuyPct: d.famousGroupBuyPct ?? null,
      anchorSellCount: d.sellN,
    });
    const lv = interp.extLevels || {};
    const p = interp.phenomena || {};
    out.push({
      名称: name, 锚笔数: anchorN,
      生产末行: `${prodGrade}(${prodReasons})`,
      当前重析: `${graded.grade}(${(graded.reasons || []).map((x) => x.code).join('|') || 'clean'})`,
      eq: p.equal_amount_split, sb: p.coordinated_sell_back, cr: p.creator_front_run, sd: p.sell_dispersion,
      wash: lv.wash_pair ?? null, holdings: lv.holdings_balance ?? null, pump: lv.slow_grind_pump ?? null,
      insider: lv.insider_supply_sell ?? null, bw: lv.same_block_buy_wave ?? null, tier: lv.amount_tiering ?? null,
      act: interp.activityLevel ? interp.activityLevel.bucket : null,
      dom: interp.bundledDominance ? interp.bundledDominance.bucket : null,
    });
  } catch (e) {
    console.error(`  ❌ ${e.message}`);
    out.push({ 名称: name, 锚笔数: anchorN, 错误: e.message });
  }
}
console.log(`\n== 汇总（题集 D3.34 / 分级 ${CHEAT_GRADE_RULES_VERSION} / 全链真调 Jev）==`);
for (const r of out) {
  if (r.错误) { console.log(`${r.名称} ❌ ${r.错误}`); continue; }
  console.log(`${r.名称.padEnd(6)} 锚${String(r.锚笔数).padEnd(5)} 生产=${r.生产末行.padEnd(46)} 当前=${r.当前重析} | eq=${r.eq} sb=${r.sb} sd=${r.sd} cr=${r.cr} wash=${r.wash} hold=${r.holdings} pump=${r.pump} insider=${r.insider} bw=${r.bw} act=${r.act} dom=${r.dom}`);
}
process.exit(0);
