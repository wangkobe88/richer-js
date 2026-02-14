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
   * @return {Promise<Object>} 创建的钱包对象
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
      return data;
    } catch (error) {
      console.error('创建钱包失败:', error);
      return null;
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
}

module.exports = { WalletDataService };
