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
      experiment_id: result.experiment_id || null,
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
    };

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
