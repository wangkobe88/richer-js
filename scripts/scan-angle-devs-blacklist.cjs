#!/usr/bin/env node
// ============================================================================
// 「pumpfun 专职找角度 dev」黑名单候选扫描 v2（2026-10-18）
//   用户定义：大量发币 + 宣发全英文 的跨链作业号（区别于 BSC 本土中文找角度号）
//   语义：这些号的推文作语料的 BSC 盘直接黑名单 low 终判
//   v1 缺陷：creator.handles 只存 top6（扫射池轮换号每号仅用 2-5 次被截断）+
//   symbol 判语言噪声大。v2：全量 (creator,handle) 边表 + token 全名中英占比。
//   数据源：experiment_tokens（同 C76 同源同口径）
//   跑法：node scripts/scan-angle-devs-blacklist.cjs （在 182 跑）
//   输出：scripts/tmp-angle-devs-blacklist.json（边表全量）
//   ⚠ 只读扫描零写入；收录须人工审核后改 config/default.json twitterBlacklist
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const fs = require('fs');

const URL_RE = /^(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i;
const RESERVED = new Set(['home', 'search', 'i', 'intent', 'hashtag', 'settings', 'share', 'compose', 'messages']);

async function main() {
  const { createClient } = require('@supabase/supabase-js');
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  const c = createClient(process.env.SUPABASE_URL, key);

  const byCreator = new Map();  // creator → Map(handle → {n, names[]})
  const byHandle = new Map();   // handle → { n, creators: Map, names[], symbols[], tokens[], lastAt }
  let cursor = '00000000-0000-0000-0000-000000000000', rows = 0, page = 0;
  const t0 = Date.now();

  for (;;) {
    const { data, error } = await c.from('experiment_tokens')
      .select('id,token_address,token_symbol,creator_address,created_at,raw_api_data->>twitterUrl,raw_api_data->>name')
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(1000);
    if (error) throw new Error(`分页拉取失败@id>${cursor}: ${error.message}`);
    if (!data.length) break;
    page++;
    for (const r of data) {
      rows++;
      const m = typeof r.twitterUrl === 'string' ? r.twitterUrl.match(URL_RE) : null;
      if (!m || RESERVED.has(m[1].toLowerCase())) continue;
      const handle = m[1].toLowerCase();
      const name = typeof r.name === 'string' ? r.name : '';
      if (r.creator_address) {
        let cr = byCreator.get(r.creator_address);
        if (!cr) { cr = new Map(); byCreator.set(r.creator_address, cr); }
        let e = cr.get(handle);
        if (!e) { e = { n: 0, names: [] }; cr.set(handle, e); }
        e.n++;
        if (e.names.length < 6 && name) e.names.push(name);
      }
      let h = byHandle.get(handle);
      if (!h) { h = { n: 0, creators: new Map(), names: [], symbols: [], tokens: [], lastAt: '' }; byHandle.set(handle, h); }
      h.n++;
      if (r.creator_address) h.creators.set(r.creator_address, (h.creators.get(r.creator_address) || 0) + 1);
      if (h.names.length < 8 && name) h.names.push(name);
      if (h.symbols.length < 8 && r.token_symbol) h.symbols.push(r.token_symbol);
      if (h.tokens.length < 6 && r.token_address) h.tokens.push(r.token_address);
      if (r.created_at && r.created_at > h.lastAt) h.lastAt = r.created_at;
    }
    cursor = data[data.length - 1].id;
    if (page % 100 === 0) console.log(`  …page ${page} rows=${rows} handles=${byHandle.size} creators=${byCreator.size} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    if (data.length < 1000) break;
  }
  console.log(`[1] 完成：rows=${rows} handles=${byHandle.size} creators=${byCreator.size}，耗时 ${((Date.now() - t0) / 1000 / 60).toFixed(1)}min`);

  // 序列化：全量 (creator, handle) 边 + handle 画像
  const edges = [];
  for (const [creator, handles] of byCreator) {
    let tot = 0;
    for (const [, e] of handles) tot += e.n;
    if (tot < 10) continue; // creator 门槛：总宣发盘数 ≥10（边表瘦身）
    for (const [handle, e] of handles) edges.push({ c: creator.slice(0, 18), h: handle, n: e.n, tot, names: e.names.slice(0, 4) });
  }
  const handlesSer = [...byHandle.entries()].map(([h, e]) => {
    const top = [...e.creators.entries()].sort((a, b) => b[1] - a[1]);
    return {
      handle: h, n: e.n, uniqCreators: e.creators.size,
      top1Share: e.creators.size ? +(top[0][1] / e.n).toFixed(2) : null,
      names: e.names, symbols: e.symbols, tokens: e.tokens, lastAt: e.lastAt.slice(0, 10),
    };
  }).filter(x => x.n >= 3);

  const out = path.join(__dirname, 'tmp-angle-devs-blacklist.json');
  fs.writeFileSync(out, JSON.stringify({
    scannedAt: new Date().toISOString(), rows,
    edges, handles: handlesSer,
  }));
  console.log(`[2] 落盘 ${out}（edges ${edges.length} / handles ${handlesSer.length}）`);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
