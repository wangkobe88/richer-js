#!/usr/bin/env node
/**
 * _test_narrative_schema_columns — 2026-10-24 叙事 DB 适配（列名重构 + B2 投影列）
 *
 * 零 DB 零网络。三组防线：
 *   S 段（源码口径）：STAGE_FIELDS/STAGE_RESULT_ONLY_FIELDS/RESULT_ONLY_FIELDS 展开形态、
 *         buildStageSaveData ioName 门（jev IO 单份真源；event_score/relation 段只产 result 键）
 *   D 段（DDL↔代码对拍）：RENAME 10 条齐全、投影 DDL 11 列与 projectColumns 输出键
 *         set-equal、event_category CHECK 域与 EVENT_CATEGORY_DOMAIN 一致、索引 4 条
 *   P 段（projectColumns 纯函数直测）：终态精确值 / 幂等 / 边角四组（__clear 信封、
 *         非数字 score、空串 blockReason、pcr __clear 非终态、unrated 透传）
 *
 * 与 _test_narrative_repo_save_thin（save 集成路：合并语义+挂点）互补；
 * 与 _test_narrative_version_columns（Analyzer 三臂路由）互补。
 */

const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
function assert(cond, name, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? `（${detail}）` : ''}`); }
}

const repoPath = path.join(__dirname, '../src/narrative/db/NarrativeRepository.mjs');
const anaPath = path.join(__dirname, '../src/narrative/analyzer/NarrativeAnalyzer.mjs');
const renameSql = fs.readFileSync(path.join(__dirname, '../migrations/rename_token_narrative_stage_columns.sql'), 'utf8');
const projSql = fs.readFileSync(path.join(__dirname, '../migrations/add_token_narrative_projection_columns.sql'), 'utf8');
const idxSql = fs.readFileSync(path.join(__dirname, '../migrations/add_token_narrative_query_indexes.sql'), 'utf8');

async function main() {
  const repoSrc = fs.readFileSync(repoPath, 'utf8');
  const anaSrc = fs.readFileSync(anaPath, 'utf8');

  console.log('[S] 源码口径：阶段字段分组与 jev IO 单份');
  {
    // S1 STAGE_FIELDS 两组（prestage 独立 IO 组 / event→jev IO 组）
    const stageBlock = repoSrc.split('const STAGE_FIELDS = [')[1]?.split('];')[0] || '';
    assert(stageBlock.includes("{ resultPrefix: 'prestage', ioPrefix: 'prestage' }")
      && stageBlock.includes("{ resultPrefix: 'event', ioPrefix: 'jev' }"),
      'STAGE_FIELDS 两组形态（prestage/prestage + event/jev）');
    // S2 仅 result 段两组 + null 覆盖段两组
    assert(/const STAGE_RESULT_ONLY_FIELDS = \[\s*'event_score',\s*'relation',\s*\]/.test(repoSrc),
      'STAGE_RESULT_ONLY_FIELDS = [event_score, relation]');
    assert(/const RESULT_ONLY_FIELDS = \[\s*'pre_check',\s*'final',\s*\]/.test(repoSrc),
      'RESULT_ONLY_FIELDS = [pre_check, final]');
    // S3 buildStageSaveData ioName 门：null 只产 result 键（冗余拷贝停写的代码位）
    const fnBlock = anaSrc.split('function buildStageSaveData(')[1]?.split('\n}') [0] || '';
    assert(/if \(ioName\) \{/.test(fnBlock)
      && fnBlock.includes('out[`${ioName}_prompt`]')
      && fnBlock.includes('out[`${ioName}_raw_output`]'),
      'buildStageSaveData：ioName 门控 IO 两键');
    // S4 四调用点形态：event 带 jev、prestage 带 prestage、event_score/relation 无 ioName
    assert(/buildStageSaveData\('prestage', prestageDataToSave, \{\}, \{ ioName: 'prestage' \}\)/.test(anaSrc),
      "prestage 调用 ioName='prestage'");
    assert(/buildStageSaveData\('event', stage1DataToSave, \{\}, \{ ioName: 'jev' \}\)/.test(anaSrc),
      "event 调用 ioName='jev'（完整 IO 落库位）");
    assert(/buildStageSaveData\('event_score', stage2DataToSave\)/.test(anaSrc),
      'event_score 调用无 ioName（只产 result 键）');
    assert(/buildStageSaveData\('relation', stage3DataToSave\)/.test(anaSrc),
      'relation 调用无 ioName（只产 result 键）');
    // S5 旧列名在生产代码归零（内存 plumbing 变量与原名对照注释豁免）
    const legacyRef = /['"`]stage(1|2|3|_final)_(result|prompt|raw_output)['"`]/;
    assert(!legacyRef.test(repoSrc) && !legacyRef.test(anaSrc),
      'Repository/Analyzer 无旧列名字符串残留');
  }

  console.log('[D] DDL↔代码对拍');
  {
    // D1 RENAME 10 条齐全（旧→新名字对逐条锁定）
    const renames = [
      ['stage1_result', 'event_result'],
      ['stage2_result', 'event_score_result'],
      ['stage3_result', 'relation_result'],
      ['stage_final_result', 'final_result'],
      ['stage1_prompt', 'jev_prompt'],
      ['stage1_raw_output', 'jev_raw_output'],
      ['stage2_prompt', 'legacy_stage2_prompt'],
      ['stage3_prompt', 'legacy_stage3_prompt'],
      ['stage2_raw_output', 'legacy_stage2_raw_output'],
      ['stage3_raw_output', 'legacy_stage3_raw_output'],
    ];
    const missing = renames.filter(([o, n]) =>
      !new RegExp(`RENAME COLUMN ${o}\\s+TO ${n};`).test(renameSql));
    assert(missing.length === 0, `RENAME 10 条齐全（缺：${missing.map(m => m.join('→')).join(', ') || '无'}）`);
    assert(/BEGIN;/.test(renameSql) && /COMMIT;/.test(renameSql), 'RENAME 事务包裹');

    // D2 投影 DDL 11 列与 projectColumns 输出键 set-equal
    const { projectColumns } = await import(
      path.join(__dirname, '../src/narrative/db/NarrativeRepository.mjs'));
    const ddlCols = [...projSql.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)\s+/g)].map(m => m[1]);
    const fnKeys = Object.keys(projectColumns({}));
    assert(ddlCols.length === 11, `投影 DDL 恰 11 列（实际 ${ddlCols.length}）`);
    assert(JSON.stringify([...ddlCols].sort()) === JSON.stringify([...fnKeys].sort()),
      `DDL 列集 === projectColumns 输出键集（DDL：${ddlCols.join(',')}｜函数：${fnKeys.join(',')}）`);

    // D3 event_category CHECK 域与 EVENT_CATEGORY_DOMAIN 一致
    const ddlDomain = (projSql.match(/event_category\s+varchar\(1\) CHECK \(event_category IN \(([^)]+)\)\)/)?.[1] || '')
      .split(',').map(s => s.trim().replace(/'/g, '')).sort().join(',');
    const codeDomainBlock = repoSrc.split('const EVENT_CATEGORY_DOMAIN = ')[1]?.split(';')[0] || '';
    const codeDomain = codeDomainBlock.match(/'([A-Z])'/g)?.map(s => s.replace(/'/g, '')).sort().join(',') || '';
    assert(ddlDomain === codeDomain && ddlDomain.length > 0,
      `category CHECK 域一致（DDL：${ddlDomain}｜代码：${codeDomain}）`);

    // D4 索引 4 条（实证全表扫修复 ×2 + 投影 partial ×2）
    for (const idx of ['idx_token_narrative_analyzed_at', 'idx_token_narrative_created_at',
      'idx_token_narrative_rating', 'idx_token_narrative_blocked']) {
      if (!idxSql.includes(idx)) { assert(false, `索引存在 ${idx}`); }
    }
    assert(true, '索引 4 条齐全');
  }

  console.log('[P] projectColumns 纯函数');
  {
    const { projectColumns } = await import(
      path.join(__dirname, '../src/narrative/db/NarrativeRepository.mjs'));

    // P1 终态精确值
    const out1 = projectColumns({
      event_result: { rating: 'pass', pass: true, category: 'E' },
      event_score_result: { rating: 'pass', pass: true },
      relation_result: { rating: 'pass', pass: true },
      final_result: {
        rating: 'high', pass: true, score: 76.5,
        details: { eventCompositeScore: 40.2, relevanceScore: 18.3, qualityScore: 12.0, blockReason: null },
      },
      analysis_path: 'standard', jev_version: 'jev-121', prestage_version: null,
    });
    assert(out1.final_rating === 'high' && out1.total_score === 76.5
      && out1.event_score === 40.2 && out1.relevance_score === 18.3 && out1.quality_score === 12.0
      && out1.event_category === 'E' && out1.block_stage === null && out1.block_reason === null,
      '终态精确值全键');
    assert(out1.analysis_path === 'standard' && out1.jev_version === 'jev-121',
      '版本/路径三键透传');

    // P2 幂等：同一合并态两次调用 deep-equal（intermediate 轮重投影语义）
    const state = {
      pre_check_result: { pass: true },
      event_result: { rating: 'pass', pass: true, category: 'B' },
      final_result: { rating: 'mid', pass: true, score: 55.5, details: { eventCompositeScore: 30 } },
    };
    assert(JSON.stringify(projectColumns(state)) === JSON.stringify(projectColumns(state)),
      '纯函数幂等（同输入两次调用同输出）');

    // P3 __clear 信封当 null（拦截/清列轮不产分数）
    const out3 = projectColumns({
      final_result: { __clear: true },
      event_result: { rating: 'pass', pass: true, category: 'E' },
    });
    assert(out3.total_score === null && out3.event_category === 'E',
      'fin __clear → 分数不落；event 未清照落 category');

    // P4 非数字 score / 空 blockReason 不落
    const out4 = projectColumns({
      final_result: { rating: 'mid', pass: true, score: '76.5',
        details: { eventCompositeScore: null, blockReason: '' } },
    });
    assert(out4.total_score === null && out4.event_score === null && out4.block_reason === null,
      '非数字 score/空串 blockReason 宁缺勿落');

    // P5 pcr __clear 非终态（precheck 轮清列后残留 pass:false 不得触发 precheck 分支）
    const out5 = projectColumns({
      pre_check_result: { __clear: true },
      final_result: { rating: 'high', pass: true, score: 80, details: {} },
    });
    assert(out5.block_stage === null && out5.total_score === 80,
      'pcr __clear 非终态 → 照常投影 fin 分数');

    // P6 unrated 透传 + precheck 终态（ruleName 兜底路径）
    const out6 = projectColumns({
      pre_check_result: { rating: 'unrated', pass: false, details: { ruleName: 'no_public_info' } },
      final_result: { rating: 'high', pass: true, score: 76.99, details: { eventCompositeScore: 50 } },
    });
    assert(out6.final_rating === 'unrated' && out6.block_stage === 'precheck'
      && out6.block_reason === 'no_public_info' && out6.total_score === null,
      'unrated 透传 + precheck 终态清分 + ruleName 兜底');
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('测试运行失败:', e);
  process.exit(1);
});
