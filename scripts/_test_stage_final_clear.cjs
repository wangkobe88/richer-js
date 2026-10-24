#!/usr/bin/env node
/**
 * final_result 残留清除单测（2026-10-19 回归案バイナンス人生实锤的修复）。
 * 零 DB 零网络：源码口径断言（红线 13 事故修复配反证）+ _mergeField 纯函数。
 *
 * 事故现场：precheck 拦截路 stageFinalData=null → stageFinalSaveData={} → spread 空
 * → final_result 不进 save 列集 → 旧 high fin 残留遮蔽新拦截
 * （行实证：pcr=expired_tweet 拦截 + fin 残留旧 high 76.99 并存）。
 *
 * 用法：node scripts/_test_stage_final_clear.cjs
 */
'use strict';

const path = require('path');
const fs = require('fs');

let passed = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) { console.error(`   失败详情: ${detail || ''}`); process.exit(1); }
  passed++;
};

async function main() {
  const analyzerSrc = fs.readFileSync(path.resolve(__dirname, '../src/narrative/analyzer/NarrativeAnalyzer.mjs'), 'utf8');

  // A1 事故形状反证：precheck 路必须显式 __clear（空对象 spread 形状已死）
  check('A1 stageFinalData=null 落 { final_result: { __clear: true } }（源码口径）',
    analyzerSrc.includes('} : { final_result: { __clear: true } };'),
    'analyzer 三元 else 臂须为显式 __clear，防旧 high fin 残留');

  // A2 repository 清列路径覆盖 fin：final 走 RESULT_ONLY_FIELDS 的
  // _mergeField(__clear→null / null 覆盖) 循环（2026-10-24 列名重构：stage_final→final，
  // event/event_score/relation 走 STAGE_RESULT_ONLY_FIELDS 的 __clear 分支）
  const repoSrc = fs.readFileSync(path.resolve(__dirname, '../src/narrative/db/NarrativeRepository.mjs'), 'utf8');
  check('A2 RESULT_ONLY_FIELDS 含 final（清列路径覆盖终局信封）',
    /RESULT_ONLY_FIELDS\s*=\s*\[[^\]]*'final'[^\]]*\]/s.test(repoSrc),
    'RESULT_ONLY_FIELDS 数组须含 final');

  // A3 _mergeField __clear 语义（静态纯函数）
  const { NarrativeRepository } = await import(path.resolve(__dirname, '../src/narrative/db/NarrativeRepository.mjs'));
  check('A3 _mergeField __clear 恒 null（无视旧值/allowNull）',
    NarrativeRepository._mergeField({ __clear: true }, { rating: 'high' }) === null
      && NarrativeRepository._mergeField({ __clear: true }, null, true) === null);

  // A4 _mergeField 非 clear 语义不回归（undefined 保旧 / null 不覆盖旧值）
  check('A4 _mergeField 非 clear 语义不回归',
    NarrativeRepository._mergeField(undefined, 'old') === 'old'
      && NarrativeRepository._mergeField(null, 'old') === 'old'
      && NarrativeRepository._mergeField('new', 'old') === 'new');

  console.log(`\n全部通过 ✅（${passed} 断言，stage_final 残留清除）`);
}

main().catch((e) => { console.error('测试异常:', e); process.exit(1); });
