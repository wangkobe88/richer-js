#!/usr/bin/env node
// ============================================================================
// C88 存量行为面扫描（超级IP口号票五腿救援 + mem 口径地板上线前置）
//
// 方法：不重实现谓词——把每行 stage1_raw_output.answers 喂给**新代码的
// mapStandardAnswers** 直放（与单测 _test_superip_slogan_class 同一入口），
// 现行评级用 resolveFinalRating（评级链单一真相源）从行内 stage 列推。
// 两清单归属只看 C88 审计键（superIpSlogan.hit / memFloorBlock），
// 扫描上下文与生产的差异（credibleEventAnchor/tweetClassification 未落库）
// 只影响 J1.24/C68/C75 等旁支豁免，不影响两清单判定键——差异行会落进
// 警示组 W1/W2（预期为空，非空=上下文失真信号，需人工看）。
//
// 输出四组：
//   ①  救援翻转面：现行 low ∧ 重放 mid/high ∧ superIpSlogan.hit=true（会翻正）
//   ①b 命中未翻转：hit=true ∧ 现行 low ∧ 仍 low（打印 reason——D/E 量级臂等刻意不豁）
//   ②  mem 地板误伤面：现行 mid/high ∧ memFloorBlock 命中 ∧ 重放 low（会翻拦）
//   W1/W2 警示组（预期空）：非 C88 键引起的评级变化 = 扫描失真，非生产行为
//
// 用法（182 上跑；本地 VPN 直连 Supabase 必超时，勿本地跑）：
//   node scripts/scan-c87-flip-surface.cjs
//   node scripts/scan-c87-flip-surface.cjs --json /tmp/c87-surface.json   # 全量落盘
// 退出码 1 = 任一清单非空（有待用户过目的面），0 = 全空。
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

