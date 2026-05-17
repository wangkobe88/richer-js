/**
 * 钱包标签因子服务
 * 从 wallets 表按链加载标签数据到内存，对早期交易者进行匹配并计算因子
 */

class WalletLabelService {
  /**
   * @param {Object} supabase - Supabase客户端
   * @param {Object} logger - Logger实例
   */
  constructor(supabase, logger) {
    this.supabase = supabase;
    this.logger = logger;
    /** @type {Map<string, { category: string, winrate: number, realizedProfit: number, buyCount: number }>} */
    this._walletMap = new Map();
    this._cacheLoaded = false;
  }

  /**
   * 初始化标签缓存（实验启动时调用一次）
   * @param {string} chain - 区块链标识，如 'solana', 'bsc'
   */
  async initLabelCache(chain = 'solana') {
    if (this._cacheLoaded) {
      this.logger.info('[WalletLabelService] 标签缓存已加载，跳过');
      return;
    }

    try {
      this.logger.info('[WalletLabelService] 开始加载钱包标签缓存...', { chain });

      const wallets = [];
      let offset = 0;
      const pageSize = 1000;

      while (true) {
        const { data, error } = await this.supabase
          .from('wallets')
          .select('address, category, winrate, realized_profit, buy_count, details->wallet_address')
          .eq('chain', chain)
          .range(offset, offset + pageSize - 1);

        if (error) {
          throw new Error(`加载钱包标签失败: ${error.message}`);
        }

        if (data && data.length > 0) {
          wallets.push(...data);
          if (data.length < pageSize) break;
          offset += pageSize;
        } else {
          break;
        }
      }

      for (const w of wallets) {
        const fullAddr = w.details?.wallet_address || w.address;
        if (!fullAddr) continue;
        this._walletMap.set(fullAddr, {
          category: w.category,
          winrate: w.winrate || 0,
          realizedProfit: parseFloat(w.realized_profit) || 0,
          buyCount: w.buy_count || 0,
        });
      }

      this._cacheLoaded = true;

      // 统计各类别数量
      const catCounts = {};
      for (const [, info] of this._walletMap) {
        const c = info.category || 'unknown';
        catCounts[c] = (catCounts[c] || 0) + 1;
      }

      this.logger.info('[WalletLabelService] 钱包标签缓存加载完成', {
        chain,
        total: this._walletMap.size,
        categories: catCounts,
      });
    } catch (error) {
      this.logger.error('[WalletLabelService] 钱包标签缓存加载失败', { error: error.message });
      // 加载失败不阻塞，因子使用默认值
      this._cacheLoaded = true;
    }
  }

  /**
   * 计算钱包标签因子（纯内存操作，无 IO）
   * @param {Array} trades - 早期交易数据（含 wallet_address, from_usd, to_usd, from_token 等字段）
   * @returns {Object} 钱包标签因子
   */
  calculateLabelFactors(trades) {
    const empty = this.getEmptyFactorValues();

    if (!trades || trades.length === 0 || this._walletMap.size === 0) {
      return empty;
    }

    // 按钱包聚合行为 + 匹配标签
    const walletBehavior = {};
    for (const trade of trades) {
      const wa = trade.wallet_address;
      if (!wa) continue;
      if (!walletBehavior[wa]) {
        walletBehavior[wa] = { buys: 0, sells: 0, buyUsd: 0, sellUsd: 0, label: null };
      }
      const isBuy = trade.from_token === 'So11111111111111111111111111111111111111112'
        || trade.from_token_symbol === 'SOL'
        || trade.from_token_symbol === 'BNB'
        || trade.from_token_symbol === 'ETH';
      if (isBuy) {
        walletBehavior[wa].buys++;
        walletBehavior[wa].buyUsd += trade.from_usd || 0;
      } else {
        walletBehavior[wa].sells++;
        walletBehavior[wa].sellUsd += trade.to_usd || 0;
      }
      // 标签匹配（只查一次）
      if (!walletBehavior[wa].label) {
        const info = this._walletMap.get(wa);
        if (info) {
          walletBehavior[wa].label = info;
        }
      }
    }

    // 收集有标签的钱包
    const labeled = [];
    let hasFresh = false;

    for (const [, behav] of Object.entries(walletBehavior)) {
      if (behav.label) {
        labeled.push(behav);
        if (behav.label.category === 'fresh_wallet') {
          hasFresh = true;
        }
      }
    }

    if (labeled.length === 0) {
      return empty;
    }

    // walletLabelHasFresh: 有 fresh_wallet 参与 (0/1)
    // walletLabelMatchCount: 匹配到标签的钱包数
    const matchCount = labeled.length;

    // walletLabelProfitableRatio: 匹配到的钱包中历史盈利占比
    const profitableCount = labeled.filter(w => w.label.realizedProfit > 0).length;
    const profitableRatio = profitableCount / matchCount;

    // walletLabelOnlyBuyRatio: 匹配到的钱包中只买不卖占比
    const onlyBuyCount = labeled.filter(w => w.buys > 0 && w.sells === 0).length;
    const onlyBuyRatio = onlyBuyCount / matchCount;

    // walletLabelBuySellRatio: 匹配到的钱包早期总买入/总卖出
    const totalBuyUsd = labeled.reduce((s, w) => s + w.buyUsd, 0);
    const totalSellUsd = labeled.reduce((s, w) => s + w.sellUsd, 0);
    const buySellRatio = totalSellUsd > 0 ? totalBuyUsd / totalSellUsd : 999;

    return {
      walletLabelHasFresh: hasFresh ? 1 : 0,
      walletLabelProfitableRatio: parseFloat(profitableRatio.toFixed(4)),
      walletLabelBuySellRatio: parseFloat(Math.min(buySellRatio, 999).toFixed(2)),
      walletLabelMatchCount: matchCount,
      walletLabelOnlyBuyRatio: parseFloat(onlyBuyRatio.toFixed(4)),
    };
  }

  /**
   * 获取空因子值（用于无数据或缓存未加载的情况）
   */
  getEmptyFactorValues() {
    return {
      walletLabelHasFresh: 0,
      walletLabelProfitableRatio: 0,
      walletLabelBuySellRatio: 0,
      walletLabelMatchCount: 0,
      walletLabelOnlyBuyRatio: 0,
    };
  }
}

module.exports = { WalletLabelService };
