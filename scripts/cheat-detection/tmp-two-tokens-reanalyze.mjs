#!/usr/bin/env node
// 一次性（182 跑）：两票当前代码（D3.35 题集+G12 分级）全链重析——非 digest 重放，真调 Jev。
// 锚=生产各阶段真析行 anchor_tick_count（防马后炮）。0x410c 取首析 24 + cheat 峰 324 两窗；
// 0x2254 单行 16。--no-jev 只组装打锚数值不烧 Jev。
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const { buildSnapshotFromRows } = require_('../../src/market-analysis/cheat-snapshot.js');
const { buildCheatState } = require_('../../src/market-analysis/cheat-state-builder.js');
const { buildObservation } = require_('../../src/market-analysis/cheat-result-mapper.js');
const { gradeObservation, CHEAT_GRADE_RULES_VERSION } = require_('../../src/market-analysis/cheat-grade.js');
const sb = dbManager.getClient();

const NO_JEV = process.argv.includes('--no-jev');
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
const TARGETS = [
  ['0x410c', '0x410cfeff144f969e2484c75ccc9a6db5a8907777', 24, '首析 unhealthy(F+G)'],
  ['0x410c', '0x410cfeff144f969e2484c75ccc9a6db5a8907777', 324, 'cheat 峰 A+F+G'],
  ['0x2254', '0x22541549c86f7d1721eff01ec063e527786b7777', 16, '单行首析即 cheat'],
];

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
for (const [tag, addr, anchorN, prodLabel] of TARGETS) {
  console.log(`\n== ${tag} ${addr.slice(0, 10)}… 锚=${anchorN}（生产该窗 ${prodLabel}）==`);
  try {
    const rows = await pullTicksToAnchor(addr, anchorN);
    const meta = { ...await loadTokenMeta(addr), quoteToken: quoteTokenOf(rows) };
    console.log(`  meta: symbol=${meta.symbol} platform=${meta.platform} creator=${(meta.creatorAddress || '?').slice(0, 10)}`);
    const snapshot = buildSnapshotFromRows(rows, meta, { capped: false, anchorTickCount: anchorN });
    const { state, promptChars } = buildCheatState(snapshot);
    const d = snapshot.derived;
    console.log(`  买${d.buyN}/${d.totalBuyBnb.toFixed(2)} 卖${d.sellN}/${d.totalSellBnb.toFixed(2)} 钱包${d.walletCount} | state ${promptChars} chars`);
    const f = (v, suf = '') => (v === null || v === undefined ? '-' : v + suf);
    console.log(`  锚值：同块簇持=${f(d.sameBlockHoldPct, '%')} 近等额=${f(d.equalBandHoldPct, '%')} 簇买=${f(d.bundleBuyPct, '%')} | top1流=${f(d.top1HoldCircPct, '%')} | famous=${f(d.famousDominanceLevel)}(${f(d.famousDominancePct, '%')}) 跟单=${f(d.famousFollowerPct, '%')} top3=${f(d.famousFollowerTop3Pct, '%')}`);
    console.log(`  D3.35 参考四键：最大单块买=${f(d.maxBlockBuyCount, '笔')}/${f(d.maxBlockBuyPct, '%')} preGap=${f(d.maxBlockPreGapSec, 's')} 同档金额钱包=${f(d.sameAmountWalletPct, '%')} 创建者峰值供=${f(d.creatorPeakHoldSupplyPct, '%')}`);
    if (NO_JEV) { console.log('  --no-jev 未烧 Jev'); continue; }
    const { JevClient } = await import('../../src/narrative/analyzer/llm/JevClient.mjs');
    const q = await import('../../src/market-analysis/llm/cheat-questions.mjs');
    const res = await JevClient.ask(state, q.buildCheatQuestions(), { timeoutMs: 30000, label: 'cheat-two-tokens' });
    const interp = buildObservation(res.answers, {
      sameBlockHoldPct: d.sameBlockHoldPct, equalBandHoldPct: d.equalBandHoldPct, bundleBuyPct: d.bundleBuyPct,
      top1HoldSupplyPct: d.top1HoldSupplyPct, top1HoldCircPct: d.top1HoldCircPct,
      washPairCount: d.washPairCount, washPairSellPct: d.washPairSellPct, washPairBuyPct: d.washPairBuyPct,
      top2HoldSupplyPct: d.top2HoldSupplyPct, top1Top2HoldSupplyPct: d.top1Top2HoldSupplyPct,
      top1Top2FirstBuyGapSec: d.top1Top2FirstBuyGapSec, clusterHoldSupplyPct: d.clusterHoldSupplyPct,
      t1PlusClusterSupplyPct: d.t1PlusClusterSupplyPct, burstMaxGapSec: d.maxGapSec,
      burstWaveBuyBnb: d.burstWaveBuyBnb, burstWaveWallets: d.burstWaveWallets, noBuySellPct: d.noBuySellPct,
      maxBlockBuyCount: d.maxBlockBuyCount, maxBlockBuyPct: d.maxBlockBuyPct,
      maxBlockPreGapSec: d.maxBlockPreGapSec, sameAmountWalletPct: d.sameAmountWalletPct,
      creatorPeakHoldSupplyPct: d.creatorPeakHoldSupplyPct,
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
      tag, anchorN, prodLabel,
      now: `${graded.grade}(${(graded.reasons || []).map((x) => x.code).join('|') || 'clean'})`,
      eq: p.equal_amount_split, sb: p.coordinated_sell_back, cr: p.creator_front_run, sd: p.sell_dispersion,
      wash: lv.wash_pair ?? null, holdings: lv.holdings_balance ?? null, pump: lv.slow_grind_pump ?? null,
      insider: lv.insider_supply_sell ?? null, bw: lv.same_block_buy_wave ?? null, tier: lv.amount_tiering ?? null,
      part: interp.participation ? interp.participation.bucket : null,
      act: interp.activityLevel ? interp.activityLevel.bucket : null,
      dom: interp.bundledDominance ? interp.bundledDominance.bucket : null,
    });
  } catch (e) {
    console.error(`  ❌ ${e.message}`);
    out.push({ tag, anchorN, prodLabel, err: e.message });
  }
}
console.log(`\n== 汇总（题集 D3.35 / 分级 ${CHEAT_GRADE_RULES_VERSION} / 全链真调 Jev / 生产对照=G8 旧规则行）==`);
for (const r of out) {
  if (r.err) { console.log(`${r.tag} 锚${r.anchorN} ❌ ${r.err}`); continue; }
  console.log(`${r.tag} 锚${String(r.anchorN).padEnd(4)} 生产=${r.prodLabel.padEnd(20)} 当前=${r.now} | eq=${r.eq} sb=${r.sb} cr=${r.cr} sd=${r.sd} wash=${r.wash} hold=${r.holdings} pump=${r.pump} insider=${r.insider} bw=${r.bw} part=${r.part} act=${r.act} dom=${r.dom}`);
}
process.exit(0);
