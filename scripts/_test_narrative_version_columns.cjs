#!/usr/bin/env node
/**
 * _test_narrative_version_columns — 2026-10-24 B2 投影列版本/路径三键
 *
 * 零 DB 零网络：源码口径断言 NarrativeAnalyzer 的
 *   jev_version      恒 `jev-${JEV_QUESTIONS_VERSION}`（唯一赋值点=声明行——prestage
 *                    分支不覆盖，终结 prompt_version 单列双格式互斥覆盖的歧义）
 *   prestage_version 仅 prestage 分支成功路径赋值（`jev-${JEV_PRESTAGE_QUESTIONS_VERSION}`）
 *   analysis_path    三臂路由：precheck 终态 > 纯 prestage 终局 > standard
 *                    （prestage 定档后续走标准评估的 abm 形状归 standard——终局由标准链产出）
 *
 * Repository 侧三键 `?? existing` 三态合并由 _test_narrative_repo_save_thin P4 覆盖；
 * 列集与 DDL 对拍由 _test_narrative_schema_columns 覆盖。本件锁 Analyzer 路由位。
 */

const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
function assert(cond, name, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? `（${detail}）` : ''}`); }
}

async function main() {
  const src = fs.readFileSync(
    path.join(__dirname, '../src/narrative/analyzer/NarrativeAnalyzer.mjs'), 'utf8');

  console.log('[V] 版本双变量不变量');
  {
    // V1 jevVersion 唯一赋值 = 声明行（恒标准题集版本；prestage 分支不碰）
    const declCount = (src.match(/let jevVersion = `jev-\$\{JEV_QUESTIONS_VERSION\}`;/g) || []).length;
    const assignCount = (src.match(/^.*jevVersion\s*=[^=]/gm) || []).length;
    assert(declCount === 1 && assignCount === 1,
      `jevVersion 唯一赋值=声明行（声明 ${declCount}/赋值 ${assignCount}）`);

    // V2 prestageVersion 声明 null + 唯一赋值点在 prestage 分支（紧邻 promptVersion 覆盖）
    const decl2 = (src.match(/let prestageVersion = null;/g) || []).length;
    const assign2 = src.match(/.*prestageVersion\s*=\s*`jev-\$\{JEV_PRESTAGE_QUESTIONS_VERSION\}`;/g) || [];
    assert(decl2 === 1 && assign2.length === 1,
      'prestageVersion 声明 null + 唯一赋值（prestage 分支）');
    // 唯一赋值点须在 prestageDataToSave 保存路径之前（同分支块内）——锚 promptVersion 覆盖行
    const prestageAssignLine = src.indexOf(assign2[0]);
    const promptOverrideLine = src.indexOf("promptVersion = `jev-${JEV_PRESTAGE_QUESTIONS_VERSION}`;");
    assert(promptOverrideLine > 0 && prestageAssignLine > promptOverrideLine
      && prestageAssignLine - promptOverrideLine < 200,
      'prestageVersion 赋值紧邻 prestage 分支 promptVersion 覆盖（同块）');

    // V3 版本常量 import 源（断代红线：改题集必须 bump）
    assert(/import \{ buildStandardQuestions, JEV_QUESTIONS_VERSION \} from '\.\/llm\/jev-questions\.mjs';/.test(src)
      && /import \{ JEV_PRESTAGE_QUESTIONS_VERSION \} from '\.\/llm\/jev-prestage-questions\.mjs';/.test(src),
      '版本常量 import 自题集模块');
  }

  console.log('[A] analysis_path 三臂路由');
  {
    // A1 三臂表达式逐臂锁定（精确源码口径）
    assert(src.includes("const analysisPath = preCheckDataToSave?.pass === false"),
      '臂 1（最高优先）：precheck 终态 → precheck_terminal');
    assert(src.includes("? 'precheck_terminal'")
      && src.includes("(prestageDataToSave && prestageDataToSave.__clear !== true")
      && src.includes("&& (!stage1DataToSave || stage1DataToSave.__clear === true))")
      && src.includes("? 'prestage'")
      && src.includes(": 'standard';"),
      '臂 2：prestage 未清 && 标准段未产/被清 → prestage（abm 续走标准归 standard）');

    // A2 三臂判据顺序语义反证：precheck 终态在前（纯 prestage 定档票若 pcr 也 fail，
    // 归 precheck_terminal——拦截比定档优先，block_stage='precheck' 才对齐）。
    // 锚串带 `))` 收尾（仅 analysisPath 表达式形态——裸前缀在 deriveTokenCategory 也有）
    const idxPrecheck = src.indexOf("const analysisPath = preCheckDataToSave?.pass === false");
    const idxPrestage = src.indexOf("&& (!stage1DataToSave || stage1DataToSave.__clear === true))");
    assert(idxPrecheck > 0 && idxPrestage > idxPrecheck, 'precheck 臂先于 prestage 臂');
  }

  console.log('[F] final save 接线');
  {
    // F1 dbSave.final 携带三键（Analyzer→Repository 直传位）
    const finalBlock = src.split("timing.wrap('dbSave.final'")[1]?.split('}));')[0] || '';
    assert(finalBlock.includes('analysis_path: analysisPath')
      && finalBlock.includes('jev_version: jevVersion')
      && finalBlock.includes('prestage_version: prestageVersion'),
      'final save 三键直传');
    // F2 prompt_version 旧列照写（存量读点兼容；双格式歧义由两新列终结）
    assert(finalBlock.includes('prompt_version: promptVersion,'),
      'prompt_version 旧列照写（兼容存量）');
    // F3 Repository 三态合并位（record 构建区 ?? existing）
    const repoSrc = fs.readFileSync(
      path.join(__dirname, '../src/narrative/db/NarrativeRepository.mjs'), 'utf8');
    assert(/analysis_path: result\.analysis_path \?\? existing\?\.analysis_path \?\? null,/.test(repoSrc)
      && /jev_version: result\.jev_version \?\? existing\?\.jev_version \?\? null,/.test(repoSrc)
      && /prestage_version: result\.prestage_version \?\? existing\?\.prestage_version \?\? null,/.test(repoSrc),
      'Repository 三键 ?? existing 三态合并');
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('测试运行失败:', e);
  process.exit(1);
});
