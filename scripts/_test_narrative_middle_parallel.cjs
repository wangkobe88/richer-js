#!/usr/bin/env node
/**
 * 中段三泳道并发单测（2026-10-13 叙事提速第二批 1A）——零 DB 零网络
 *
 * 被测：NarrativeAnalyzer.analyze 中段并发——泳道 1 账号链 IIFE /
 * 泳道 2 precheck 立发 / 泳道 3 issuerCa 按 chainPullsAuthor 条件分派 /
 * Promise.all join。（泳道 0 vision 预启动已随 dataPrefetch/visionPrefetch
 * 退役删除，C84 2026-10-17——D8 退役反证锁定防回流）
 *
 * 打桩手法（先例 _test_tweet_image_analysis / _test_narrative_timing_probe）：
 *   - twitter-validation/index.js 是 CJS：在任何 narrative ESM 加载**前** require 并
 *     覆写 module.exports 属性（getTweetDetail/getUserByScreenName/getUserTweets）
 *     ——twitter-fetcher 加载时解构、account-community-rules ESM 命名导入都拿到桩
 *   - dbManager.getSupabase（CJS 单例方法，运行时查找）→ 假 supabase 链式 client
 *   - NarrativeRepository / ExternalResourceCache 类 static 方法运行时覆写
 *     （内存 Map 缓存桩——链↔issuerCa 的缓存 handoff 真实走通）
 *   - console.log hook 捕「预检查触发」行作 precheck 时序事件
 *
 * 场景：
 *   A. 链拉作者（独立网站+推文）：precheck 立发不等链；issuerCa 排链后吃
 *      userId 级缓存 handoff（getUserByScreenName/getUserTweets 各恰 1 次——
 *      盲并行会双真拉）
 *   B. 链不拉（纯推文无网站非项目币）：issuerCa 立即真拉（各恰 1 次来自
 *      issuerCa 自身）；预检分支零视觉调用（C84 泳道 0 退役后天然成立）
 *   D. 源码口径：IIFE 三段顺序无提前 return / chainPullsAuthor 三条件宽判 /
 *      issuerCa 三元分派 / Promise.all join / push 判定后移 / 泳道 0 退役反证
 *
 * 依赖的前置状态（显式依赖非兜底，变更时应更新本测试）：
 *   - symbol 超长（>8 英文词）触发 precheck 第一规则 symbol_too_long——
 *     全程走预检分支，LLM/Jev 零触达，AVE 同名规则（0.5）不可达
 *
 * 用法：node scripts/_test_narrative_middle_parallel.cjs
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
const idx = (arr, pred) => arr.findIndex(pred);

// ═══ 加载前覆写（必须在任何 narrative ESM import 之前）═══
process.env.SILICONFLOW_FALLBACK_KEY = process.env.SILICONFLOW_FALLBACK_KEY || 'unit-test-key';

let events = [];          // 时序事件（seq 递增）
let seq = 0;
let cacheCalls = [];      // ExternalResourceCache.get 调用记录 {url,type,seq}
let memCache = new Map(); // ExternalResourceCache 内存桩
const ev = (name) => events.push({ seq: seq++, name });

const LONG_SYMBOL = 'THIS IS A VERY LONG EYE CATCHING TOKEN NAME FOR SURE'; // 12 词 > 8 → symbol_too_long

// twitter stub（闭包读可变 events 引用，每场景重置数组即可）
const tv = require('../src/utils/twitter-validation/index.js');
let tweetStub = null; // {tweet} getTweetDetail 返回
let accountStub = null; // {userInfo, tweetCount} 账号返回
tv.getTweetDetail = async (tweetId) => {
  ev(`tweetDetail:${tweetId}`);
  return tweetStub ? { ...tweetStub } : null;
};
tv.getTweetDetailGraphQL = async () => null;
tv.getUserByScreenName = async (screenName) => {
  ev(`sn:${screenName}`);
  return accountStub ? { ...accountStub.userInfo } : null;
};
tv.getUserTweets = async (userId) => {
  ev(`tweets:${userId}`);
  return accountStub ? accountStub.tweets.map(t => ({ ...t })) : [];
};

// dbManager 假 supabase（链式 Proxy + thenable）
const chainable = (result) => new Proxy(function () {}, {
  get(_t, prop) {
    const p = Promise.resolve(result);
    if (prop === 'then') return p.then.bind(p);
    if (prop === 'catch') return p.catch.bind(p);
    return () => chainable(result);
  },
  apply() { return chainable(result); },
});
let tokenRow = null;
const supabaseStub = {
  from(table) {
    const rows = table === 'experiment_tokens' ? [tokenRow] : [];
    return chainable({ data: rows, error: null });
  },
};
const { dbManager } = require('../src/services/dbManager.js');
dbManager.getSupabase = () => supabaseStub;

// console.log hook：precheck 触发行 → 事件（performPreCheck 裸 console.log）
const origLog = console.log;
console.log = (...args) => {
  const s = String(args[0] ?? '');
  if (s.includes('预检查触发:')) ev('precheck:fired'); // 带冒号=真触发行（区别于「触发，跳过LLM分析」尾日志）
  origLog(...args);
};

async function main() {
  // NarrativeRepository / ExternalResourceCache static 覆写 + NarrativeAnalyzer 加载
  const repoMod = await import('../src/narrative/db/NarrativeRepository.mjs');
  const saves = [];
  repoMod.NarrativeRepository.findByAddress = async () => null; // 缓存恒 miss → 走真析链
  repoMod.NarrativeRepository.getSupabase = () => supabaseStub; // precheck DB 规则防御性接通（本测试 symbol 规则先 return 不可达）
  repoMod.NarrativeRepository.save = async (fields) => {
    saves.push(fields);
    return { id: 1, analyzed_at: '2026-10-13T00:00:00Z', ...fields };
  };

  const cacheMod = await import('../src/narrative/db/ExternalResourceCache.mjs');
  cacheMod.ExternalResourceCache.get = async (url, type) => {
    cacheCalls.push({ url, type, seq: seq++ });
    const hit = memCache.get(`${type}::${url}`);
    return hit === undefined ? null : hit;
  };
  cacheMod.ExternalResourceCache.set = async (url, type, content) => {
    memCache.set(`${type}::${url}`, content);
    return true;
  };

  const { NarrativeAnalyzer } = await import('../src/narrative/analyzer/NarrativeAnalyzer.mjs');

  const IMG_URL = 'https://pbs.twimg.com/media/UNITTEST.jpg';

  const resetScenario = () => {
    events = []; seq = 0; cacheCalls = []; memCache = new Map(); saves.length = 0;
  };

  const makeTweetStub = (screenName) => ({
    text: 'launch day', // 无 URL → enrich 零抓取（websiteFetch 亦关）
    user: { screen_name: screenName, name: `Name ${screenName}`, followers_count: 1500, verified: false },
    favorite_count: 10, retweet_count: 2,
    created_at: 'Wed Oct 01 10:00:00 +0000 2025',
    urls: [],
    medias: [IMG_URL],
  });
  // 100 条推文（无 CA 地址 → findCaTweetInAccount null → issuerCa fail-open）；
  // ≥100 条使 issuerCa 的 userId 级全量 key 复用判据（length >= max(20,100)）成立
  const makeAccountStub = (id) => ({
    userInfo: { screen_name: null, id, name: 'x', description: 'd', followers_count: 900 }, // screen_name 由场景填
    tweets: Array.from({ length: 100 }, (_, i) => ({ id_str: String(i + 1), full_text: `post ${i + 1}`, created_at_seconds: 1759000000 - i * 3600 })),
  });

  const runAnalyze = (addr, rawApi, options) => {
    tokenRow = {
      token_symbol: LONG_SYMBOL,
      raw_api_data: rawApi,
      blockchain: 'bsc',
      platform: 'fourmeme',
    };
    return NarrativeAnalyzer.analyze(addr, options);
  };

  // ═══ A. 链拉作者：issuerCa 排链后吃缓存 handoff ═══
  console.log('══ A. chainPullsAuthor=true（独立网站+推文，链 collect → issuerCa handoff）══');
  {
    resetScenario();
    const ADDR = '0xaaaa1111aaaa1111aaaa1111aaaa1111aaaa1111';
    const authorA = 'author_a_test';
    tweetStub = makeTweetStub(authorA);
    accountStub = makeAccountStub('u-author-a');
    accountStub.userInfo.screen_name = authorA;

    const t0 = Date.now();
    const r = await runAnalyze(ADDR, {
      twitter: `https://x.com/${authorA}/status/111222333`,
      website: 'https://project-UnitTest.example.com', // 独立网站（非免费托管域）→ shouldCollectAccounts
    });
    const wall = Date.now() - t0;

    const snEvents = events.filter(e => e.name.startsWith('sn:'));
    const tweetsEvents = events.filter(e => e.name.startsWith('tweets:'));
    const precheckEv = idx(events, e => e.name === 'precheck:fired');
    const firstSn = idx(events, e => e.name.startsWith('sn:'));

    assert(r.meta.preCheckTriggered === true, 'A1 预检触发（symbol_too_long）且走预检分支',
      JSON.stringify(r.meta));
    assert(precheckEv > -1 && firstSn > -1 && precheckEv < firstSn,
      'A2 precheck 立发不等账号链（precheck 事件先于链首 sn）',
      `precheck@${precheckEv} sn@${firstSn} ${JSON.stringify(events.map(e => e.name))}`);
    assert(snEvents.length === 1 && tweetsEvents.length === 1,
      'A3 issuerCa 吃链 handoff：getUserByScreenName/getUserTweets 各恰 1 次（盲并行=2）',
      `sn=${snEvents.length} tweets=${tweetsEvents.length}`);
    const finalSave = saves[saves.length - 1];
    assert(finalSave?.pre_check_result?.details?.ruleName === 'symbol_too_long',
      'A4 最终 save 落预检结果 symbol_too_long');
    assert(r.meta.preCheckReason === 'symbol_too_long', 'A5 返回 reason=symbol_too_long');
    // issuerCa fail-open：未检测到发行方 → 未转 prestage（预检分支保持）——A1/A5 共同证明
    assert(wall < 10000, 'A6 全链零真网络（墙钟 <10s）', `${wall}ms`);
    console.log('A 段事件序:', events.map(e => e.name).join(' → '));
  }

  // ═══ B. 链不拉：issuerCa 立即真拉；visionPrefetch 缺省 false 不发起 ═══
  console.log('══ B. chainPullsAuthor=false（纯推文，issuerCa 立发自身真拉）══');
  {
    resetScenario();
    const ADDR = '0xbbbb2222bbbb2222bbbb2222bbbb2222bbbb2222';
    const authorB = 'author_b_test';
    tweetStub = makeTweetStub(authorB);
    accountStub = makeAccountStub('u-author-b');
    accountStub.userInfo.screen_name = authorB;

    const r = await runAnalyze(ADDR, {
      twitter: `https://x.com/${authorB}/status/444555666`,
      // 无 website → hasIndependentWebsite false；addr 不在语料 → 非项目币；品牌不同一 → 非自发
    }); // 不传 visionPrefetch（缺省 false）

    const snEvents = events.filter(e => e.name.startsWith('sn:'));
    const tweetsEvents = events.filter(e => e.name.startsWith('tweets:'));
    const precheckEv = idx(events, e => e.name === 'precheck:fired');
    const firstSn = idx(events, e => e.name.startsWith('sn:'));

    assert(r.meta.preCheckTriggered === true && r.meta.preCheckReason === 'symbol_too_long',
      'B1 预检触发（等价终态）');
    assert(snEvents.length === 1 && snEvents[0].name === `sn:${authorB}` && tweetsEvents.length === 1,
      'B2 issuerCa 立即真拉作者（各恰 1 次，来自 issuerCa 自身；链零调用）',
      `sn=${snEvents.length} tweets=${tweetsEvents.length}`);
    assert(precheckEv > -1 && firstSn > precheckEv,
      'B3 issuerCa 在 precheck 之后立即发起（链不拉不排队）',
      `precheck@${precheckEv} sn@${firstSn}`);
    assert(!cacheCalls.some(c => c.type === 'tweet_image'),
      'B4 全程零 tweet_image 缓存 get（C84 泳道 0 退役后预检分支天然无视觉调用）');
    assert(r.twitter && !r.twitter.image_analysis, 'B5 无 vision 挂载（预检分支零视觉调用）');
    console.log('B 段事件序:', events.map(e => e.name).join(' → '));
  }

  // ═══ D. 源码口径（锁防线，项目惯例）═══
  console.log('══ D. 源码口径 ═══');
  {
    const na = src('src/narrative/analyzer/NarrativeAnalyzer.mjs');

    // D1: 账号链 IIFE 切片与「无提前 return」等价性
    const iifeStart = na.indexOf('const accountChainPromise = (async () => {');
    const iifeEnd = na.indexOf('})();', iifeStart);
    assert(iifeStart > 0 && iifeEnd > iifeStart, 'D1a accountChainPromise IIFE 存在');
    const iife = na.slice(iifeStart, iifeEnd);
    const returns = iife.match(/(^|\s)return\s/g) || [];
    assert(returns.length === 1 && iife.includes('return accounts;'),
      'D1b IIFE 内唯一 return 在尾部（三段顺序判定无提前 return 等价性）', `returns=${returns.length}`);

    // D2: IIFE 三段顺序 = 原串行顺序
    const seg1 = iife.indexOf('if (shouldCollectAccounts)');
    const seg2 = iife.indexOf('if (isProjectCoinResult && accounts.length === 0)');
    const seg3 = iife.indexOf('if (issuerSelfLaunch && accounts.length === 0)');
    assert(seg1 > -1 && seg1 < seg2 && seg2 < seg3, 'D2 三段顺序：主路径 collect → 项目币补收 → 自发币补收');

    // D3: chainPullsAuthor 三条件宽判
    assert(na.includes('const chainPullsAuthor = shouldCollectAccounts')
      && na.includes('|| (isProjectCoinResult && (twitterInfo || (classifiedUrls?.twitter?.length || 0) > 0))')
      && na.includes('|| !!issuerSelfLaunch;'),
      'D3 chainPullsAuthor 宽判三条件（主路径∨项目币∨自发）');

    // D4: issuerCa 三元分派（链拉→排链后 .then；不拉→立即发起）
    assert(na.includes('const issuerCaPromise = (!issuerSelfLaunch && twitterInfo?.type === \'tweet\')')
      && na.includes('? (chainPullsAuthor ? accountChainPromise.then(() => runIssuerCa()) : runIssuerCa())')
      && na.includes(': null;'),
      'D4 issuerCa 条件分派（非 tweet/自发→null；链拉→排链后；不拉→立发）');

    // D5: join 形状（C76 起四泳道：+searchPromise 空语料推特搜索兜底）
    assert(na.includes('await Promise.all([\n      accountChainPromise, precheckPromise, issuerCaPromise, searchPromise,\n    ])'),
      'D5 Promise.all 四泳道 join（三泳道 + C76 searchPromise）');

    // D6: issuerCa push 判定移 join 后
    const joinIdx = na.indexOf('await Promise.all([\n      accountChainPromise');
    const pushIdx = na.indexOf('if (issuerCaTimeline)');
    assert(joinIdx > -1 && pushIdx > joinIdx, 'D6 issuerCa push 判定在 join 之后');

    // D7: issuerDetected 融合
    assert(na.includes('const issuerDetected = issuerSelfLaunch || issuerCaTimeline;'), 'D7 issuerDetected 融合两路径');

    // D8（C84 2026-10-17 退役反证）：泳道 0 预启动形状已删——剥注释后源码零
    // visionPrefetch/visionPromise（退役注释里的字样剥除后再判，防回流）
    const naStripped = na.replace(/\/\/[^\n]*/g, '');
    assert(!naStripped.includes('visionPrefetch') && !naStripped.includes('visionPromise'),
      'D8 泳道 0 退役（visionPrefetch/visionPromise 源码零残留）');

    // D9: vision join 形状（C84 后唯一路径=visionSkipped 门 + 直调，无预启动 join）
    assert(na.includes('if (!visionSkipped) {\n          await timing.wrap(\'vision\', () => analyzeTweetImage(twitterInfo));\n        }'),
      'D9 vision join 形状（visionSkipped 门 + 直调）');

    // D10: precheck 立发先于 issuerCa 分派声明（源码顺序 = 泳道序）
    const precheckDecl = na.indexOf('const precheckPromise = timing.wrap(\'precheck\'');
    const issuerDecl = na.indexOf('const issuerCaPromise =');
    const chainDecl = na.indexOf('const accountChainPromise =');
    assert(chainDecl > -1 && precheckDecl > chainDecl && issuerDecl > precheckDecl,
      'D10 声明序：账号链 → precheck 立发 → issuerCa 分派');
  }

  console.log = origLog;
  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });
