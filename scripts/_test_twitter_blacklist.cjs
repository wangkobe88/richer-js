#!/usr/bin/env node
/**
 * precheck 规则 1 推特账号黑名单单测——零 DB 零网络
 *
 *   名单真源=config/default.json narrative.twitterBlacklist（pre-check-service
 *   模块加载时 readFileSync 直读）；2026-10-17 sharkalpacaboi 入名单（用户裁定）
 *   配套把判比从精确 includes 改为大小写不敏感——推特 handle 平台侧不区分大小写、
 *   语料携带 API 原样大小写（如 SharkAlpacaBoi），精确比对会静默不命中。
 *
 * 节：
 *   A.  config 真源：sharkalpacaboi 在名单 + JSON 可解析 + 名单非空
 *   B.  命中三形：语料 author_screen_name 全小写/驼峰/全大写 → blacklist low 终判
 *   C.  URL 提取回退臂：twitterInfo null + extractedInfo.twitter_url 携带大写
 *       handle → 命中（规则 1.2 路径同归一）
 *   D.  反证：非名单作者（含大小写变体）不误伤 → ruleName !== 'blacklist'
 *   E.  源码口径防回流：双侧 toLowerCase + 无裸 includes(authorScreenName) 残留
 *
 * 用法：node scripts/_test_twitter_blacklist.cjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function assert(cond, label, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.error(`  ❌ ${label}${extra ? ` | ${extra}` : ''}`); }
}
function src(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

// 假 supabase（规则 0.55/0.58/0.7 查询空回零发）
const supabaseStub = {
  from() {
    const chain = {};
    for (const m of ['select', 'eq', 'neq', 'lt', 'gte', 'in', 'contains', 'order', 'limit']) {
      chain[m] = () => chain;
    }
    chain.then = (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej);
    return chain;
  },
};

const ANCHOR_SEC = 1759000000;
const iso = (sec) => new Date(sec * 1000).toISOString();

async function run(tokenData, twitterInfo, extractedInfo = null) {
  const mod = run._mod;
  return mod.performPreCheck(tokenData, twitterInfo, extractedInfo, null,
    { twitter: ['https://x.com/ut_author/status/1'] }, {}, null, null, {});
}

async function main() {
  const repoMod = await import(path.join(ROOT, 'src/narrative/db/NarrativeRepository.mjs'));
  repoMod.NarrativeRepository.getSupabase = () => supabaseStub;
  run._mod = await import(path.join(ROOT, 'src/narrative/analyzer/services/pre-check-service.mjs'));

  const makeTokenData = () => ({
    address: '0xUnitTestBlacklistToken1234567890abcdef',
    symbol: 'UTEST',
    name: 'Unit Test Token',
    tokenCreatedAtSec: ANCHOR_SEC,
  });
  const makeTweet = (handle) => ({
    type: 'tweet',
    text: 'unit test blacklist tweet text',
    author_screen_name: handle,
    author_followers_count: 4200,
    metrics: { favorite_count: 10, retweet_count: 2 },
    created_at: iso(ANCHOR_SEC - 60),
  });

  console.log('══ A. config 真源 ══');
  {
    const cfg = JSON.parse(src('config/default.json'));
    const list = cfg.narrative?.twitterBlacklist;
    assert(Array.isArray(list) && list.length > 0, 'A1 名单存在且非空', JSON.stringify(list));
    assert(list.includes('sharkalpacaboi'), 'A2 sharkalpacaboi 在名单（2026-10-17 用户裁定）', JSON.stringify(list));
    assert(list.includes('Fouzia69513878'), 'A3 JDI 案账号仍在（存量不丢）');
  }

  console.log('══ B. 命中三形（大小写归一）══');
  for (const handle of ['sharkalpacaboi', 'SharkAlpacaBoi', 'SHARKALPACABOI']) {
    const r = await run(makeTokenData(), makeTweet(handle));
    assert(r?.details?.ruleName === 'blacklist' && r?.rating === 'low' && r?.pass === false,
      `B 语料 handle=${handle} → blacklist low 终判`, JSON.stringify(r?.details?.ruleName));
  }

  console.log('══ C. URL 提取回退臂 ══');
  {
    const r = await run(makeTokenData(), null, { twitter_url: 'https://x.com/SharkAlpacaBoi/status/999' });
    assert(r?.details?.ruleName === 'blacklist',
      'C1 twitterInfo null + URL 大写 handle 提取 → 命中', JSON.stringify(r?.details?.ruleName));
  }

  console.log('══ D. 反证（非名单不误伤）══');
  {
    const r = await run(makeTokenData(), makeTweet('SharkyMcInnocent'));
    assert(r?.details?.ruleName !== 'blacklist',
      'D1 非名单作者（形近不同名）不因归一误伤', JSON.stringify(r?.details?.ruleName));
  }

  console.log('══ E. 源码口径防回流 ══');
  {
    const s = src('src/narrative/analyzer/services/pre-check-service.mjs');
    assert(s.includes('blacklistSet.has(authorScreenName.toLowerCase())'),
      'E1 判比=双侧 toLowerCase（Set.has 口径）');
    assert(!s.includes('twitterBlacklist?.includes(authorScreenName)'),
      'E2 裸精确 includes(authorScreenName) 零残留（旧口径死透）');
  }

  console.log(`\n${'═'.repeat(50)}`);
  if (fail === 0) { console.log(`✅ 全部通过（${pass} 断言）`); process.exit(0); }
  console.error(`❌ ${fail} 失败 / ${pass} 通过`); process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
