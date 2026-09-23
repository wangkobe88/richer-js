/**
 * 聪明钱挖掘 — tick 拉取（pumpfun-wss-trader scripts/wallet-profiles/lib/data-fetcher.js
 * 的 fetchTicksForExperiment 链路移植，BSC 列名适配：price_bnb / bnb_amount（十进制 BNB，
 * 无 lamports 换算）/ block_number）
 *
 * 只按 experiment_id 过滤 + (received_at, id) 复合游标分页，不在 Supabase 层做
 * block_time 过滤（block_time 无复合索引，过滤会触发查询超时）。不依赖
 * experiments.created_at/stopped_at 作时间边界——stopped_at 在重启/实验仍在跑时是脏值，
 * 用作边界会截断数据。全量取根治（与 BacktestEngine._loadWssTicks 口径一致）。
 *
 * ⚠️ 索引前提：wss_price_ticks(experiment_id, received_at, id)——见
 * scripts/sql/create-wss-ticks-received-idx.sql（用户在 Supabase SQL Editor 执行）。
 * 无索引时查询仍正确但每页带 sort，数据量增长后变慢。
 */

const PAGE_SIZE = 1000;
const DB_SLEEP_MS = 200; // 页间歇，避免把连接池打满

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 带重试的 DB 查询包装器
 * @param {Function} fn 返回 Promise 的查询函数（须在 fn 内部对 supabase {error} 显式 throw，
 *   否则 DB error 不触发重试——supabase-js 默认不 throw）
 * @param {number} maxRetries 6 次（退避 1/2/4/8/16/32s）：离线挖掘几百次查询偶发撞
 *   DB 阵发抖动（锁阻塞/连接池排队 statement timeout），3 次扛不过 ~5min 抖动波。
 *   仅离线挖掘脚本用此函数，成功路径不重试，无副作用。
 */
async function queryWithRetry(fn, maxRetries = 6) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === maxRetries) throw e;
      console.warn(`  DB query failed (attempt ${attempt + 1}), retrying...`, e.message);
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
}

/** 实验的 wss_price_ticks 全量/增量拉取（走 TickDataCache 缓存穿透） */
async function fetchTicksForExperiment(sb, experimentId, tickCache, options = {}) {
  return tickCache.getOrFetch(
    experimentId,
    // fetchFn 接收增量游标 cursor={received_at,id}|null：STALE 时 _doGetOrFetch 传 cached
    // 高水位做增量拉，null=全量。本函数是唯一启用增量的调用方。
    (cursor) => _fetchTicksFromSupabase(sb, experimentId, cursor),
    {
      forceRefresh: options.forceRefresh,
      maxReceivedAtFn: () => _maxReceivedAtInSupabase(sb, experimentId),
      incremental: true, // STALE 时增量拉合并重写
    }
  );
}

/**
 * 查询实验的 DB 最新 received_at（缓存新鲜度验证）。
 * order received_at desc limit 1 走 (experiment_id, received_at) 索引反向取一条 ~150ms，
 * 不受大表 count timeout 影响。
 */
async function _maxReceivedAtInSupabase(sb, experimentId) {
  // fn 内 throw error：supabase-js 默认【不 throw DB error】（返回 {data,error}），
  // 若在外面 throw，queryWithRetry 的 try/catch 抓不到 → statement timeout 零重试即崩。
  const data = await queryWithRetry(async () => {
    const r = await sb.from('wss_price_ticks')
      .select('received_at')
      .order('received_at', { ascending: false })
      .limit(1)
      .eq('experiment_id', experimentId);
    if (r.error) throw new Error(r.error.message);
    return r.data;
  });
  return data && data[0] ? data[0].received_at : null;
}

/**
 * 从 Supabase 获取实验的全部 tick 数据。
 * sinceCursor={received_at,id}|null：null=全量；非 null=增量（只拉该游标之后的 tick）。
 * 游标用 (received_at,id) 复合：received_at 单字段游标会漏掉同 received_at 的后续 tick
 * （一页末尾与下页头部同 received_at 时 .gt 跳过），复合游标根治；order received_at,id asc 天然支持。
 */
async function _fetchTicksFromSupabase(sb, experimentId, sinceCursor) {
  const incremental = !!sinceCursor;
  console.log(`  ${incremental ? '增量' : '全量'}拉取 experiment_id=${experimentId} 的 tick（received_at,id 复合游标分页）` +
    `${incremental ? ` since=${sinceCursor.received_at}/${sinceCursor.id}` : ''}`);
  const SELECT = 'id, token_address, trade_type, trader_address, price_bnb, price_usd, bnb_amount, token_amount, block_number, block_time, received_at, tx_hash, price_outlier';
  const allTicks = [];
  let curRA = sinceCursor ? sinceCursor.received_at : null;
  let curId = sinceCursor ? sinceCursor.id : null;
  let hasMore = true;
  while (hasMore) {
    let pageData, mainLen;
    if (curRA === null) {
      // 首页（全量起点）：无游标，取最早的 PAGE_SIZE 条（走索引，快）
      const query = sb.from('wss_price_ticks').select(SELECT).eq('experiment_id', experimentId)
        .order('received_at', { ascending: true }).order('id', { ascending: true }).limit(PAGE_SIZE);
      pageData = await queryWithRetry(async () => { const r = await query; if (r.error) throw r.error; return r.data; });
      mainLen = pageData ? pageData.length : 0;
    } else {
      // 复合游标拆双查（替代 .or()）。原 .or(received_at.gt.X, and(received_at.eq.X, id.gt.Y))
      // 在大表上让 PG 放弃 (experiment_id,received_at) 索引早停、退化 BitmapOr+全 sort，单页稳定
      // 撞 statement_timeout（母版实证 100× 慢）。拆两个单条件查询（语义等价、防漏不变）：
      // ①主查 received_at > curRA（严格大于，索引有序早停）
      // ②补漏 received_at = curRA AND id > curId（同 received_at 边界，通常 0 条）
      // 两集 received_at 范围互斥(> vs =) 无重复，[...bound, ...main] 拼接即全局升序。
      const mainQuery = sb.from('wss_price_ticks').select(SELECT).eq('experiment_id', experimentId)
        .gt('received_at', curRA)
        .order('received_at', { ascending: true }).order('id', { ascending: true }).limit(PAGE_SIZE);
      const boundQuery = sb.from('wss_price_ticks').select(SELECT).eq('experiment_id', experimentId)
        .eq('received_at', curRA).gt('id', curId)
        .order('received_at', { ascending: true }).order('id', { ascending: true }).limit(PAGE_SIZE);
      const [main, bound] = await Promise.all([
        queryWithRetry(async () => { const r = await mainQuery; if (r.error) throw r.error; return r.data; }),
        queryWithRetry(async () => { const r = await boundQuery; if (r.error) throw r.error; return r.data; }),
      ]);
      pageData = [...(bound || []), ...(main || [])];
      mainLen = main ? main.length : 0;
    }
    if (!pageData || pageData.length === 0) break;
    allTicks.push(...pageData);
    hasMore = mainLen === PAGE_SIZE; // 主查满页才有更多；bound 有限不决定 hasMore
    if (hasMore) {
      const last = pageData[pageData.length - 1];
      curRA = last.received_at;
      curId = last.id;
    }
    await sleep(DB_SLEEP_MS);
  }

  console.log(`  共 ${allTicks.length} 条 tick`);
  allTicks.sort((a, b) => new Date(a.block_time).getTime() - new Date(b.block_time).getTime());
  return allTicks;
}

module.exports = { fetchTicksForExperiment, queryWithRetry, sleep, PAGE_SIZE };
