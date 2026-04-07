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

export class NarrativeRepository {

  /**
   * 辅助函数：智能合并字段值
   * - 如果新值显式传递（存在于result对象中），使用新值
   * - 如果新值是null但旧值存在，保留旧值（避免覆盖有效数据）
   * - 只有在新值是非null值时，才会覆盖旧值
   * - 如果新值是清除标记对象（{__clear: true}），返回 null
   * @param {*} newValue - 新值
   * @param {*} oldValue - 旧值
   * @param {boolean} allowNullOverride - 是否允许null覆盖旧值（默认false）
   * @returns {*} 合并后的值
   */
  static _mergeField(newValue, oldValue, allowNullOverride = false) {
    // 检查是否是清除标记
    if (newValue && typeof newValue === 'object' && newValue.__clear === true) {
      return null; // 显式清除，返回 null
    }
    // 如果新值未定义，使用旧值
    if (newValue === undefined) {
      return oldValue ?? null;
    }
    // 如果新值是null且不允许覆盖，使用旧值
    if (newValue === null && !allowNullOverride && oldValue !== null) {
      return oldValue;
    }
    // 否则使用新值
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
   * @param {string} address - 代币地址
   */
  static async findByAddress(address) {
    const supabase = this.getSupabase();
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
    const supabase = this.getSupabase();
    const tokenAddress = result.token_address.toLowerCase();

    // 检查是否已存在记录
    const { data: existing } = await supabase
      .from('token_narrative')
      .select('*')
      .eq('token_address', tokenAddress)
      .maybeSingle();

    // 检查清除标记，如果存在则需要清除旧数据
    const hasStage1ClearFlag = result.llm_stage1_parsed_output?.__clear === true;
    const hasStage2ClearFlag = result.llm_stage2_parsed_output?.__clear === true;
    const hasStage3ClearFlag = result.llm_stage3_parsed_output?.__clear === true;

    // 检查预检查字段是否显式传入（用于清除旧数据）
    const hasPreCheckCategory = Object.prototype.hasOwnProperty.call(result, 'pre_check_category');
    const hasPreCheckReason = Object.prototype.hasOwnProperty.call(result, 'pre_check_reason');
    const hasPreCheckResult = Object.prototype.hasOwnProperty.call(result, 'pre_check_result');

    // 构建记录对象，如果存在则保留未更新的字段
    // 对于分析数据（stage1/stage2/prestage），null不会覆盖旧的有效数据
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
        ? null  // 清除标记
        : (result.analysis_stage ?? existing?.analysis_stage ?? null), // 否则使用新值或保留旧值

      // === 预检查字段（3个）- 允许null覆盖（用于清除旧的预检查数据）===
      pre_check_category: hasPreCheckCategory ? result.pre_check_category : (existing?.pre_check_category ?? null),
      pre_check_reason: hasPreCheckReason ? result.pre_check_reason : (existing?.pre_check_reason ?? null),
      pre_check_result: hasPreCheckResult ? result.pre_check_result : (existing?.pre_check_result ?? null),

      // === 前置LLM阶段字段（9个）- null不覆盖旧数据 ===
      llm_prestage_category: this._mergeField(result.llm_prestage_category, existing?.llm_prestage_category),
      llm_prestage_model: this._mergeField(result.llm_prestage_model, existing?.llm_prestage_model),
      llm_prestage_prompt: this._mergeField(result.llm_prestage_prompt, existing?.llm_prestage_prompt),
      llm_prestage_raw_output: this._mergeField(result.llm_prestage_raw_output, existing?.llm_prestage_raw_output),
      llm_prestage_parsed_output: this._mergeField(result.llm_prestage_parsed_output, existing?.llm_prestage_parsed_output),
      llm_prestage_started_at: this._mergeField(result.llm_prestage_started_at, existing?.llm_prestage_started_at),
      llm_prestage_finished_at: this._mergeField(result.llm_prestage_finished_at, existing?.llm_prestage_finished_at),
      llm_prestage_success: this._mergeField(result.llm_prestage_success, existing?.llm_prestage_success),
      llm_prestage_error: this._mergeField(result.llm_prestage_error, existing?.llm_prestage_error),

      // === Stage 1 字段（9个）- null不覆盖旧数据（除非有清除标记）===
      llm_stage1_category: hasStage1ClearFlag ? null : this._mergeField(result.llm_stage1_category, existing?.llm_stage1_category),
      llm_stage1_model: hasStage1ClearFlag ? null : this._mergeField(result.llm_stage1_model, existing?.llm_stage1_model),
      llm_stage1_prompt: hasStage1ClearFlag ? null : this._mergeField(result.llm_stage1_prompt, existing?.llm_stage1_prompt),
      llm_stage1_raw_output: hasStage1ClearFlag ? null : this._mergeField(result.llm_stage1_raw_output, existing?.llm_stage1_raw_output),
      llm_stage1_parsed_output: hasStage1ClearFlag ? null : this._mergeField(result.llm_stage1_parsed_output, existing?.llm_stage1_parsed_output),
      llm_stage1_started_at: hasStage1ClearFlag ? null : this._mergeField(result.llm_stage1_started_at, existing?.llm_stage1_started_at),
      llm_stage1_finished_at: hasStage1ClearFlag ? null : this._mergeField(result.llm_stage1_finished_at, existing?.llm_stage1_finished_at),
      llm_stage1_success: hasStage1ClearFlag ? null : this._mergeField(result.llm_stage1_success, existing?.llm_stage1_success),
      llm_stage1_error: hasStage1ClearFlag ? null : this._mergeField(result.llm_stage1_error, existing?.llm_stage1_error),

      // === Stage 2 字段（9个）- null不覆盖旧数据（除非有清除标记）===
      llm_stage2_category: hasStage2ClearFlag ? null : this._mergeField(result.llm_stage2_category, existing?.llm_stage2_category),
      llm_stage2_model: hasStage2ClearFlag ? null : this._mergeField(result.llm_stage2_model, existing?.llm_stage2_model),
      llm_stage2_prompt: hasStage2ClearFlag ? null : this._mergeField(result.llm_stage2_prompt, existing?.llm_stage2_prompt),
      llm_stage2_raw_output: hasStage2ClearFlag ? null : this._mergeField(result.llm_stage2_raw_output, existing?.llm_stage2_raw_output),
      llm_stage2_parsed_output: hasStage2ClearFlag ? null : this._mergeField(result.llm_stage2_parsed_output, existing?.llm_stage2_parsed_output),
      llm_stage2_started_at: hasStage2ClearFlag ? null : this._mergeField(result.llm_stage2_started_at, existing?.llm_stage2_started_at),
      llm_stage2_finished_at: hasStage2ClearFlag ? null : this._mergeField(result.llm_stage2_finished_at, existing?.llm_stage2_finished_at),
      llm_stage2_success: hasStage2ClearFlag ? null : this._mergeField(result.llm_stage2_success, existing?.llm_stage2_success),
      llm_stage2_error: hasStage2ClearFlag ? null : this._mergeField(result.llm_stage2_error, existing?.llm_stage2_error),

      // === Stage 3 字段（9个）- null不覆盖旧数据（除非有清除标记）===
      llm_stage3_category: hasStage3ClearFlag ? null : this._mergeField(result.llm_stage3_category, existing?.llm_stage3_category),
      llm_stage3_model: hasStage3ClearFlag ? null : this._mergeField(result.llm_stage3_model, existing?.llm_stage3_model),
      llm_stage3_prompt: hasStage3ClearFlag ? null : this._mergeField(result.llm_stage3_prompt, existing?.llm_stage3_prompt),
      llm_stage3_raw_output: hasStage3ClearFlag ? null : this._mergeField(result.llm_stage3_raw_output, existing?.llm_stage3_raw_output),
      llm_stage3_parsed_output: hasStage3ClearFlag ? null : this._mergeField(result.llm_stage3_parsed_output, existing?.llm_stage3_parsed_output),
      llm_stage3_started_at: hasStage3ClearFlag ? null : this._mergeField(result.llm_stage3_started_at, existing?.llm_stage3_started_at),
      llm_stage3_finished_at: hasStage3ClearFlag ? null : this._mergeField(result.llm_stage3_finished_at, existing?.llm_stage3_finished_at),
      llm_stage3_success: hasStage3ClearFlag ? null : this._mergeField(result.llm_stage3_success, existing?.llm_stage3_success),
      llm_stage3_error: hasStage3ClearFlag ? null : this._mergeField(result.llm_stage3_error, existing?.llm_stage3_error),

      // === Debug字段（2个）- 允许覆盖 ===
      url_extraction_result: result.url_extraction_result ?? existing?.url_extraction_result ?? null,
      data_fetch_results: result.data_fetch_results ?? existing?.data_fetch_results ?? null
    };

    // 使用 upsert (insert or update)
    const { data, error } = await supabase
      .from('token_narrative')
      .upsert(record, {
        onConflict: 'token_address'
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * 更新分析状态（已废弃，保留用于兼容）
   * @deprecated 新的数据库结构不再使用 analysis_status 和 error_message
   */
  static async updateStatus(address, status, errorMessage = null) {
    const supabase = this.getSupabase();
    const updateData = {
      is_valid: status === 'completed'
    };

    const { data, error } = await supabase
      .from('token_narrative')
      .update(updateData)
      .eq('token_address', address.toLowerCase())
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * 仅更新 is_valid 字段（用于使缓存失效）
   * @param {string} address - 代币地址
   * @param {boolean} isValid - 是否有效
   */
  static async updateIsValid(address, isValid) {
    const supabase = this.getSupabase();
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
    const supabase = this.getSupabase();
    const { category, limit = 100, offset = 0 } = options;

    let query = supabase
      .from('token_narrative')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (category) {
      query = query.eq('llm_category', category);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data;
  }
}
