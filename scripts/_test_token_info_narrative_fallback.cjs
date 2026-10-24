#!/usr/bin/env node
/**
 * _test_token_info_narrative_fallback — C188 中国人能飞案裁定选项 1（2026-10-24）：
 * fetchTokenData 的 token_narrative 旧行回退。experiment_tokens 行随旧实验级联删
 * ≠ 代币不存在——全局表旧行（token_symbol/platform/blockchain/raw_api_data）撑起
 * 历史票重析。
 *
 * 零 DB 零网络：dbManager.getSupabase 打桩为链式假客户端（记录表调用序），
 * 断言三层取数语义与返回形状：
 *   A. 主路径命中（experiment_tokens 有行）→ 不查 token_narrative（回退不越位）
 *   B. 0 行回退命中 → 同形状返回：symbol 清洗/platform 透传/blockchain 缺省 bsc/
 *      created_at 取 raw_api_data（evPromise 不消费）
 *   C. 回退行缺 created_at → wss_events token_create 补锚（four.meme 形状）；
 *      事件也空 → null 锚（flap 无事件形状，不冒充墙钟）
 *   D. 两层全 0 行 → null（真未知地址仍「代币不存在」）；回退查询 error → throw
 *      （fail-loud，不把 DB 故障吞成代币不存在）
 *   E. 源码口径：回退只取身份列+raw_api_data（不读分析结果列）、
 *      evPromise 消费点在 created_at 缺锚分支内
 */

const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

// ── 假 supabase 客户端（链式打桩，记录表调用序）──
function makeFakeSupabase({ etRows = [], etError = null, evRows = [], narrRows = null, narrError = null } = {}) {
  const tables = [];
  const client = {
    from(table) {
      tables.push(table);
      if (table === 'experiment_tokens') {
        return {
          select: () => ({
            eq: () => ({
              limit: async () => ({ data: etRows, error: etError }),
            }),
          }),
        };
      }
      if (table === 'wss_events') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: evRows, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'token_narrative') {
        return {
          select: () => ({
            eq: () => ({
              limit: async () => ({ data: narrRows, error: narrError }),
            }),
          }),
        };
      }
      throw new Error('意外表查询: ' + table);
    },
  };
  return { client, tables };
}

async function withStub(fake, fn) {
  const dbm = await import(path.join(__dirname, '..', 'src/services/dbManager.js'));
  const { fetchTokenData } = await import(
    path.join(__dirname, '..', 'src/narrative/analyzer/services/token-info-service.mjs'));
  const real = dbm.dbManager.getSupabase;
  dbm.dbManager.getSupabase = () => fake;
  try {
    return await fn(fetchTokenData);
  } finally {
    dbm.dbManager.getSupabase = real;
  }
}

const ADDR = '0x108876c3df3d893350e9b780563b3697aa3e7777';

(async () => {
  console.log('A. 主路径命中 → 回退不触发');
  {
    const { client, tables } = makeFakeSupabase({
      etRows: [{ token_symbol: '中国人能飞', raw_api_data: { created_at: 1789976558 }, blockchain: 'bsc', platform: 'flap' }],
      narrRows: [{ token_symbol: '不应被读', platform: 'flap', blockchain: 'bsc', raw_api_data: {} }],
    });
    const r = await withStub(client, (f) => f(ADDR));
    assert(r.symbol === '中国人能飞' && r.platform === 'flap' && r.tokenCreatedAtSec === 1789976558,
      'A1 主路径返回形状不变');
    assert(!tables.includes('token_narrative'), 'A2 未查 token_narrative（回退只在 0 行分支）');
  }

  console.log('B. 0 行回退命中 → 同形状返回');
  {
    const { client } = makeFakeSupabase({
      narrRows: [{ token_symbol: '中国人能飞', platform: 'flap', blockchain: 'bsc',
        raw_api_data: { created_at: 1789976558, twitterUrl: 'https://x.com/i/communities/1' } }],
    });
    const r = await withStub(client, (f) => f(ADDR));
    assert(r && r.address === ADDR && r.symbol === '中国人能飞' && r.platform === 'flap'
      && r.blockchain === 'bsc' && r.raw_api_data.twitterUrl === 'https://x.com/i/communities/1',
      'B1 回退身份列+raw_api_data 全透传');
    assert(r.tokenCreatedAtSec === 1789976558, 'B2 created_at 取 raw_api_data');
  }

  console.log('C. 回退行缺 created_at → 事件补锚 / null 锚');
  {
    const { client } = makeFakeSupabase({
      narrRows: [{ token_symbol: 'X', platform: 'fourmeme', blockchain: 'bsc', raw_api_data: {} }],
      evRows: [{ created_at: '2026-09-29T11:42:38.000Z' }],
    });
    const r = await withStub(client, (f) => f(ADDR));
    assert(r.tokenCreatedAtSec === 1790682158, 'C1 wss_events token_create 补锚（秒级取整）');
  }
  {
    const { client } = makeFakeSupabase({
      narrRows: [{ token_symbol: 'X', platform: null, blockchain: null, raw_api_data: {} }],
    });
    const r = await withStub(client, (f) => f(ADDR));
    assert(r.tokenCreatedAtSec === null, 'C2 事件也空 → null 锚（不用墙钟冒充）');
    assert(r.blockchain === 'bsc' && r.platform === null, 'C3 blockchain 缺省 bsc / platform 缺省 null');
  }

  console.log('D. 两层全空 / 回退查询故障');
  {
    const { client } = makeFakeSupabase({ narrRows: [] });
    const r = await withStub(client, (f) => f(ADDR));
    assert(r === null, 'D1 两层全 0 行 → null（代币不存在语义保留）');
  }
  {
    const { client } = makeFakeSupabase({ narrRows: null, narrError: { message: 'connect ECONNREFUSED' } });
    let threw = null;
    await withStub(client, (f) => f(ADDR)).catch((e) => { threw = e; });
    assert(threw && threw.message === 'connect ECONNREFUSED', 'D2 回退查询 error → throw fail-loud');
  }

  console.log('E. 源码口径');
  {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src/narrative/analyzer/services/token-info-service.mjs'), 'utf8');
    // 锚实现体注释（函数头 docstring 也有「token_narrative 旧行回退」字样，勿混）
    const fbStart = src.indexOf('C188 裁定选项 1');
    const fbQuery = src.indexOf(".from('token_narrative')", fbStart);
    const fbSeg = src.slice(fbStart, src.indexOf('return {', fbStart) + 400);
    assert(fbQuery > -1, 'E1 回退查 token_narrative');
    assert(fbSeg.includes("'token_symbol, platform, blockchain, raw_api_data'"),
      'E2 只取身份列+raw_api_data（不读分析结果列）');
    assert(fbSeg.indexOf('nr.raw_api_data?.created_at') < fbSeg.indexOf('await evPromise'),
      'E3 evPromise 消费在 created_at 缺锚分支之后（有锚不消费）');
    assert(src.indexOf("data.length === 0") < fbStart, 'E4 回退挂在主查询 0 行分支内');
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
