/**
 * 叙事分析数据库操作
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
import { dbManager } from '../../services/dbManager.js';
import { resolveFinalRating } from '../utils/rating-utils.mjs';

// 获取当前模块的目录（ESM 中没有 __dirname）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量（使用相对于当前模块的路径；先于下方 dbManager.getSupabase()
// 懒初始化读 env——dbManager 自身的 dotenv 按 CWD 解析不可依赖）
dotenv.config({ path: resolve(__dirname, '../../../config/.env') });

// supabase 客户端：统一走 dbManager（service key 优先 + 72s fetch 超时；2026-10-24
// 叙事 DB 适配批次切换——前身自建 createClient 且 ANON 优先，与「routes/远程脚本
// 一律 service key」红线同源的 anon 优先坑。ExternalResourceCache.mjs 同款
// ESM→CJS 互操作先例）
const supabase = dbManager.getSupabase();

/**
 * 递归清洗 JSON 载荷中的非法 Unicode（2026-10-21 C144，全量回归 C133 发现）：
 * 搜索兜底推文文本可能被截断在 emoji 代理对中间（如 `\ud83d` 单独结尾）——JSON.stringify
 * 会产出 lone surrogate escape，PostgREST 解析直接回 PGRST102「Empty or invalid json」，
 * 整条叙事行落库失败。NUL（\u0000）Postgres text/jsonb 同样不接受，一并替换为 U+FFFD。
 * 纯函数（不 mutate 入参），返回新对象；stats.replaced 供 save 日志观测。
 */
export function sanitizeJsonValue(value, stats = { replaced: 0 }) {
  if (typeof value === 'string') {
    let out = '';
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code === 0) {
        out += '�';
        stats.replaced++;
      } else if (code >= 0xD800 && code <= 0xDBFF) {
        const next = value.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          out += value[i] + value[i + 1];
          i++;
        } else {
          out += '�';
          stats.replaced++;
        }
      } else if (code >= 0xDC00 && code <= 0xDFFF) {
        out += '�';
        stats.replaced++;
      } else {
        out += value[i];
      }
    }
    return out === value ? value : out;
  }
  if (value === null || value === undefined) return value;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  // copy-on-write：子树无非法字符时返回原引用（save 快照 identity 语义不被破坏，
  // 只克隆含 lone surrogate/NUL 的路径；stats 仍精确计数）
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const nv = sanitizeJsonValue(v, stats);
      if (nv !== v) changed = true;
      return nv;
    });
    return changed ? out : value;
  }
  if (typeof value === 'object') {
    let changed = false;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const nv = sanitizeJsonValue(v, stats);
      if (nv !== v) changed = true;
      out[k] = nv;
    }
    return changed ? out : value;
  }
  return value;
}

/**
 * 阶段字段定义（2026-10-24 列名重构：旧三阶段 stage1/2/3 三件套 → 评估链语义名，
 * 见 migrations/rename_token_narrative_stage_columns.sql）
 *
 * STAGE_FIELDS：result + prompt + raw_output 成组的 LLM 阶段（__clear 联动清整组）
 * - prestage：独立 Jev 调用（3 题）三件套独立成组（prestage_result/_prompt/_raw_output）
 * - jev：标准调用完整 IO 单份真源（原 stage1_prompt/stage1_raw_output）。result 位
 *   挂 event（事件判定段，原 stage1_result）——event __clear 联动清 jev IO，
 *   对齐旧 stage1 三列全 null 语义
 *
 * STAGE_RESULT_ONLY_FIELDS：仅 result 列的信封段（原 stage2/stage3 的 result 位）。
 * 其旧 prompt/raw 三件套是同一 Jev IO 的冗余拷贝，新行停写（legacy_* 列只读历史）
 *
 * RESULT_ONLY_FIELDS：null 覆盖语义的仅 result 段（web 重析入口对 final 传裸 null
 * 清——刻意与上面 __clear 语义区分）
 */
const STAGE_FIELDS = [
  { resultPrefix: 'prestage', ioPrefix: 'prestage' },
  { resultPrefix: 'event', ioPrefix: 'jev' },
];

