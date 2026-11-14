// 一次性（182 跑）：D3.41 新题面反例对拍——RAM（跨块长尾撞块正常盘）/MAI（0.1 档 62 钱包长尾）
// 锚：RAM 41=生产首析水位（tmp-ram-cluster-asof 同锚 block 131207966:410）+全窗；MAI=全窗
// （G11 裁定当时分析窗；两票无 cheat_detection 生产行——历史裁定走 tmp 脚本直算）。真调 Jev。
// D3.42/D3.43 复用：输出行加 pump= 档（pump 伪装散买修复的反例防线验证）。
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const { buildSnapshotFromRows } = require_('../../src/market-analysis/cheat-snapshot.js');
const { buildCheatState } = require_('../../src/market-analysis/cheat-state-builder.js');
const { buildObservation } = require_('../../src/market-analysis/cheat-result-mapper.js');
const { gradeObservation, CHEAT_GRADE_RULES_VERSION } = require_('../../src/market-analysis/cheat-grade.js');
const sb = dbManager.getClient();
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
const TOKENS = [
  ['RAM', '0xec74ec6b297fbe318ff09da24023319a36737777'],
  ['MAI', '0x732bd5190992ecb2365e080c2d3d37880cb17777'],
];
async function pullTicksToAnchor(token, n) {
  const { data, error } = await sb.from('wss_price_ticks').select(TICK_COLS).eq('token_address', token).order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(n);
  if (error) throw new Error(error.message);
  if ((data ?? []).length < n) throw new Error(`锚截窗不足：${n} vs ${(data ?? []).length}`);
  return data;
}
async function loadTokenMeta(token) {
  const { data } = await sb.from('wss_events').select('platform,payload,block_time').eq('kind', 'token_create').eq('token_address', token).order('id', { ascending: true }).limit(5);
  const hit = (data ?? []).find((r) => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
  const p = hit ? hit.payload : {};
  return { address: token, symbol: p.symbol || null, name: p.name || null, platform: hit ? hit.platform : null, createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null), creatorAddress: p.creator || null, totalSupply: p.totalSupply ?? ((hit && (hit.platform === 'flap' || hit.platform === 'gang')) ? 1e9 : null) };
}
function quoteTokenOf(rows) { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].quote_token) return rows[i].quote_token; return null; }
const { JevClient } = await import('../../src/narrative/analyzer/llm/JevClient.mjs');
const q = await import('../../src/market-analysis/llm/cheat-questions.mjs');
console.log(`题集 ${q.CHEAT_QUESTIONS_VERSION} / 分级 ${CHEAT_GRADE_RULES_VERSION}`);
const PLANS = [
  ['RAM', '0xec74ec6b297fbe318ff09da24023319a36737777', [41, 0]], // 0=全窗
  ['MAI', '0x732bd5190992ecb2365e080c2d3d37880cb17777', [0]],
];
for (const [tag, addr, anchorList] of PLANS) {
  console.log(`\n== ${tag} ${addr.slice(0, 8)}… ==`);
  for (const n of anchorList) {
    const rows = n > 0 ? await pullTicksToAnchor(addr, n) : (await sb.from('wss_price_ticks').select(TICK_COLS).eq('token_address', addr).order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(3000)).data ?? [];
    const meta = { ...await loadTokenMeta(addr), quoteToken: quoteTokenOf(rows) };
    const anchorN = n > 0 ? n : rows.length;
    const snap = buildSnapshotFromRows(rows, meta, { capped: false, anchorTickCount: anchorN });
    const { state } = buildCheatState(snap);
    const d = snap.derived;
    const f = (v, s = '') => (v === null || v === undefined ? '-' : v + s);
    console.log(`  [锚${anchorN}${n === 0 ? '(全窗)' : ''}] 簇流=${f(d.sameBlockHoldCircPct, '%')}/${f(d.equalBandHoldCircPct, '%')} 闭环=${f(d.clusterRoundTripPct, '%')}买/${f(d.clusterRoundTripSellPct, '%')}卖×${f(d.clusterRoundTripBlocks, '块')}`);
    const res = await JevClient.ask(state, q.buildCheatQuestions(), { timeoutMs: 30000, label: 'cheat-d341-ram-mai' });
    const interp = buildObservation(res.answers, { sameBlockHoldPct: d.sameBlockHoldPct, equalBandHoldPct: d.equalBandHoldPct, bundleBuyPct: d.bundleBuyPct, top1HoldSupplyPct: d.top1HoldSupplyPct, top1HoldCircPct: d.top1HoldCircPct, washPairCount: d.washPairCount, washPairSellPct: d.washPairSellPct, washPairBuyPct: d.washPairBuyPct, top2HoldSupplyPct: d.top2HoldSupplyPct, top1Top2HoldSupplyPct: d.top1Top2HoldSupplyPct, top1Top2FirstBuyGapSec: d.top1Top2FirstBuyGapSec, clusterHoldSupplyPct: d.clusterHoldSupplyPct, t1PlusClusterSupplyPct: d.t1PlusClusterSupplyPct, burstMaxGapSec: d.maxGapSec, burstWaveBuyBnb: d.burstWaveBuyBnb, burstWaveWallets: d.burstWaveWallets, noBuySellPct: d.noBuySellPct, maxBlockBuyCount: d.maxBlockBuyCount, maxBlockBuyPct: d.maxBlockBuyPct, maxBlockPreGapSec: d.maxBlockPreGapSec, sameAmountWalletPct: d.sameAmountWalletPct, creatorPeakHoldSupplyPct: d.creatorPeakHoldSupplyPct, sameBlockHoldCircPct: d.sameBlockHoldCircPct, equalBandHoldCircPct: d.equalBandHoldCircPct, clusterRoundTripPct: d.clusterRoundTripPct, clusterRoundTripSellPct: d.clusterRoundTripSellPct, clusterRoundTripBlocks: d.clusterRoundTripBlocks });
    const g = gradeObservation(interp, { famousLevel: d.famousDominanceLevel ?? null, famousFollowerTop3Pct: d.famousFollowerTop3Pct ?? null, famousGroupBuyPct: d.famousGroupBuyPct ?? null, anchorSellCount: d.sellN });
    const p = interp.phenomena || {}, lv = interp.extLevels || {};
    console.log(`  [锚${anchorN}] D3.41=${g.grade}(${(g.reasons || []).map((x) => x.code).join('|') || 'clean'}) | eq=${p.equal_amount_split} sb=${p.coordinated_sell_back} hold=${lv.holdings_balance ?? '-'} bw=${lv.same_block_buy_wave ?? '-'} tier=${lv.amount_tiering ?? '-'} pump=${lv.slow_grind_pump ?? '-'} act=${interp.activityLevel ? interp.activityLevel.bucket : '-'} dom=${interp.bundledDominance ? interp.bundledDominance.bucket : '-'}`);
  }
}
process.exit(0);
