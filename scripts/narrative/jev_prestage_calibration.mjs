#!/usr/bin/env node
/**
 * P3 prestage 校准对比：历史 account_community 行 旧判定 vs Jev 判定
 *
 * 语料恢复：旧 prestage_prompt 文本就是旧 LLM 看到的同一份账号/社区数据
 * （信息块 + 20 条推文摘要 + 网站内容），解析回 fullAccountOrCommunityData
 * 近似结构 → buildPrestageState → buildPrestageQuestions → JevClient.ask →
 * mapPrestageAnswers。时间基准 now=analyzed_at（abm 的"30天内流量事件"
 * 与旧判定同基准）。
 *
 * 对比基准：prestage_result.category（旧 tokenType）/ .rating（旧评级）。
 * project 评级为纯代码数学（rateProject），同时输出"旧 LLM 评级 vs 表复算"
 * 对照——验证评级表转译正确性（旧 LLM 可能偏离表）。
 *
 * 用法：node scripts/narrative/jev_prestage_calibration.mjs [--scale N]
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(resolve(__dirname, '../..'));

const { NarrativeRepository } = await import('../../src/narrative/db/NarrativeRepository.mjs');
const { JevClient } = await import('../../src/narrative/analyzer/llm/JevClient.mjs');
const { buildPrestageQuestions, JEV_PRESTAGE_QUESTIONS_VERSION } = await import('../../src/narrative/analyzer/llm/jev-prestage-questions.mjs');
const { buildPrestageState } = await import('../../src/narrative/analyzer/llm/jev-state-builder.mjs');
const { mapPrestageAnswers, rateProject } = await import('../../src/narrative/analyzer/llm/jev-prestage-mapper.mjs');

/** 各旧 tokenType 抽样上限（默认 ≈22 条；--scale N 按比例放大） */
const BASE_QUOTA = { account_based_meme: 8, web3_native_ip_early: 6, project: 8 };
const scaleIdx = process.argv.indexOf('--scale');
const scale = scaleIdx > 0 ? Math.max(1, parseInt(process.argv[scaleIdx + 1], 10) || 1) : 1;
const QUOTA = Object.fromEntries(Object.entries(BASE_QUOTA).map(([k, v]) => [k, v * scale]));

/**
 * 从旧 prompt 文本恢复语料（账号/社区信息块 + 推文 + 网站内容）
 * addressVerified 优先取 prestage_result.details.addressVerified 存储值
 * （isProjectCoin 走 skipAddressValidation 时 prompt 横幅仍显示"未命中"，
 * 横幅推断会误判），存储值缺失才回退横幅。
 */
export function parseLegacyPrompt(promptText, storedAddressVerified = undefined) {
  const p = promptText;
  const bannerVerified = /合约地址验证结果：✅ 已命中/.test(p);
  const addressVerified = storedAddressVerified === undefined ? bannerVerified : storedAddressVerified;
  const isAccount = /【Twitter账号信息】/.test(p);

  const num = (re) => {
    const m = p.match(re);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  };
  const line = (re) => {
    const m = p.match(re);
    return m ? m[1].trim() : null;
  };

  // 推文段：编号行列表，到 网站内容/边框/结尾 为止
  const tweetsMatch = p.match(/【近期推文（(\d+)条）】\n([\s\S]*?)(?=\n【项目网站内容】|\n╔|$)/);
  const tweets = [];
  if (tweetsMatch) {
    for (const tline of tweetsMatch[2].split('\n')) {
      const m = tline.match(/^\d+\. \[([^\]]*)\] (.*)$/);
      if (m) tweets.push({ tweet_id: null, created_at: m[1], text: m[2], user: null });
    }
  }

  // 网站内容段（项目币路径才有）
  const webMatch = p.match(/【项目网站内容】（来源：(\S+)）\n([\s\S]*)$/);
  const websiteInfo = webMatch ? { url: webMatch[1], content: webMatch[2].trim() } : null;

  const verifiedLabel = line(/- 认证状态：(认证|蓝V|无)/);

  const data = isAccount
    ? {
        type: 'account',
        screen_name: (line(/- 账号名：@(\S+)/) || ''),
        name: line(/- 显示名：(.*)/) || '',
        description: line(/- 简介：(.*)/) || '',
        followers_count: num(/- 粉丝数：([\d,]+)/) ?? 0,
        verified: verifiedLabel === '认证',
        is_blue_verified: verifiedLabel === '蓝V',
        statuses_count: num(/- 推文总数：([\d,]+)/) ?? 0,
        tweets,
      }
    : {
        type: 'community',
        name: line(/- 社区名：(.*)/) || '',
        description: line(/- 简介：(.*)/) || '',
        members_count: num(/- 成员数：([\d,]+)/) ?? 0,
        moderators_count: num(/- 管理员数：(\d+)/) ?? 0,
        timeline_tweet_count: num(/- 推文总数：([\d,]+)/) ?? 0,
        tweets,
      };

  return { addressVerified, data, websiteInfo };
}