const STAGE_RESULT_ONLY_FIELDS = [
  'event_score',
  'relation',
];

const RESULT_ONLY_FIELDS = [
  'pre_check',
  'final',
];

// event_category 投影域白名单（对齐 add_token_narrative_projection_columns.sql CHECK）
const EVENT_CATEGORY_DOMAIN = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'W'];

// save 回读瘦列清单（3b，2026-10-13 叙事提速第二批）：upsert 后 .select() 原样拉回
// 肥行（jev_prompt/jev_raw_output 审计列最肥）。回读值唯一消费点 =
// formatResult(saveResult)（resolveFinalRating 阶段链 + reason/score 链 + token 段
// + metadata）与 saveResult.analyzed_at——列清单按消费点闭集锁定，肥列
// （jev_prompt/jev_raw_output/twitter_info/classified_urls/extracted_info/
// url_extraction_result/data_fetch_results/gmgn_info 等）一律不回读。
// 单测 _test_narrative_repo_save_thin 锁清单防漂移；新增消费列须同步此处。
const SAVE_RETURN_COLS = [
  'id',
  'token_address',
  'token_symbol',
  'raw_api_data',
  'analyzed_at',
  'is_valid',
  'prompt_version',
  'pre_check_result',
  'prestage_result',
  'event_result',
  'event_score_result',
  'relation_result',
  'final_result',
].join(',');

/**
 * 投影列派生（2026-10-24 叙事 DB 适配 B2）：从合并后完整信封态 record 派生 SQL
 * 可查投影（final_rating/block_reason/block_stage/分数四列/event_category +
 * analysis_path/jev_version/prestage_version 透传）。真相源=各信封 jsonb，本函数
 * 是唯一派生点（save 落库与回填脚本 backfill-projection-columns.mjs 共用）。
 * 纯函数不 mutate 入参；intermediate 轮（信封字段取 existing 合并值）重投影同值=幂等。
 *
 * - final_rating 复用 resolveFinalRating 六列顺序链（单一真相源不重新发明）
 * - precheck 终态（pass===false）→ 分数四列/event_category 强制 null（防旧 final
 *   残留分污染——「拦截+fin 残留并存」同款坑）
 * - event_category 仅非拦截票落：mapper 拦截票 category 被改写为掷骰值不可信
 *   （C184 快狗案）；真低分评级票（无 blockReason）照落
 * - block_stage：final.details.blockReason 非空→'mapper'；pre_check.pass===false
 *   →'precheck'（prestage 定档 low 是评级非拦截，不落）
 */
export function projectColumns(record) {
  const out = {
    final_rating: resolveFinalRating(record),
    block_reason: null,
    block_stage: null,
    analysis_path: record?.analysis_path ?? null,
    total_score: null,
    event_score: null,
    relevance_score: null,
    quality_score: null,
    event_category: null,
    jev_version: record?.jev_version ?? null,
    prestage_version: record?.prestage_version ?? null,
  };
  const fin = (record && record.final_result && record.final_result.__clear !== true)
    ? record.final_result : null;
  const details = fin?.details || null;
  if (fin) {
    if (typeof fin.score === 'number') out.total_score = fin.score;
    if (typeof details?.eventCompositeScore === 'number') out.event_score = details.eventCompositeScore;
    if (typeof details?.relevanceScore === 'number') out.relevance_score = details.relevanceScore;
    if (typeof details?.qualityScore === 'number') out.quality_score = details.qualityScore;
    if (details?.blockReason) {
      out.block_reason = details.blockReason;
      out.block_stage = 'mapper';
    }
  }
  const pcr = record?.pre_check_result;
  const precheckTerminal = !!pcr && pcr.__clear !== true && pcr.pass === false;
  if (precheckTerminal) {
    out.block_stage = 'precheck';
    out.block_reason = out.block_reason || pcr.reason || pcr.details?.ruleName || null;
    out.total_score = null;
    out.event_score = null;
    out.relevance_score = null;
    out.quality_score = null;
    out.event_category = null;
  }
  // event_category：仅非拦截票（block_stage 为 null）取事件判定段原判分类；
  // 域白名单对齐 DDL CHECK（域外值宁缺勿炸 upsert）
  if (!out.block_stage) {
    const ev = record?.event_result;
    const category = (ev && ev.__clear !== true)
      ? (ev.parsed_output?.eventClassification?.primaryCategory ?? ev.category) : null;
    if (EVENT_CATEGORY_DOMAIN.includes(category)) {
      out.event_category = category;
    }
  }
  return out;
}

