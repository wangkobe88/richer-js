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

    // 构建记录对象，如果存在则保留未更新的字段
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
      is_valid: result.is_valid !== undefined ? result.is_valid : true,

      // === 预检查字段（3个）===
      pre_check_category: result.pre_check_category !== undefined ? result.pre_check_category : (existing?.pre_check_category || null),
      pre_check_reason: result.pre_check_reason !== undefined ? result.pre_check_reason : (existing?.pre_check_reason || null),
      pre_check_result: result.pre_check_result !== undefined ? result.pre_check_result : (existing?.pre_check_result || null),

      // === Stage 1 字段（9个）===
      llm_stage1_category: result.llm_stage1_category !== undefined ? result.llm_stage1_category : (existing?.llm_stage1_category || null),
      llm_stage1_model: result.llm_stage1_model !== undefined ? result.llm_stage1_model : (existing?.llm_stage1_model || null),
      llm_stage1_prompt: result.llm_stage1_prompt !== undefined ? result.llm_stage1_prompt : (existing?.llm_stage1_prompt || null),
      llm_stage1_raw_output: result.llm_stage1_raw_output !== undefined ? result.llm_stage1_raw_output : (existing?.llm_stage1_raw_output || null),
      llm_stage1_parsed_output: result.llm_stage1_parsed_output !== undefined ? result.llm_stage1_parsed_output : (existing?.llm_stage1_parsed_output || null),
      llm_stage1_started_at: result.llm_stage1_started_at !== undefined ? result.llm_stage1_started_at : (existing?.llm_stage1_started_at || null),
      llm_stage1_finished_at: result.llm_stage1_finished_at !== undefined ? result.llm_stage1_finished_at : (existing?.llm_stage1_finished_at || null),
      llm_stage1_success: result.llm_stage1_success !== undefined ? result.llm_stage1_success : (existing?.llm_stage1_success ?? null),
      llm_stage1_error: result.llm_stage1_error !== undefined ? result.llm_stage1_error : (existing?.llm_stage1_error || null),

      // === Stage 2 字段（9个）===
      llm_stage2_category: result.llm_stage2_category !== undefined ? result.llm_stage2_category : (existing?.llm_stage2_category || null),
      llm_stage2_model: result.llm_stage2_model !== undefined ? result.llm_stage2_model : (existing?.llm_stage2_model || null),
      llm_stage2_prompt: result.llm_stage2_prompt !== undefined ? result.llm_stage2_prompt : (existing?.llm_stage2_prompt || null),
      llm_stage2_raw_output: result.llm_stage2_raw_output !== undefined ? result.llm_stage2_raw_output : (existing?.llm_stage2_raw_output || null),
      llm_stage2_parsed_output: result.llm_stage2_parsed_output !== undefined ? result.llm_stage2_parsed_output : (existing?.llm_stage2_parsed_output || null),
      llm_stage2_started_at: result.llm_stage2_started_at !== undefined ? result.llm_stage2_started_at : (existing?.llm_stage2_started_at || null),
      llm_stage2_finished_at: result.llm_stage2_finished_at !== undefined ? result.llm_stage2_finished_at : (existing?.llm_stage2_finished_at || null),
      llm_stage2_success: result.llm_stage2_success !== undefined ? result.llm_stage2_success : (existing?.llm_stage2_success ?? null),
      llm_stage2_error: result.llm_stage2_error !== undefined ? result.llm_stage2_error : (existing?.llm_stage2_error || null),

      // === Debug字段（2个）===
      url_extraction_result: result.url_extraction_result !== undefined ? result.url_extraction_result : (existing?.url_extraction_result || null),
      data_fetch_results: result.data_fetch_results !== undefined ? result.data_fetch_results : (existing?.data_fetch_results || null)
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