async function main() {
  const supabase = NarrativeRepository.getSupabase();

  const { data: rows, error } = await supabase
    .from('token_narrative')
    .select('token_address, token_symbol, raw_api_data, prestage_result, prestage_prompt, analyzed_at')
    .eq('prompt_type', 'account_community')
    .not('prestage_prompt', 'is', null)
    .order('analyzed_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(`查询失败: ${error.message}`);

  // 分层抽样（旧 tokenType 来自 prestage_result.category）
  const picked = [];
  const counts = {};
  for (const row of rows) {
    const cls = row.prestage_result?.category;
    if (!cls || !QUOTA[cls]) continue;
    if ((counts[cls] || 0) >= QUOTA[cls]) continue;
    counts[cls] = (counts[cls] || 0) + 1;
    picked.push({ ...row, oldType: cls });
  }
  console.log(`=== prestage Jev 校准对比（${picked.length} 样本，问题集 ${JEV_PRESTAGE_QUESTIONS_VERSION}）===\n`);

  const details = [];
  const typeMatrix = {};  // [old][new] = n
  let typeSame = 0, ratingSame = 0;

  for (const row of picked) {
    const storedAV = row.prestage_result?.details?.addressVerified;
    const parsed = parseLegacyPrompt(row.prestage_prompt || '', storedAV);
    if (!parsed.data.tweets.length && parsed.data.type === 'account' && !parsed.data.description) {
      console.log(`[跳过] ${row.token_symbol}: prompt 解析失败`);
      continue;
    }

    const tokenData = {
      address: row.token_address,
      symbol: row.token_symbol,
      name: row.raw_api_data?.name || '',
      raw_api_data: row.raw_api_data,
    };

    const oldRating = row.prestage_result?.rating || '?';
    const oldReason = row.prestage_result?.reason || row.prestage_result?.details?.reason || '';

    const analyzedAtMs = row.analyzed_at ? new Date(row.analyzed_at).getTime() : undefined;
    const { state, stats } = buildPrestageState(tokenData, parsed.data, {
      addressVerified: parsed.addressVerified,
      rulesResult: { addressVerified: parsed.addressVerified, nameMatch: null, details: {} },
      websiteInfo: parsed.websiteInfo,
      now: analyzedAtMs,
    });
    const questions = buildPrestageQuestions();

    const t0 = Date.now();
    const result = await JevClient.ask(state, questions, { label: `calib-prestage:${row.token_symbol}` });
    const elapsed = Date.now() - t0;

    const callInfo = {
      model: result.model, questions, stateStats: stats,
      usage: result.usage,
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    };
    const mapped = mapPrestageAnswers(result.answers, {
      fullAccountOrCommunityData: parsed.data,
      addressVerified: parsed.addressVerified,
      rulesResult: { addressVerified: parsed.addressVerified, nameMatch: null, details: {} },
      callInfo,
    });

    const newType = mapped.tokenType;
    const newRating = mapped.rating;
    const a = result.answers;

    const typeOk = newType === row.oldType;
    const ratingOk = newRating === oldRating;
    if (typeOk) typeSame++;
    if (ratingOk) ratingSame++;
    typeMatrix[row.oldType] = typeMatrix[row.oldType] || {};
    typeMatrix[row.oldType][newType] = (typeMatrix[row.oldType][newType] || 0) + 1;

    // project 行：旧 LLM 评级 vs 代码表复算（转译正确性验证）
    let tableRating = null;
    if (row.oldType === 'project') {
      tableRating = rateProject(parsed.data, a.prestage_community_activity?.choice || null).rating;
    }

    const verdict = typeOk && ratingOk ? '一致' : typeOk ? '评级分歧' : '类型翻转';
    console.log(`[${verdict}] ${row.token_symbol}(${parsed.data.type}${parsed.addressVerified ? '/verified' : '/unverified'}): ${row.oldType}/${oldRating} → ${newType}/${newRating} [${elapsed}ms]`);
    if (!typeOk || !ratingOk) {
      const notes = [];
      if (row.oldType === 'account_based_meme' || newType === 'account_based_meme') {
        notes.push(`nameLink=${a.prestage_abm_name_link?.choice}(P_none=${a.prestage_abm_name_link?.probabilities?.none?.toFixed(2)}) trafficP=${a.prestage_abm_web3_traffic?.probabilities?.has_traffic?.toFixed(2)}`);
      } else {
        notes.push(`tokenType P=${JSON.stringify(a.prestage_token_type?.probabilities)}`);
      }
      if (tableRating) notes.push(`表复算=${tableRating}`);
      if (oldReason) notes.push(`旧reason:${String(oldReason).slice(0, 60)}`);
      console.log(`      └ ${notes.join(' | ')}`);
    }

    details.push({
      symbol: row.token_symbol, oldType: row.oldType, oldRating,
      newType, newRating, tableRating, verdict, elapsed,
      addressVerified: parsed.addressVerified, corpusType: parsed.data.type,
      followers: parsed.data.followers_count ?? null, members: parsed.data.members_count ?? null,
      nameLink: a.prestage_abm_name_link?.choice ?? null,
      nameLinkNoneP: a.prestage_abm_name_link?.probabilities?.none ?? null,
      trafficP: a.prestage_abm_web3_traffic?.probabilities?.has_traffic ?? null,
      tokenTypeProbs: a.prestage_token_type?.probabilities ?? null,
      activity: a.prestage_community_activity?.choice ?? null,
      reason: mapped.reasoning,
    });
  }

  // ── 汇总 ──
  const total = details.length;
  console.log('\n=== 汇总 ===');
  console.log(`tokenType 一致 ${typeSame}/${total} (${(typeSame / total * 100).toFixed(0)}%)｜rating 一致 ${ratingSame}/${total} (${(ratingSame / total * 100).toFixed(0)}%)`);

  console.log('\ntokenType 混淆矩阵 (行=旧, 列=新):');
  const cols = [...new Set([...Object.keys(typeMatrix), ...Object.values(typeMatrix).flatMap(o => Object.keys(o))])];
  console.log('       ' + cols.map(c => c.slice(0, 12).padStart(14)).join(''));
  for (const r of Object.keys(typeMatrix)) {
    console.log((r + ':').padEnd(7) + cols.map(c => String(typeMatrix[r]?.[c] || 0).padStart(14)).join(''));
  }

  // abm 条件分解
  const abm = details.filter(d => d.oldType === 'account_based_meme' || d.newType === 'account_based_meme');
  if (abm.length) {
    const nameOk = abm.filter(d => d.nameLink && d.nameLink !== 'none').length;
    const trafficOk = abm.filter(d => (d.trafficP ?? 0) >= 0.5).length;
    console.log(`\nabm 条件分解（n=${abm.length}）: 名称关联≠none ${nameOk}｜P(has_traffic)≥0.5 ${trafficOk}`);
  }

  // project 评级三方对照（旧 LLM vs Jev 版代码表）
  const proj = details.filter(d => d.oldType === 'project' && d.tableRating);
  if (proj.length) {
    const tableAgreeOld = proj.filter(d => d.tableRating === d.oldRating).length;
    const newAgreeTable = proj.filter(d => d.newRating === d.tableRating).length;
    console.log(`project 三方对照（n=${proj.length}）: 表复算=旧LLM ${tableAgreeOld}｜Jev版=表复算 ${newAgreeTable}（后者应=n，评级纯确定性）`);
  }

  writeFileSync('/tmp/jev_prestage_calib_details.json', JSON.stringify(details, null, 1));
  console.log('details 已写入 /tmp/jev_prestage_calib_details.json');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isMain) {
  main().catch(err => {
    console.error('❌ 校准失败:', err.message);
    process.exit(1);
  });
}