export class NarrativeRepository {

  /**
   * 辅助函数：智能合并字段值
   * - {__clear: true} → 返回 null（显式清除）
   * - undefined → 保留旧值
   * - null 且不允许覆盖 → 保留旧值
   * - 其他 → 使用新值
   */
  static _mergeField(newValue, oldValue, allowNullOverride = false) {
    if (newValue && typeof newValue === 'object' && newValue.__clear === true) {
      return null;
    }
    if (newValue === undefined) {
      return oldValue ?? null;
    }
    if (newValue === null && !allowNullOverride && oldValue !== null) {
      return oldValue;
    }
    return newValue;
  }

  /**
   * 获取supabase客户端
   */
  static getSupabase() {
    return supabase;
  }

  /**
   * 根据代币地址查找分析结果（返回最新的一条）
   */
  static async findByAddress(address) {
    const { data, error } = await supabase
      .from('token_narrative')
      .select('*')
      .eq('token_address', address.toLowerCase())
      .order('analyzed_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /**
   * 预载轻列键集扫描（回测叙事预载专用；2026-10-12 statement timeout 修复）
   *
   * 前身 fetchAllRows 的 select * offset 分页在 ~23.5k 行时已不可用：35 列 jsonb
   * （stage*_prompt/raw_output 审计列最肥）单页 500 行载荷 3-4.5s，肥行页顶穿
   * PostgREST statement timeout（8s）——perf2 臂两连崩现场（窄列深页实测 67-378ms，
   * 证明慢在全列载荷非 offset 扫描）。改：id PK 键集分页（走索引无 Sort，
   * PositionAnalysisService._fetchAllRows 同款形状）+ 只拉过滤/胜负判定所需轻列，
   * is_valid 与 gmgn_info 非空两个纯列谓词 DB 层先过。
   *
   * gmgn_info 谓词用 SQL IS NOT NULL：jsonb 'null' 字面量行会通过 DB 过滤但 JS
   * `== null` 为真——前身会排除该行；该行进预载对决策零影响（analyze 命中分支
   * 对 falsy gmgn_info 照样补调 GMGN，只是多预载一行），刻意不为此拉全列复查。
   * no_public_info 是 jsonb 路径断言（pre_check_result 为 NULL 的行必须通过，
   * PostgREST .neq 会把 NULL 行排掉=语义破坏）留在调用方客户端判。
   *
   * 行序 id 升序（非 analyzed_at）：每地址最新过票行的胜负由 preloadCache 在
   * 内存判（analyzed_at null 视最早 + id 决胜平），与原升序覆盖口径等价。
   */
  static async fetchPreloadLightRows() {
    const rows = [];
    let lastId = null;
    const PAGE = 1000;
    while (true) {
      let q = this.getSupabase()
        .from('token_narrative')
        .select('id,token_address,analyzed_at,pre_check_result,classified_urls')
        .eq('is_valid', true)
        .not('gmgn_info', 'is', null)
        .order('id', { ascending: true })
        .limit(PAGE);
      if (lastId != null) q = q.gt('id', lastId);
      const { data, error } = await q;
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < PAGE) break;
      lastId = data[data.length - 1].id;
    }
    return rows;
  }

  /**
   * 按主键批量拉全列行（预载第二段）：ids 由轻列扫描的过票行决出（实际可预载
   * 行 ~3k，而非全表 ~23k）；批 50 防肥 jsonb 载荷单查超 statement timeout
   * （.in URL 8KB 上限同口径）。返回行序 = 请求 id 顺序无关（调用方按地址装 Map）。
   */
  static async fetchRowsByIds(ids) {
    const rows = [];
    const CHUNK = 50;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await this.getSupabase()
        .from('token_narrative')
        .select('*')
        .in('id', ids.slice(i, i + CHUNK));
      if (error) throw error;
      rows.push(...(data || []));
    }
    return rows;
  }

