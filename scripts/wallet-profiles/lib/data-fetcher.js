/**
 * wss_price_ticks 全表拉取（pumpfun 回迁批 4 step4 专用 data-fetcher）
 *
 * ★口径（plan 核实裁定）：全表 id 游标扫描，无 experiment_id/token/platform 过滤。
 *   批 3.2 smart-wallet-mining 版按 experiment_id 拉数——watcher 架构后新行 experiment_id=NULL
 *   会全部漏行；钱包离线画像要求与 TPA 实时三路径（trader_address 直查，跨平台全局）严格同构，
 *   否则 stale 增量合并错位（离线表多算/漏算异平台或 NULL 行）。
 *
 * 游标：`.gt('id', afterId).order('id', {ascending:true}).limit(1000)`——恒走 PK 索引。
 *   id 是 bigserial 单调唯一：无批 3.2 版「同 received_at 边界漏拉」问题（那边要 (received_at,id)
 *   复合游标拆双查），单列 id 天然不漏不重。
 *
 * ⚠️ 只在 182 跑（红线）：全表分页是重查询，本地 VPN 连 Supabase 必超时。
 * ⚠️ SUPABASE_KEY 是 anon（RLS 会静默过滤 wss_price_ticks 成空）——调用方必须传
 *   dbManager.getClient()（service_role），不传 service key。
 */

'use strict';

const PAGE_SIZE = 1000;
const DB_SLEEP_MS = 200; // 页间歇，减轻 Supabase 网关压力（母版/批 3.2 同款）
const MAX_RETRIES = 6;   // 批 3.2 同款：退避 1/2/4/8/16/32s（fetch failed 瞬断护栏）

// 列集对齐批 3.2 smart-wallet-mining/lib/data-fetcher.js（cache 存全列作复用资产；spill 只消费 7 字段）
const SELECT_COLS = 'id, token_address, trade_type, trader_address, price_bnb, price_usd, bnb_amount, token_amount, block_number, block_time, received_at, tx_hash, price_outlier';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * 带退避重试的查询包装。
 * ★fn 内部必须 throw（supabase-js 默认不 throw DB error 而返回 {data,error}）：外面 throw 的话
 *   try/catch 抓不到 → 零重试直接漏页。批 3.2 实证同款。
 * @param {Function} fn async () => data：内部构建 query（每次重试新建 builder）并在 error 时 throw
 * @returns {Promise<any>} fn 的返回值；重试耗尽后 throw 最后一次错误
 */
async function queryWithRetry(fn, maxRetries = MAX_RETRIES) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetries) {
        await sleep(1000 * Math.pow(2, attempt - 1)); // 1/2/4/8/16s
      }
    }
  }
  throw lastErr;
}

/**
 * 拉一页全表 ticks（id 升序）。
 * @param {Object} sb supabase client（须 service_role：dbManager.getClient()）
 * @param {number|null} afterId null=从头；非 null 只拉 id>afterId
 * @returns {Promise<Array>} 行数组（空数组=拉完）
 */
async function fetchTicksPageAfter(sb, afterId) {
  const data = await queryWithRetry(async () => {
    let q = sb.from('wss_price_ticks')
      .select(SELECT_COLS)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);
    if (afterId != null) q = q.gt('id', afterId);
    const r = await q;
    if (r.error) throw new Error(`fetchTicksPageAfter(afterId=${afterId}): ${r.error.message}`);
    return r.data;
  });
  await sleep(DB_SLEEP_MS);
  return data || [];
}

/**
 * DB max(id)（STALE 判据用，GlobalTickCache.dbMaxId 注入）。
 * PK 反取一条：恒走 id 索引 O(1)，不扫表（母版 history：GROUP BY max 聚合撞网关 8s 超时，反取法实证可行）。
 * @returns {Promise<number|null>} null=表空
 */
async function fetchMaxTickId(sb) {
  const data = await queryWithRetry(async () => {
    const r = await sb.from('wss_price_ticks')
      .select('id')
      .order('id', { ascending: false })
      .limit(1);
    if (r.error) throw new Error(`fetchMaxTickId: ${r.error.message}`);
    return r.data;
  });
  // bigserial JSON number：2000 万 << 2^53，精度安全（TPA id 游标分页同假设）
  return data && data[0] ? Number(data[0].id) : null;
}

module.exports = {
  fetchTicksPageAfter,
  fetchMaxTickId,
  queryWithRetry,
  sleep,
  PAGE_SIZE,
};
