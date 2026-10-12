/**
 * 叙事分析数据库操作
 */

import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';

// 获取当前模块的目录（ESM 中没有 __dirname）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量（使用相对于当前模块的路径）
dotenv.config({ path: resolve(__dirname, '../../../config/.env') });

// 创建supabase客户端
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL 和 SUPABASE_ANON_KEY 环境变量必须设置');
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * 新 schema 的阶段字段定义
 * 每个阶段包含 result(JSONB) + prompt(text) + raw_output(text)
 */
const STAGE_FIELDS = [
  'prestage',
  'stage1',
  'stage2',
  'stage3',
];

// 仅 result 的阶段（无 prompt/raw_output）
const RESULT_ONLY_FIELDS = [
  'pre_check',
  'stage_final',
];

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
   */
  static async save(result) {
    const tokenAddress = result.token_address.toLowerCase();

    // 检查是否已存在记录
    const { data: existing, error: existError } = await supabase
      .from('token_narrative')
      .select('*')
      .eq('token_address', tokenAddress)
      .maybeSingle();

    if (existError) {
      console.error('[NarrativeRepository] save 查询已有记录失败:', JSON.stringify(existError));
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
    };

    // === 代币分类（2026-09-27 裁定）===：有分类判定才写键——null/undefined（precheck
    // fail 未分类）不带键保留旧值（重析 fail 不清掉已落库的分类；新分类自然覆盖）。
    // 列由 scripts/sql/add-token-narrative-token-category.sql 先行创建（部署顺序红线）
    if (result.token_category) {
      record.token_category = result.token_category;
    }

    // === 仅 result 的阶段（无 prompt/raw_output）===
    for (const stage of RESULT_ONLY_FIELDS) {
      const fieldName = stage === 'pre_check' ? 'pre_check_result' : `${stage}_result`;
      const hasField = Object.prototype.hasOwnProperty.call(result, fieldName);
      if (hasField) {
        record[fieldName] = this._mergeField(result[fieldName], existing?.[fieldName], true);
      } else if (existing) {
        record[fieldName] = existing[fieldName] ?? null;
      }
    }

    // === LLM 阶段（result + prompt + raw_output）===
    for (const stage of STAGE_FIELDS) {
      const resultField = `${stage}_result`;
      const promptField = `${stage}_prompt`;
      const rawOutputField = `${stage}_raw_output`;

      const stageResult = result[resultField];
      const isClear = stageResult && typeof stageResult === 'object' && stageResult.__clear === true;

      if (isClear) {
        // 清除标记：三个字段全部置 null
        record[resultField] = null;
        record[promptField] = null;
        record[rawOutputField] = null;
      } else {
        record[resultField] = this._mergeField(result[resultField], existing?.[resultField]);
        record[promptField] = this._mergeField(result[promptField], existing?.[promptField]);
        record[rawOutputField] = this._mergeField(result[rawOutputField], existing?.[rawOutputField]);
      }
    }

    // 使用 upsert (insert or update)
    const { data, error } = await supabase
      .from('token_narrative')
      .upsert(record, {
        onConflict: 'token_address'
      })
      .select()
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
   * 仅回写 GMGN 风险字段（x-0 案）：缓存命中但行内无 gmgn_info 的直调补调路径——
   * 不重析 Jev，只补数据（与 no_public_info 穿透重析同构但更轻）
   */
  static async updateGmgnInfo(address, info) {
    const { data, error } = await supabase
      .from('token_narrative')
      .update({ gmgn_info: info })
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
