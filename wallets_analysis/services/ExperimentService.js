/**
 * 实验服务 - 获取所有实验和标注代币
 */

import { createClient } from '@supabase/supabase-js';
import { config as dotenvConfig } from 'dotenv';
import { resolve, fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenvConfig({ path: resolve(__dirname, '../../config/.env') });

import config from '../config.js';

export class ExperimentService {
  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL || config.database.supabaseUrl;
    const supabaseKey = process.env.SUPABASE_ANON_KEY || config.database.supabaseKey;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set in environment variables');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * 获取所有实验
   * @returns {Promise<Array>} 实验列表
   */
  async getAllExperiments() {
    console.log('📋 获取所有实验...');

    const allExperiments = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('experiments')
        .select('id, experiment_name, created_at')
        .range(page * pageSize, (page + 1) * pageSize - 1)
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`获取实验失败: ${error.message}`);
      }

      if (data && data.length > 0) {
        allExperiments.push(...data);
        hasMore = data.length === pageSize;
        page++;
      } else {
        hasMore = false;
      }
    }

    console.log(`✅ 找到 ${allExperiments.length} 个实验`);
    return allExperiments;
  }

  /**
   * 获取所有标注的代币
   * @param {Array} experiments - 实验列表
   * @returns {Promise<Map>} Map<tokenAddress, {category, note, experiments[], chains[]}>
   */
  async getAnnotatedTokens(experiments) {
    console.log(`🏷️  获取标注代币（${experiments.length} 个实验）...`);

    const tokenMap = new Map();

    // 分批处理实验（每次50个）
    const batchSize = 50;
    for (let i = 0; i < experiments.length; i += batchSize) {
      const batch = experiments.slice(i, i + batchSize);
      console.log(`   处理实验 ${i + 1}-${Math.min(i + batchSize, experiments.length)}/${experiments.length}`);

      for (const experiment of batch) {
        const tokens = await this._getExperimentTokens(experiment.id);

        for (const token of tokens) {
          if (!token.human_judges || !token.human_judges.category) {
            continue;
          }

          const addr = token.token_address;
          const category = token.human_judges.category;
          const note = token.human_judges.note || '';
          const chain = token.blockchain || 'bsc';

          if (tokenMap.has(addr)) {
            const existing = tokenMap.get(addr);
            existing.experiments.push(experiment.id);
            if (!existing.chains.includes(chain)) {
              existing.chains.push(chain);
            }
          } else {
            tokenMap.set(addr, {
              category,
              note,
              experiments: [experiment.id],
              chains: [chain],
              symbol: token.token_symbol || addr.slice(0, 8)
            });
          }
        }
      }
    }

    console.log(`✅ 找到 ${tokenMap.size} 个已标注代币`);
    return tokenMap;
  }

  /**
   * 获取单个实验的代币
   * @private
   */
  async _getExperimentTokens(experimentId) {
    const allTokens = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('experiment_tokens')
        .select('token_address, token_symbol, blockchain, human_judges')
        .eq('experiment_id', experimentId)
        .not('human_judges', 'is', null)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        console.warn(`⚠️  获取实验 ${experimentId} 代币失败: ${error.message}`);
        break;
      }

      if (data && data.length > 0) {
        allTokens.push(...data);
        hasMore = data.length === pageSize;
        page++;
      } else {
        hasMore = false;
      }
    }

    return allTokens;
  }

  /**
   * 获取代币的创建时间
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<Date|null>}
   */
  async getTokenCreateTime(tokenAddress) {
    const { data, error } = await this.supabase
      .from('experiment_tokens')
      .select('discovered_at')
      .eq('token_address', tokenAddress)
      .order('discovered_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return new Date(data.discovered_at);
  }

  /**
   * 获取代币的 inner pair
   * @param {string} tokenAddress - 代币地址
   * @param {string} chain - 链
   * @returns {Promise<string|null>}
   */
  async getTokenInnerPair(tokenAddress, chain = 'bsc') {
    const { data, error } = await this.supabase
      .from('experiment_tokens')
      .select('platform, raw_api_data->inner_pair, raw_api_data->inner_pair_base')
      .eq('token_address', tokenAddress)
      .eq('blockchain', chain)
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    // 如果数据库有存储 inner_pair，直接使用
    if (data.raw_api_data?.inner_pair) {
      return data.raw_api_data.inner_pair;
    }

    // 否则根据平台构建
    const platform = data.platform || 'fourmeme';
    if (platform === 'fourmeme') {
      return `${tokenAddress}_fo`;
    } else if (platform === 'flap') {
      return `${tokenAddress}_iportal`;
    }

    return null;
  }
}
