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
 * 状态机（探针 = 锚定 + 无序存在性形状，2026-10-08 计划翻转事故两轮改造：
 * `id > meta.maxId` 锚 + 无 ORDER BY 的 LIMIT 1——chunk×platform 判增量区间有无行。
 * 旧无锚 `ORDER BY id DESC LIMIT 1` 表涨后 planner 稳定 id 反向扫描扫无关行 8s 超时；
 * 锚定 DESC 只救活 token 集仍活跃的平台，死集（锚=集内最后行 id）区间全为无关行
 * 照样超时；无序 LIMIT 1 无 top-k 排序可贪，稳定走 (token,platform,id) 索引 probe，
 * 与区间长度无关——死集旧锚最坏情形实测 242 批 0 错、最慢 132ms）：
 *   MISS   data/meta 缺、gzipBytes 与实际 size 失配（上次写 crash 在 rename 与 meta 之间）、
 *          columnsTag 漂移 → fetchRows(0) 全量拉 → 落盘（不经探针）
 *   FRESH  锚定探针 null（增量区间无行）且锚行 PK 核验存在 → 纯读文件零拉取
 *          （空集形态 {0,0} 锚=0 探针退无锚形状，null = DB 无行，同样 FRESH 空数组）
 *   STALE  锚定探针返回行 id（增量区间有行；观测值仅日志用，真 max 由增量拉取后
 *          重算）→ 读旧文件 + fetchRows(meta.maxId) 增量补拉 → 小增量走 delta 侧车
 *          追加（P15：base 不重压缩，见下「delta 侧车」）
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
 * delta 侧车（P15，2026-10-13）：STALE 增量不再触发 base 全量重压缩（perf15 装载画像：
 * flap 旧行 128.7 万 + 增量 7 行 → 读+解压+重压缩+写回 ~72s 静默纯 CPU = ticks 慢臂主导）。
 * `<platform>.delta.jsonl` 明文小文件重写（tmp+rename 原子）；meta 真源记 baseMaxId/
 * baseRows/deltaRows/deltaBytes（v1 旧 meta 缺键 → 读侧缺省「无 delta」= 旧行为，不强制
 * 重建缓存）。不变量：delta 行 id 全部 > baseMaxId（fetchRows(afterId=meta.maxId) 起点
 * 保证），base(升序)++delta(升序) = 全局 id 升序，与旧「重写排序」返回口径一致。
 * crash 窗口：rename 后 meta 写前中断 → delta 实际行数 > meta.deltaRows → 读侧只读前
 * meta.deltaRows 行（_streamRead maxRows 读满即停，撕裂尾不解析），下次 STALE 重拉增量
 * 幂等自愈；delta 行数 < meta.deltaRows（外部删改）→ 判损坏 drop + MISS。deltaRows ≥
 * deltaCompactionRows（默认 30 万）→ 一次性全量合并重压缩摊销。
 *
 * 投机读（P15）：一致性校验通过后、探针发出前即启 _readBaseAndDelta（FRESH/STALE 两分支
 * 都需要全量行；MISS/bypass/回缩丢弃——MISS 本身分钟级网络拉取，读重叠成本可忽略）。探针
 * ~40s chunk 存在性 RTT 与 gunzip+parse ~25s 并行，STALE 慢臂 = max(探针, 读) + 增量。
 * 读失败仍在 FRESH/STALE 的 await 点按原语义处理（不提前暴露）；创建即附 catch sink 防
 * MISS/bypass/回缩分支不 await 时的 unhandled rejection（P10 早发并发同款防线）。
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
const DELTA_COMPACTION_ROWS = 300000; // delta 侧车行数阈值：≥ 则全量合并重压缩（182 量级 base flap 128 万行，~25% 摊销点）

