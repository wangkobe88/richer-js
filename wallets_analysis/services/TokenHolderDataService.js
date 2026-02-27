/**
 * 代币持有者数据服务
 * 从 Supabase token_holders 表获取持有者数据
 */

import { createClient } from '@supabase/supabase-js';
import config from '../config.js';

export class TokenHolderDataService {
  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('缺少 SUPABASE_URL 或 SUPABASE_ANON_KEY 环境变量');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * 获取代币的持有者数据
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<Set>} 持有者地址集合
   */
  async getTokenHolders(tokenAddress) {
    try {
      // 获取该代币最新的持有者数据
      const { data, error } = await this.supabase
        .from('token_holders')
        .select('holder_data')
        .eq('token_address', tokenAddress)
        .order('checked_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn(`   ⚠️  获取持有者数据失败: ${error.message}`);
        return new Set();
      }

      if (!data || !data.holder_data || !data.holder_data.holders) {
        return new Set();
      }

      // 提取持有者地址
      const holders = new Set();
      for (const holder of data.holder_data.holders) {
        const address = holder.address || holder.holder;
        if (address && typeof address === 'string') {
          holders.add(address.toLowerCase());
        }
      }

      return holders;

    } catch (error) {
      console.warn(`   ⚠️  获取持有者异常: ${error.message}`);
      return new Set();
    }
  }

  /**
   * 批量获取多个代币的持有者数据
   * @param {Array} tokens - 代币数组 [{address, symbol, category}, ...]
   * @param {Function} progressCallback - 进度回调
   * @returns {Promise<Map>} Map<tokenAddress, Set<holderAddress>>
   */
  async batchGetTokenHolders(tokens, progressCallback = null) {
    const holdersMap = new Map();

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const tokenAddress = token.address || token.token_address;

      const holders = await this.getTokenHolders(tokenAddress);
      holdersMap.set(tokenAddress, holders);

      if (progressCallback) {
        progressCallback(i + 1, tokens.length);
      }
    }

    return holdersMap;
  }

  /**
   * 清理缓存（如果有的话）
   */
  clearCache() {
    // 当前无缓存，此方法保留接口兼容性
  }
}
