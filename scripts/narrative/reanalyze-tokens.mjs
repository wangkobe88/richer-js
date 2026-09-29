#!/usr/bin/env node
/**
 * 一次性正式重析（落库）：指定 token 地址列表走 NarrativeAnalyzer.analyze
 * ({ignoreCache:true})，评级/审计标记写入 token_narrative。
 *
 * 用法：node scripts/narrative/reanalyze-tokens.mjs <addr> [addr ...]
 * （在 182 跑；单条小写入，非批量扫描）
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(resolve(__dirname, '../..'));

const { NarrativeAnalyzer } = await import('../../src/narrative/analyzer/NarrativeAnalyzer.mjs');

async function main() {
  const addrs = process.argv.slice(2);
  if (!addrs.length) {
    console.error('用法: node scripts/narrative/reanalyze-tokens.mjs <addr> [addr ...]');
    process.exit(1);
  }
  for (const addr of addrs) {
    try {
      const r = await NarrativeAnalyzer.analyze(addr, { ignoreCache: true });
      console.log(`${addr} → rating=${r?.rating} score=${r?.score ?? '-'} pass=${r?.pass} stage=${r?.analysis_stage ?? '-'}`);
      console.log(`  reason: ${r?.reason ?? '-'}`);
    } catch (e) {
      console.error(`${addr} 重析异常:`, e?.message || e);
      process.exitCode = 1;
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