async function main() {
  const db = dbManager.getClient();
  const { mapStandardAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { shouldIncludeBrandHijackCheck } = await import('../src/narrative/analyzer/llm/jev-questions.mjs');
  const { resolveFinalRating, categoryToRating } = await import('../src/narrative/utils/rating-utils.mjs');

  const COLS = [
    'token_address', 'token_symbol', 'raw_api_data', 'twitter_info', 'is_valid',
    'pre_check_result', 'prestage_result', 'stage1_raw_output',
    'stage1_result', 'stage2_result', 'stage3_result', 'stage_final_result',
    'token_category', 'analyzed_at',
  ].join(',');

  // keyset 分页（PostgREST max-rows=1000 静默截断防线）
  const PAGE = 1000;
  const groups = { rescue: [], hitNoFlip: [], memFloor: [], w1: [], w2: [] };
  let total = 0, noStd = 0, threw = 0, cursor = null;

  while (true) {
    let q = db.from('token_narrative').select(COLS).order('token_address').limit(PAGE);
    if (cursor) q = q.gt('token_address', cursor);
    const { data: rows, error } = await q;
    if (error) throw error;
    if (!rows || rows.length === 0) break;
    cursor = rows[rows.length - 1].token_address;

    for (const row of rows) {
      total++;
      const answers = asObj(row.stage1_raw_output)?.answers;
      // 标准路径行判定：18+ 题集含 web3_user_name_entity_acceptance（precheck/prestage/旧题集行跳过——
      // prestage 无此题=标签恒 null 语义，本扫描与其无关）
      if (!answers || typeof answers !== 'object' || !answers.web3_user_name_entity_acceptance) { noStd++; continue; }

      let m;
      try {
        m = mapStandardAnswers(answers, {
          tokenData: {
            symbol: row.token_symbol,
            name: asObj(row.raw_api_data)?.name,
            raw_api_data: asObj(row.raw_api_data),
          },
          twitterInfo: asObj(row.twitter_info),
          // J1.85/C143：品牌题已退役；门开关改由关键词预检决定（与生产同口径）
          includeBrandHijack: shouldIncludeBrandHijackCheck(row.token_symbol, asObj(row.raw_api_data)?.name),
          credibleEventAnchor: false, // 未落库：fail-closed；只影响 J1.24，不影响两清单判定键
          tweetClassification: null,  // 未落库：C68/C75 override 不参与，timing 用 Jev 原判
          callInfo: { model: 'scan', questions: {}, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
        });
      } catch (e) {
        threw++; continue;
      }

      const curRating = categoryToRating(resolveFinalRating(row)); // 1/2/3/9/null
      const newRatingStr = m.llmResult?.rating ?? null;
      const newRating = categoryToRating(newRatingStr);
      const s2jev = m.stage2DataToSave?.parsed_output?.jev ?? {};
      const sip = s2jev.superIpSlogan ?? null;
      const floor = s2jev.memFloorBlock ?? null;
      const base = {
        addr: row.token_address, symbol: row.token_symbol, is_valid: row.is_valid !== false,
        cur: curRating, curStr: resolveFinalRating(row),
        new: newRating, newStr: newRatingStr,
        newScore: r2(m.stage3DataToSave?.parsed_output?.total_score ?? m.stage2DataToSave?.parsed_output?.scoringResult?.total_score),
        reason: (m.llmResult?.reason || '').slice(0, 90),
        analyzed_at: row.analyzed_at,
      };

      if (curRating === 1 && (newRating === 2 || newRating === 3)) {
        (sip?.hit ? groups.rescue : groups.w2).push({ ...base, sip, floor });
      } else if (curRating === 1 && sip?.hit) {
        groups.hitNoFlip.push({ ...base, sip, floor });
      } else if ((curRating === 2 || curRating === 3) && newRating === 1) {
        (floor ? groups.memFloor : groups.w1).push({ ...base, sip, floor });
      }
    }
    if (rows.length < PAGE) break;
  }

  const fmtSip = (s) => s ? `superIp=${s.superIp} rel+${s.relPositive}/none${s.relNone} mem=${s.mem} ${s.timing} fit${s.strongFit}` : 'no-audit';
  const show = (list, cap = 300) => {
    for (const r of list.slice(0, cap)) {
      console.log(`  ${r.symbol} ${r.addr}${r.is_valid ? '' : ' [is_valid=false]'} | 现行${r.curStr} → 重放${r.newStr}${r.newScore != null ? `(${r.newScore})` : ''} | ${fmtSip(r.sip)}${r.floor ? ` | floor mem=${r.floor.mem}` : ''}`);
      if (r.reason) console.log(`      reason: ${r.reason}`);
    }
    if (list.length > cap) console.log(`  …另有 ${list.length - cap} 行（--json 落盘看全量）`);
  };

  console.log(`\n===== C88 存量行为面扫描（token_narrative 全表 ${total} 行；标准路径 ${total - noStd - threw}；跳过 precheck/prestage/无 web3_user_name_entity_acceptance ${noStd}；mapper 异常 ${threw}）=====`);
  console.log(`\n── ① 救援翻转面（现行 low ∧ 重放 mid/high ∧ 五腿全中）${groups.rescue.length} 行 ──`);
  show(groups.rescue);
  console.log(`\n── ①b 五腿命中但未翻转（刻意不豁的门仍拦——D/E 量级臂/W 数学等）${groups.hitNoFlip.length} 行 ──`);
  show(groups.hitNoFlip);
  console.log(`\n── ② mem 地板误伤面（现行 mid/high ∧ mem<2 ∧ fresh ∧ 标准数学域）${groups.memFloor.length} 行 ──`);
  show(groups.memFloor);
  console.log(`\n── W1 警示（现行 mid/high → 重放 low 但非 memFloor；预期空，非空=扫描上下文失真）${groups.w1.length} 行 ──`);
  show(groups.w1);
  console.log(`\n── W2 警示（现行 low → 重放 mid/high 但非五腿；预期空，非空=扫描上下文失真）${groups.w2.length} 行 ──`);
  show(groups.w2);

  const jsonIdx = process.argv.indexOf('--json');
  if (jsonIdx > 0 && process.argv[jsonIdx + 1]) {
    const fs = require('fs');
    fs.writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(groups, null, 1));
    console.log(`\n全量 JSON 已落盘: ${process.argv[jsonIdx + 1]}`);
  }

  const hit = groups.rescue.length + groups.memFloor.length;
  console.log(`\n结论: 救援翻转 ${groups.rescue.length} 行 / mem 地板误伤 ${groups.memFloor.length} 行${hit ? '（两清单待用户过目后才重启 worker）' : ''}`);
  process.exit(hit > 0 || groups.w1.length > 0 || groups.w2.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
