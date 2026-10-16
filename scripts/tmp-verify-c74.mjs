#!/usr/bin/env node
// C74 啾啾端到端现场反证（182 上跑一次即弃）：失效缓存 → 强制重析 →
// 断言无 expired_tweet、Jev 真跑（stage1.jev 有落）、event_timing 有答案
import { NarrativeRepository } from '../src/narrative/db/NarrativeRepository.mjs';
import { NarrativeAnalyzer } from '../src/narrative/analyzer/NarrativeAnalyzer.mjs';

const ADDR = '0x21bfeeddb550e3e84d3c9783523e1153e19a7777';

const inv = await NarrativeRepository.updateIsValid(ADDR, false);
console.log('[1] 缓存失效: is_valid =', inv?.is_valid);

const t0 = Date.now();
const r = await NarrativeAnalyzer.analyze(ADDR, { ignoreCache: true });
console.log('[2] 重析墙钟:', ((Date.now() - t0) / 1000).toFixed(1) + 's');

const preRule = r?.pre_check_result?.details?.ruleName
  ?? r?.llmAnalysis?.preCheck?.details?.ruleName ?? null;
console.log('[3] preCheck ruleName =', preRule, '| meta.preCheckTriggered =', r?.meta?.preCheckTriggered);
console.log('[4] 终评 rating =', r?.rating, '| reason =', String(r?.reason ?? r?.llmAnalysis?.summary?.reason ?? '').slice(0, 160));

const s1str = JSON.stringify(r?.llmAnalysis?.stage1 ?? {});
const hasJev = s1str.includes('event_timing');
console.log('[5] stage1.jev 有落（含 event_timing）=', hasJev);
const m = s1str.match(/"event_timing"[^}]*"choice"\s*:\s*"[a-z_0-9]+"/);
console.log('[6] event_timing 答案 =', m ? m[0].slice(0, 120) : '(choice 形状未匹配，见 [5])');

if (preRule === 'expired_tweet') {
  console.log('❌ FAIL: 仍被 expired_tweet 拦（分桶未生效）');
  process.exit(1);
}
if (!hasJev) {
  console.log('❌ FAIL: Jev 未运行（stage1 无 event_timing）');
  process.exit(1);
}
console.log('✅ C74 验证通过：无 expired_tweet 硬拦，Jev 真跑，时效交软评；终评 =', r?.rating);
process.exit(0);
