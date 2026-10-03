#!/usr/bin/env node
/** 临时诊断：diff 币安智能1 的线上 stage1_prompt.state 与重建 state（逐段） */
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(resolve(__dirname, '../..'));

const { NarrativeRepository } = await import('../../src/narrative/db/NarrativeRepository.mjs');
const { buildJevState } = await import('../../src/narrative/analyzer/llm/jev-state-builder.mjs');

const supabase = NarrativeRepository.getSupabase();
const { data: rows } = await supabase.from('token_narrative')
  .select('token_address, token_symbol, raw_api_data, extracted_info, classified_urls, twitter_info, analyzed_at, stage1_prompt')
  .eq('token_address', '0x4a674ed30cb3000cb53a77f2709a0e3f53e77777');
const row = rows[0];
const p = JSON.parse(row.stage1_prompt);
console.log(`══ 线上 state（${p.state.length} 字符）══`);
console.log(p.state);
console.log(`\n══ 重建 state ══`);
const tokenData = { address: row.token_address, symbol: row.token_symbol, name: row.raw_api_data?.name || '', raw_api_data: row.raw_api_data };
const fetchResults = { twitterInfo: row.twitter_info, extractedInfo: row.extracted_info || null, classifiedUrls: row.classified_urls || null, binanceSquareInfo: null };
const { state } = buildJevState(tokenData, fetchResults, { now: new Date(row.analyzed_at).getTime() });
console.log(state);
process.exit(0);
