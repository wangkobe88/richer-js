#!/usr/bin/env node
// ============================================================================
// C110 结构扫描①：event_magnitude ↔ dimension2 同轴性测量（182 跑）
//
// 背景：dim2 题面明文「两题评估同一主体，档位应基本一致」= 同一判断问两遍；
// 形状①②/J1.23/J1.35 语义在两题文本中双份维护。本扫描出裁定数据：
//   1) Pearson + Spearman 相关系数（score 级）
//   2) 量级档内 dim2 分布（均值±标准差——档内方差=dim2 的增量信息）
//   3) 档位不一致样本（A/S 档但 dim2<18 / E/D 档但 dim2≥23，带地址）
//   4) 合并翻转面模拟：dim2 替换为档内均值（数据驱动的确定性映射）后重放
//      mapStandardAnswers，评级翻转换向的票数与地址——「删 dim2 题值多少行为面」
//
// 方法：不重实现数学——把行内 stage1_raw_output.answers 喂给现行
// mapStandardAnswers 直放（与 scan-c88-flip-surface 同一入口/同一上下文口径），
// 翻转比较是同一管线内 dim2 原值 vs 档均值替换的自对照，内部一致。
// tier 取重放审计键 magnitudeTier（原判档，不受锚定影响）。
//
// 用法（182 上跑；本地 VPN 直连 Supabase 必超时，勿本地跑）：
//   node scripts/tmp-scan-mag-dim2-correlation.cjs
//   node scripts/tmp-scan-mag-dim2-correlation.cjs --json /tmp/mag-dim2.json
// ============================================================================
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require(path.join(__dirname, '../src/services/dbManager.js'));

const asObj = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return null;
};
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const std = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const pearson = (xs, ys) => {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
};
// Spearman = 秩变换后 Pearson（同值平均秩）
const ranks = (a) => {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const out = new Array(a.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = avg;
    i = j + 1;
  }
  return out;
};