  /**
   * 保存或更新分析结果
   * @param {Object} [options]
   * @param {Object|null} [options.existing] 3b（2026-10-13 叙事提速第二批）：调用方
   *   已持有的旧行快照（analyze 入口 cacheLookup/rowCache 拿到）。非 null 时跳过
   *   save 内 pre-select（35 列肥行往返）。刻意只在非 null 时跳过——null（入口已
   *   查明无行）保留现查：空结果查询本就廉价，且并发窗口内新插入行的
   *   gmgn_info/未产阶段列不会被 null 假设清掉（x-0「重析不清掉已积累数据」语义
   *   保持）。快照与分析期间的并发写存在竞态（合并读旧值）——接受：该参数只在
   *   强制/穿透重析路径触发，同 token 双进程秒级并发写同一行属罕见。
   */
  static async save(result, { existing: existingHint, clearTokenCategory = false } = {}) {
    const tokenAddress = result.token_address.toLowerCase();

    // 检查是否已存在记录（3b：非 null 快照跳过该往返）
    let existing = existingHint || null;
    if (!existing) {
      const { data, error: existError } = await this.getSupabase()
        .from('token_narrative')
        .select('*')
        .eq('token_address', tokenAddress)
        .maybeSingle();

      if (existError) {
        console.error('[NarrativeRepository] save 查询已有记录失败:', JSON.stringify(existError));
      }
      existing = data || null;
    }

    // 构建记录对象
    const record = {
      // === 基础字段 ===
      token_address: tokenAddress,
      token_symbol: result.token_symbol,
      platform: result.platform || 'fourmeme',
      blockchain: result.blockchain || 'bsc',
      raw_api_data: result.raw_api_data,
      extracted_info: result.extracted_info,
      twitter_info: result.twitter_info,
      classified_urls: result.classified_urls || null,
      // experiment_id 不再写入：叙事结果为代币级全局缓存，不挂实验名下（历史行的遗留值保留不动）
      analyzed_at: result.analyzed_at || new Date().toISOString(),
      is_valid: this._mergeField(result.is_valid, existing?.is_valid),
      prompt_version: result.prompt_version || existing?.prompt_version || null,
      analysis_stage: (result.analysis_stage && typeof result.analysis_stage === 'object' && result.analysis_stage.__clear === true)
        ? null
        : (result.analysis_stage ?? existing?.analysis_stage ?? null),
      prompt_type: result.prompt_type ?? existing?.prompt_type ?? null,

      // === Debug 字段 ===
      url_extraction_result: result.url_extraction_result ?? existing?.url_extraction_result ?? null,
      data_fetch_results: result.data_fetch_results ?? existing?.data_fetch_results ?? null,

      // === GMGN 风险字段（x-0 案，2026-09-27）===：直调语境拿到才写；undefined
      // （非直调 / 本次未拿到）保旧行值——重析失败不清掉已积累的发币史/捆绑数据
      gmgn_info: result.gmgn_info ?? existing?.gmgn_info ?? null,

      // === 投影直传三键（B2 挂点 2：Analyzer final save 携带；intermediate 轮
      // undefined 保旧——重析路径键存在性即语义） ===
      analysis_path: result.analysis_path ?? existing?.analysis_path ?? null,
      jev_version: result.jev_version ?? existing?.jev_version ?? null,
      prestage_version: result.prestage_version ?? existing?.prestage_version ?? null,
    };

    // === 代币分类（2026-09-27 裁定；2026-10-21 C146 修订）===：有分类判定才写键；
    // 终态重析无分类（precheck fail/no_data）时由调用方显式传 clearTokenCategory——
    // 重跑数据必须反映本次判定，旧分类不得残留（C101 回归实证：precheck fail 行
    // 仍显示修复前 prestage 的 web3_native_ip_early）。中间 save 不传标记=保留旧值。
    // 列由 scripts/sql/add-token-narrative-token-category.sql 先行创建（部署顺序红线）
    if (result.token_category) {
      record.token_category = result.token_category;
    } else if (clearTokenCategory) {
      record.token_category = null;
    }

    // === 仅 result 的阶段（null 覆盖语义；pre_check / final 终局信封）===
    for (const stage of RESULT_ONLY_FIELDS) {
      const fieldName = stage === 'pre_check' ? 'pre_check_result' : `${stage}_result`;
      const hasField = Object.prototype.hasOwnProperty.call(result, fieldName);
      if (hasField) {
        record[fieldName] = this._mergeField(result[fieldName], existing?.[fieldName], true);
      } else if (existing) {
        record[fieldName] = existing[fieldName] ?? null;
      }
    }

    // === 评估链 event_score/relation 段（仅 result 列；__clear 或传值三态合并）===
    for (const stage of STAGE_RESULT_ONLY_FIELDS) {
      const resultField = `${stage}_result`;
      const stageResult = result[resultField];
      const isClear = stageResult && typeof stageResult === 'object' && stageResult.__clear === true;
      record[resultField] = isClear ? null : this._mergeField(stageResult, existing?.[resultField]);
    }

    // === LLM 阶段（result + prompt + raw_output 成组，__clear 联动清整组）===
    for (const { resultPrefix, ioPrefix } of STAGE_FIELDS) {
      const resultField = `${resultPrefix}_result`;
      const promptField = `${ioPrefix}_prompt`;
      const rawOutputField = `${ioPrefix}_raw_output`;

      const stageResult = result[resultField];
      const isClear = stageResult && typeof stageResult === 'object' && stageResult.__clear === true;

      if (isClear) {
        // 清除标记：整组置 null（event 段 clear 联动清 jev IO——对齐旧 stage1
        // 三列全 null 语义，precheck 终态重析清掉旧标准调用痕迹）
        record[resultField] = null;
        record[promptField] = null;
        record[rawOutputField] = null;
      } else {
        record[resultField] = this._mergeField(stageResult, existing?.[resultField]);
        record[promptField] = this._mergeField(result[promptField], existing?.[promptField]);
        record[rawOutputField] = this._mergeField(result[rawOutputField], existing?.[rawOutputField]);
      }
    }

    // === 投影列派生（B2 挂点 1）：从合并后完整信封态 record 派生 SQL 可查投影。
    // 须在所有信封合并完成之后、sanitize 之前调用；projectColumns 纯函数幂等
    // （intermediate 轮信封值取 existing 合并值→重投影同值）。
    Object.assign(record, projectColumns(record));

    // C144：落库前清洗 lone surrogate/NUL（PostgREST PGRST102 防线；观测命中数）
    const sanitizeStats = { replaced: 0 };
    const safeRecord = sanitizeJsonValue(record, sanitizeStats);
    if (sanitizeStats.replaced > 0) {
      console.warn(`[NarrativeRepository] save 清洗非法 Unicode ${sanitizeStats.replaced} 处 | token=${record.token_address}`);
    }

    // 使用 upsert (insert or update)；回读瘦列（3b，见文件头 SAVE_RETURN_COLS 注释）
    const { data, error } = await this.getSupabase()
      .from('token_narrative')
      .upsert(safeRecord, {
        onConflict: 'token_address'
      })
      .select(SAVE_RETURN_COLS)
      .single();

    if (error) {
      console.error('[NarrativeRepository] save upsert失败:', JSON.stringify(error));
      throw error;
    }
    return data;
  }

  /**
   * 仅更新 is_valid 字段（用于使缓存失效）
   */
  static async updateIsValid(address, isValid) {
    const { data, error } = await supabase
      .from('token_narrative')
      .update({ is_valid: isValid })
      .eq('token_address', address.toLowerCase())
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * 获取所有分析结果
   */
  static async findAll(options = {}) {
    const { limit = 100, offset = 0 } = options;

    const { data, error } = await supabase
      .from('token_narrative')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return data;
  }
}
