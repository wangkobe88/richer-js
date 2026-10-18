#!/usr/bin/env node
// ============================================================================
// 黑名单账号语言复查（2026-10-18，wangzbnb 误收事故后补验）
//   背景：批量收录时 fetch-followers 只取 limit 1 单样本，wangzbnb 实际中英混发
//   （BSC 本土中文找角度号），不符合「宣发全英文」标准。
//   本脚本：config/default.json twitterBlacklist 全量，每号拉 8 条语料快照
//   （token_narrative.twitter_info contains），落原始样本供 CJK 分析。
//   输出：/tmp/blacklist-language-samples.json  [{handle, followers[], texts[]}]
//   ⚠ 只读；在 182 跑
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const fs = require('fs');

async function main() {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/default.json'), 'utf8'));
  const handles = config.narrative.twitterBlacklist.map(h => String(h).toLowerCase());
  console.log(`[0] 黑名单 ${handles.length} 个，逐号拉 8 条语料样本`);
  const { createClient } = require('@supabase/supabase-js');
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  const c = createClient(process.env.SUPABASE_URL, key);
  const out = [];
  const t0 = Date.now();
  for (let i = 0; i < handles.length; i++) {
    const handle = handles[i];
    const { data } = await c.from('token_narrative')
      .select('twitter_info->author_followers_count, twitter_info->text, twitter_info->created_at')
      .contains('twitter_info', { author_screen_name: handle })
      .order('created_at', { ascending: false })
      .limit(8);
    const rows = data || [];
    const texts = [...new Set(rows.map(r => String(r.text || '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
    const followers = rows.map(r => r.author_followers_count ?? null).filter(x => x !== null);
    out.push({ handle, samples: rows.length, uniqTexts: texts.length, followers, texts: texts.slice(0, 8) });
    if ((i + 1) % 20 === 0) console.log(`  …${i + 1}/${handles.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  fs.writeFileSync('/tmp/blacklist-language-samples.json', JSON.stringify(out, null, 1));
  const hit = out.filter(x => x.samples > 0).length;
  console.log(`[1] 完成：有样本 ${hit}/${out.length}，落盘 /tmp/blacklist-language-samples.json`);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