async function main() {
  const db = dbManager.getClient();
  const { mapStandardAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');

  const COLS = 'token_address,token_symbol,raw_api_data,twitter_info,stage1_raw_output,analyzed_at';
  const PAGE = 1000;
  const rows = [];
  let total = 0, noStd = 0, threw = 0, cursor = null;

  while (true) {
    let q = db.from('token_narrative').select(COLS).order('token_address').limit(PAGE);
    if (cursor) q = q.gt('token_address', cursor);
    const { data: page, error } = await q;
    if (error) throw error;
    if (!page || page.length === 0) break;
    cursor = page[page.length - 1].token_address;

    for (const row of page) {
      total++;
      const answers = asObj(row.stage1_raw_output)?.answers;
      if (!answers || typeof answers !== 'object'
        || typeof answers.event_magnitude?.score !== 'number'
        || typeof answers.dimension2?.score !== 'number'
        || !answers.name_referent) { noStd++; continue; }
      rows.push({ row, answers });
    }
    if (page.length < PAGE) break;
  }

  // ── 第一遍：重放取原判 tier/rating/score + 档内分布 ──
  const perTier = {}; // tier -> [dim2 score]
  const valid = [];
  for (const { row, answers } of rows) {
    let m;
    try {
      m = mapStandardAnswers(answers, {
        tokenData: {
          symbol: row.token_symbol,
          name: asObj(row.raw_api_data)?.name,
          raw_api_data: asObj(row.raw_api_data),
        },
        twitterInfo: asObj(row.twitter_info),
        includeBrandHijack: 'brand_hijack' in answers,
        credibleEventAnchor: false,
        tweetClassification: null,
        callInfo: { model: 'scan', questions: {}, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
      });
    } catch (e) { threw++; continue; }
    const tier = m.stage2DataToSave?.parsed_output?.jev?.magnitudeTier ?? null;
    if (!tier) { threw++; continue; }
    valid.push({
      addr: row.token_address, symbol: row.token_symbol, tier,
      mag: answers.event_magnitude.score, dim2: answers.dimension2.score,
      rating: m.llmResult?.rating ?? null,
      score: m.llmResult?.score ?? null,
      m, row, answers,
    });
    (perTier[tier] = perTier[tier] || []).push(answers.dimension2.score);
  }

  const mags = valid.map(v => v.mag), dim2s = valid.map(v => v.dim2);
  console.log(`\n===== mag↔dim2 同轴性扫描（token_narrative 全表 ${total} 行；标准路径 ${rows.length}；有效重放 ${valid.length}；跳过 ${noStd}；重放异常 ${threw}）=====`);
  console.log(`Pearson r  = ${r2(pearson(mags, dim2s))}`);
  console.log(`Spearman ρ = ${r2(pearson(ranks(mags), ranks(dim2s)))}`);

  console.log('\n── 量级档内 dim2 分布（档内方差=dim2 超出量级的增量信息）──');
  const tierMean = {};
  for (const tier of ['S', 'A', 'B', 'C', 'D', 'E']) {
    const a = perTier[tier] || [];
    tierMean[tier] = a.length ? Math.round(mean(a) * 10) / 10 : null;
    console.log(`  ${tier}: n=${a.length} dim2 mean=${r2(mean(a))} std=${r2(std(a))} min=${a.length ? Math.min(...a) : '-'} max=${a.length ? Math.max(...a) : '-'} → 档均值映射值 ${tierMean[tier]}`);
  }

  console.log('\n── 档位不一致样本（A/S 档但 dim2<18；E/D 档但 dim2≥23）──');
  const incHigh = valid.filter(v => (v.tier === 'A' || v.tier === 'S') && v.dim2 < 18);
  const incLow = valid.filter(v => (v.tier === 'E' || v.tier === 'D') && v.dim2 >= 23);
  console.log(`  A/S 低带: ${incHigh.length} 行 / A/S 总 ${valid.filter(v => v.tier === 'A' || v.tier === 'S').length}`);
  incHigh.slice(0, 15).forEach(v => console.log(`    ${v.symbol} ${v.addr} tier=${v.tier} mag=${v.mag} dim2=${v.dim2} rating=${v.rating}`));
  console.log(`  E/D 高带: ${incLow.length} 行 / E/D 总 ${valid.filter(v => v.tier === 'E' || v.tier === 'D').length}`);
  incLow.slice(0, 15).forEach(v => console.log(`    ${v.symbol} ${v.addr} tier=${v.tier} mag=${v.mag} dim2=${v.dim2} rating=${v.rating}`));

  // ── 第二遍：合并翻转面模拟（dim2 := 档均值，数据驱动确定性映射）──
  console.log('\n── 合并翻转面模拟（dim2 替换为档内均值后重放，评级翻转换向）──');
  const flips = [];
  for (const v of valid) {
    const mv = tierMean[v.tier];
    if (mv == null) continue;
    const simAnswers = { ...v.answers, dimension2: { ...v.answers.dimension2, score: mv } };
    let ms;
    try {
      ms = mapStandardAnswers(simAnswers, {
        tokenData: {
          symbol: v.row.token_symbol,
          name: asObj(v.row.raw_api_data)?.name,
          raw_api_data: asObj(v.row.raw_api_data),
        },
        twitterInfo: asObj(v.row.twitter_info),
        includeBrandHijack: 'brand_hijack' in v.answers,
        credibleEventAnchor: false,
        tweetClassification: null,
        callInfo: { model: 'scan', questions: {}, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
      });
    } catch (e) { continue; }
    const simRating = ms.llmResult?.rating ?? null;
    if (simRating !== v.rating) {
      flips.push({
        addr: v.addr, symbol: v.row.token_symbol, tier: v.tier,
        dim2Orig: v.dim2, dim2Sim: mv,
        from: v.rating, to: simRating,
        scoreOrig: v.score,
        scoreSim: ms.llmResult?.score ?? null,
      });
    }
  }
  const up = flips.filter(f => f.from === 'low' && f.to !== 'low').length;
  const down = flips.filter(f => f.from !== 'low' && f.to === 'low').length;
  const churn = flips.length - up - down;
  console.log(`  翻转总数 ${flips.length}/${valid.length}（${r2(flips.length / Math.max(valid.length, 1) * 100)}%）：放行向 ${up}、拦去向 ${down}、mid/high 互转 ${churn}`);
  flips.slice(0, 30).forEach(f =>
    console.log(`    ${f.symbol} ${f.addr} tier=${f.tier} dim2 ${f.dim2Orig}→${f.dim2Sim} rating ${f.from}→${f.to} score ${r2(f.scoreOrig)}→${r2(f.scoreSim)}`));

  const jsonIdx = process.argv.indexOf('--json');
  if (jsonIdx > 0 && process.argv[jsonIdx + 1]) {
    require('fs').writeFileSync(process.argv[jsonIdx + 1], JSON.stringify({
      n: valid.length, pearson: r2(pearson(mags, dim2s)), spearman: r2(pearson(ranks(mags), ranks(dim2s))),
      perTier: Object.fromEntries(Object.entries(perTier).map(([t, a]) => [t, { n: a.length, mean: r2(mean(a)), std: r2(std(a)) }])),
      tierMean, incHigh: incHigh.map(v => ({ addr: v.addr, tier: v.tier, mag: v.mag, dim2: v.dim2 })),
      incLow: incLow.map(v => ({ addr: v.addr, tier: v.tier, mag: v.mag, dim2: v.dim2 })),
      flips,
    }, null, 1));
    console.log(`\n全量 JSON 已落盘: ${process.argv[jsonIdx + 1]}`);
  }
  process.exit(0);
}

main().catch(err => { console.error('扫描异常:', err); process.exit(1); });
