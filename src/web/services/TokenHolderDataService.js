/**
 * 代币持有者数据服务
 * 用于查询和管理代币持有者信息
 */

const { dbManager } = require('../../services/dbManager');

class TokenHolderDataService {
  constructor() {
    this.supabase = dbManager.getClient();
  }

  /**
   * 获取指定代币的所有持有者快照
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<Object>} 快照数据
   */
  async getTokenHolders(tokenAddress) {
    try {
      // 1. 获取所有快照
      const { data: snapshots, error: snapshotsError } = await this.supabase
        .from('token_holders')
        .select('id, token_address, experiment_id, holder_data, snapshot_id, checked_at, created_at')
        .eq('token_address', tokenAddress)
        .order('checked_at', { ascending: false });

      if (snapshotsError) {
        throw new Error(`查询快照失败: ${snapshotsError.message}`);
      }

      if (!snapshots || snapshots.length === 0) {
        return {
          token_address: tokenAddress,
          snapshots: [],
          stats: { total_snapshots: 0, total_holders: 0, blacklisted_holders: 0 }
        };
      }

      // 2. 提取所有实验ID
      const experimentIds = snapshots
        .map(s => s.experiment_id)
        .filter(Boolean);

      // 3. 批量查询实验名称
      let experimentMap = {};
      if (experimentIds.length > 0) {
        const { data: experiments } = await this.supabase
          .from('experiments')
          .select('id, name')
          .in('id', experimentIds);

        experimentMap = (experiments || []).reduce((map, exp) => {
          map[exp.id] = exp.name || exp.id.substring(0, 8);
          return map;
        }, {});
      }

      // 4. 提取所有持有者地址
      const allHolderAddresses = new Set();
      snapshots.forEach(snapshot => {
        if (snapshot.holder_data?.holders) {
          snapshot.holder_data.holders.forEach(holder => {
            if (holder.address) {
              allHolderAddresses.add(holder.address);
            }
          });
        }
      });

      // 5. 批量查询钱包分类
      let walletCategoryMap = {};
      if (allHolderAddresses.size > 0) {
        const { data: wallets } = await this.supabase
          .from('wallets')
          .select('address, category, name')
          .in('address', Array.from(allHolderAddresses));

        walletCategoryMap = (wallets || []).reduce((map, wallet) => {
          map[wallet.address.toLowerCase()] = {
            category: wallet.category,
            name: wallet.name
          };
          return map;
        }, {});
      }

      // 6. 组装数据
      const blacklistedCategories = ['dev', 'pump_group', 'negative_holder'];
      let totalHolders = 0;
      let totalBlacklisted = 0;

      const processedSnapshots = snapshots.map(snapshot => {
        const holders = (snapshot.holder_data?.holders || []).map(holder => {
          const walletInfo = walletCategoryMap[holder.address?.toLowerCase()];
          totalHolders++;
          if (walletInfo?.category && blacklistedCategories.includes(walletInfo.category)) {
            totalBlacklisted++;
          }

          return {
            address: holder.address || holder.holder || '',
            holder: holder.holder || '',
            balance_ratio: holder.balance_ratio || '',
            balance_usd: holder.balance_usd || '',
            main_coin_balance: holder.main_coin_balance || '',
            category: walletInfo?.category || null,
            wallet_name: walletInfo?.name || ''
          };
        });

        // 计算该快照的黑名单持有者
        const blacklistedCount = holders.filter(h =>
          h.category && blacklistedCategories.includes(h.category)
        ).length;

        return {
          id: snapshot.id,
          experiment_id: snapshot.experiment_id,
          experiment_name: snapshot.experiment_id
            ? (experimentMap[snapshot.experiment_id] || snapshot.experiment_id.substring(0, 8))
            : '收集阶段',
          checked_at: snapshot.checked_at,
          created_at: snapshot.created_at,
          snapshot_id: snapshot.snapshot_id,
          holders: holders,
          holders_count: holders.length,
          blacklisted_count: blacklistedCount
        };
      });

      return {
        token_address: tokenAddress,
        snapshots: processedSnapshots,
        stats: {
          total_snapshots: snapshots.length,
          total_holders: totalHolders,
          blacklisted_holders: totalBlacklisted
        }
      };
    } catch (error) {
      console.error('获取代币持有者失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有有持有者数据的代币列表
   * @returns {Promise<Array>} 代币列表
   */
  async getTokenList(experimentId = null) {
    try {
      let query = this.supabase
        .from('token_holders')
        .select('token_address');

      if (experimentId) {
        query = query.eq('experiment_id', experimentId);
      }

      const { data, error } = await query
        .order('checked_at', { ascending: false });

      if (error) {
        throw new Error(`查询代币列表失败: ${error.message}`);
      }

      // 去重
      const uniqueTokens = [...new Set(data?.map(d => d.token_address) || [])];
      return uniqueTokens;
    } catch (error) {
      console.error('获取代币列表失败:', error);
      throw error;
    }
  }
}

module.exports = { TokenHolderDataService };
