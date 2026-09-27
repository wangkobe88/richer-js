/**
 * 全局 tick 数据本地缓存（pumpfun 回迁批 4 step4 专用；单键全局流式版）
 *
 * 与批 3.2 smart-wallet-mining/lib/tick-data-cache.js（experimentId 键控）的关键差异：
 *   1. 单键：data/tick-cache/global-wallet-profiles.jsonl.gz —— wss_price_ticks 【全表】镜像，
 *      无 experiment_id/platform 过滤。watcher 架构后新行 experiment_id=NULL，experiment 键控
 *      口径会全部漏行；钱包画像要求与 TPA 实时三路径（trader_address 直查，跨平台全局）严格
 *      同构，故 step4 拉数必须全表口径（plan 裁定）。
 *   2. 流式：forEachTick 用 readline 逐行 visit，不把全表载入内存数组（母版 fetch 返回数组的
 *      模式在 BSC 全表量级下爆 heap —— 全表数百万-千万行 × ~1KB 对象开销远超 12GB）。
 *      两遍遍历（count 筛 HF + spill）各自流式，内存峰值 = 消费侧 visit 自持状态。
 *   3. STALE 判据 = max(id)（PK 反取一条，恒走索引 O(1)）；增量 .gt('id', cachedMaxId)。
 *      id 是 bigserial 唯一键，天然无批 3.2 版「同 received_at 边界漏拉」问题，不需要复合
 *      游标拆双查。
 *   4. meta sidecar（global-wallet-profiles.meta.json：{maxId, rows, gzipBytes, savedAt}）：
 *      STALE 判据 O(1) 读 meta，不流式扫数据文件找高水位。gzipBytes 与数据文件实际 size
 *      不符 = 上次写入 crash 在 rename 与 meta 落盘之间 → 删数据文件全量重拉（安全方向）。
 *
 * 损坏语义（fail-loud，不留半成品）：
 *   - 读路径损坏（gunzip CRC / JSON.parse / 流 error）→ 删 cache（数据+meta）后 throw：
 *     本次中止（消费侧 visit 副作用全在内存/临时 spill，进程退出即弃，无表污染），下次 MISS 重拉。
 *   - 写路径中断（fetch 失败 / visit throw / 流 error）→ 清 tmp 后 rethrow，cache 保持原状
 *     （MISS 场景无文件、STALE 场景原文件未动）。
 *
 * 存储：JSON Lines + gzip（流式读写避免 V8 单字符串超长）；tmp 写 + rename 原子替换。
 *
 * ⚠️ 只在 182 跑（红线同 step4 主脚本）：全表分页拉取是重查询。
 * ⚠️ 不动批 3.2 的 smart-wallet-mining 版（experimentId 键控语义不同，两套并存）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { once } = require('events');

const CACHE_DIR = path.join(process.cwd(), 'data', 'tick-cache');
const CACHE_KEY = 'global-wallet-profiles';

class GlobalTickCache {
  /**
   * @param {Object} [logger] { info(msg), error(msg) }；缺省 console
   */
  constructor(logger) {
    this._logger = logger || {
      info: (msg) => console.log(msg),
      error: (msg) => console.error(msg),
    };
  }

  // ── 路径 ──
  _dataPath() { return path.join(CACHE_DIR, `${CACHE_KEY}.jsonl.gz`); }
  _metaPath() { return path.join(CACHE_DIR, `${CACHE_KEY}.meta.json`); }

  _ensureDir() {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  // ── meta sidecar ──
  _readMeta() {
    try {
      const m = JSON.parse(fs.readFileSync(this._metaPath(), 'utf8'));
      return (m && Number.isFinite(m.maxId) && Number.isFinite(m.rows)) ? m : null;
    } catch (_) {
      return null;
    }
  }

  _writeMetaAtomic(m) {
    const tmp = this._metaPath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(m));
    fs.renameSync(tmp, this._metaPath());
  }

  _dropCache() {
    try { fs.rmSync(this._dataPath(), { force: true }); } catch (_) { /* ignore */ }
    try { fs.rmSync(this._metaPath(), { force: true }); } catch (_) { /* ignore */ }
  }

  /**
   * 主入口：以 id 升序流式遍历全表 tick，逐行喂 visit(row)。
   *
   * 状态机：
   *   MISS（数据/meta 缺失、size 失配、DB 空、DB 比 cache 旧）→ 全量分页拉取（边拉边写 tmp，
   *     visit 逐行执行）→ rename + meta 落盘
   *   FRESH（dbMaxId === meta.maxId）→ 流式读数据文件逐行 visit
   *   STALE（dbMaxId > meta.maxId）→ 流式读旧行（visit + 透传写 tmp）+ 增量分页拉取
   *     （visit + 写 tmp）→ rename + meta 更新
   *
   * @param {Object} deps
   * @param {Function} deps.fetchPage  (afterId: number|null) => Promise<Array>：单页查询
   *   （id 升序、limit 1000；afterId=null 从头拉，非 null 只拉 id>afterId；空数组=拉完；
   *   重试/页间歇由 fetchPage 内部负责）
   * @param {Function} deps.dbMaxId    () => Promise<number|null>：DB max(id)（PK 反取一条）
   * @param {Function} deps.visit      (row) => void：同步消费（计数/spill；throw 会中断并清 tmp）
   * @param {Function} [deps.onPageGap] async () => void：页/行批间隙钩子（每页尾或每 2000 行调
   *   一次并 await）——消费侧磁盘写流（spill 桶）在此做背压 drain，防 write queue 无界膨胀。
   * @returns {Promise<{source:'miss'|'fresh'|'stale', rows:number, maxId:number}>}
   */
  async forEachTick({ fetchPage, dbMaxId, visit, onPageGap }) {
    if (typeof fetchPage !== 'function' || typeof visit !== 'function') {
      throw new Error('GlobalTickCache.forEachTick: fetchPage/visit 必传');
    }
    const gap = typeof onPageGap === 'function' ? onPageGap : null;
    const dataPath = this._dataPath();
    const meta = this._readMeta();
    const dataExists = fs.existsSync(dataPath);
    // 一致性：数据文件与 meta 必须同时存在且 size 匹配（crash 窗口：rename 后 meta 落盘前）
    let sizeOk = false;
    if (dataExists && meta) {
      try { sizeOk = meta.gzipBytes === fs.statSync(dataPath).size; } catch (_) { sizeOk = false; }
    }
    if (!dataExists || !meta || !sizeOk) {
      if (dataExists || meta) {
        this._logger.info(`[GlobalTickCache] 缓存失配（data=${dataExists}, meta=${!!meta}, sizeOk=${sizeOk}）→ 删除全量重拉`);
        this._dropCache();
      }
      return this._fullFetch({ fetchPage, visit, label: 'MISS', gap });
    }

    // dbMaxId 校验失败（网络长断）→ 保守用缓存（对齐批 3.2 语义；重拉也必然失败）
    let dbMax = null;
    let dbMaxErr = null;
    try {
      dbMax = await dbMaxId();
    } catch (e) {
      dbMaxErr = e;
    }
    if (dbMaxErr) {
      this._logger.info(`[GlobalTickCache] max(id) 校验失败(${dbMaxErr.message})，保守用缓存: cacheMax=${meta.maxId} / ${meta.rows} 行`);
      return this._streamOnly(visit, meta, gap);
    }
    if (dbMax == null) {
      // DB 表空：cache 内容必过时 → 重拉（重拉也得 0 行，安全）
      this._logger.info('[GlobalTickCache] DB max(id)=null（表空）→ 删除缓存全量重拉');
      this._dropCache();
      return this._fullFetch({ fetchPage, visit, label: 'MISS', gap });
    }
    if (dbMax < meta.maxId) {
      // 表比缓存旧（清表/回滚）：沿用会拿到已删行 → 重拉
      this._logger.info(`[GlobalTickCache] DB max(id)=${dbMax} < cache=${meta.maxId}（表回缩）→ 删除缓存全量重拉`);
      this._dropCache();
      return this._fullFetch({ fetchPage, visit, label: 'MISS', gap });
    }
    if (dbMax === meta.maxId) {
      return this._streamOnly(visit, meta, gap);
    }
    return this._staleRewrite({ fetchPage, visit, oldMeta: meta, dbMax, gap });
  }

  /**
   * MISS：全量分页拉取，逐行 visit + 写 tmp；完成后 rename + meta。
   * visit throw（如护栏超限）→ 清 tmp 后 rethrow（cache 保持无文件态，下次重拉）。
   */
  async _fullFetch({ fetchPage, visit, label, gap }) {
    this._ensureDir();
    const t0 = Date.now();
    const tmp = this._dataPath() + '.tmp';
    const { gz, finished, writeLine } = this._makeWriter(tmp);
    let rows = 0;
    let maxId = 0;
    try {
      let afterId = null;
      while (true) {
        const page = await fetchPage(afterId);
        if (!page || page.length === 0) break;
        for (const row of page) {
          visit(row);
          writeLine(row);
          rows++;
          const _id = Number(row.id);
          if (Number.isFinite(_id) && _id > maxId) maxId = _id;
        }
        afterId = Number(page[page.length - 1].id);
        if (!Number.isFinite(afterId)) throw new Error(`tick 行缺 id（row=${JSON.stringify(page[page.length - 1]).slice(0, 120)}）`);
        await this._drainIfNeeded(gz);
        if (gap) await gap();
      }
      const st = await this._finishWriter(gz, finished, tmp);
      this._writeMetaAtomic({ maxId, rows, gzipBytes: st, savedAt: new Date().toISOString() });
      this._logger.info(`[GlobalTickCache] ${label}: DB 全量拉取 ${rows} 行 / ${(st / 1048576).toFixed(1)}MB / ${((Date.now() - t0) / 1000).toFixed(0)}s → cache 落盘`);
      return { source: 'miss', rows, maxId };
    } catch (e) {
      this._abortWriter(gz, tmp);
      throw e;
    }
  }

  /** FRESH：只读流式遍历（不写）。损坏 → 删 cache 后 throw（下次运行重拉；本次无表写入，无污染）。 */
  async _streamOnly(visit, meta, gap) {
    const t0 = Date.now();
    try {
      const rows = await this._streamRead(this._dataPath(), (row, _line) => visit(row), gap);
      this._logger.info(`[GlobalTickCache] FRESH: cache 命中 ${rows} 行 / maxId=${meta.maxId} / ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      return { source: 'fresh', rows, maxId: meta.maxId };
    } catch (e) {
      this._logger.error(`[GlobalTickCache] FRESH 读失败(${e.message}) → 删缓存（下次重拉），本次中止`);
      this._dropCache();
      throw new Error(`global tick cache 读失败已删除，请重跑: ${e.message}`);
    }
  }

  /**
   * STALE：旧行流式透传（visit + 原样写 tmp，不重新序列化保字节）→ 增量分页拉取（visit + 写 tmp）
   * → rename + meta 更新。增量拉完 DB 可能又有新行（watcher 常驻写入）：下次运行再增量，单次
   * 运行内 visit 行集 = 某一致快照前缀（id 单调），足够。
   * 损坏分阶段：旧行读阶段失败 → 删 cache（下次 MISS 重拉，防撞同一损坏行死循环）；增量阶段失败
   * → 只清 tmp（cache 原文件未动，下次再增量）。
   */
  async _staleRewrite({ fetchPage, visit, oldMeta, dbMax, gap }) {
    this._ensureDir();
    const t0 = Date.now();
    const tmp = this._dataPath() + '.tmp';
    const { gz, finished, writeLine } = this._makeWriter(tmp);
    let rows = 0;
    let maxId = oldMeta.maxId;
    let oldDone = false;
    try {
      // ① 旧行透传（id ≤ oldMeta.maxId，行序即写出序）
      rows = await this._streamRead(
        this._dataPath(),
        (row, line) => {
          visit(row);
          writeLine(line);
        },
        async () => {
          await this._drainIfNeeded(gz);
          if (gap) await gap();
        }
      );
      oldDone = true;
      // ② 增量页（id > oldMeta.maxId）
      let afterId = oldMeta.maxId;
      while (true) {
        const page = await fetchPage(afterId);
        if (!page || page.length === 0) break;
        for (const row of page) {
          visit(row);
          writeLine(row);
          rows++;
          const _id = Number(row.id);
          if (Number.isFinite(_id) && _id > maxId) maxId = _id;
        }
        afterId = Number(page[page.length - 1].id);
        if (!Number.isFinite(afterId)) throw new Error(`增量 tick 行缺 id（afterId=${oldMeta.maxId}）`);
        await this._drainIfNeeded(gz);
        if (gap) await gap();
      }
      const st = await this._finishWriter(gz, finished, tmp);
      this._writeMetaAtomic({ maxId, rows, gzipBytes: st, savedAt: new Date().toISOString() });
      this._logger.info(`[GlobalTickCache] STALE: cacheMax=${oldMeta.maxId} → DB=${dbMax} | 旧行透传 + 增量至 maxId=${maxId} | 共 ${rows} 行 / ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      return { source: 'stale', rows, maxId };
    } catch (e) {
      this._abortWriter(gz, tmp);
      if (!oldDone) {
        // 旧行读阶段失败（损坏或 visit throw）：删 cache，下次 MISS 全量重拉。
        // visit throw 场景误删 cache 的代价 = 多一次全量拉取（正确性无损，可接受——护栏超限等
        // fail-loud 优先于缓存复用）。
        this._dropCache();
      }
      throw e;
    }
  }

  // ── 流式读写原语 ──

  /**
   * 流式读 gzip jsonl，逐行回调 onRow(row, line)。
   * ★readline 坑防护：input 流（gunzip）error 时 async iterator 可能不 reject 而是静默正常结束
   *   （截断当成功）——显式监听 source/gunzip error，close rl 并在循环尾检查抛出。
   * @param {Function} [onGap] 行批间隙钩子（每 2000 行 await 一次；透传写场景做背压，只读场景可 null）
   */
  async _streamRead(file, onRow, onGap = null) {
    const source = fs.createReadStream(file);
    const gun = zlib.createGunzip();
    source.pipe(gun);
    const rl = readline.createInterface({ input: gun, crlfDelay: Infinity });
    let streamErr = null;
    source.on('error', (e) => { if (!streamErr) streamErr = e; rl.close(); });
    gun.on('error', (e) => { if (!streamErr) streamErr = e; rl.close(); });
    let n = 0;
    for await (const line of rl) {
      if (streamErr) throw streamErr;
      if (!line) continue;
      const row = JSON.parse(line);
      onRow(row, line);
      n++;
      if (onGap && (n % 2000 === 0)) await onGap();
    }
    if (streamErr) throw streamErr;
    return n;
  }

  /** 建 gzip 写装置（tmp 文件）。writeLine 接收行对象（序列化）或已序列化字符串（透传）。 */
  _makeWriter(tmpPath) {
    const out = fs.createWriteStream(tmpPath);
    const gz = zlib.createGzip();
    gz.pipe(out);
    const finished = new Promise((resolve, reject) => {
      out.on('finish', resolve);
      out.on('error', reject);
      gz.on('error', reject);
    });
    const writeLine = (rowOrLine) => {
      const line = typeof rowOrLine === 'string' ? rowOrLine : JSON.stringify(rowOrLine);
      gz.write(line.endsWith('\n') ? line : line + '\n');
    };
    return { gz, finished, writeLine };
  }

  /** 背压：gzip 缓冲积压超 4MB 时等 drain（千万行长跑防 write queue 无界膨胀）。 */
  async _drainIfNeeded(gz) {
    if (gz.writableLength > (1 << 22)) await once(gz, 'drain');
  }

  /** 收尾：flush gzip → 等落盘 → rename → 返回最终文件 size。 */
  async _finishWriter(gz, finished, tmpPath) {
    gz.end();
    await finished;
    const size = fs.statSync(tmpPath).size;
    fs.renameSync(tmpPath, this._dataPath());
    return size;
  }

  /** 中止：销毁流 + 清 tmp（下次重拉；不留半成品）。 */
  _abortWriter(gz, tmpPath) {
    try { gz.destroy(); } catch (_) { /* ignore */ }
    try { fs.rmSync(tmpPath, { force: true }); } catch (_) { /* ignore */ }
  }

  /** 删除缓存（数据 + meta）。 */
  clear() {
    this._dropCache();
  }
}

module.exports = GlobalTickCache;
