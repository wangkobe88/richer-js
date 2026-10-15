#!/usr/bin/env node
/**
 * precheck 三查询并行单测（2026-10-13 叙事提速第二批 2b；2026-10-15 ③' 收编）
 * ——零 DB 零网络
 *
 *   2b 查询并行：0.55/0.58/0.7 规则查询互不依赖（各自只读 tokenData），
 *      原串行 await 白付 ~75ms → 并行发起按原顺序消费（判定/优先级/返回
 *      形状 bit 一致；命中路径多发未消费查询属计划内代价）。
 *   历史：0.6（token_narrative q60）与 0.5（SameNameCheckService AVE 同名
 *      搜索）系 AVE 发现链路死代码，2026-10-15 死代码删除（③'）——本测试
 *      收编为三查询口径，并承担 same-name-check-service 防回流断言。
 *
 * 节：
 *   A. 三查询全发：appendix+created_at 齐备 → 0.55/0.58/0.7 三条
 *      experiment_tokens 同批发出；两次调用行为一致
 *   B. 三查询并行时序：假 supabase from() 记表名+时刻、链式 thenable 带 30ms
 *      延迟 → 三查询同拍发起（max-min < 15ms）且总墙钟 ≈ 单查延迟（串行版
 *      ≥3×30ms）
 *   C. 前置不满足零发：无 appendix → q55 不发；无 raw created_at → q70 不发
 *      （0.7 原口径无 tokenCreatedAtSec 回退——wss 行跳过 0.7 刻意保留）
 *   D. 等价终态：三查空 → 走到 no_public_info（消费顺序与尾部规则不变）
 *   E. 源码口径：same-name-check-service 零残留（③' 防回流）/ 三查询声明
 *      形状 / safeQuery 归一 / createdAtSec70 口径分离
 *
 * 用法：node scripts/_test_precheck_parallel_queries.cjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function assert(cond, label, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { console.error(`  ❌ ${label}${extra ? ` | ${extra}` : ''}`); }
}
function src(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

const QUERY_DELAY = 30; // ms——假查询链延迟（串行版四查墙钟 ≥4×30）

// 假 supabase：from() 记录表名+时刻；链式方法全收，thenable 延迟结算
let dbQueryLog = [];
const supabaseStub = {
  from(table) {
    dbQueryLog.push({ table, t: Date.now() });
    const result = { data: [], error: null };
    const chain = {};
    for (const m of ['select', 'eq', 'neq', 'lt', 'gte', 'in', 'contains', 'order', 'limit']) {
      chain[m] = () => chain;
    }
    // Promise.resolve(chain) 消费 then(resolve, reject) —— 延迟结算制造串行/并行可区分窗口
    chain.then = (res, rej) =>
      new Promise(r => setTimeout(() => r(result), QUERY_DELAY)).then(res, rej);
    return chain;
  },
};

async function main() {
  const repoMod = await import('../src/narrative/db/NarrativeRepository.mjs');
  repoMod.NarrativeRepository.getSupabase = () => supabaseStub;

  const { performPreCheck } = await import('../src/narrative/analyzer/services/pre-check-service.mjs');

  // 前置全满足的 tokenData：appendix 带 twitter status + created_at + symbol
  const makeTokenData = () => ({
    address: '0xUnitTestToken1234567890abcdef12345678',
    symbol: 'UTEST',
    name: 'Unit Test Token',
    raw_api_data: {
      token: '0xUnitTestToken1234567890abcdef12345678',
      created_at: 1759000000,
      appendix: JSON.stringify({ twitter: 'https://x.com/foo/status/123' }),
    },
  });

  // ═══ A+B. 三查询并行（两次调用共用一个场景骨架）═══
  console.log('══ A. 三查询全发（appendix+created_at 齐备）══');
  let r1;
  {
    dbQueryLog = [];
    const t0 = Date.now();
    r1 = await performPreCheck(makeTokenData(), null, null, null, {}, {}, null, null, {});
    const wall1 = Date.now() - t0;

    const expTokens = dbQueryLog.filter(q => q.table === 'experiment_tokens').length;
    assert(dbQueryLog.length === 3 && expTokens === 3,
      'A1 三查询全发：0.55/0.58/0.7 → experiment_tokens ×3（0.6 q60 已随 AVE 死代码删除）',
      JSON.stringify(dbQueryLog.map(q => q.table)));

    console.log('══ B. 三查询并行时序（假链 30ms 延迟）══');
    const times = dbQueryLog.map(q => q.t);
    const spread = Math.max(...times) - Math.min(...times);
    assert(spread < 15, 'B1 三查询同拍发起（max-min < 15ms；串行版间隔 ≥30ms）', `spread=${spread}ms`);
    assert(wall1 < QUERY_DELAY * 2 + 40,
      'B2 总墙钟 ≈ 单查延迟级（并行 <2×30+40ms；串行版 ≥3×30ms）', `${wall1}ms`);

    // 第二次调用：查询照发（行为一致）
    dbQueryLog = [];
    const r2 = await performPreCheck(makeTokenData(), null, null, null, {}, {}, null, null, {});
    assert(dbQueryLog.length === 3, 'A2 第二次调用三查询照发', String(dbQueryLog.length));
    assert(r2?.details?.ruleName === r1?.details?.ruleName, 'A3 两次结果一致');
  }

  // ═══ C. 前置不满足零发 ═══
  console.log('══ C. 前置门（零发不空发）══');
  {
    // C1 无 appendix → q55 不发（无 twitterId）；0.7 无 materialId 也不发
    dbQueryLog = [];
    const noAppendix = makeTokenData();
    delete noAppendix.raw_api_data.appendix;
    await performPreCheck(noAppendix, null, null, null, {}, {}, null, null, {});
    const exp = dbQueryLog.filter(q => q.table === 'experiment_tokens').length;
    assert(dbQueryLog.length === 1 && exp === 1,
      'C1 无 appendix：仅 0.58（symbol 查询）发，0.55/0.7 前置不满足零发',
      JSON.stringify(dbQueryLog.map(q => q.table)));

    // C2 wss 行：tokenCreatedAtSec 有、raw created_at 无 → 0.55/0.58 发（回退口径）、0.7 不发（原口径无回退）
    dbQueryLog = [];
    const wssRow = {
      address: '0xWssRowToken1234567890abcdef123456',
      symbol: 'WSST',
      name: 'Wss Row',
      tokenCreatedAtSec: 1759000500,
      raw_api_data: {
        token: '0xWssRowToken1234567890abcdef123456',
        appendix: JSON.stringify({ twitter: 'https://x.com/foo/status/456' }),
      },
    };
    await performPreCheck(wssRow, null, null, null, {}, {}, null, null, {});
    // 0.55(createdAtSec 回退有) + 0.58(回退有) + 0.7(createdAtSec70 无 → 不发)
    assert(dbQueryLog.length === 2 && dbQueryLog.filter(q => q.table === 'experiment_tokens').length === 2,
      'C2 wss 行（tokenCreatedAtSec 有/raw created_at 无）：0.55/0.58 发、0.7 原口径零发（刻意分离勿合并）',
      JSON.stringify(dbQueryLog.map(q => q.table)));
  }

  // ═══ D. 等价终态：三查空 → 走到 no_public_info ═══
  console.log('══ D. 尾部规则不变 ═══');
  {
    assert(r1?.details?.ruleName === 'no_public_info',
      'D1 三查空 → 按原顺序消费后走到 no_public_info（消费顺序与返回形状不变）',
      JSON.stringify(r1?.details?.ruleName));
  }

  // ═══ E. 源码口径（锁防线）═══
  console.log('══ E. 源码口径 ═══');
  {
    const pcs = src('src/narrative/analyzer/services/pre-check-service.mjs');

    // E1: ③' 防回流——same-name-check-service AVE 死代码零代码引用
    // （历史迁移注释刻意提及旧文件名属文档，不属引用；锁 import/new/调用三形状）
    const fnStart = pcs.indexOf('export async function performPreCheck');
    assert(fnStart > -1
      && !/from\s+'\.\/same-name-check-service/.test(pcs)
      && !pcs.includes('new SameNameCheckService(')
      && !pcs.includes('sameNameService.'),
      'E1 pre-check-service 零 import/new/调用（死代码删除防回流）');
    assert(!fs.existsSync(path.join(ROOT, 'src/narrative/analyzer/services/same-name-check-service.mjs')),
      'E1b same-name-check-service.mjs 文件已删（不得回流）');

    // E2: 三查询声明形状（safeQuery 归一 + 前置条件驱动）
    for (const decl of ['const q55Promise = (appendixTwitterId && tokenSymbol && createdAtSec)',
      'const q58Promise = (tokenSymbol && createdAtSec)',
      'const q70Promise = (currentMaterialId && createdAtSec70)']) {
      assert(pcs.includes(decl), `E2 ${decl.slice(6, 20)}… 前置驱动声明`);
    }
    assert(!pcs.includes('q60Promise'), 'E2b q60Promise 零残留（0.6 死代码已删）');
    assert(pcs.includes('const safeQuery = (promise, label) => promise.catch(err => {'),
      'E3 safeQuery 归一（reject → error 形状消费 + 原文案 warn；防后位规则悬空 unhandled）');

    // E4: 0.7 口径分离（无 tokenCreatedAtSec 回退——wss 行跳过 0.7 刻意保留）
    assert(pcs.includes('const createdAtSec70 = tokenData.raw_api_data?.created_at;')
      && pcs.includes('无 tokenCreatedAtSec 回退——wss 行'), 'E4 createdAtSec70 原口径分离');

    // E5: 消费顺序 0.55 → 0.58 → 0.7（await qNN 顺序）
    const c55 = pcs.indexOf('await q55Promise');
    const c58 = pcs.indexOf('await q58Promise');
    const c70 = pcs.indexOf('await q70Promise');
    assert(c55 > -1 && c55 < c58 && c58 < c70,
      'E5 消费顺序 0.55→0.58→0.7（优先级与原串行版一致）');

    // E6: 查询发起先于消费（并行窗口存在的结构性证明）
    const q55Decl = pcs.indexOf('const q55Promise =');
    assert(q55Decl > -1 && q55Decl < c55 && pcs.indexOf('const q70Promise =') < c55,
      'E6 三查询全部声明于首次消费之前（先齐发后按序消费）');
  }

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });
