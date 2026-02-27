/**
 * 钱包分析数据服务
 * 用于生成钱包画像、标签和同步数据
 */

const { createClient } = require('@supabase/supabase-js');
const { dbManager } = require('../../services/dbManager');

// 算法配置
const ALGORITHM_CONFIG = {
  pureFakePumpThreshold: 0.8,
  minFakePumpCount: 3,
  mixedFakePumpThreshold: 0.4,
  singleAttemptThreshold: 1
};

/**
 * 钱包分析服务类
 */
class WalletAnalysisDataService {
  constructor() {
    this.supabase = dbManager.getClient();
    this.activeTasks = new Map();
  }

  /**
   * 获取可用的实验列表（用于画像生成）
   */
  async getAvailableExperiments() {
    try {
      const { data, error } = await this.supabase
        .from('experiments')
        .select('id, experiment_name, created_at, blockchain, status')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      // 获取每个实验的代币数量
      const experimentsWithStats = await Promise.all(
        (data || []).map(async (exp) => {
          const { count } = await this.supabase
            .from('experiment_tokens')
            .select('*', { count: 'exact', head: true })
            .eq('experiment_id', exp.id);

          return {
            ...exp,
            tokenCount: count || 0
          };
        })
      );

      return experimentsWithStats;
    } catch (error) {
      console.error('获取实验列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有实验
   */
  async getAllExperiments() {
    try {
      const allExperiments = [];
      let page = 0;
      const pageSize = 100;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await this.supabase
          .from('experiments')
          .select('id, experiment_name')
          .range(page * pageSize, (page + 1) * pageSize - 1)
          .order('created_at', { ascending: false });

        if (error) throw error;

        if (data && data.length > 0) {
          allExperiments.push(...data);
          hasMore = data.length === pageSize;
          page++;
        } else {
          hasMore = false;
        }
      }

      return allExperiments;
    } catch (error) {
      console.error('获取实验列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取已标注的代币（按实验逐个获取）
   */
  async getAnnotatedTokens(experimentId = null) {
    try {
      const tokenMap = new Map();

      if (experimentId) {
        // 单个实验
        const tokens = await this._getExperimentTokens(experimentId);
        for (const token of tokens) {
          if (!token.human_judges || !token.human_judges.category) continue;
          const key = `${token.token_address}_${token.blockchain || 'bsc'}`;
          if (!tokenMap.has(key)) {
            tokenMap.set(key, {
              address: token.token_address,
              symbol: token.token_symbol,
              chain: token.blockchain || 'bsc',
              category: token.human_judges.category,
              note: token.human_judges.note,
              experimentId: token.experiment_id
            });
          }
        }
      } else {
        // 所有实验
        const experiments = await this.getAllExperiments();
        console.log(`获取 ${experiments.length} 个实验的标注代币...`);

        // 分批处理实验
        const batchSize = 20;
        for (let i = 0; i < experiments.length; i += batchSize) {
          const batch = experiments.slice(i, i + batchSize);

          for (const exp of batch) {
            const tokens = await this._getExperimentTokens(exp.id);

            for (const token of tokens) {
              if (!token.human_judges || !token.human_judges.category) continue;
              const key = `${token.token_address}_${token.blockchain || 'bsc'}`;
              if (!tokenMap.has(key)) {
                tokenMap.set(key, {
                  address: token.token_address,
                  symbol: token.token_symbol,
                  chain: token.blockchain || 'bsc',
                  category: token.human_judges.category,
                  note: token.human_judges.note,
                  experimentId: exp.id
                });
              }
            }
          }

          // 批次间延迟
          if (i + batchSize < experiments.length) {
            await this._delay(100);
          }
        }
      }

      console.log(`找到 ${tokenMap.size} 个已标注代币`);
      return Array.from(tokenMap.values());
    } catch (error) {
      console.error('获取标注代币失败:', error);
      throw error;
    }
  }

  /**
   * 获取单个实验的代币
   */
  async _getExperimentTokens(experimentId) {
    try {
      const allTokens = [];
      let page = 0;
      const pageSize = 500;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await this.supabase
          .from('experiment_tokens')
          .select('token_address, token_symbol, blockchain, human_judges')
          .eq('experiment_id', experimentId)
          .not('human_judges', 'is', null)
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
          console.warn(`获取实验 ${experimentId} 代币失败: ${error.message}`);
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
    } catch (error) {
      console.warn(`获取实验 ${experimentId} 代币异常:`, error.message);
      return [];
    }
  }

  /**
   * 获取代币的早期交易者（前60笔）
   */
  async getEarlyTraders(tokenAddress, chain = 'bsc') {
    try {
      // 从 token_early_trades 表获取早期交易者
      const { data, error } = await this.supabase
        .from('token_early_trades')
        .select('trader')
        .eq('token_address', tokenAddress)
        .limit(60);

      if (error) {
        // 如果表不存在或查询失败，返回空集合
        return new Set();
      }

      const traders = new Set();
      for (const row of data || []) {
        if (row.trader && typeof row.trader === 'string') {
          traders.add(row.trader.toLowerCase());
        }
      }

      return traders;
    } catch (error) {
      console.warn(`获取代币 ${tokenAddress} 早期交易者失败:`, error.message);
      return new Set();
    }
  }

  /**
   * 获取代币的持有者
   */
  async getTokenHolders(tokenAddress) {
    try {
      const { data, error } = await this.supabase
        .from('token_holders')
        .select('holder_data')
        .eq('token_address', tokenAddress)
        .order('checked_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data?.holder_data?.holders) {
        return new Set();
      }

      const holders = new Set();
      for (const holder of data.holder_data.holders) {
        const address = holder.address || holder.holder;
        if (address && typeof address === 'string') {
          holders.add(address.toLowerCase());
        }
      }

      return holders;
    } catch (error) {
      console.warn(`获取代币 ${tokenAddress} 持有者失败:`, error.message);
      return new Set();
    }
  }

  /**
   * 生成钱包画像（使用所有实验的标注代币）
   */
  async generateProfiles(onProgress) {
    const taskId = this._generateTaskId();
    this.activeTasks.set(taskId, { status: 'running', progress: 0, message: '初始化...' });

    try {
      // 获取所有标注代币
      onProgress?.({ status: 'running', progress: 5, message: '获取标注代币...' });
      const tokens = await this.getAnnotatedTokens(null);

      if (tokens.length === 0) {
        throw new Error('没有找到已标注的代币');
      }

      onProgress?.({ status: 'running', progress: 10, message: `找到 ${tokens.length} 个标注代币，开始分析...` });

      // 分析钱包
      const walletProfiles = new Map();
      const total = tokens.length;
      let processed = 0;
      let lastProgressUpdate = Date.now();

      // 批量处理，每批处理指定数量的代币
      const batchSize = 10;
      const delayBetweenBatches = 500; // 毫秒

      for (let i = 0; i < tokens.length; i += batchSize) {
        const batch = tokens.slice(i, i + batchSize);

        // 处理当前批次
        for (const token of batch) {
          try {
            const [traders, holders] = await Promise.all([
              this.getEarlyTraders(token.address, token.chain),
              this.getTokenHolders(token.address)
            ]);

            const allWallets = new Set([...traders, ...holders]);

            for (const wallet of allWallets) {
              if (!walletProfiles.has(wallet)) {
                walletProfiles.set(wallet, {
                  walletAddress: wallet,
                  blockchain: token.chain,
                  totalParticipations: 0,
                  earlyTradeCount: 0,
                  holderCount: 0,
                  categories: {},
                  tokens: []
                });
              }

              const profile = walletProfiles.get(wallet);
              profile.categories[token.category] = (profile.categories[token.category] || 0) + 1;
              profile.totalParticipations++;

              if (traders.has(wallet)) {
                profile.earlyTradeCount++;
              }
              if (holders.has(wallet)) {
                profile.holderCount++;
              }

              // 限制 tokens 数组大小，避免数据过大
              if (profile.tokens.length < 100) {
                profile.tokens.push({
                  address: token.address,
                  symbol: token.symbol,
                  category: token.category,
                  asEarlyTrader: traders.has(wallet),
                  asHolder: holders.has(wallet)
                });
              }
            }

            processed++;

            // 每1秒更新一次进度，避免过于频繁
            const now = Date.now();
            if (now - lastProgressUpdate > 1000) {
              const progress = Math.min(85, 10 + Math.floor((processed / total) * 75));
              onProgress?.({ status: 'running', progress, message: `处理 ${processed}/${total} 个代币...` });
              lastProgressUpdate = now;
            }
          } catch (error) {
            console.warn(`处理代币 ${token.address} 失败:`, error.message);
          }
        }

        // 批次间延迟
        if (i + batchSize < tokens.length) {
          await this._delay(delayBetweenBatches);
        }
      }

      // 保存到数据库
      onProgress?.({ status: 'running', progress: 88, message: '保存到数据库...' });

      const blockchain = tokens[0]?.chain || 'bsc';
      await this._saveProfiles(walletProfiles, blockchain);

      // 生成统计
      const stats = this._generateStats(walletProfiles);

      onProgress?.({ status: 'completed', progress: 100, message: '完成！', stats });

      return {
        taskId,
        stats,
        totalWallets: walletProfiles.size
      };

    } catch (error) {
      this.activeTasks.set(taskId, { status: 'failed', error: error.message });
      throw error;
    }
  }

  /**
   * 延迟函数
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 保存钱包画像到数据库（覆盖模式，批量处理）
   */
  async _saveProfiles(walletProfiles, blockchain) {
    const profiles = Array.from(walletProfiles.values());
    console.log(`开始保存 ${profiles.length} 个钱包...`);

    // 不保存 tokens 数组，只保存统计数据
    const batchSize = 100;
    let saved = 0;

    for (let i = 0; i < profiles.length; i += batchSize) {
      const batch = profiles.slice(i, i + batchSize);
      const upsertData = batch.map(profile => ({
        wallet_address: profile.walletAddress,
        blockchain: blockchain,
        total_participations: profile.totalParticipations,
        early_trade_count: profile.earlyTradeCount,
        holder_count: profile.holderCount,
        categories: profile.categories,
        dominant_category: this._getDominantCategory(profile.categories),
        updated_at: new Date().toISOString()
      }));

      try {
        const { error } = await this.supabase
          .from('wallet_profiles')
          .upsert(upsertData, {
            onConflict: 'wallet_address,blockchain'
          });

        if (error) {
          console.error(`批量保存失败 (批次 ${i / batchSize + 1}):`, error);
        } else {
          saved += upsertData.length;
          console.log(`已保存 ${saved}/${profiles.length} 个钱包`);
        }
      } catch (err) {
        console.error(`批量保存异常 (批次 ${i / batchSize + 1}):`, err);
      }

      // 批次间延迟
      if (i + batchSize < profiles.length) {
        await this._delay(100);
      }
    }

    console.log(`保存完成: ${saved}/${profiles.length} 个钱包`);
  }

  /**
   * 生成标签
   */
  async generateLabels(algorithmConfig = {}) {
    const config = { ...ALGORITHM_CONFIG, ...algorithmConfig };

    try {
      // 获取所有未打标签的钱包
      const { data: profiles, error } = await this.supabase
        .from('wallet_profiles')
        .select('*');

      if (error) throw error;

      let pumpGroupCount = 0;
      let goodHolderCount = 0;

      for (const profile of profiles || []) {
        const label = this._calculateLabel(profile.categories, config);

        await this.supabase
          .from('wallet_profiles')
          .update({
            label: label.label,
            label_confidence: label.confidence,
            label_reason: label.reason,
            synced: false,
            updated_at: new Date().toISOString()
          })
          .eq('wallet_address', profile.wallet_address)
          .eq('blockchain', profile.blockchain);

        if (label.label === 'pump_group') {
          pumpGroupCount++;
        } else {
          goodHolderCount++;
        }
      }

      return {
        stats: {
          pump_group: pumpGroupCount,
          good_holder: goodHolderCount,
          total: pumpGroupCount + goodHolderCount
        }
      };

    } catch (error) {
      console.error('生成标签失败:', error);
      throw error;
    }
  }

  /**
   * 计算钱包标签
   */
  _calculateLabel(categories, config) {
    const fakePumpCount = categories.fake_pump || 0;
    const otherCount = (categories.no_user || 0) + (categories.low_quality || 0) +
                       (categories.mid_quality || 0) + (categories.high_quality || 0);
    const totalCount = fakePumpCount + otherCount;

    if (totalCount === 0) {
      return {
        label: 'good_holder',
        confidence: 0,
        reason: '无参与记录'
      };
    }

    const fakePumpRatio = fakePumpCount / totalCount;

    // 规则1: 无流水盘参与
    if (fakePumpCount === 0) {
      return {
        label: 'good_holder',
        confidence: 1.0,
        reason: '无流水盘参与'
      };
    }

    // 规则2: 纯流水盘钱包
    if (fakePumpRatio >= config.pureFakePumpThreshold) {
      return {
        label: 'pump_group',
        confidence: fakePumpRatio,
        reason: `纯流水盘占比${(fakePumpRatio * 100).toFixed(1)}%`
      };
    }

    // 规则3: 混合型重度流水盘
    if (fakePumpCount >= config.minFakePumpCount &&
        fakePumpRatio >= config.mixedFakePumpThreshold) {
      return {
        label: 'pump_group',
        confidence: fakePumpRatio * 0.8,
        reason: `混合型重度流水盘 (${fakePumpCount}次, ${(fakePumpRatio * 100).toFixed(1)}%)`
      };
    }

    // 规则4: 单次试探
    if (fakePumpCount === config.singleAttemptThreshold) {
      return {
        label: 'good_holder',
        confidence: 1.0 - fakePumpRatio,
        reason: '单次试探性参与'
      };
    }

    // 规则5: 其他混合情况
    return {
      label: 'good_holder',
      confidence: 0.5,
      reason: `混合型轻度流水盘 (${fakePumpCount}次, ${(fakePumpRatio * 100).toFixed(1)}%)`
    };
  }

  /**
   * 同步标签到 wallets 表
   */
  async syncToWallets(mode = 'upsert') {
    try {
      // 获取有标签的钱包
      const { data: profiles, error } = await this.supabase
        .from('wallet_profiles')
        .select('wallet_address, label, label_reason')
        .not('label', 'is', null);

      if (error) throw error;

      let updated = 0;
      let inserted = 0;
      let skipped = 0;

      for (const profile of profiles || []) {
        if (mode === 'insert') {
          // 仅插入新钱包
          const { data: existing } = await this.supabase
            .from('wallets')
            .select('id')
            .ilike('address', profile.wallet_address)
            .maybeSingle();

          if (existing) {
            skipped++;
            continue;
          }

          const { error: insertError } = await this.supabase
            .from('wallets')
            .insert({
              address: profile.wallet_address,
              category: profile.label,
              name: `${profile.label}钱包`
            });

          if (!insertError) {
            inserted++;
          }

        } else if (mode === 'update') {
          // 仅更新已有钱包
          const { error: updateError } = await this.supabase
            .from('wallets')
            .update({ category: profile.label })
            .ilike('address', profile.wallet_address);

          if (!updateError) {
            updated++;
          }

        } else {
          // upsert
          const { data: existing } = await this.supabase
            .from('wallets')
            .select('id')
            .ilike('address', profile.wallet_address)
            .maybeSingle();

          if (existing) {
            await this.supabase
              .from('wallets')
              .update({ category: profile.label })
              .eq('id', existing.id);
            updated++;
          } else {
            await this.supabase
              .from('wallets')
              .insert({
                address: profile.wallet_address,
                category: profile.label,
                name: `${profile.label}钱包`
              });
            inserted++;
          }
        }
      }

      // 更新 synced 标记
      await this.supabase
        .from('wallet_profiles')
        .update({ synced: true })
        .not('label', 'is', null);

      return { updated, inserted, skipped };

    } catch (error) {
      console.error('同步失败:', error);
      throw error;
    }
  }

  /**
   * 获取钱包画像列表
   */
  async getProfiles(filters = {}) {
    try {
      const page = filters.page || 1;
      const limit = filters.limit || 50;
      const offset = (page - 1) * limit;

      // 先获取总数
      let countQuery = this.supabase
        .from('wallet_profiles')
        .select('*', { count: 'exact', head: true });

      if (filters.label) {
        countQuery = countQuery.eq('label', filters.label);
      }
      if (filters.dominant_category) {
        countQuery = countQuery.eq('dominant_category', filters.dominant_category);
      }
      if (filters.search) {
        countQuery = countQuery.ilike('wallet_address', `%${filters.search}%`);
      }

      const { count: totalCount, error: countError } = await countQuery;

      if (countError) {
        console.error('获取总数失败:', countError);
      }

      // 获取当前页数据
      let query = this.supabase
        .from('wallet_profiles')
        .select('*');

      if (filters.label) {
        query = query.eq('label', filters.label);
      }
      if (filters.dominant_category) {
        query = query.eq('dominant_category', filters.dominant_category);
      }
      if (filters.search) {
        query = query.ilike('wallet_address', `%${filters.search}%`);
      }

      query = query
        .order('total_participations', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) throw error;

      return {
        profiles: data || [],
        total: totalCount || 0,
        page,
        limit
      };

    } catch (error) {
      console.error('获取钱包画像失败:', error);
      throw error;
    }
  }

  /**
   * 获取钱包画像详情
   */
  async getProfile(walletAddress, blockchain = 'bsc') {
    try {
      const { data, error } = await this.supabase
        .from('wallet_profiles')
        .select('*')
        .eq('wallet_address', walletAddress)
        .eq('blockchain', blockchain)
        .single();

      if (error) throw error;

      return data;
    } catch (error) {
      console.error('获取钱包画像详情失败:', error);
      return null;
    }
  }

  /**
   * 获取统计概览
   */
  async getStats() {
    try {
      // 获取总数
      const { count: totalProfiles } = await this.supabase
        .from('wallet_profiles')
        .select('*', { count: 'exact', head: true });

      // 获取标签统计（分批处理）
      const labelStats = {};
      const categoryStats = {};
      const pageSize = 1000;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: profiles, error } = await this.supabase
          .from('wallet_profiles')
          .select('label, dominant_category')
          .range(offset, offset + pageSize - 1);

        if (error) throw error;

        if (profiles && profiles.length > 0) {
          for (const p of profiles) {
            if (p.label) {
              labelStats[p.label] = (labelStats[p.label] || 0) + 1;
            }
            if (p.dominant_category) {
              categoryStats[p.dominant_category] = (categoryStats[p.dominant_category] || 0) + 1;
            }
          }

          hasMore = profiles.length === pageSize;
          offset += pageSize;
        } else {
          hasMore = false;
        }
      }

      // 获取最后更新时间
      const { data: lastUpdate } = await this.supabase
        .from('wallet_profiles')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      return {
        totalProfiles: totalProfiles || 0,
        labelStats,
        categoryStats,
        lastUpdated: lastUpdate?.updated_at || null
      };

    } catch (error) {
      console.error('获取统计失败:', error);
      throw error;
    }
  }

  /**
   * 获取任务状态
   */
  getTaskStatus(taskId) {
    return this.activeTasks.get(taskId) || { status: 'not_found' };
  }

  /**
   * 生成任务ID
   */
  _generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取主导分类
   */
  _getDominantCategory(categories) {
    let maxCount = 0;
    let dominant = null;

    for (const [cat, count] of Object.entries(categories)) {
      if (count > maxCount) {
        maxCount = count;
        dominant = cat;
      }
    }

    return dominant;
  }

  /**
   * 生成统计
   */
  _generateStats(walletProfiles) {
    const byDominantCategory = {};
    const byLabel = {};

    for (const profile of walletProfiles.values()) {
      if (profile.dominantCategory) {
        byDominantCategory[profile.dominantCategory] =
          (byDominantCategory[profile.dominantCategory] || 0) + 1;
      }
    }

    return {
      totalWallets: walletProfiles.size,
      byDominantCategory,
      byLabel
    };
  }
}

module.exports = { WalletAnalysisDataService };
