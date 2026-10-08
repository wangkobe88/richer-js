/**
 * 回测 ticks 装载本地缓存（2026-09-29，参照 pumpfun-wss-trader TickDataCache 机制）
 *
 * 把「源实验 token 全集 × 单 platform」的全时段 wss_price_ticks 原始 DB 行缓存为本地
 * gzip jsonl 文件，配对回测/多轮验证场景免重复全量分页拉取。粒度 (sourceExperimentId,
 * platform) per-platform 一文件——对齐 BacktestEngine 的拉取口径（token 集合 + platform
 * 单值 .eq，watcher 架构后新行 experiment_id=NULL 不能按实验过滤）；both 实验读两个文件。
 *
 * 「缓存存全量、运行期过滤」：只存全时段原始行（supabase 返回原样 JSON——price 保持
 * 字符串、block_time 保持 ISO），回测时间窗/token 过滤维持引擎既有内存层零改动，同一份
 * 缓存服务任意窗口回测，回测结果与直拉 bit-identical。
 *
 * 状态机（探针 = 锚定式，2026-10-08 计划翻转事故改造：`id > meta.maxId` 锚 + chunk×platform
 * 取增量区间 max(id)——扫描范围 = 缓存头之后的增量行，而非全表头无关行。旧无锚形状
 * `IN(N>3) + eq(platform) + ORDER BY id DESC LIMIT 1` 在表涨 150 万行后 planner 稳定选
 * id 反向扫描扫表头无关行 → 8s statement timeout，in(20)/in(50) 小批量同死，探针必败
 * → bypass 全量直拉 flap 同死）：
 *   MISS   data/meta 缺、gzipBytes 与实际 size 失配（上次写 crash 在 rename 与 meta 之间）、
 *          columnsTag 漂移 → fetchRows(0) 全量拉 → 落盘（不经探针）
 *   FRESH  锚定探针 null（增量区间无行）且锚行 PK 核验存在 → 纯读文件零拉取
 *          （空集形态 {0,0} 锚=0 探针退无锚形状，null = DB 无行，同样 FRESH 空数组）
 *   STALE  锚定探针返回 id > 锚（增量区间 max）→ 读旧文件 + fetchRows(meta.maxId)
 *          增量补拉 → 合并重写
 *   回缩   锚定探针 null 且锚行 PK 核验不存在（清表/删行使 meta.maxId 行消失——gt 锚
 *          形状下旧行「probeMax < meta.maxId」分支结构性不可达，检测责任移交锚行核验）→ drop → MISS
 *   bypass 探针 throw → WARN + fetchRows(0) 直拉，本次完全不读写缓存（数据正确性优先，
 *          不掩盖问题；缓存原状，下次重试探针）
 *   损坏   FRESH/STALE 读旧文件失败（gunzip CRC / JSON.parse / 流 error）→ drop + 本次
 *          继续 MISS 重拉（不中断回测）；fetchRows/写流失败 → 清 tmp + rethrow（引擎
 *          初始化失败，缓存保持原状下次再试）
 *
 * 写路径：JSON Lines 逐行 + gzip 流式（绕 V8 单字符串上限）；tmp 带 pid 后缀（两进程并发
 * 写同 key 只浪费不损坏）；先 rename 数据文件后写 meta（保住 gzipBytes crash 检测语义）；
 * 4MB 背压 drain；行 id > Number.MAX_SAFE_INTEGER → throw（fail-loud 防 bigint 静默丢精度）。
 *
 * 原语（_streamRead 坑防护 / _makeWriter / _drainIfNeeded / _finishWriter / _abortWriter）
 * 平移自 scripts/wallet-profiles/lib/tick-data-cache.js（GlobalTickCache，生产验证母版）。
 * 与 scripts/ 两个 tick-data-cache 的差异：本模块是引擎本体组件、多键 (srcExpId, platform)、
 * 返回全量数组（回测本就全量物化 raw）、探针失败 bypass 而非保守用缓存。
 *
 * ⚠ 磁盘无自动清理（不做静默 TTL 删数据）：clear() 手动管理，182 磁盘监控项。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { once } = require('events');

const CACHE_VERSION = 1;
const DEFAULT_CACHE_DIR = path.join(process.cwd(), 'data', 'tick-cache', 'backtest');
const DRAIN_THRESHOLD_BYTES = 1 << 22; // 4MB 背压阈值

class BacktestTickCache {
  /**
   * @param {Object} [opts]
   * @param {Object} [opts.logger]        引擎 Logger（info/warn/error 三参形态
   *                                      (experimentId, tag, msg)）；缺省 console
   * @param {string} [opts.experimentId]  日志归属实验（回测实验 id，非源实验）
   * @param {string} [opts.cacheDir]      覆盖缓存根目录（单测注入 tmp 用；默认
   *                                      cwd/data/tick-cache/backtest）
   */
  constructor(opts = {}) {
    this._logger = opts.logger || {
      info: (_exp, tag, msg) => console.log(`[${tag}] ${msg}`),
      warn: (_exp, tag, msg) => console.warn(`[${tag}] ${msg}`),
      error: (_exp, tag, msg) => console.error(`[${tag}] ${msg}`),
    };
    this._experimentId = opts.experimentId || null;
    this._cacheDir = opts.cacheDir || DEFAULT_CACHE_DIR;
    this._pendingWrites = new Map(); // `<srcExpId>::<platform>` → Promise（进程内并发去重）
  }

  // ── 路径 ──

  _dirFor(sourceExperimentId) { return path.join(this._cacheDir, sourceExperimentId); }
  _dataPath(sourceExperimentId, platform) {
    return path.join(this._dirFor(sourceExperimentId), `${platform}.jsonl.gz`);
  }
  _metaPath(sourceExperimentId, platform) {
    return path.join(this._dirFor(sourceExperimentId), `${platform}.meta.json`);
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // ── meta sidecar ──

  /**
   * 读并校验 meta：version 匹配、maxId/rows 有限数、columnsTag 与本次一致；
   * 任何不合格（含文件缺失/JSON 损坏）返回 null（调用方按失配分支处理）。
   */
  _readMeta(metaPath, columnsTag) {
    let m;
    try {
      m = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (_) {
      return null;
    }
    if (!m || m.version !== CACHE_VERSION) return null;
    if (!Number.isFinite(m.maxId) || !Number.isFinite(m.rows)) return null;
    if (columnsTag != null && m.columnsTag !== columnsTag) return null;
    return m;
  }

  _writeMetaAtomic(metaPath, m) {
    const tmp = `${metaPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(m));
    fs.renameSync(tmp, metaPath);
  }

  _dropCache(dataPath, metaPath) {
    try { fs.rmSync(dataPath, { force: true }); } catch (_) { /* ignore */ }
    try { fs.rmSync(metaPath, { force: true }); } catch (_) { /* ignore */ }
  }

  // ── 主入口 ──

  /**
   * 装载某 (sourceExperimentId, platform) 的全时段原始 DB 行。
   *
   * @param {Object} d
   * @param {string}   d.sourceExperimentId 缓存键之一（目录名）
   * @param {string}   d.platform           缓存键之二（单值 'fourmeme'|'flap'）
   * @param {string[]} d.addresses          源实验 token 全集（tokenCount 诊断用）
   * @param {Function} d.fetchRows   async (afterId: number) => Array<row>
   *                                 单 platform 全 chunk keyset 分页拉取闭包
   *                                 （afterId=0 全量、=meta.maxId 增量）
   * @param {Function} d.probeMaxId  async (anchor: number) => number|null  新鲜度探针
   *                                 （锚定式：id > anchor 区间内 chunk×platform max(id)；
   *                                 anchor=0/空 = 无锚全区间形状；增量区间无行时 null）
   * @param {Function} d.anchorExists async (id: number) => boolean  锚行 PK 存在性核验
   *                                 （`where id = meta.maxId limit 1` 单行查询恒快；
   *                                 锚定探针 null 时区分 FRESH 与 清表/删行回缩）
   * @param {string}   [d.columnsTag]       列清单标记（引擎 select 字符串；漂移 → 判废重拉）
   * @param {boolean}  [d.forceRefresh=false] 跳过缓存读，MISS 全量重拉重建
   * @returns {Promise<{rows: Array, source: 'miss'|'fresh'|'stale'|'bypass'}>}
   */
  async getOrFetch(d) {
    if (!d || typeof d !== 'object') throw new Error('BacktestTickCache.getOrFetch: 参数必传');
    const { sourceExperimentId, platform, fetchRows, probeMaxId, anchorExists } = d;
    if (!sourceExperimentId || !platform) {
      throw new Error('BacktestTickCache.getOrFetch: sourceExperimentId/platform 必传');
    }
    if (typeof fetchRows !== 'function' || typeof probeMaxId !== 'function'
      || typeof anchorExists !== 'function') {
      throw new Error('BacktestTickCache.getOrFetch: fetchRows/probeMaxId/anchorExists 必传');
    }
    const key = `${sourceExperimentId}::${platform}`;
    if (this._pendingWrites.has(key)) return this._pendingWrites.get(key);
    const p = this._getOrFetchInner(d).finally(() => this._pendingWrites.delete(key));
    this._pendingWrites.set(key, p);
    return p;
  }

  async _getOrFetchInner(d) {
    const { sourceExperimentId, platform, fetchRows, probeMaxId, anchorExists, forceRefresh } = d;
    const dataPath = this._dataPath(sourceExperimentId, platform);
    const metaPath = this._metaPath(sourceExperimentId, platform);

    // ① 一致性校验：data/meta 同在且 gzipBytes 匹配（crash 窗口）+ columnsTag 匹配
    const meta = this._readMeta(metaPath, d.columnsTag);
    const dataExists = fs.existsSync(dataPath);
    let sizeOk = false;
    if (dataExists && meta) {
      try { sizeOk = meta.gzipBytes === fs.statSync(dataPath).size; } catch (_) { sizeOk = false; }
    }
    if (!dataExists || !meta || !sizeOk) {
      if (dataExists || meta) {
        this._log('info', `${platform}: 缓存失配（data=${dataExists}, meta=${!!meta}, sizeOk=${sizeOk}）→ 删除全量重拉`);
        this._dropCache(dataPath, metaPath);
      }
      return this._miss({ dataPath, metaPath, ...d });
    }
    if (forceRefresh) {
      this._dropCache(dataPath, metaPath);
      return this._miss({ dataPath, metaPath, ...d });
    }

    // ② 新鲜度探针（锚定式，2026-10-08）：锚 = meta.maxId，只查 id > 锚 增量区间的
    //    chunk×platform max(id)。失败 → bypass 直拉（不读写缓存，数据正确性优先不掩盖问题）
    let probeMax;
    try {
      probeMax = await probeMaxId(meta.maxId);
    } catch (e) {
      this._log('warn', `${platform}: 锚定探针失败(${e.message}) → 绕过缓存直拉（缓存原状）`);
      const rows = await fetchRows(0);
      return { rows, source: 'bypass' };
    }

    if (probeMax == null) {
      if (meta.maxId === 0 && meta.rows === 0) {
        // DB 该 token 集×platform 无任何行，缓存同为空集形态 → FRESH 空读零拉取
        // （空集锚=0 探针退无锚形状，null 即 DB 无行——旧语义不变）
        return { rows: [], source: 'fresh' };
      }
      // 增量区间无行。锚行 PK 核验区分 FRESH 与 清表/删行回缩——gt 锚形状下增量
      // 区间取 max 结构性拿不到「DB max < 锚」，旧行 probeMax < meta.maxId 回缩分支
      // 不可达，检测责任移交此处锚行核验；核验失败（查询异常）与探针失败同 bypass
      let alive;
      try {
        alive = await anchorExists(meta.maxId);
      } catch (e) {
        this._log('warn', `${platform}: 锚行核验失败(${e.message}) → 绕过缓存直拉（缓存原状）`);
        const rows = await fetchRows(0);
        return { rows, source: 'bypass' };
      }
      if (!alive) {
        this._log('info', `${platform}: 锚行 id=${meta.maxId} 不存在（表空/回缩/删行）→ 删除缓存全量重拉`);
        this._dropCache(dataPath, metaPath);
        return this._miss({ dataPath, metaPath, ...d });
      }
      // FRESH：纯读文件。损坏 → drop + 本次继续 MISS 重拉（不中断回测）
      try {
        const t0 = Date.now();
        const rows = await this._readAllRows(dataPath);
        this._log('info', `${platform}: fresh → ${rows.length} 行 / maxId=${meta.maxId} / ${((Date.now() - t0) / 1000).toFixed(1)}s（零 DB 拉取）`);
        return { rows, source: 'fresh' };
      } catch (e) {
        this._log('info', `${platform}: 缓存读损坏(${e.message}) → 删除缓存，本次全量重拉`);
        this._dropCache(dataPath, metaPath);
        return this._miss({ dataPath, metaPath, ...d });
      }
    }

    // probeMax > meta.maxId（gt 锚形状下不可能 ≤ 锚）：STALE 增量补拉 → 合并重写
    return this._stale({ dataPath, metaPath, meta, probeMax, ...d });
  }

  /** MISS：全量拉取 → 排序落盘。fetchRows/写失败 → 清 tmp + rethrow（缓存保持无文件态）。 */
  async _miss({ dataPath, metaPath, platform, addresses, fetchRows, columnsTag }) {
    const t0 = Date.now();
    const rows = await fetchRows(0);
    const { rows: n, maxId } = await this._writeSorted(dataPath, metaPath, rows, {
      addresses, columnsTag,
    });
    this._log('info', `${platform}: miss → 全量拉取 ${n} 行 / maxId=${maxId} / ${((Date.now() - t0) / 1000).toFixed(1)}s → 缓存落盘`);
    return { rows, source: 'miss' };
  }

  /**
   * STALE：读旧文件全部行 + fetchRows(meta.maxId) 增量合并 → 排序重写。
   * 旧文件读失败（损坏）→ drop + MISS 重拉；增量拉取/写失败 → 清 tmp + rethrow
   * （原文件未动，下次再增量）。
   */
  async _stale({ dataPath, metaPath, platform, addresses, fetchRows, columnsTag, meta, probeMax }) {
    const t0 = Date.now();
    let oldRows;
    try {
      oldRows = await this._readAllRows(dataPath);
    } catch (e) {
      this._log('info', `${platform}: STALE 旧缓存读损坏(${e.message}) → 删除缓存全量重拉`);
      this._dropCache(dataPath, metaPath);
      return this._miss({ dataPath, metaPath, platform, addresses, fetchRows, columnsTag });
    }
    const oldCount = oldRows.length; // push 前快照：rows 是 oldRows 同一引用，push 后 length=合并总数（2026-10-03 R0 双实例事故排查中被此显示误导）
    const incRows = await fetchRows(meta.maxId);
    // for 循环 push 合并（禁 spread：28 万行展开爆栈教训）
    const rows = oldRows;
    for (const r of incRows) rows.push(r);
    const { rows: n, maxId } = await this._writeSorted(dataPath, metaPath, rows, {
      addresses, columnsTag,
    });
    this._log('info', `${platform}: stale → cacheMax=${meta.maxId} → probe=${probeMax} | 旧行 ${oldCount} + 增量 ${incRows.length} = ${n} 行 / maxId=${maxId} / ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return { rows, source: 'stale' };
  }

  // ── 流式读写原语（平移自 GlobalTickCache）──

  /** 全部行读进数组（回测本就全量物化 raw，内存画像与直拉一致）。 */
  async _readAllRows(dataPath) {
    const rows = [];
    await this._streamRead(dataPath, (row) => rows.push(row));
    return rows;
  }

  /**
   * 流式读 gzip jsonl，逐行回调 onRow(row)。
   * ★readline 坑防护：input 流（gunzip）error 时 async iterator 可能不 reject 而是
   *   静默正常结束（截断当成功）——显式监听 source/gunzip error，close rl 并循环尾检查抛出。
   */
  async _streamRead(file, onRow) {
    const source = fs.createReadStream(file);
    const gun = zlib.createGunzip();
    source.pipe(gun);
    const rl = readline.createInterface({ input: gun, crlfDelay: Infinity });
    let streamErr = null;
    source.on('error', (e) => { if (!streamErr) streamErr = e; rl.close(); });
    gun.on('error', (e) => { if (!streamErr) streamErr = e; rl.close(); });
    for await (const line of rl) {
      if (streamErr) throw streamErr;
      if (!line) continue;
      onRow(JSON.parse(line));
    }
    if (streamErr) throw streamErr;
  }

  /**
   * 排序 + 流式落盘：全局 id 升序是文件不变量的执行点（不依赖调用方有序——STALE 合并的
   * 增量块间本就无序）；行间 4MB 背压 drain；先 rename 数据文件、后写 meta（保住
   * gzipBytes crash 检测语义）。返回 { rows, maxId }。
   */
  async _writeSorted(dataPath, metaPath, rows, { addresses, columnsTag }) {
    this._ensureDir(path.dirname(dataPath));
    const tmp = `${dataPath}.${process.pid}.tmp`;
    const { gz, finished, writeLine } = this._makeWriter(tmp);
    try {
      rows.sort((a, b) => a.id - b.id);
      let maxId = 0;
      for (const row of rows) {
        const id = this._validateRowId(row);
        if (id > maxId) maxId = id;
        writeLine(row);
        await this._drainIfNeeded(gz);
      }
      const size = await this._finishWriter(gz, finished, tmp, dataPath);
      this._writeMetaAtomic(metaPath, {
        version: CACHE_VERSION,
        maxId,
        rows: rows.length,
        gzipBytes: size,
        savedAt: new Date().toISOString(),
        tokenCount: Array.isArray(addresses) ? addresses.length : null,
        columnsTag: columnsTag || null,
      });
      return { rows: rows.length, maxId };
    } catch (e) {
      this._abortWriter(gz, tmp);
      throw e;
    }
  }

  /** 行 id 校验：非有限数或超安全整数 → throw（fail-loud 防 bigint 静默丢精度）。 */
  _validateRowId(row) {
    const id = Number(row && row.id);
    if (!Number.isFinite(id)) {
      throw new Error(`tick 行 id 非数值（row=${JSON.stringify(row).slice(0, 120)}）`);
    }
    if (id > Number.MAX_SAFE_INTEGER) {
      throw new Error(`tick 行 id=${row.id} 超 Number.MAX_SAFE_INTEGER，JSON 往返丢精度，拒绝入缓存`);
    }
    return id;
  }

  /** 建 gzip 写装置（tmp 文件）。 */
  _makeWriter(tmpPath) {
    const out = fs.createWriteStream(tmpPath);
    const gz = zlib.createGzip();
    gz.pipe(out);
    const finished = new Promise((resolve, reject) => {
      out.on('finish', resolve);
      out.on('error', reject);
      gz.on('error', reject);
    });
    const writeLine = (row) => {
      const line = JSON.stringify(row);
      gz.write(line.endsWith('\n') ? line : line + '\n');
    };
    return { gz, finished, writeLine };
  }

  /** 背压：gzip 缓冲积压超 4MB 时等 drain（边拉边写场景防 write queue 无界膨胀）。 */
  async _drainIfNeeded(gz) {
    if (gz.writableLength > DRAIN_THRESHOLD_BYTES) await once(gz, 'drain');
  }

  /** 收尾：flush gzip → 等落盘 → rename → 返回最终文件 size。 */
  async _finishWriter(gz, finished, tmpPath, finalPath) {
    gz.end();
    await finished;
    const size = fs.statSync(tmpPath).size;
    fs.renameSync(tmpPath, finalPath);
    return size;
  }

  /** 中止：销毁流 + 清 tmp（不留半成品）。 */
  _abortWriter(gz, tmpPath) {
    try { gz.destroy(); } catch (_) { /* ignore */ }
    try { fs.rmSync(tmpPath, { force: true }); } catch (_) { /* ignore */ }
  }

  // ── 运维 ──

  has(sourceExperimentId, platform) {
    return fs.existsSync(this._dataPath(sourceExperimentId, platform));
  }

  /** 删除指定缓存；platform 缺省删整个源实验目录。 */
  clear(sourceExperimentId, platform) {
    if (platform) {
      this._dropCache(this._dataPath(sourceExperimentId, platform),
        this._metaPath(sourceExperimentId, platform));
      return;
    }
    try { fs.rmSync(this._dirFor(sourceExperimentId), { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }

  _log(level, msg) {
    this._logger[level](this._experimentId, 'BacktestTickCache', msg);
  }
}

module.exports = { BacktestTickCache, BACKTEST_TICK_CACHE_VERSION: CACHE_VERSION };
