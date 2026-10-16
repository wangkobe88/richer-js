#!/usr/bin/env node
// ============================================================================
// 「找角度」博主（频繁发币者）名单候选扫描 v2（2026-10-16）
//   v1 频次口径暴露缺陷：TOP 全是被蹭大 IP（cz_binance 9169/binance/elonmusk——
//   别人发币挂他们的推），频次≠找角度博主。v2 加 creator_address 聚合甄别：
//   handle 关联 creator 越集中=自营发币号（真候选）；越分散=被蹭 IP（排除）。
//   数据源：experiment_tokens.raw_api_data->>twitterUrl + creator_address（同源同口径
//   于 2026-04-17 老名单，全量重扫频次更准）
//   跑法：node scripts/scan-frequent-issuers.cjs [--min N]   （在 182 跑）
//   输出：console 分类候选表（self_issuer/hybrid/hijacked_ip）+ tmp JSON
//   ⚠ 只读扫描零写入；收录须人工审核后改 frequent-issuers.mjs（老流程惯例）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const fs = require('fs');

const MIN = (() => {
  const i = process.argv.indexOf('--min');
  return i > 0 ? parseInt(process.argv[i + 1], 10) : 5;
})();

// 宣告推 URL → screen_name（x.com/twitter.com 第一段；剔保留字路径）
const URL_RE = /^(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i;
const RESERVED = new Set(['home', 'search', 'i', 'intent', 'hashtag', 'settings', 'share', 'compose', 'messages']);
// 平台官方号（jev-result-mapper.mjs PLATFORM_OFFICIAL_HANDLES 同源；官方部署币 creator
// 集中会被误判 self_issuer，输出侧显式标记供人工剔除）
const OFFICIAL = new Set(['binance', 'flapdotsh']);

async function main() {
  const { createClient } = require('@supabase/supabase-js');
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  const c = createClient(process.env.SUPABASE_URL, key);

  // 现有名单（ESM 动态 import；命中者排除=只出增量候选）
  const { FREQUENT_ISSUERS } = await import('../src/narrative/analyzer/services/frequent-issuers.mjs');
  console.log(`[0] 现有名单 ${FREQUENT_ISSUERS.size} 个，扫描全量 experiment_tokens（min=${MIN}）`);

  const counts = new Map(); // handle → { n, creatorKnown, creators: Map(creator→cnt), samples }
  let cursor = '00000000-0000-0000-0000-000000000000', rows = 0, withUrl = 0, page = 0;
  const t0 = Date.now();

  for (;;) {
    // keyset 分页：id(uuid) 升序锚定（max-rows=1000 红线）；只拉 jsonb 路径列省带宽
    const { data, error } = await c.from('experiment_tokens')
      .select('id,token_symbol,creator_address,raw_api_data->>twitterUrl')
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(1000);
    if (error) throw new Error(`分页拉取失败@id>${cursor}: ${error.message}`);
    if (!data.length) break;
    page++;
    for (const r of data) {
      rows++;
      const tw = r.twitterUrl;
      if (!tw || typeof tw !== 'string') continue;
      const m = tw.match(URL_RE);
      if (!m) continue;
      const handle = m[1].toLowerCase();
      if (RESERVED.has(handle)) continue;
      withUrl++;
      const e = counts.get(handle) || { n: 0, creatorKnown: 0, creators: new Map(), samples: [] };
      e.n++;
      if (r.creator_address) {
        e.creatorKnown++;
        e.creators.set(r.creator_address, (e.creators.get(r.creator_address) || 0) + 1);
      }
      if (e.samples.length < 4 && r.token_symbol) e.samples.push(r.token_symbol);
      counts.set(handle, e);
    }
    cursor = data[data.length - 1].id;
    if (page % 100 === 0) console.log(`  …page ${page} rows=${rows} withUrl=${withUrl} handles=${counts.size} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    if (data.length < 1000) break;
  }

  console.log(`[1] 扫描完成：rows=${rows} withUrl=${withUrl} uniqueHandles=${counts.size}，耗时 ${((Date.now() - t0) / 1000 / 60).toFixed(1)}min`);

  // 甄别：creator 集中度三分类
  const analyze = (handle, e) => {
    const top = [...e.creators.entries()].sort((a, b) => b[1] - a[1]);
    const top1Share = e.creatorKnown ? top[0]?.[1] / e.creatorKnown : null;
    const top3Share = e.creatorKnown ? top.slice(0, 3).reduce((s, [, v]) => s + v, 0) / e.creatorKnown : null;
    const coverage = e.n ? e.creatorKnown / e.n : 0;
    let verdict;
    if (OFFICIAL.has(handle)) verdict = 'official';                       // 平台官方号，人工剔除
    else if (coverage < 0.3) verdict = 'no_creator_data';                 // creator 覆盖太低，甄别信号失真
    else if (top1Share !== null && (top1Share >= 0.6 || (top3Share ?? 0) >= 0.9)) verdict = 'self_issuer';   // creator 集中=自营发币号
    else if (top1Share !== null && top1Share < 0.2 && e.creators.size >= 10) verdict = 'hijacked_ip';        // creator 极分散=被蹭 IP
    else verdict = 'hybrid';                                              // 中间地带，人工审
    return {
      handle, n: e.n, uniqCreators: e.creators.size, creatorKnown: e.creatorKnown, coverage: +coverage.toFixed(2),
      top1Share: top1Share === null ? null : +top1Share.toFixed(2),
      top3Share: top3Share === null ? null : +top3Share.toFixed(2),
      topCreators: top.slice(0, 3).map(([a, v]) => `${a.slice(0, 10)}:${v}`),
      samples: e.samples, verdict,
    };
  };

  const all = [...counts.entries()].map(([h, e]) => analyze(h, e)).sort((a, b) => b.n - a.n);
  const fresh = all.filter(x => !FREQUENT_ISSUERS.has(x.handle) && x.n >= MIN);
  const tally = {};
  for (const x of fresh) tally[x.verdict] = (tally[x.verdict] || 0) + 1;
  console.log(`[2] 新候选 ≥${MIN}次 共 ${fresh.length} 个，甄别分布：`, JSON.stringify(tally));

  const show = (list, label, topN = 40) => {
    const sub = list.filter(x => !FREQUENT_ISSUERS.has(x.handle) && x.n >= MIN).slice(0, topN);
    if (!sub.length) return;
    console.log(`\n── ${label}（TOP ${sub.length}）──`);
    console.log('   handle                    n  uniqC  cov  top1  top3  samples');
    for (const x of sub) {
      console.log(`   ${x.handle.padEnd(24)} ${String(x.n).padStart(4)} ${String(x.uniqCreators).padStart(5)} ${x.coverage.toFixed(2).padStart(4)} ${x.top1Share === null ? '  - ' : x.top1Share.toFixed(2).padStart(4)} ${x.top3Share === null ? '  - ' : x.top3Share.toFixed(2).padStart(4)}  ${x.samples.join(',').slice(0, 40)}`);
    }
  };
  show(all.filter(x => x.verdict === 'self_issuer'), 'self_issuer 自营发币号（建议收录主池）');
  show(all.filter(x => x.verdict === 'hybrid'), 'hybrid 中间地带（人工审）');
  show(all.filter(x => x.verdict === 'hijacked_ip'), 'hijacked_ip 被蹭大 IP（排除对照）', 15);
  show(all.filter(x => x.verdict === 'no_creator_data'), 'no_creator_data 甄别信号失真（人工审）', 15);

  const out = path.join(__dirname, 'tmp-frequent-issuers-candidates.json');
  fs.writeFileSync(out, JSON.stringify({
    scannedAt: new Date().toISOString(), rows, withUrl, min: MIN,
    existingListSize: FREQUENT_ISSUERS.size, verdictTally: tally,
    candidates: fresh, allTop: all.slice(0, 300),
  }, null, 2));
  console.log(`\n[3] 落盘 ${out}（fresh ${fresh.length} 条全量）`);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
