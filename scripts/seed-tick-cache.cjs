#!/usr/bin/env node
// ============================================================================
// 回测 tick 缓存种子脚本——用「planner 友好」的查询形状绕开 keyset 慢计划
// 直接生成 BacktestTickCache 缓存文件（2026-10-02，d46b1b6c flap statement
// timeout 案）
//
// 背景：BacktestEngine._fetchPlatformTicksRows 的形状是
//   .in(token,100/批) + .eq(platform) + .gt(id,cursor) + .order(id) + .limit
// 在 (token_address, platform, id) 索引不存在时，planner 对「无约束起点
// (gt(id,0)) + order id」选 id 索引顺序扫全表过滤——稀疏平台（flap，token
// 命中率低）扫 230 万行 > 8s statement_timeout。d46b1b6c 并集 49,171 token
// 实测：fourmeme 63ms / flap 8053ms 超时。
//
// 本脚本用替代形状拉全量（实测 flap 同批 368ms）：
//   .in(token,100/批) + .eq(platform) + .range(from,to)   ← 无 order 无 gt
// 走 token bitmap 计划。无序 range 分页在并发 UPDATE（price_outlier 回写）
// 下有跳行/重行风险 → 每 chunk 拉 head count 精确行数，去重行数 !== count
// 即 fail-loud throw（不静默缺数据）。
//
// 落盘完全复用 BacktestTickCache.getOrFetch 官方写路径（_miss → _writeSorted：
// 排序 / MAX_SAFE_INTEGER 检查 / gzip 流式 / meta sidecar 全一致），下次回测
// 启动 probe maxId 对比 → FRESH 纯读或 STALE 增量（增量形状 .gt(id,大数) 本身
// 不慢，实测 99ms）——两条路径都快，引擎零改动。
//
// 用法（182 上跑）：
//   node scripts/seed-tick-cache.cjs --experiment <容器实验id> [--platform flap]
//     [--force]   已有缓存文件时覆盖重造（默认存在即退出）
// ============================================================================
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt;
}
const EXPERIMENT = argVal('--experiment', null);
const PLATFORM = argVal('--platform', 'flap');
const FORCE = args.includes('--force');
if (!EXPERIMENT) { console.error('用法: node scripts/seed-tick-cache.cjs --experiment <id> [--platform flap] [--force]'); process.exit(1); }

// 与 BacktestEngine.TICK_SELECT_COLUMNS 严格一致（columnsTag 漂移会判废缓存）
const TICK_SELECT_COLUMNS = 'id, token_address, trade_type, trader_address, sender_address, price_bnb, price_usd, bnb_amount, token_amount, block_number, block_time, tx_hash, log_index, price_outlier, platform';

const TOKEN_CHUNK_SIZE = 100;  // 与引擎一致（PostgREST .in 护栏）
const PAGE_SIZE = 1000;        // 无序 range 分页页大小
const MAX_COUNT_RETRY = 2;     // count 校验失败的整 chunk 重试次数

async function main() {
  const fs = require('fs');
  const { dbManager } = require('../src/services/dbManager');
  const { BacktestTickCache } = require('../src/trading-engine/core/BacktestTickCache');
  const db = dbManager.getClient();

  // ── 1. 容器 token 全集（与引擎 _loadTokenMetadata 同源：experiment_tokens）──
  const addresses = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db.from('experiment_tokens')
      .select('token_address').eq('experiment_id', EXPERIMENT).range(from, from + 999);
    if (error) throw new Error(`拉 experiment_tokens 失败: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) if (r.token_address) addresses.push(r.token_address);
    if (data.length < 1000) break;
    from += 1000;
  }
  if (addresses.length === 0) throw new Error(`实验 ${EXPERIMENT} 名下无 token 行`);
  console.log(`token 全集: ${addresses.length} 地址（platform=${PLATFORM}）`);

  // ── 2. 缓存存在性检查 ──
  const cache = new BacktestTickCache({ experimentId: EXPERIMENT });
  const dir = path.join(process.cwd(), 'data', 'tick-cache', 'backtest', EXPERIMENT);
  const dataPath = path.join(dir, `${PLATFORM}.jsonl.gz`);
  const metaPath = path.join(dir, `${PLATFORM}.meta.json`);
  if (!FORCE && fs.existsSync(dataPath) && fs.existsSync(metaPath)) {
    console.log(`缓存已存在（${dataPath}），如需重造加 --force`);
    process.exit(0);
  }

  // ── 3. 高效形状 fetchRows（getOrFetch 的 MISS 路径只以 afterId=0 调一次）──
  const t0 = Date.now();
  let queryCount = 0;
  const fetchRows = async () => {
    const rows = [];
    for (let ci = 0; ci < addresses.length; ci += TOKEN_CHUNK_SIZE) {
      const chunk = addresses.slice(ci, ci + TOKEN_CHUNK_SIZE);
      const label = `chunk ${Math.floor(ci / TOKEN_CHUNK_SIZE) + 1}/${Math.ceil(addresses.length / TOKEN_CHUNK_SIZE)}`;

      let ok = false;
      for (let attempt = 1; attempt <= MAX_COUNT_RETRY && !ok; attempt++) {
        // 精确行数（head count，同过滤形状）
        queryCount++;
        const { count, error: cErr } = await db.from('wss_price_ticks')
          .select('id', { count: 'exact', head: true })
          .in('token_address', chunk).eq('platform', PLATFORM);
        if (cErr) throw new Error(`${label} count 失败: ${cErr.message}`);

        // 无序 range 分页拉全量 + id 去重
        const collected = new Map();   // id → row
        let rangeFrom = 0;
        for (;;) {
          queryCount++;
          const { data, error } = await db.from('wss_price_ticks')
            .select(TICK_SELECT_COLUMNS)
            .in('token_address', chunk).eq('platform', PLATFORM)
            .range(rangeFrom, rangeFrom + PAGE_SIZE - 1);
          if (error) throw new Error(`${label} 拉取失败: ${error.message}`);
          if (!data || data.length === 0) break;
          for (const r of data) collected.set(r.id, r);
          if (data.length < PAGE_SIZE) break;
          rangeFrom += PAGE_SIZE;
        }

        if (collected.size === count) {
          for (const r of collected.values()) rows.push(r);
          ok = true;
        } else {
          console.warn(`  ${label} 第 ${attempt} 次 count 校验不符（拉到 ${collected.size} vs count ${count}），重试`);
        }
      }
      if (!ok) {
        throw new Error(`${label} count 校验连续 ${MAX_COUNT_RETRY} 次不符（并发写导致分页漂移？）——fail-loud 中止，不写缓存`);
      }
      if ((ci / TOKEN_CHUNK_SIZE) % 50 === 49) {
        console.log(`  进度: ${ci + chunk.length}/${addresses.length} 地址，累计 ${rows.length} 行 / ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }
    }
    return rows;
  };

  // ── 4. 官方写路径落盘（排序/meta/原子写全复用）──
  const { rows, source } = await cache.getOrFetch({
    sourceExperimentId: EXPERIMENT,
    platform: PLATFORM,
    addresses,
    columnsTag: TICK_SELECT_COLUMNS,
    fetchRows,
    probeMaxId: async () => { throw new Error('probe 不应被调用（无缓存时走 MISS）'); },
  });
  console.log(`\n完成: source=${source}, ${rows.length} 行 / 查询 ${queryCount} 次 / ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`缓存: ${dataPath}`);
  console.log(`下次回测启动 → FRESH 纯读 或 STALE 增量（增量形状不慢），引擎零改动`);
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
