// btv140 BP-T006 食蟹猴二 0x387c9be8…7777 D3.72/G19 单票重判（182 跑零 DB，REPEAT 3）
// 验证：slow_grind_pump 合力反锚第二通道（28 买家/7.35 BNB/min/散布）→ 不再 strong；
// holdings_balance 已删题；剩余 D_famous_dominance 的豁免走向如实呈报
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildSnapshotFromRows } = require_('../../src/market-analysis/cheat-snapshot.js');
const { buildCheatState } = require_('../../src/market-analysis/cheat-state-builder.js');
const { buildObservation } = require_('../../src/market-analysis/cheat-result-mapper.js');
const { gradeObservation, CHEAT_GRADE_RULES_VERSION } = require_('../../src/market-analysis/cheat-grade.js');

const OBS_ANCHOR_KEYS = [
  'sameBlockHoldPct', 'equalBandHoldPct', 'bundleBuyPct', 'top1HoldSupplyPct', 'top1HoldCircPct',
  'washPairCount', 'washPairSellPct', 'washPairBuyPct',
  'top2HoldSupplyPct', 'top1Top2HoldSupplyPct', 'top1Top2FirstBuyGapSec', 'clusterHoldSupplyPct', 't1PlusClusterSupplyPct',
  'posHolderCount', 'top1Top2HoldCircPct', 'top3HoldCircPct',
  ['burstMaxGapSec', 'maxGapSec'],
  'burstWaveBuyBnb', 'burstWaveWallets', 'noBuySellPct',
  'maxBlockBuyCount', 'maxBlockBuyPct', 'maxBlockPreGapSec', 'sameAmountWalletPct',
  'creatorPeakHoldSupplyPct', 'sameBlockHoldCircPct', 'equalBandHoldCircPct',
  'clusterRoundTripPct', 'clusterRoundTripSellPct', 'clusterRoundTripBlocks',
  'spikeBuyPctInBurst', 'spikeHoldPctAll', 'anchorBuySellRatio',
  'noBuySellVolumePct',
  'exactEqualBlockBuyPct', 'exactEqualBlockClusterCount', 'exactEqualBlockMaxWallets',
  'pulseBlockCount', 'pulseBlockBuyPct', 'pulseMaxGapBlocks',
  'pumpStablePoints', 'pumpStableSpanSec', 'pumpStableR2', 'pumpStableSlopePctPerMin', 'pumpRisePerBuyBnb', 'pumpSellTickCountPct',
  'postStallSpanSec', 'postStallBuyBnb', 'postStallBuyerCount', 'postStallFreshBuyerPct', 'postStallEqualClusterPct', 'postStallMaxBlockBuyPct',
  'routerEntryBuyPct',
];
const obsAnchors = (d) => {
  const out = {};
  for (const k of OBS_ANCHOR_KEYS) {
    if (Array.isArray(k)) out[k[0]] = d[k[1]] ?? null;
    else out[k] = d[k] ?? null;
  }
  return out;
};

const ADDR = '0x387c9be80266a818539660e7ba8093dcc3617777';
const set = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades.json'), 'utf8'));
const p = set.points.find((x) => x.tokenAddress === ADDR);
const allRows = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades-ticks', p.ticksFile), 'utf8')).rows || [];
const anchorN = p.anchorTickCount;
const winRows = allRows.slice(0, anchorN);
const meta = { ...(set.tokens[ADDR] || { address: ADDR }), quoteToken: p.quoteToken || null };
const snapshot = buildSnapshotFromRows(winRows, meta, { capped: false, anchorTickCount: anchorN });
const { state } = buildCheatState(snapshot);
const d = snapshot.derived;
const { JevClient } = await import('../../src/narrative/analyzer/llm/JevClient.mjs');
const q = await import('../../src/market-analysis/llm/cheat-questions.mjs');
console.log(`题集 ${q.CHEAT_QUESTIONS_VERSION} / 规则 ${CHEAT_GRADE_RULES_VERSION} | 锚 ${anchorN} 行 | 买 ${d.totalBuyBnb?.toFixed(3)}/${d.buyN} 卖 ${d.totalSellBnb?.toFixed(3)}/${d.sellN} | t1流 ${d.top1HoldCircPct?.toFixed(1)}% | famous ${d.famousDominanceLevel}`);

const out = [];
for (let i = 1; i <= 3; i++) {
  const res = await JevClient.ask(state, q.buildCheatQuestions(), { timeoutMs: 30000, label: `tmp-bpt006-d3.72-r${i}` });
  const obs = buildObservation(res.answers, obsAnchors(d));
  const graded = gradeObservation(obs, {
    famousLevel: d.famousDominanceLevel ?? null,
    famousFollowerTop3Pct: d.famousFollowerTop3Pct ?? null,
    famousGroupBuyPct: d.famousGroupBuyPct ?? null,
    anchorSellCount: d.sellN,
  });
  const pump = obs.extLevels.slow_grind_pump ?? null;
  const act = obs.activityLevel?.bucket ?? null;
  const hold = obs.extLevels.holdings_balance ?? '(题已删)';
  out.push({ run: i, pump, act, hold, grade: graded.grade, reasons: graded.reasons.map((r) => r.code) });
  console.log(`run${i}: pump=${pump} act=${act} hold=${hold} → grade=${graded.grade} reasons=[${graded.reasons.map((r) => r.code).join(',')}]`);
  writeFileSync(`/tmp/bpt006-prompt-r${i}.txt`, state);
}
console.log('（prompt 存档 /tmp/bpt006-prompt-r*.txt）');
