/**
 * Step 4 — 离线高频钱包全历史 profile → wallet_offline_profiles（182）
 *
 * 迁自 pumpfun-wss-trader（2026-09-27）。预计算高频钱包（tick≥threshold）截止 data_through 的
 * 全历史 profile，TPA 实时命中离线表则直接用/增量合并，未命中（小钱包）走实时全量。
 *
 * 须在 step3 后跑（依赖 token_profiles 的 flash_crash_period/first_tick_time 算 bad_action 靶向率
 * ——build-wallet-profiles 头注部署纪律）。step4 是唯一钱包离线画像步（richer-js 无 insider/coords）。
 *
 * 与母版差异：
 *   1. 命令同形 `build-wallet-profiles.cjs --threshold 3 --days 14`，但 REPO_ROOT 从 __dirname
 *      推导（run-daily 同仓库，删母版 REMOTE_182_ROOT/NODE_182 env 依赖，NODE=process.execPath）。
 *   2. 输出解析换 ../lib/parse.js（richer-js 全表 id 游标口径的 [阶段N] 输出格式，母版正则
 *      一条都不匹配）；顺带提取缓存源/扫描行数/分类命中率/阶段4 profile 数（首跑 MISS→FRESH
 *      演化可观测）。
 *   3. 成功后无需额外清理——脚本自删 offline cache/checkpoint/spill（:331-333）。
 *
 * NODE_OPTIONS=12288（HF ticks 内存 + 两阶段 Map）。timeout 3600s（母版 2026-08-10 iter#1
 * ETIMEDOUT 教训：网络抖动拉 ticks 慢，30min 必超）。
 */
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const db = require('../lib/db');
const { parseWalletProfilesRun } = require('../lib/parse');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const NODE = process.execPath;
const TIMEOUT_MS = 3600000;
const MAX_BUFFER = 50 * 1024 * 1024;

async function run(iteration) {
  const cmd = `cd ${REPO_ROOT} && NODE_OPTIONS=--max-old-space-size=12288 ${NODE} scripts/build-wallet-profiles.cjs --threshold 3 --days 14`;
  console.log(`[step4] 离线高频钱包全历史 profile → wallet_offline_profiles（须在 step3 后）`);
  const out = execSync(cmd, { encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'] });
  const tail = out.split('\n').slice(-12).join('\n');
  console.log(`[step4] 完成\n${tail}`);

  const stats = {
    ...parseWalletProfilesRun(out),
    output_tail: tail.slice(-1000),
  };
  // 单命令无中间态：完成即 done（run-daily 断点判据 metrics[stepKey].done）
  if (stats.upserted == null) {
    // 输出协议漂移：显式报错而非静默 null 落表——upsert 数是本步核心产物
    throw new Error(`step4: 输出解析失败（upserted=null，build-wallet-profiles 输出格式漂移？tail:\n${tail.slice(-400)}`);
  }
  await db.writeMetrics(iteration.id, db.METRIC_KEYS.step4, { ...stats, done: true });
  console.log(`[step4] 统计: HF=${stats.high_freq_found} upsert=${stats.upserted} cache=${stats.cache_source}`);
}

module.exports = { run };
