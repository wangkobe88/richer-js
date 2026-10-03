#!/usr/bin/env node
/** 临时 dump（2026-10-03，flap/BOB 豁免口径设计）：两票语料官方特征——作者/认证/文内自称 */
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(resolve(__dirname, '../..'));
const { NarrativeRepository } = await import('../../src/narrative/db/NarrativeRepository.mjs');

const supabase = NarrativeRepository.getSupabase();
const { data: rows } = await supabase.from('token_narrative')
  .select('token_address, token_symbol, raw_api_data, extracted_info, classified_urls, twitter_info, stage1_prompt')
  .in('token_address', ['0x2fb77ad099f60c0fdb0a8301bf94c4a8d8ac7777', '0xf2fca4cf09986e97220c2371e3184c91b4637777']);
for (const row of rows) {
  console.log(`════ ${row.token_symbol} ${row.token_address}`);
  const tw = row.twitter_info || {};
  console.log(`  raw name=${JSON.stringify(row.raw_api_data?.name)} symbol=${row.raw_api_data?.symbol}`);
  console.log(`  主推作者: handle=${tw.author?.handle ?? tw.author_handle ?? '?'} name=${JSON.stringify(tw.author?.name)} verified=${tw.author?.verified} followers=${tw.author?.followers_count ?? tw.followers_count}`);
  const texts = [];
  if (tw.full_text) texts.push(tw.full_text);
  if (Array.isArray(tw.tweets)) for (const t of tw.tweets.slice(0, 5)) texts.push(t.full_text || t.text || '');
  console.log(`  推文前5条: ${JSON.stringify(texts).slice(0, 1200)}`);
  console.log(`  classified_urls 桶: ${JSON.stringify(Object.fromEntries(Object.entries(row.classified_urls || {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])))}`);
  try {
    const p = typeof row.stage1_prompt === 'string' ? JSON.parse(row.stage1_prompt) : row.stage1_prompt;
    const st = p?.state || '';
    console.log(`  state 前 600: ${st.slice(0, 600)}`);
  } catch { }
  console.log('');
}
process.exit(0);
