/**
 * 临时扫描（C59 现金猫续案调研）：superIP 通道存量行中
 * 「关联截断豁免」候选形状的分布——量化 mapper 豁免的误放面。
 *
 * 形状定义（拟议豁免条件）：
 *   通道 = prompt_type LIKE 'super_ip_fast%'
 *   门1  0 < relevanceScore <= 10（Jev 已判出关联但弱，本会被 ≤10 截断）
 *   门2  referent_memeability >= 3（内容作品 + web3 共鸣双达标，J1.21 阈）
 *   门3  图证据（twitter_info.image_analysis 存在）
 *
 * 分组输出：三门全中（会翻案）/ 仅缺门3（无图证据形状——评估是否需要门3）
 *          / relevance=0 且门2 中（>0 门不救的纯零关联票，对照组）
 */
import { dbManager } from '../src/services/dbManager.js';

const RELEVANCE_TABLE = {
  exact_match: [20, 20, 20, 20, 20],
  translation_match: [18, 18, 18, 18, 18],
  abbreviation_alias: [16, 16, 17, 18, 18],
  semantic: [8, 10, 12, 15, 15],
  cultural: [1, 5, 10, 14, 15],
  generic_concept: [2, 4, 6, 7, 7],
  none: [0, 1, 2, 2, 2],
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function relevanceOf(answers) {
  const type = answers.relevance_type?.choice || 'none';
  const levelIdx = clamp(Math.round(answers.relevance_level?.score ?? 0), 0, 4);
  return { type, levelIdx, score: (RELEVANCE_TABLE[type] || RELEVANCE_TABLE.none)[levelIdx] };
}

const db = dbManager.getClient();
const PAGE = 500;
let rows = [];
let from = 0;
for (;;) {
  const { data, error } = await db.from('token_narrative')
    .select('token_address, token_symbol, prompt_type, is_valid, twitter_info, prestage_raw_output, stage_final_result, pre_check_result')
    .like('prompt_type', 'super_ip_fast%')
    .range(from, from + PAGE - 1);
  if (error) { console.error('DB ERR', error.message); process.exit(1); }
  if (!data.length) break;
  rows = rows.concat(data);
  if (data.length < PAGE) break;
  from += PAGE;
}
console.log(`superIP 通道总行数: ${rows.length}`);

const stats = { parsed: 0, blockedBefore: 0, exemptHit: [], noImageHit: [], zeroRelevanceMeme: [], otherTrunc: [] };
for (const r of rows) {
  let answers = null;
  try { answers = JSON.parse(r.prestage_raw_output || '{}').answers; } catch { /* skip */ }
  if (!answers?.relevance_type) continue;
  stats.parsed++;
  const rel = relevanceOf(answers);
  const meme = answers.referent_memeability?.score ?? null;
  const hasImage = !!(r.twitter_info && typeof r.twitter_info === 'object');
  let img = false;
  if (hasImage) {
    const ti = r.twitter_info;
    img = !!(ti.image_analysis?.analysis || ti.image_analysis);
  }
  // rating 推导（token_narrative 无 rating 列，扫 stage 载体）
  const sf = r.stage_final_result;
  const rating = sf?.rating || sf?.category || (r.prestage_raw_output ? 'see-prestage' : '?');

  if (meme != null && meme >= 3) {
    if (rel.score > 0 && rel.score <= 10) {
      (img ? stats.exemptHit : stats.noImageHit).push({
        addr: r.token_address, symbol: r.token_symbol,
        rel: `${rel.type}/lv${rel.levelIdx}=${rel.score}`, meme,
        blockReason: sf?.blockReason || '-', rating,
        valid: r.is_valid,
      });
    } else if (rel.score === 0) {
      stats.zeroRelevanceMeme.push({
        addr: r.token_address, symbol: r.token_symbol, meme, img, rating, valid: r.is_valid,
      });
    }
  }
}
console.log(`可解析 answers 行: ${stats.parsed}`);
console.log(`\n=== 三门全中（豁免会翻案）: ${stats.exemptHit.length} 行 ===`);
for (const x of stats.exemptHit) console.log(JSON.stringify(x));
console.log(`\n=== 门1+门2 中但无图证据（评估门3 是否必要）: ${stats.noImageHit.length} 行 ===`);
for (const x of stats.noImageHit) console.log(JSON.stringify(x));
console.log(`\n=== relevance=0 且 meme>=3（>0 门不救，对照组）: ${stats.zeroRelevanceMeme.length} 行 ===`);
for (const x of stats.zeroRelevanceMeme.slice(0, 30)) console.log(JSON.stringify(x));
if (stats.zeroRelevanceMeme.length > 30) console.log(`… 共 ${stats.zeroRelevanceMeme.length} 行`);
process.exit(0);
