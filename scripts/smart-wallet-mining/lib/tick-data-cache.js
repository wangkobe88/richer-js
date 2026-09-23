/**
 * Tick 数据本地缓存（pumpfun-wss-trader src/trading-engine/TickDataCache.js 移植，
 * 聪明钱挖掘批 3.2 专用——richer-js 引擎本体不需要它，故落 scripts/ 而非 src/）
 *
 * 将已停止虚拟实验的 wss_price_ticks 缓存为本地 gzip 文件，
 * 避免每次挖掘/对账都从 Supabase 分页拉取（大实验可达百万级查询）。
 *
 * 存储格式: JSON Lines (.jsonl.gz) — 每行一个 JSON 对象，流式读写避免 V8 字符串长度限制
 *
 * STALE 检测：加载缓存后对比 DB max(received_at)（(experiment_id, received_at) 索引反向取一条
 * ~150ms）；DB 有更新 tick 则增量拉合并重写（data-fetcher opt-in）。不用 count(*)——大表
 * count 必扫全部匹配行 statement timeout，退化成"保守用残缺缓存"反而掩盖问题。
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const readline = require('readline');

const CACHE_DIR = path.join(process.cwd(), 'data', 'tick-cache');

class TickDataCache {
  constructor(logger) {
    this._logger = logger || { info: () => {}, error: console.error };
    this._pendingWrites = new Map(); // sourceExperimentId -> Promise（并发去重）
  }

  /** 确保缓存目录存在 @private */
  _ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
  }

  /** 缓存路径（JSON Lines + gzip）@private */
  _getCachePath(sourceExperimentId) {
    return path.join(CACHE_DIR, `${sourceExperimentId}.jsonl.gz`);
  }

  /** 同步检查缓存是否存在 */
  has(sourceExperimentId) {
    return fs.existsSync(this._getCachePath(sourceExperimentId));
  }

  /**
   * 从本地缓存加载 tick 数据（异步流式读取）
   * @returns {Promise<Array|null>} tick 数组，缓存不存在或损坏时返回 null
   */
  async load(sourceExperimentId) {
    const filePath = this._getCachePath(sourceExperimentId);
    if (!fs.existsSync(filePath)) return null;
    try {
      const start = Date.now();
      const ticks = [];

      const fileStream = fs.createReadStream(filePath);
      const gunzip = zlib.createGunzip();
      fileStream.pipe(gunzip);

      const rl = readline.createInterface({ input: gunzip, crlfDelay: Infinity });
      for await (const line of rl) {
        if (line) {
          ticks.push(JSON.parse(line));
        }
      }

      const stat = fs.statSync(filePath);
      this._logger.info('TickDataCache',
        `Cache HIT: ${sourceExperimentId} | ${ticks.length} ticks | ` +
        `${(stat.size / 1024 / 1024).toFixed(2)}MB | ${Date.now() - start}ms`);
      return ticks;
    } catch (error) {
      this._logger.info('TickDataCache',
        `Cache CORRUPT: ${sourceExperimentId} | ${error.message} | Deleting and re-fetching...`);
      try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
      return null;
    }
  }

  /**
   * 将 tick 数据保存到本地缓存（流式写入 JSON Lines + gzip，tmp 原子改名）
   */
  async save(sourceExperimentId, ticks) {
    this._ensureCacheDir();
    const filePath = this._getCachePath(sourceExperimentId);
    const tmpPath = filePath + '.tmp';
    try {
      const start = Date.now();
      let rawBytes = 0;

      await pipeline(
        Readable.from(this._tickLinesIterator(ticks, counter => { rawBytes = counter; })),
        zlib.createGzip(),
        fs.createWriteStream(tmpPath)
      );
      fs.renameSync(tmpPath, filePath);

      const stat = fs.statSync(filePath);
      this._logger.info('TickDataCache',
        `Cache SAVE: ${sourceExperimentId} | ${ticks.length} ticks | ` +
        `${(rawBytes / 1024 / 1024).toFixed(2)}MB -> ${(stat.size / 1024 / 1024).toFixed(2)}MB | ${Date.now() - start}ms`);
    } catch (error) {
      this._logger.info('TickDataCache',
        `Cache SKIP: ${sourceExperimentId} | ${ticks.length} ticks | ${error.message}`);
      try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
    }
  }

  /**
   * async generator: 逐条序列化 tick 为 JSON Lines，按 ~64KB 分批 yield @private
   */
  async *_tickLinesIterator(ticks, onRawBytes) {
    let batch = '';
    let rawBytes = 0;

    for (let i = 0; i < ticks.length; i++) {
      const line = JSON.stringify(ticks[i]) + '\n';
      rawBytes += Buffer.byteLength(line, 'utf-8');
      batch += line;

      if (batch.length > 65536) {
        yield batch;
        batch = '';
      }
    }
    if (batch) {
      yield batch;
    }
    onRawBytes(rawBytes);
  }

  /**
   * 缓存穿透：先查本地，命中则返回；未命中则调用 fetchFn 从 Supabase 拉取并缓存
   * @param {Function} fetchFn - fetchFn(cursor|null)：cursor={received_at,id} 增量游标（仅
   *   options.incremental 的调用方会收到非 null cursor；无参闭包忽略 cursor 退化全量）
   */
  async getOrFetch(sourceExperimentId, fetchFn, options = {}) {
    // 并发去重：同一 sourceExpId 只允许一个 fetch 执行
    if (this._pendingWrites.has(sourceExperimentId)) {
      this._logger.info('TickDataCache', `Awaiting in-progress fetch for ${sourceExperimentId}`);
      return this._pendingWrites.get(sourceExperimentId);
    }
    const promise = this._doGetOrFetch(sourceExperimentId, fetchFn, options);
    this._pendingWrites.set(sourceExperimentId, promise);
    try {
      return await promise;
    } finally {
      this._pendingWrites.delete(sourceExperimentId);
    }
  }

  /** @private */
  async _doGetOrFetch(sourceExperimentId, fetchFn, options) {
    if (!options.forceRefresh) {
      const cached = await this.load(sourceExperimentId);
      if (cached) {
        const check = options.maxReceivedAtFn
          ? await this._isCacheStale(sourceExperimentId, cached, options)
          : { stale: false, cursor: null };
        if (!check.stale) {
          return cached;
        }
        // STALE：DB 有 cached 之后的 tick。incremental + cursor → 增量拉合并重写；
        // 否则（无参闭包 fetchFn / cached 无 received_at）→ 全量重拉。
        // ⚠️不能对无参闭包 fetchFn 用 fetchFn(cursor)：闭包忽略 cursor 返回全量 → tick 重复。
        if (options.incremental && check.cursor) {
          const incremental = await fetchFn(check.cursor);
          if (incremental && incremental.length > 0) {
            // 不用 spread 合并：增量可达几十万条，push(...arr) 展开超栈上限（母版 P0 教训）
            for (let i = 0; i < incremental.length; i++) cached.push(incremental[i]);
            // 增量按 received_at 拉，但 block_time（链上时刻）可能早于 cached 末尾（received_at
            // 滞后写入），整体 sort block_time 保排序不变量（fold/时间线都依赖 block_time 序）
            cached.sort((a, b) => new Date(a.block_time).getTime() - new Date(b.block_time).getTime());
            await this.save(sourceExperimentId, cached);
            this._logger.info('TickDataCache',
              `Cache INCREMENTAL: ${sourceExperimentId} | +${incremental.length} → ${cached.length} ticks`);
          } else {
            this._logger.info('TickDataCache',
              `Cache INCREMENTAL(0 new): ${sourceExperimentId} | 保持 cache=${cached.length}`);
          }
          return cached;
        }
        this._logger.info('TickDataCache',
          `Cache STALE 全量重拉: ${sourceExperimentId} | cache=${cached.length} → 重新获取`);
      }
    }

    this._logger.info('TickDataCache', `Cache MISS: ${sourceExperimentId} | Fetching from Supabase...`);
    const ticks = await fetchFn(null);
    await this.save(sourceExperimentId, ticks);
    return ticks;
  }

  /**
   * 验证缓存是否过期/不全（DB max(received_at) > 缓存高水位 → DB 有缓存没有的更新 tick）
   * 触发场景：缓存生成时 DB 还没 flush 完（collector 缓冲延迟），后续 DB 补全但缓存定格在不全状态。
   * @returns {Promise<{stale:boolean, cursor:{received_at,id}|null}>}
   * @private
   */
  async _isCacheStale(sourceExperimentId, cached, options) {
    // 缓存高水位：cached 中最大的 (received_at, id)（数据写入边界 + 增量游标）。
    // 同 received_at 可能有多条（collector 一批 flush），取该 received_at 下 max id 作复合游标，
    // 增量拉时 received_at.gt.X OR (eq.X AND id.gt.Y) 防同 received_at 漏拉。
    let cachedMaxRA = null;
    let cachedMaxId = null;
    for (let i = 0; i < cached.length; i++) {
      const t = cached[i];
      const r = t && t.received_at;
      if (!r) continue;
      if (cachedMaxRA === null || r > cachedMaxRA) {
        cachedMaxRA = r;
        cachedMaxId = t.id;
      } else if (r === cachedMaxRA && (cachedMaxId === null || t.id > cachedMaxId)) {
        cachedMaxId = t.id;
      }
    }
    if (!cachedMaxRA) {
      // 缓存无 received_at（异常/极旧格式）：无法验证完整性，视为不全触发重拉，而非保守沿用
      this._logger.info('TickDataCache',
        `Cache STALE(无 received_at 高水位): ${sourceExperimentId} | cache=${cached.length} → 改从 DB 重新加载`);
      return { stale: true, cursor: null };
    }
    try {
      const dbMax = await options.maxReceivedAtFn();
      if (!dbMax) {
        // DB 无 received_at（实验无 tick 或查询返回空）：缓存即全部，视为可用
        this._logger.info('TickDataCache',
          `Cache 校验跳过(DB 无 received_at): ${sourceExperimentId} | cache=${cached.length}`);
        return { stale: false, cursor: { received_at: cachedMaxRA, id: cachedMaxId } };
      }
      if (cachedMaxRA < dbMax) {
        this._logger.info('TickDataCache',
          `Cache STALE(DB 有更新 tick): ${sourceExperimentId} | cacheMax=${cachedMaxRA} < DB=${dbMax} ` +
          `(cache=${cached.length} ticks) → 增量拉取`);
        return { stale: true, cursor: { received_at: cachedMaxRA, id: cachedMaxId } };
      }
      this._logger.info('TickDataCache',
        `Cache 校验通过: ${sourceExperimentId} | cacheMax=${cachedMaxRA} / DB=${dbMax} | ${cached.length} ticks`);
      return { stale: false, cursor: { received_at: cachedMaxRA, id: cachedMaxId } };
    } catch (e) {
      // max(received_at) 走索引 ~150ms，正常不会 timeout；此处仅防网络瞬断，保守用缓存避免无谓重拉
      this._logger.info('TickDataCache',
        `Cache 校验失败(${e.message})，保守用缓存: ${sourceExperimentId} | cacheMax=${cachedMaxRA}`);
      return { stale: false, cursor: { received_at: cachedMaxRA, id: cachedMaxId } };
    }
  }

  /** 删除指定实验的缓存 */
  clear(sourceExperimentId) {
    const fp = this._getCachePath(sourceExperimentId);
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp);
      return true;
    }
    return false;
  }

  /** 清除所有缓存文件 */
  clearAll() {
    if (!fs.existsSync(CACHE_DIR)) return 0;
    let count = 0;
    for (const file of fs.readdirSync(CACHE_DIR)) {
      if (file.endsWith('.jsonl.gz')) {
        fs.unlinkSync(path.join(CACHE_DIR, file));
        count++;
      }
    }
    return count;
  }
}

module.exports = TickDataCache;
