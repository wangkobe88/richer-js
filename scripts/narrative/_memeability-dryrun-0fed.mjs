#!/usr/bin/env node
/**
 * referent_memeability 恒带 dry-run（0fed29f9 标准路径 96 票）
 *
 * 验证目标：J1.21 的 referent_memeability 题从 superIP 条件题扩为标准路径恒带后，
 * 分数与实际盈亏的对齐度——用户裁定方向（2026-10-08）：「币安汽车/日产」这类
 * 蹭过头的名词票（无梗无二创空间、不可能成为 meme 币）应被拦，但「永生/Taigan/
 * 皮草」这类有形象载体的不敢一棒子打死。
 *
 * 方法（校准方法论，state 保真）：线上 stage1_prompt.state 原文复用 +
 * buildStandardQuestions({includeBrandHijack, referentMemeability: true}) +
 * 只读 answers.referent_memeability.score（不动现行 mapper 门，纯观测）。
 *
 * 用法（182）：node scripts/narrative/_memeability-dryrun-0fed.mjs
 */
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(resolve(__dirname, '../..'));

const { NarrativeRepository } = await import('../../src/narrative/db/NarrativeRepository.mjs');
const { JevClient } = await import('../../src/narrative/analyzer/llm/JevClient.mjs');
const { buildStandardQuestions, shouldIncludeBrandHijackCheck, JEV_QUESTIONS_VERSION } = await import('../../src/narrative/analyzer/llm/jev-questions.mjs');

const timing = JSON.parse(fs.readFileSync(resolve(__dirname, '../../data/analysis-0fed29f9-timing.json'), 'utf8'));
const netByAddr = new Map(timing.map(r => [r.addr, r.net]));

async function main() {
  const supabase = NarrativeRepository.getSupabase();
  const addrs = [...netByAddr.keys()];
  const rows = [];
  for (let i = 0; i < addrs.length; i += 50) {
    const { data } = await supabase.from('token_narrative')
      .select('token_address, token_symbol, is_valid, analyzed_at, twitter_info, classified_urls, extracted_info, raw_api_data, token_category, analysis_stage, stage1_prompt')
      .in('token_address', addrs.slice(i, i + 50));
    rows.push(...(data || []));
  }
  // 同地址多行去重：is_valid 优先，同则 analyzed_at 最新（与线上 analyze() 缓存命中同口径）
  const dedup = new Map();
  for (const r of rows) {
    const prev = dedup.get(r.token_address);
    if (!prev || (r.is_valid && !prev.is_valid) || (r.is_valid === prev.is_valid && r.analyzed_at > prev.analyzed_at)) dedup.set(r.token_address, r);
  }
  // 只跑标准路径票（super_ip_fast 走独立通道，另行处理）
  const std = [...dedup.values()].filter(r => r.token_category !== 'super_ip_fast');
  console.log(`票数: ${std.length}/${rows.length}（排除 super_ip_fast ${rows.length - std.length}）问题集 ${JEV_QUESTIONS_VERSION}+mem`);

  const out = new Map();
  const askOne = async (row) => {
    let state = null, stateSrc = 'online';
    try {
      const p = typeof row.stage1_prompt === 'string' ? JSON.parse(row.stage1_prompt) : row.stage1_prompt;
      state = p?.state || null;
    } catch { /* 旧行非 JSON */ }
    const base = { addr: row.token_address, symbol: row.token_symbol, net: netByAddr.get(row.token_address), cat: row.token_category };
    if (!state) return { ...base, memScore: null, stateSrc: 'rebuilt-no-state' };
    const includeBrandHijack = shouldIncludeBrandHijackCheck(row.token_symbol, row.raw_api_data?.name || '');
    try {
      const q = buildStandardQuestions({ includeBrandHijack, referentMemeability: true });
      const r = await JevClient.ask(state, q, { label: `mem:${row.token_symbol}` });
      const mem = r.answers?.referent_memeability?.score ?? null;
      const nr = r.answers?.name_referent;
      return { ...base, memScore: mem, stateSrc, nrChoice: nr?.choice ?? null };
    } catch (e) {
      return { ...base, memScore: null, stateSrc: 'err:' + e.message.slice(0, 60) };
    }
  };
  // 多 pass：上游 529 过载时 JevClient 内置 2 次短退避不够，失败票隔 60s 补跑（最多 4 pass）
  for (let pass = 1; pass <= 4; pass++) {
    const todo = std.filter(r => {
      const rec = out.get(r.token_address);
      return !rec || (rec.memScore == null && String(rec.stateSrc).startsWith('err:'));
    });
    if (!todo.length) break;
    if (pass > 1) {
      const errs = todo.length;
      console.log(`pass ${pass}: 补跑 ${errs} 张失败票（60s 冷却后）`);
      await new Promise(z => setTimeout(z, 60000));
    }
    let done = 0;
    for (const row of todo) {
      out.set(row.token_address, await askOne(row));
      if (++done % 10 === 0) console.log(`  pass${pass} ${done}/${todo.length}`);
    }
  }
  const outArr = std.map(r => out.get(r.token_address)).filter(Boolean);
  fs.writeFileSync(resolve(__dirname, '../../data/memeability-dryrun-0fed.json'), JSON.stringify(outArr, null, 1));

  // 交叉
  const sum = a => a.reduce((x, y) => x + y, 0);
  console.log('\n===== memScore × 盈亏 =====');
  const byScore = new Map();
  for (const r of outArr) { if (r.memScore == null) continue; if (!byScore.has(r.memScore)) byScore.set(r.memScore, []); byScore.get(r.memScore).push(r); }
  for (const [s, l] of [...byScore.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`mem=${s}: ${String(l.length).padStart(2)} 票 净 ${sum(l.map(r => r.net)).toFixed(3).padStart(7)} 胜 ${l.filter(r => r.net > 0).length} | ${l.map(r => `${r.symbol}(${r.net.toFixed(2)})`).slice(0, 8).join(' ')}`);
  }
  const noMem = outArr.filter(r => r.memScore == null);
  if (noMem.length) console.log(`无分: ${noMem.length} 票（${noMem.map(r => r.stateSrc).join(';').slice(0, 100)}）`);
  console.log('\n导出: data/memeability-dryrun-0fed.json');
}

main().catch(e => { console.error(e); process.exit(1); });