class BacktestTickCache {
  /**
   * @param {Object} [opts]
   * @param {Object} [opts.logger]        引擎 Logger（info/warn/error 三参形态
   *                                      (experimentId, tag, msg)）；缺省 console
   * @param {string} [opts.experimentId]  日志归属实验（回测实验 id，非源实验）
   * @param {string} [opts.cacheDir]      覆盖缓存根目录（单测注入 tmp 用；默认
   *                                      cwd/data/tick-cache/backtest）
   * @param {number} [opts.deltaCompactionRows] delta 侧车压缩阈值（单测注入小值
   *                                      强制走压缩路径；默认 DELTA_COMPACTION_ROWS）
   */
  constructor(opts = {}) {
    this._logger = opts.logger || {
      info: (_exp, tag, msg) => console.log(`[${tag}] ${msg}`),
      warn: (_exp, tag, msg) => console.warn(`[${tag}] ${msg}`),
      error: (_exp, tag, msg) => console.error(`[${tag}] ${msg}`),
    };
    this._experimentId = opts.experimentId || null;
    this._cacheDir = opts.cacheDir || DEFAULT_CACHE_DIR;
    this._deltaCompactionRows = opts.deltaCompactionRows || DELTA_COMPACTION_ROWS;
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
  _deltaPath(sourceExperimentId, platform) {
    return path.join(this._dirFor(sourceExperimentId), `${platform}.delta.jsonl`);
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // ── meta sidecar ──

  /**
   * 读并校验 meta：version 匹配、maxId/rows 有限数、columnsTag 与本次一致；
   * 任何不合格（含文件缺失/JSON 损坏）返回 null（调用方按失配分支处理）。
   * P15 delta 字段（baseMaxId/baseRows/deltaRows）：v1 旧 meta 缺键 → 缺省
   * 「无 delta」（= 旧版行为，存量缓存不强制重建）；存在但非法（负/NaN/总数
   * 不自洽）→ 判损坏 null（drop + MISS fail-loud）。
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
    const hasDeltaFields = m.baseMaxId != null || m.baseRows != null || m.deltaRows != null;
    if (hasDeltaFields) {
      const nonNeg = (v) => Number.isFinite(v) && v >= 0;
      if (!nonNeg(m.baseMaxId) || !nonNeg(m.baseRows) || !nonNeg(m.deltaRows)) return null;
      if (m.baseRows + m.deltaRows !== m.rows) return null; // 总数自洽（写路径不变量）
    }
    m.baseMaxId = m.baseMaxId != null ? m.baseMaxId : m.maxId;
    m.baseRows = m.baseRows != null ? m.baseRows : m.rows;
    m.deltaRows = m.deltaRows != null ? m.deltaRows : 0;
    return m;
  }

  _writeMetaAtomic(metaPath, m) {
    const tmp = `${metaPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(m));
    fs.renameSync(tmp, metaPath);
  }

  _dropCache(dataPath, metaPath, deltaPath) {
    try { fs.rmSync(dataPath, { force: true }); } catch (_) { /* ignore */ }
    try { fs.rmSync(metaPath, { force: true }); } catch (_) { /* ignore */ }
    if (deltaPath) { try { fs.rmSync(deltaPath, { force: true }); } catch (_) { /* ignore */ } }
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
   *                                 （锚定无序形状：id > anchor 区间内 chunk×platform
   *                                 任意一行 id（非 null 即有增量；观测值仅日志用）；
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
    const deltaPath = this._deltaPath(sourceExperimentId, platform);

    // ① 一致性校验：data/meta 同在且 gzipBytes 匹配（crash 窗口）+ columnsTag 匹配；
    //    meta 声明有 delta 行但 delta 文件缺失（外部删改）同判失配
    const meta = this._readMeta(metaPath, d.columnsTag);
    const dataExists = fs.existsSync(dataPath);
    let sizeOk = false;
    if (dataExists && meta) {
      try { sizeOk = meta.gzipBytes === fs.statSync(dataPath).size; } catch (_) { sizeOk = false; }
    }
    const deltaOk = !(meta && meta.deltaRows > 0) || fs.existsSync(deltaPath);
    if (!dataExists || !meta || !sizeOk || !deltaOk) {
      if (dataExists || meta) {
        this._log('info', `${platform}: 缓存失配（data=${dataExists}, meta=${!!meta}, sizeOk=${sizeOk}, deltaOk=${deltaOk}）→ 删除全量重拉`);
        this._dropCache(dataPath, metaPath, deltaPath);
      }
      return this._miss({ dataPath, metaPath, deltaPath, ...d });
    }
    if (forceRefresh) {
      this._dropCache(dataPath, metaPath, deltaPath);
      return this._miss({ dataPath, metaPath, deltaPath, ...d });
    }

    // ①.5 投机读（P15）：FRESH/STALE 都需要 base+delta 全量行，与探针并行发起；
    //     MISS/bypass/回缩分支不 await → 创建即附 catch sink 防 unhandled rejection
    const baseRead = this._readBaseAndDelta(dataPath, deltaPath, meta.deltaRows);
    baseRead.catch(() => {});

    // ② 新鲜度探针（锚定无序形状，2026-10-08）：锚 = meta.maxId，判 id > 锚 增量
    //    区间有无行。失败 → bypass 直拉（不读写缓存，数据正确性优先不掩盖问题）
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
        this._dropCache(dataPath, metaPath, deltaPath);
        return this._miss({ dataPath, metaPath, deltaPath, ...d });
      }
      // FRESH：纯读文件（base+delta）。损坏 → drop + 本次继续 MISS 重拉（不中断回测）
      try {
        const t0 = Date.now();
        const { base, delta } = await baseRead;
        const rows = base;
        for (const r of delta) rows.push(r);   // 禁 spread（大数组）
        this._log('info', `${platform}: fresh → ${rows.length} 行 / maxId=${meta.maxId} / ${((Date.now() - t0) / 1000).toFixed(1)}s（零 DB 拉取${meta.deltaRows ? `，含 delta ${meta.deltaRows} 行` : ''}）`);
        return { rows, source: 'fresh' };
      } catch (e) {
        this._log('info', `${platform}: 缓存读损坏(${e.message}) → 删除缓存，本次全量重拉`);
        this._dropCache(dataPath, metaPath, deltaPath);
        return this._miss({ dataPath, metaPath, deltaPath, ...d });
      }
    }

    // 探针命中（gt 锚保证返回 id > 锚）：STALE 增量补拉 → delta 侧车追加（或阈值压缩）
    return this._stale({ dataPath, metaPath, deltaPath, meta, probeMax, baseRead, ...d });
  }

  /** MISS：全量拉取 → 排序落盘（meta delta 字段归零 + 清除残留 delta）。fetchRows/写失败
   *  → 清 tmp + rethrow（缓存保持无文件态）。 */
  async _miss({ dataPath, metaPath, deltaPath, platform, addresses, fetchRows, columnsTag }) {
    const t0 = Date.now();
    const rows = await fetchRows(0);
    const { rows: n, maxId } = await this._writeSorted(dataPath, metaPath, rows, {
      addresses, columnsTag, deltaPath,
    });
    this._log('info', `${platform}: miss → 全量拉取 ${n} 行 / maxId=${maxId} / ${((Date.now() - t0) / 1000).toFixed(1)}s → 缓存落盘`);
    return { rows, source: 'miss' };
  }

  /**
   * STALE：base+delta 投机读 + fetchRows(meta.maxId) 增量 → delta 侧车追加（P15：
   * base 不重压缩；delta 行数 ≥ 阈值 → 全量合并重压缩摊销）。
   * 旧文件读失败（损坏）→ drop + MISS 重拉；增量拉取/写失败 → 清 tmp + rethrow
   * （原文件未动，下次再增量）。
   */
  async _stale({ dataPath, metaPath, deltaPath, platform, addresses, fetchRows, columnsTag, meta, probeMax, baseRead }) {
    const t0 = Date.now();
    let base, delta;
    try {
      ({ base, delta } = await baseRead);
    } catch (e) {
      this._log('info', `${platform}: STALE 旧缓存读损坏(${e.message}) → 删除缓存全量重拉`);
      this._dropCache(dataPath, metaPath, deltaPath);
      return this._miss({ dataPath, metaPath, deltaPath, platform, addresses, fetchRows, columnsTag });
    }
    const oldCount = base.length + delta.length; // push 前快照：合并总数（2026-10-03 R0 双实例事故排查中被此显示误导）
    const incRows = await fetchRows(meta.maxId);
    // delta 批 = 旧 delta + 增量（增量跨 chunk 无序 → 批内全局 id 排序；不变量：
    // 全部 id > baseMaxId，base(升序)++deltaBatch(升序) = 全局升序 = 旧重写口径）
    const deltaBatch = delta;
    for (const r of incRows) deltaBatch.push(r);
    deltaBatch.sort((a, b) => a.id - b.id);

    if (deltaBatch.length >= this._deltaCompactionRows) {
      // 压缩：base+delta 全量合并重写（_writeSorted 内清 delta + meta 归零）
      const rows = base;
      for (const r of deltaBatch) rows.push(r);
      const { rows: n, maxId } = await this._writeSorted(dataPath, metaPath, rows, {
        addresses, columnsTag, deltaPath,
      });
      this._log('info', `${platform}: stale→compact（delta ${deltaBatch.length} 行 ≥ 阈值 ${this._deltaCompactionRows}）| cacheMax=${meta.maxId} → probeObserved=${probeMax} | 旧行 ${oldCount} + 增量 ${incRows.length} = ${n} 行 / maxId=${maxId} / ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return { rows, source: 'stale' };
    }

    // 侧车追加：小文件全量重写（tmp+rename 原子；读侧按 meta.deltaRows 截尾，撕裂
    // 尾不进入）。行 id 校验与 _writeSorted 同款 fail-loud。
    let maxId = meta.maxId;
    const parts = new Array(deltaBatch.length);
    for (let i = 0; i < deltaBatch.length; i++) {
      const id = this._validateRowId(deltaBatch[i]);
      if (id > maxId) maxId = id;
      parts[i] = JSON.stringify(deltaBatch[i]);
    }
    const deltaBytes = this._writeDeltaAtomic(deltaPath, parts);
    this._writeMetaAtomic(metaPath, {
      version: CACHE_VERSION,
      maxId,
      rows: base.length + deltaBatch.length,
      gzipBytes: meta.gzipBytes,          // base 未动
      savedAt: new Date().toISOString(),
      tokenCount: Array.isArray(addresses) ? addresses.length : null,
      columnsTag: columnsTag || null,
      baseMaxId: meta.baseMaxId,
      baseRows: meta.baseRows,
      deltaRows: deltaBatch.length,
      deltaBytes,
    });
    this._log('info', `${platform}: stale → cacheMax=${meta.maxId} → probeObserved=${probeMax} | 旧行 ${oldCount} + 增量 ${incRows.length} = ${base.length + deltaBatch.length} 行 / maxId=${maxId} / ${((Date.now() - t0) / 1000).toFixed(1)}s（增量走 delta 侧车 ${deltaBatch.length} 行，base 未重压缩）`);
    const rows = base;
    for (const r of deltaBatch) rows.push(r);
    return { rows, source: 'stale' };
  }

  // ── 流式读写原语（平移自 GlobalTickCache）──

  /** 全部行读进数组（回测本就全量物化 raw，内存画像与直拉一致）。 */
  async _readAllRows(file) {
    const rows = [];
    await this._streamRead(file, (row) => rows.push(row));
    return rows;
  }

  /**
   * base + delta 侧车合并读（P15）。delta 只读前 meta.deltaRows 行：crash 窗口下
   * rename 后 meta 写前中断会留下多余/撕裂尾行，meta 是行数真源（读满即停不解析）；
   * 实际行数 < meta.deltaRows（外部删改）→ throw（调用方按损坏处理 drop + MISS）。
   */
  async _readBaseAndDelta(dataPath, deltaPath, deltaRows) {
    const base = await this._readAllRows(dataPath);
    const delta = [];
    if (deltaRows > 0) {
      const n = await this._streamRead(deltaPath, (row) => delta.push(row), deltaRows, { plain: true });
      if (n < deltaRows) {
        throw new Error(`delta 行数不足（实际 ${n} < meta ${deltaRows}）`);
      }
    }
    return { base, delta };
  }

  /**
   * 流式读 gzip jsonl（opts.plain=true 读明文 jsonl——delta 侧车），逐行回调
   * onRow(row)；maxRows 给定则读满即停（delta 截尾用，未到达的尾行不解析）。
   * ★readline 坑防护：input 流（gunzip）error 时 async iterator 可能不 reject 而是
   *   静默正常结束（截断当成功）——显式监听 source/gunzip error，close rl 并循环尾检查抛出。
   */
  async _streamRead(file, onRow, maxRows, opts) {
    const plain = !!(opts && opts.plain);
    const source = fs.createReadStream(file);
    const gun = plain ? null : zlib.createGunzip();
    if (gun) source.pipe(gun);
    const rl = readline.createInterface({ input: gun || source, crlfDelay: Infinity });
    let streamErr = null;
    source.on('error', (e) => { if (!streamErr) streamErr = e; rl.close(); });
    if (gun) gun.on('error', (e) => { if (!streamErr) streamErr = e; rl.close(); });
    let n = 0;
    for await (const line of rl) {
      if (streamErr) throw streamErr;
      if (!line) continue;
      onRow(JSON.parse(line));
      n += 1;
      if (maxRows != null && n >= maxRows) {
        rl.close();          // 读满即停：后续尾行（撕裂/多余）不进入解析
        source.destroy();
        if (gun) gun.destroy();
        return n;
      }
    }
    if (streamErr) throw streamErr;
    return n;
  }

  /**
   * 排序 + 流式落盘（base 全量重压缩路径：MISS / forceRefresh / delta 压缩）：全局
   * id 升序是文件不变量的执行点（不依赖调用方有序——STALE 合并的增量块间本就无序）；
   * 行间 4MB 背压 drain；先 rename 数据文件、后写 meta（保住 gzipBytes crash 检测
   * 语义）；meta delta 字段归零 + 清除残留 delta 文件。返回 { rows, maxId }。
   */
  async _writeSorted(dataPath, metaPath, rows, { addresses, columnsTag, deltaPath }) {
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
        baseMaxId: maxId,
        baseRows: rows.length,
        deltaRows: 0,
      });
      if (deltaPath) { try { fs.rmSync(deltaPath, { force: true }); } catch (_) { /* ignore */ } }
      return { rows: rows.length, maxId };
    } catch (e) {
      this._abortWriter(gz, tmp);
      throw e;
    }
  }

  /**
   * delta 侧车整文件原子重写（明文 jsonl；行已在调用方排序+校验）。tmp 带 pid 后缀
   * + rename（与 base 写路径同款原子性：中途 crash 留 tmp 垃圾、原 delta 未动，meta
   * 未写 → 下次按旧 deltaRows 读 + STALE 重拉增量幂等自愈）。失败清 tmp + rethrow。
   */
  _writeDeltaAtomic(deltaPath, parts) {
    this._ensureDir(path.dirname(deltaPath));
    const tmp = `${deltaPath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, parts.length ? parts.join('\n') + '\n' : '');
      fs.renameSync(tmp, deltaPath);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch (_) { /* ignore */ }
      throw e;
    }
    return fs.statSync(deltaPath).size;
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

  /** 删除指定缓存（含 delta 侧车）；platform 缺省删整个源实验目录。 */
  clear(sourceExperimentId, platform) {
    if (platform) {
      this._dropCache(this._dataPath(sourceExperimentId, platform),
        this._metaPath(sourceExperimentId, platform),
        this._deltaPath(sourceExperimentId, platform));
      return;
    }
    try { fs.rmSync(this._dirFor(sourceExperimentId), { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }

  _log(level, msg) {
    this._logger[level](this._experimentId, 'BacktestTickCache', msg);
  }
}

module.exports = { BacktestTickCache, BACKTEST_TICK_CACHE_VERSION: CACHE_VERSION };
