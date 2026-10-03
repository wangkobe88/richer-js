#!/usr/bin/env node
/** 临时 dump（2026-10-03，flap 豁免接线验证）：FlapGuy/BOB 的 twitter_info 实际形状——
 *  detectPlatformOfficial 读哪个字段才能命中 flapdotsh */
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(resolve(__dirname, '../..'));
const { NarrativeRepository } = await import('../../src/narrative/db/NarrativeRepository.mjs');

const supabase = NarrativeRepository.getSupabase();
const { data: rows } = await supabase.from('token_narrative')
  .select('token_address, token_symbol, twitter_info')
  .in('token_address', ['0x2fb77ad099f60c0fdb0a8301bf94c4a8d8ac7777', '0xf2fca4cf09986e97220c2371e3184c91b4637777']);
for (const row of rows) {
  const tw = row.twitter_info || {};
  console.log(`════ ${row.token_symbol} ${row.token_address}`);
  console.log(`  keys: ${Object.keys(tw).join(',')}`);
  console.log(`  type=${tw.type} author_screen_name=${JSON.stringify(tw.author_screen_name)} screen_name=${JSON.stringify(tw.screen_name)} author=${JSON.stringify(tw.author)?.slice(0, 120)}`);
  if (Array.isArray(tw.tweets)) {
    console.log(`  tweets[0].author_screen_name=${JSON.stringify(tw.tweets[0]?.author_screen_name)} tweets.length=${tw.tweets.length}`);
  }
  if (tw.in_reply_to) {
    console.log(`  in_reply_to.author_screen_name=${JSON.stringify(tw.in_reply_to.author_screen_name)}`);
  }
}
process.exit(0);
