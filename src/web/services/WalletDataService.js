/**
 * 钱包数据服务层
 * 用于管理用户钱包地址
 */

const { dbManager } = require('../../services/dbManager');

/**
 * 钱包数据服务类
 */
class WalletDataService {
  constructor() {
    this.supabase = dbManager.getClient();
  }

  /**
   * 获取所有钱包
   * @return {Promise<Array>} 钱包列表
   */
  async getWallets() {
    try {
      const { data, error } = await this.supabase
        .from('wallets')
        .select('*')
        .order('id', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('获取钱包列表失败:', error);
      return [];
    }
  }

  /**
   * 根据 ID 获取钱包
   * @param {string} id - 钱包ID
   * @return {Promise<Object>} 钱包对象
   */
  async getWalletById(id) {
    try {
      const { data, error } = await this.supabase
        .from('wallets')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('获取钱包失败:', error);
      return null;
    }
  }

  /**
   * 创建钱包
   * @param {Object} walletData - 钱包数据 { address, name?, category? }
   * @return {Promise<Object>} { success, data?, alreadyExists? }
   */
  async createWallet(walletData) {
    try {
      const { data, error } = await this.supabase
        .from('wallets')
        .insert({
          address: walletData.address,
          name: walletData.name || null,
          category: walletData.category || null
        })
        .select()
        .single();

      if (error) throw error;
      return { success: true, data };
    } catch (error) {
      console.error('创建钱包失败:', error);

      // 检查是否是唯一约束错误（重复）
      const errorMsg = error.message || '';
      const isDuplicate = errorMsg.includes('unique constraint') ||
                        errorMsg.includes('duplicate key') ||
                        error.code === '23505';

      if (isDuplicate) {
        // 返回已存在标记，并获取现有钱包数据
        const existing = await this.getWalletByAddress(walletData.address);
        return { success: false, alreadyExists: true, data: existing };
      }

      return { success: false, error: error.message };
    }
  }

  /**
   * 更新钱包
   * @param {string} id - 钱包ID
   * @param {Object} updates - 更新数据 { name?, category? }
   * @return {Promise<Object>} 更新后的钱包对象
   */
  async updateWallet(id, updates) {
    try {
      const { data, error } = await this.supabase
        .from('wallets')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('更新钱包失败:', error);
      return null;
    }
  }

  /**
   * 删除钱包
   * @param {string} id - 钱包ID
   * @return {Promise<boolean>} 是否成功
   */
  async deleteWallet(id) {
    try {
      const { error } = await this.supabase
        .from('wallets')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('删除钱包失败:', error);
      return false;
    }
  }

  /**
   * 根据地址删除钱包
   * @param {string} address - 钱包地址
   * @return {Promise<boolean>} 是否成功
   */
  async deleteWalletByAddress(address) {
    try {
      // 使用 ilike 进行不区分大小写的匹配
      const { error } = await this.supabase
        .from('wallets')
        .delete()
        .ilike('address', address);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('根据地址删除钱包失败:', error);
      return false;
    }
  }

  /**
   * 根据地址获取钱包
   * @param {string} address - 钱包地址
   * @return {Promise<Object>} 钱包对象
   */
  async getWalletByAddress(address) {
    try {
      // 使用 ilike 进行不区分大小写的匹配
      const { data, error } = await this.supabase
        .from('wallets')
        .select('*')
        .ilike('address', address)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // 没有找到记录
          return null;
        }
        throw error;
      }
      return data;
    } catch (error) {
      console.error('根据地址获取钱包失败:', error);
      return null;
    }
  }

  /**
   * 批量创建钱包（跳过已存在的）
   * @param {Array<Object>} wallets - 钱包数组 [{ address, name, category }]
   * @return {Promise<Object>} { success: 数量, skipped: 数量, errors: 数量, skippedWallets: [] }
   */
  async bulkCreateWallets(wallets) {
    const results = {
      success: 0,
      skipped: 0,
      errors: 0,
      details: [],
      skippedWallets: []
    };

    // 直接逐个插入，捕获每个重复错误
    const existingAddresses = new Set();

    for (const w of wallets) {
      const addr = w.address?.toLowerCase();
      if (!addr) continue;

      try {
        const { data, error } = await this.supabase
          .from('wallets')
          .insert(w)
          .select();

        if (error) {
          // 检查是否是唯一约束错误
          const errorMsg = error.message || '';
          const isDuplicate = errorMsg.includes('unique constraint') ||
                            errorMsg.includes('duplicate key') ||
                            error.code === '23505';

          if (isDuplicate) {
            // 重复，跳过
            results.skipped++;
            results.skippedWallets.push({
              address: w.address,
              existingCategory: 'duplicate'
            });
            existingAddresses.add(addr);
          } else {
            console.error('插入钱包失败:', w.address, error);
            results.errors++;
          }
        } else if (data && data.length > 0) {
          results.success++;
          results.details.push(data[0]);
          existingAddresses.add(addr);
        }
      } catch (err) {
        // 捕获异常级别的错误
        const errorMsg = err.message || '';
        const isDuplicate = errorMsg.includes('unique constraint') ||
                          errorMsg.includes('duplicate key') ||
                          err.code === '23505';

        if (isDuplicate) {
          results.skipped++;
          results.skippedWallets.push({
            address: w.address,
            existingCategory: 'duplicate'
          });
          existingAddresses.add(addr);
        } else {
          console.error('插入钱包异常:', w.address, err);
          results.errors++;
        }
      }
    }

    return results;
  }
}

module.exports = { WalletDataService };
