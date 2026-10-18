#!/usr/bin/env node
// ============================================================================
// 候选宣发号粉丝数/推文样本批量精查（2026-10-18，黑名单甄别辅助）
//   输入：/tmp/candidate-handles.json（scan-angle-devs-blacklist.cjs 产出）
//   数据源：token_narrative.twitter_info（jsonb contains 单号查询，limit 1 只取样本）
//   输出：/tmp/candidate-followers.json  handle → {followers, text 样本, hit}
//   ⚠ 只读扫描；在 182 跑
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const fs = require('fs');

async function main() {
  const { createClient } = require('@supabase/supabase-js');
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  const c = createClient(process.env.SUPABASE_URL, key);
  const cands = JSON.parse(fs.readFileSync('/tmp/candidate-handles.json', 'utf8'));
  console.log(`[0] 候选 ${cands.length} 个，逐号查 twitter_info`);
  const out = [];
  const t0 = Date.now();
  for (let i = 0; i < cands.length; i++) {
    const { handle, n, uniqC } = cands[i];
    const { data } = await c.from('token_narrative')
      .select('twitter_info->author_followers_count, twitter_info->author_friends_count, twitter_info->text, twitter_info->author_screen_name')
      .contains('twitter_info', { author_screen_name: handle })
      .limit(1);
    const row = data && data[0];
    out.push({
      handle, n, uniqC,
      hit: !!row,
      followers: row ? (row.author_followers_count ?? null) : null,
      text: row && row.text ? String(row.text).replace(/\s+/g, ' ').slice(0, 90) : null,
    });
    if ((i + 1) % 100 === 0) console.log(`  …${i + 1}/${cands.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  fs.writeFileSync('/tmp/candidate-followers.json', JSON.stringify(out, null, 1));
  const hit = out.filter(x => x.hit).length;
  console.log(`[1] 完成：hit=${hit}/${out.length}，落盘 /tmp/candidate-followers.json`);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
