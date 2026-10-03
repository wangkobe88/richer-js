#!/usr/bin/env node
/**
 * 临时校准（2026-10-03，C55/J1.27 产品实体接纳门）：161 票评3全集
 * J1.26 线上评级 vs J1.27 全量题面+新门重判——验收口径：
 *   ① 产品簇 18 票预期翻 low（中国公司产品发布簇几乎全亏）
 *   ② 对照赢 5 票保住（rating ≥ mid）
 *   ③ 非产品簇票一致率 ≥95%（误伤检查——含骑乘票 subject_entity 标注误触）
 *   ④ 币安票豁免生效（C35 币安支付 high 保住）
 * 时间基准=analyzed_at（幂等，与线上同锚）。纯校准不写 DB。
 *
 * 用法（182，项目根）：node scripts/narrative/_calib-product-entity.mjs --addrs /tmp/r3-addrs.json --out /tmp/calib-j127.json
 */
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { writeFileSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(resolve(__dirname, '../..'));

const { NarrativeRepository } = await import('../../src/narrative/db/NarrativeRepository.mjs');
const { JevClient } = await import('../../src/narrative/analyzer/llm/JevClient.mjs');
const { buildStandardQuestions, shouldIncludeBrandHijackCheck, JEV_QUESTIONS_VERSION } = await import('../../src/narrative/analyzer/llm/jev-questions.mjs');
const { buildJevState } = await import('../../src/narrative/analyzer/llm/jev-state-builder.mjs');
const { mapStandardAnswers } = await import('../../src/narrative/analyzer/llm/jev-result-mapper.mjs');
const { detectSuperIP } = await import('../../src/narrative/analyzer/prompts/super-ip/super-ip-registry.mjs');
const { detectIssuerSelfLaunch } = await import('../../src/narrative/analyzer/utils/narrative-utils.mjs');
const { classifyTweetType } = await import('../../src/narrative/analyzer/services/tweet-type-classifier.mjs');

const argOf = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const addrsPath = argOf('--addrs') || '/tmp/r3-addrs.json';
const outPath = argOf('--out') || '/tmp/calib-j127.json';

// ── 分组标记（C55 分析既定清单）──
const PROD_CLUSTER = new Set([
  '0x967e4a528c264529fe8d6d9773665a6357787777', // 麒麟
  '0x70db4674c85e77cda99dc1154ac2cb7236327777', // 狗剩1
  '0xf645cacdef13ca5e01418441d81d321fa0a07777', // 狗剩2
  '0xf0355e9bbc8ae2de06b958237be626c2d6e17777', // 狗剩3
  '0xeeb7752ee078fe8cff8d19343ef7abe9a3627777', // 狗剩4
  '0x831974d3f612b715a2e2b931470c8c5ae8957767', // TDreamQQ
  '0x17b36a94e93b8598fc2d25a7300810402ab77777', // EB
  '0xd797487150167ea4cb66ee9224e8296e434d7777', // 小久
  '0xd00b91e94e1fe3917ffb854d17ac1c2031cb7777', // 子曰
  '0xd1ba4cf6d7571becaab74e93fd92e2713d6e7777', // METI
  '0xd0daf8f05ef9cbb3eb16cfa33d49336a92ca7777', // MeMe
  '0xc53500c470d97e09b990a91d2156def418707777', // YOYO
  '0x0aef115d92cc89b1aaa4f653a839aabb05787777', // 福来
  '0x78d7082d38ab8f99c8b6362c4ab041e3cf677777', // 小财
  '0xd9a0cea7d44d4c7d468c7a8612eb315b083877777', // 小财2
  '0x1c797191fba12bee7326b27341f74455f2da7777', // 多多进宝
  '0xd07a0ba2afb7a8b2add0715edd7880140fc17777', // Temu
  '0x49ca1e62078ea1a80b7fcb96a13781f4bc0177777', // 西方产品簇伴生
]);
const WIN_CTRL = new Set([
  '0xec16bb6976fdf303de24e9b0669e928f04a17777', // 中国猪能飞
  '0xbaa7427af7cef74a6ddb04aad9061dac1cc57777', // CHOUCHOU
  '0x7466248c7ed0d5e42b2f452ddda2bd179f527777', // 金六根
  '0xde3e6c39a304b69c606c67885bbff390ca427777', // 小八
  '0x5f887384e49b8ccd3a17a32352fb64a4cd277777', // LIARA
]);
const WEST_PROD = new Set([
  '0x40278f10acf21d0994b64a8bb287b7662a447777', // RedCoin
  '0x1c6b9b1bf987d4117f3d06ac6041dae3111e7777', // Express
  '0x986d2ff73cca33684d66b6d8369f59fe8f637777', // 点点
  '0x063d14a1ec498a8090ae3f0d1acd97d3145c7777', // Autopilot
]);

const RANK = { low: 1, mid: 2, high: 3 };
const groupOf = (a) => PROD_CLUSTER.has(a) ? 'prod' : (WIN_CTRL.has(a) ? 'win' : (WEST_PROD.has(a) ? 'west' : 'other'));

const tickets = JSON.parse(readFileSync(addrsPath, 'utf8'));
console.log(`J1.27 校准（${JEV_QUESTIONS_VERSION}）：${tickets.length} 票 · 产品簇${PROD_CLUSTER.size} 对照赢${WIN_CTRL.size} 西产${WEST_PROD.size}\n`);

const supabase = NarrativeRepository.getSupabase();
// 分批 in 查询（161 > 单批上限 100？supabase in 无硬限但保守分批 50）
const rows = [];
for (let i = 0; i < tickets.length; i += 50) {
  const batch = tickets.slice(i, i + 50);
  const { data, error } = await supabase.from('token_narrative')
    .select('token_address, token_symbol, raw_api_data, extracted_info, classified_urls, twitter_info, analyzed_at, stage1_prompt, stage_final_result, prestage_result')
    .in('token_address', batch.map(t => t.addr));
  if (error) throw new Error(error.message);
  rows.push(...data);
}
const byAddr = new Map(rows.map(r => [r.token_address, r]));

const results = [];
let done = 0;
for (const t of tickets) {
  const row = byAddr.get(t.addr);
  if (!row) { results.push({ addr: t.addr, symbol: t.symbol, group: groupOf(t.addr), skip: 'no_row' }); continue; }
  if (!row.twitter_info) { results.push({ addr: t.addr, symbol: row.token_symbol || t.symbol, group: groupOf(t.addr), skip: 'no_corpus', oldRating: row.stage_final_result?.rating }); continue; }
  const tokenData = {
    address: row.token_address, symbol: row.token_symbol,
    name: row.raw_api_data?.name || '', raw_api_data: row.raw_api_data,
  };
  const fetchResults = {
    twitterInfo: row.twitter_info, websiteInfo: null, githubInfo: null, backgroundInfo: null,
    youtubeInfo: null, douyinInfo: null, tiktokInfo: null, bilibiliInfo: null,
    weixinInfo: null, amazonInfo: null, xiaohongshuInfo: null, instagramInfo: null,
    binanceSquareInfo: null, extractedInfo: row.extracted_info || null,
    classifiedUrls: row.classified_urls || null, relatedAccounts: null, accountSummary: null,
  };
  const includeBrandHijack = shouldIncludeBrandHijackCheck(tokenData.symbol, tokenData.name);
  const now = row.analyzed_at ? new Date(row.analyzed_at).getTime() : undefined;
  // ── state 保真（2026-10-03 修订）：线上 stage1_prompt.state 原文优先 ──
  // binance_square_info/instagram_info/website_info 等不持久化为列，重建 state 必缺
  // 这些语料节（161 票中 94 票含非持久化节；币安智能案实证 675 vs 466 字符，mag 掉档）
  let state = null, stats = null, stateSrc = 'online';
  try {
    const p = typeof row.stage1_prompt === 'string' ? JSON.parse(row.stage1_prompt) : row.stage1_prompt;
    state = p?.state || null;
  } catch { /* 旧行非 JSON */ }
  if (!state) { const b = buildJevState(tokenData, fetchResults, { now }); state = b.state; stats = b.stats; stateSrc = 'rebuilt'; }
  // ── context 全键复刻（NarrativeAnalyzer.mjs:602 同参）──
  const superIPInfo = detectSuperIP(row.extracted_info?.twitterUrl || row.classified_urls?.twitter?.[0]?.url, row.twitter_info);
  const issuerSelfLaunch = detectIssuerSelfLaunch(tokenData, fetchResults);
  const squareVerified = /【币安广场内容】[\s\S]*?作者认证:\s*官方认证账号/.test(state);
  const credibleEventAnchor = !!(superIPInfo || issuerSelfLaunch || squareVerified);
  const igLinked = !!(row.classified_urls?.instagram?.length > 0);
  const igFetched = igLinked && /instagram/i.test(state);
  try {
    const q = buildStandardQuestions({ includeBrandHijack });
    const r = await JevClient.ask(state, q, { label: `cal127:${row.token_symbol}` });
    const m = mapStandardAnswers(r.answers, {
      tokenData, includeBrandHijack, twitterInfo: row.twitter_info,
      credibleEventAnchor, instagramLinked: igLinked, instagramInfoFetched: igFetched,
      tweetClassification: classifyTweetType(row.twitter_info),
      callInfo: { model: r.model, questions: q, stateStats: stats, state, usage: r.usage, startedAt: '', finishedAt: '' },
    });
    const a = r.answers;
    const fitP = a.web3_fit?.probabilities ?? {};
    const audit = m.stage2DataToSave?.parsed_output?.jev ?? {};
    results.push({
      addr: t.addr, symbol: row.token_symbol || t.symbol, group: groupOf(t.addr), theme: t.theme || null,
      oldRating: row.stage_final_result?.rating ?? null, oldScore: row.stage_final_result?.score ?? null,
      newRating: m.llmResult.rating, newScore: m.llmResult.score,
      cat: a.event_category?.choice, mag: a.event_magnitude?.score, dim2: a.dimension2?.score,
      se: a.subject_entity?.choice ?? null, seP: Math.round((a.subject_entity?.probabilities?.[a.subject_entity?.choice] ?? 0) * 100),
      fitMass: Math.round(((fitP.strong_fit ?? 0) + (fitP.fit ?? 0)) * 100),
      peBlock: audit.productEntityBlock ?? null, bzExempt: audit.productEntityBinanceExempt ?? null,
      blockReason: m.stage2DataToSave?.parsed_output?.blockReason ?? null,
      stateSrc, credibleEventAnchor,
    });
  } catch (e) {
    results.push({ addr: t.addr, symbol: row.token_symbol || t.symbol, group: groupOf(t.addr), skip: `ask_failed:${String(e.message).slice(0, 80)}` });
  }
  done++;
  if (done % 20 === 0) console.log(`  … ${done}/${tickets.length}`);
}

// ── 汇总 ──
const scored = results.filter(r => !r.skip);
const matrix = {};
for (const r of scored) {
  const k = `${r.oldRating}->${r.newRating}`;
  matrix[k] = (matrix[k] || 0) + 1;
}
const flips = scored.filter(r => RANK[r.newRating] < RANK[r.oldRating]);
const peHits = scored.filter(r => r.peBlock);
const prodFlips = flips.filter(r => r.group === 'prod');
const winLost = scored.filter(r => r.group === 'win' && RANK[r.newRating] < 2); // 对照赢掉到 low = 误伤
const bzHits = scored.filter(r => r.bzExempt);
const others = scored.filter(r => r.group === 'other');
const otherAgree = others.filter(r => r.newRating === r.oldRating).length;

console.log('\n══ 汇总 ══');
console.log(`有效判定 ${scored.length}/${tickets.length}（跳过 ${results.length - scored.length}：${results.filter(r => r.skip).map(r => r.skip.split(':')[0]).join('/') || '无'}）`);
console.log(`state 来源: 线上原文 ${scored.filter(r => r.stateSrc === 'online').length} · 重建 ${scored.filter(r => r.stateSrc === 'rebuilt').length}（重建票=旧行无 stage1_prompt，绝对评级保真度低）`);
console.log('迁移矩阵:', JSON.stringify(matrix));
console.log(`\n① 产品门命中 ${peHits.length} 票（产品簇内 ${peHits.filter(r => r.group === 'prod').length}/${PROD_CLUSTER.size}）`);
console.log(`② 对照赢 5 票评级: ${scored.filter(r => r.group === 'win').map(r => `${r.symbol}:${r.oldRating}→${r.newRating}`).join(' · ')}${winLost.length ? ' ⚠️误伤' + winLost.length : ' ✓零误伤'}`);
console.log(`③ 非产品簇一致率（other 组）: ${otherAgree}/${others.length} = ${(others.length ? (otherAgree / others.length * 100).toFixed(1) : '-')}%`);
console.log(`④ 币安豁免命中: ${bzHits.length} 票 ${bzHits.map(r => r.symbol).join('·') || ''}`);
console.log(`\n降档票（${flips.length}）:`);
for (const r of flips) console.log(`  [${r.group}] ${r.symbol} ${r.addr} ${r.oldRating}${r.oldScore ?? ''}→${r.newRating}${r.newScore ?? ''} se=${r.se}${r.seP}% fit=${r.fitMass}% ${r.stateSrc === 'rebuilt' ? '⚠️重建state ' : ''}${r.blockReason ? '·' + r.blockReason.slice(0, 50) : ''}`);
writeFileSync(outPath, JSON.stringify({ version: JEV_QUESTIONS_VERSION, matrix, results }, null, 1));
console.log(`\n明细已写 ${outPath}`);
process.exit(0);
