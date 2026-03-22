/**
 * 叙事分析数据库操作
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config({ path: '../../config/.env' });

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
    const record = {
      token_address: result.token_address.toLowerCase(),
      token_symbol: result.token_symbol,
      platform: result.platform || 'fourmeme',
      blockchain: result.blockchain || 'bsc',
      raw_api_data: result.raw_api_data,
      extracted_info: result.extracted_info,
      twitter_info: result.twitter_info,
      llm_category: result.llm_category,
      llm_raw_output: result.llm_raw_output,
      llm_summary: result.llm_summary,
      prompt_version: result.prompt_version || 'V5.13',
      prompt_used: result.prompt_used,
      analysis_status: result.analysis_status || 'completed',
      error_message: result.error_message,
      is_valid: result.is_valid !== undefined ? result.is_valid : true,
      experiment_id: result.experiment_id || null,  // 标识来源实验
      analyzed_at: result.analyzed_at || new Date().toISOString()
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
   * 更新分析状态
   */
  static async updateStatus(address, status, errorMessage = null) {
    const supabase = this.getSupabase();
    const updateData = {
      analysis_status: status,
      updated_at: new Date().toISOString()
    };

    if (errorMessage) {
      updateData.error_message = errorMessage;
    }

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

  /**
   * 批量标记为无效（用于Prompt版本更新后重新分析）
   */
  static async invalidateByPromptVersion(oldVersion) {
    const supabase = this.getSupabase();
    const { data, error } = await supabase
      .from('token_narrative')
      .update({ is_valid: false })
      .eq('prompt_version', oldVersion)
      .select();

    if (error) throw error;
    return data;
  }
}
