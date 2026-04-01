/**
 * Telegram 通知服务
 * 用于发送交易信号通知到 Telegram 频道
 */

class TelegramNotifier {
  constructor(config = {}) {
    // Bot Token 和 Channel ID（硬编码）
    this.botToken = '7584677994:AAG_5OA64yzHxqLAuI44ROCL3PLAkMtFfes';
    this.channelId = '-5116043189';
    this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;

    // 通知开关（从配置读取）
    this.enabled = config.enabled !== undefined ? config.enabled : false;

    // 链接模板
    this.gmgnBaseUrl = 'https://gmgn.ai';
    this.webBaseUrl = config.webBaseUrl || 'http://localhost:3010';

    // 数据库管理器（用于查询代币信息）
    this.dbManager = null;
  }

  /**
   * 设置数据库管理器
   */
  setDbManager(dbManager) {
    this.dbManager = dbManager;
  }

  /**
   * 发送交易信号通知
   * @param {Object} signal - 信号对象
   * @param {Object} experimentInfo - 实验信息
   */
  async sendSignalNotification(signal, experimentInfo) {
    // 检查通知是否启用
    if (!this.enabled) {
      return;
    }

    try {
      // 获取代币发现信息
      const tokenInfo = await this.getTokenDiscoveryInfo(signal.token_address, signal.experiment_id);

      // 格式化消息
      const message = this.formatSignalMessage(signal, tokenInfo, experimentInfo);

      // 发送消息（带重试）
      await this.sendWithRetry(message);

      console.log(`📱 Telegram通知发送成功: ${signal.token_symbol} ${signal.action}`);

    } catch (error) {
      console.error(`📱 Telegram通知发送失败:`, error.message);
      // 不抛出错误，避免影响交易流程
    }
  }

  /**
   * 格式化信号通知消息
   */
  formatSignalMessage(signal, tokenInfo, experimentInfo) {
    const metadata = signal.metadata || {};
    const tf = metadata.trendFactors || {};
    const pf = metadata.preBuyCheckFactors || {};
    const pr = metadata.preBuyCheckResult || {};

    // 执行状态
    const executed = signal.executed === true;
    const statusIcon = executed ? '✅' : '🚫';
    const statusText = executed ? '已执行' : '被拒绝';

    // 代币符号（直接从信号数据获取，数据库字段是 token_symbol）
    const tokenSymbol = signal.token_symbol || 'UNKNOWN';
    const shortAddress = this.shortenAddress(signal.token_address);

    // 构建因子状态映射（用于颜色编码）
    const factorStatus = this._buildFactorStatusMap(pr.failedConditions || [], pr.canBuy);

    // 消息头部（紧凑格式）
    let message = `${statusIcon} *${tokenSymbol}* | \`${shortAddress}\` | ${(signal.chain || 'bsc').toUpperCase()}

`;

    // 价格信息（紧凑一行）
    const priceParts = [];
    const currentPrice = tf.currentPrice || metadata.price;
    if (currentPrice !== undefined && currentPrice !== null) {
      priceParts.push(`现价: \`${this.formatNumber(currentPrice, 6)}\``);
    }
    if (tf.collectionPrice !== undefined && tf.collectionPrice !== null) {
      priceParts.push(`收集价: \`${this.formatNumber(tf.collectionPrice, 6)}\``);
    }
    if (tf.earlyReturn !== undefined && tf.earlyReturn !== null) {
      priceParts.push(`涨幅: \`${this.formatPercent(tf.earlyReturn)}\``);
    }
    if (tf.highestPrice !== undefined && tf.highestPrice !== null && currentPrice) {
      const highestReturn = ((tf.highestPrice - tf.collectionPrice) / tf.collectionPrice * 100);
      priceParts.push(`最高: \`${this.formatPercent(highestReturn)}\``);
    }
    if (priceParts.length > 0) {
      message += `💵 ${priceParts.join(' | ')}\n`;
    }

    // 趋势因子（紧凑一行）
    if (tf.age !== undefined || tf.trendStrengthScore !== undefined) {
      const trendParts = [];
      if (tf.age !== undefined && tf.age !== null) {
        trendParts.push(`年龄: \`${this.formatNumber(tf.age)}分\``);
      }
      if (tf.trendStrengthScore !== undefined && tf.trendStrengthScore !== null) {
        trendParts.push(`强度: \`${this.formatNumber(tf.trendStrengthScore)}\``);
      }
      if (tf.drawdownFromHighest !== undefined && tf.drawdownFromHighest !== null) {
        trendParts.push(`回撤: \`${this.formatPercent(tf.drawdownFromHighest)}\``);
      }
      if (trendParts.length > 0) {
        message += `📊 ${trendParts.join(' | ')}\n`;
      }
    }

    // 持有者检查（紧凑一行，带状态）
    if (pf.holderWhitelistCount !== undefined || pf.holderBlacklistCount !== undefined) {
      const holderStatus = factorStatus.get('holderBlacklistCount');
      const statusIcon = holderStatus === 'pass' ? '✅' : holderStatus === 'fail' ? '❌' : '';
      const holderParts = [];
      if (pf.holderWhitelistCount !== undefined) {
        holderParts.push(`白: \`${pf.holderWhitelistCount}\``);
      }
      if (pf.holderBlacklistCount !== undefined) {
        holderParts.push(`黑: \`${pf.holderBlacklistCount}\``);
      }
      if (pf.devHoldingRatio !== undefined && pf.devHoldingRatio !== null) {
        holderParts.push(`Dev: \`${this.formatPercent(pf.devHoldingRatio)}\``);
      }
      if (pf.maxHoldingRatio !== undefined && pf.maxHoldingRatio !== null) {
        holderParts.push(`最大: \`${this.formatPercent(pf.maxHoldingRatio)}\``);
      }
      if (holderParts.length > 0) {
        message += `👥 ${statusIcon}${holderParts.join(' | ')}\n`;
      }
    }

    // 早期交易（紧凑一行，带状态）
    if (pf.earlyTradesChecked === 1 && pf.earlyTradesCountPerMin !== undefined) {
      const tradeStatus = factorStatus.get('earlyTradesCountPerMin') || factorStatus.get('earlyTradesVolumePerMin');
      const statusIcon = tradeStatus === 'pass' ? '✅' : tradeStatus === 'fail' ? '❌' : '';
      const tradeParts = [];
      if (pf.earlyTradesCountPerMin !== undefined && pf.earlyTradesCountPerMin !== null) {
        tradeParts.push(`笔/分: \`${this.formatNumber(pf.earlyTradesCountPerMin)}\``);
      }
      if (pf.earlyTradesVolumePerMin !== undefined && pf.earlyTradesVolumePerMin !== null) {
        tradeParts.push(`量/分: \`${this.formatNumber(pf.earlyTradesVolumePerMin)}\``);
      }
      if (pf.earlyTradesWalletsPerMin !== undefined && pf.earlyTradesWalletsPerMin !== null) {
        tradeParts.push(`钱包/分: \`${this.formatNumber(pf.earlyTradesWalletsPerMin)}\``);
      }
      if (pf.earlyTradesFinalLiquidity !== undefined && pf.earlyTradesFinalLiquidity !== null) {
        tradeParts.push(`流动性: \`$${this.formatNumber(pf.earlyTradesFinalLiquidity)}\``);
      }
      if (pf.earlyTradesDrawdownFromHighest !== undefined && pf.earlyTradesDrawdownFromHighest !== null) {
        tradeParts.push(`回撤: \`${this.formatPercent(pf.earlyTradesDrawdownFromHighest)}\``);
      }
      if (tradeParts.length > 0) {
        message += `💪 ${statusIcon}${tradeParts.join(' | ')}\n`;
      }
    }

    // 钱包簇（紧凑一行，带状态）
    if (pf.walletClusterCount !== undefined) {
      const clusterStatus = factorStatus.get('walletClusterSecondToFirstRatio') || factorStatus.get('walletClusterMegaRatio');
      const statusIcon = clusterStatus === 'pass' ? '✅' : clusterStatus === 'fail' ? '❌' : '';
      const clusterParts = [];
      if (pf.walletClusterCount !== undefined) {
        clusterParts.push(`簇数: \`${pf.walletClusterCount}\``);
      }
      if (pf.walletClusterSecondToFirstRatio !== undefined && pf.walletClusterSecondToFirstRatio !== null) {
        clusterParts.push(`2/1比: \`${this.formatPercent(pf.walletClusterSecondToFirstRatio)}\``);
      }
      if (pf.walletClusterMegaRatio !== undefined && pf.walletClusterMegaRatio !== null) {
        clusterParts.push(`Mega: \`${this.formatNumber(pf.walletClusterMegaRatio)}\``);
      }
      if (pf.walletClusterTop2Ratio !== undefined && pf.walletClusterTop2Ratio !== null) {
        clusterParts.push(`Top2: \`${this.formatPercent(pf.walletClusterTop2Ratio)}\``);
      }
      if (pf.walletClusterMaxBlockBuyRatio !== undefined && pf.walletClusterMaxBlockBuyRatio !== null) {
        clusterParts.push(`区块买入: \`${this.formatPercent(pf.walletClusterMaxBlockBuyRatio)}\``);
      }
      if (clusterParts.length > 0) {
        message += `🔗 ${statusIcon}${clusterParts.join(' | ')}\n`;
      }
    }

    // Twitter（紧凑一行）
    if (pf.twitterTotalResults !== undefined && pf.twitterTotalResults > 0) {
      const twitterParts = [];
      if (pf.twitterTotalResults !== undefined) {
        twitterParts.push(`结果: \`${pf.twitterTotalResults}\``);
      }
      if (pf.twitterQualityTweets !== undefined) {
        twitterParts.push(`优质: \`${pf.twitterQualityTweets}\``);
      }
      if (pf.twitterTotalEngagement !== undefined) {
        twitterParts.push(`互动: \`${this.formatNumber(pf.twitterTotalEngagement)}\``);
      }
      if (twitterParts.length > 0) {
        message += `🐦 ${twitterParts.join(' | ')}\n`;
      }
    }

    // 强势交易者（紧凑一行，带状态）
    if (pf.strongTraderTradeCount !== undefined && pf.strongTraderTradeCount > 0) {
      const traderStatus = factorStatus.get('strongTraderNetPositionRatio');
      const statusIcon = traderStatus === 'pass' ? '✅' : traderStatus === 'fail' ? '❌' : '';
      const traderParts = [];
      if (pf.strongTraderNetPositionRatio !== undefined && pf.strongTraderNetPositionRatio !== null) {
        traderParts.push(`净持仓: \`${this.formatPercent(pf.strongTraderNetPositionRatio)}\``);
      }
      if (pf.strongTraderWalletCount !== undefined) {
        traderParts.push(`钱包: \`${pf.strongTraderWalletCount}个\``);
      }
      if (pf.strongTraderTradeCount !== undefined) {
        traderParts.push(`交易: \`${pf.strongTraderTradeCount}笔\``);
      }
      if (pf.strongTraderSellIntensity !== undefined && pf.strongTraderSellIntensity !== null) {
        traderParts.push(`卖出强度: \`${this.formatNumber(pf.strongTraderSellIntensity)}\``);
      }
      if (traderParts.length > 0) {
        message += `💎 ${statusIcon}${traderParts.join(' | ')}\n`;
      }
    }

    // 叙事评级（紧凑一行，带状态）
    if (pf.narrativeRating !== undefined && pf.narrativeRating !== 9) {
      const narrativeStatus = factorStatus.get('narrativeRating');
      const statusIcon = narrativeStatus === 'pass' ? '✅' : narrativeStatus === 'fail' ? '❌' : '';
      const ratingLabels = { 1: '低', 2: '中', 3: '高', 9: '未评级' };
      const ratingText = ratingLabels[pf.narrativeRating] || `${pf.narrativeRating}`;
      message += `📖 ${statusIcon}叙事: \`${ratingText}\`\n`;
    }

    // 多次交易因子（紧凑一行）
    if (pf.buyRound !== undefined && pf.buyRound > 1) {
      const tradeParts = [];
      tradeParts.push(`轮次: \`第${pf.buyRound}轮\``);
      if (pf.lastPairReturnRate !== undefined && pf.lastPairReturnRate !== null) {
        tradeParts.push(`上一对: \`${this.formatPercent(pf.lastPairReturnRate)}\``);
      }
      if (tradeParts.length > 0) {
        message += `🔄 ${tradeParts.join(' | ')}\n`;
      }
    }

    // 拒绝原因
    if (!executed) {
      const executionReason = metadata.execution_reason || signal.execution_reason || pr.checkReason || '未知原因';
      message += `🚫 ${executionReason}\n`;
    }

    // 链接
    const gmgnUrl = this.buildGMGNUrl(signal.token_address, signal.chain);
    const expId = signal.experiment_id || metadata.experiment_id;
    const signalsUrl = `${this.webBaseUrl}/experiment/${expId}/signals`;

    message += `🔗 [GMGN](${gmgnUrl}) | [信号](${signalsUrl})`;

    return message;
  }

  /**
   * 构建因子状态映射（用于颜色编码）
   * @param {Array} failedConditions - 失败的条件列表
   * @param {boolean} canBuy - 是否可以购买
   * @returns {Map} 因子名 -> 状态 ('pass' | 'fail' | 'unknown')
   * @private
   */
  _buildFactorStatusMap(failedConditions, canBuy) {
    const statusMap = new Map();

    // 如果可以购买，所有条件都通过
    if (canBuy) {
      for (const condition of failedConditions) {
        if (condition.factorName && !condition.isSubFactor) {
          statusMap.set(condition.factorName, 'pass');
        }
      }
      return statusMap;
    }

    // 如果不能购买，根据failedConditions判断每个因子的状态
    for (const condition of failedConditions) {
      if (condition.isComplex) {
        // 复杂条件：检查其子因子
        continue;
      }

      if (condition.isSubFactor) {
        // 子因子：不设置状态（只有复杂条件才有状态）
        continue;
      }

      if (condition.factorName) {
        // 根据satisfied字段设置状态
        if (condition.satisfied === true) {
          statusMap.set(condition.factorName, 'pass');
        } else if (condition.satisfied === false) {
          statusMap.set(condition.factorName, 'fail');
        } else {
          statusMap.set(condition.factorName, 'unknown');
        }
      }
    }

    return statusMap;
  }

  /**
   * 获取代币发现信息
   */
  async getTokenDiscoveryInfo(tokenAddress, experimentId) {
    if (!this.dbManager) {
      return {};
    }

    try {
      const supabase = this.dbManager.getClient();
      const { data, error } = await supabase
        .from('experiment_tokens')
        .select('discovered_at, raw_api_data')
        .eq('token_address', tokenAddress)
        .eq('experiment_id', experimentId)
        .maybeSingle();

      if (error || !data) {
        return {};
      }

      return {
        discoveredAt: data.discovered_at,
        launchPrice: data.raw_api_data?.launch_price || null
      };
    } catch (error) {
      console.error('获取代币发现信息失败:', error.message);
      return {};
    }
  }

  /**
   * 发送消息到 Telegram（带重试）
   */
  async sendWithRetry(message, maxRetries = 3) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.sendMessage(message);
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          // 指数退避
          const delay = Math.pow(2, attempt) * 1000;
          await this.sleep(delay);
        }
      }
    }
    throw lastError;
  }

  /**
   * 发送消息到 Telegram
   */
  async sendMessage(message) {
    const url = `${this.apiUrl}/sendMessage`;

    const payload = {
      chat_id: this.channelId,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: false
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Telegram API error: ${response.status} - ${errorData.description || response.statusText}`);
    }

    const data = await response.json();

    if (!data.ok) {
      throw new Error(`Telegram API error: ${data.description || 'Unknown error'}`);
    }

    return data.result;
  }

  /**
   * 构建 GMGN 链接
   */
  buildGMGNUrl(token, chain) {
    const chainName = this.getGMGNChainName(chain);
    return `${this.gmgnBaseUrl}/${chainName}/token/${token}`;
  }

  /**
   * 获取GMGN所需的链名称
   */
  getGMGNChainName(chain) {
    const chainMapping = {
      'bsc': 'bsc',
      'binance-smart-chain': 'bsc',
      'eth': 'eth',
      'ethereum': 'eth',
      'solana': 'sol',
      'sol': 'sol',
      'base': 'base',
      'flap': 'bsc', // flap 使用 bsc
      'bankr': 'bsc' // bankr 使用 bsc
    };

    return chainMapping[chain.toLowerCase()] || 'bsc';
  }

  /**
   * 缩短地址显示
   */
  shortenAddress(address) {
    if (!address || address.length < 16) return address;
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  }

  /**
   * 格式化数字显示
   */
  formatNumber(num, maxDecimals = 2) {
    if (num === null || num === undefined || isNaN(num)) {
      return 'N/A';
    }

    if (num === 0) return '0';

    // 对于非常大的数字，使用科学计数法或缩写
    if (num >= 1e9) {
      return (num / 1e9).toFixed(maxDecimals) + 'B';
    } else if (num >= 1e6) {
      return (num / 1e6).toFixed(maxDecimals) + 'M';
    } else if (num >= 1e3) {
      return (num / 1e3).toFixed(maxDecimals) + 'K';
    }

    // 对于小数，根据大小决定显示位数
    if (num < 0.000001) {
      return num.toExponential(2);
    } else if (num < 0.01) {
      return num.toFixed(8);
    } else {
      return num.toFixed(maxDecimals);
    }
  }

  /**
   * 格式化百分比
   */
  formatPercent(value) {
    if (value === null || value === undefined || isNaN(value)) {
      return 'N/A';
    }
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}%`;
  }

  /**
   * 格式化日期为中文格式
   */
  formatDate(date) {
    const d = date instanceof Date ? date : new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * 延迟函数
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 发送统计数据通知
   * @param {string} experimentId - 实验ID
   * @param {string} experimentName - 实验名称
   * @param {Object} stats - 统计数据
   * @param {string} mode - 引擎模式
   */
  async sendStatsNotification(experimentId, experimentName, stats, mode) {
    if (!this.enabled) return;

    try {
      const message = this.formatStatsMessage(experimentId, experimentName, stats, mode);
      await this.sendWithRetry(message);
      console.log(`📱 统计通知发送成功: ${experimentName}`);
    } catch (error) {
      console.error(`📱 统计通知发送失败:`, error.message);
    }
  }

  /**
   * 格式化统计通知消息
   */
  formatStatsMessage(experimentId, experimentName, stats, mode) {
    const modeEmoji = mode === 'live' ? '🔴' : mode === 'backtest' ? '📊' : '🟢';
    const modeText = mode === 'live' ? '实盘' : mode === 'backtest' ? '回测' : '虚拟';

    // 处理实验名称为空的情况
    const displayName = experimentName || `实验 ${experimentId ? experimentId.substring(0, 8) : ''}`;

    // 处理计算时间为空的情况
    const calculatedAt = stats.calculatedAt || new Date().toISOString();

    let message = `${modeEmoji} *实验统计报告*

📊 *${displayName}* (${modeText})

━━━━━━━━━━━━━━━

💰 *收益统计:*
  • 交易代币: \`${stats.tokenCount || 0}\`个
  • 盈利代币: \`${stats.profitCount || 0}\`个
  • 亏损代币: \`${stats.lossCount || 0}\`个
  • 胜率: \`${(stats.winRate || 0).toFixed(1)}%\`
  • 总收益率: \`${(stats.totalReturn || 0).toFixed(2)}%\`

💵 *资金变化:*
  • BNB变化: \`${(stats.bnbChange || 0).toFixed(4)}\`
  • 总花费: \`${(stats.totalSpent || 0).toFixed(4)}\`
  • 总收入: \`${(stats.totalReceived || 0).toFixed(4)}\`

🔗 *查看详情:*
  [📋 实验页面](${this.webBaseUrl}/experiment/${experimentId})

🕐 计算时间: \`${this.formatDate(calculatedAt)}\`
`;

    return message;
  }

  /**
   * 测试连接
   */
  async testConnection() {
    try {
      const testMessage = `🧪 *Telegram 连接测试*

✅ Bot Token 配置正确
✅ Channel ID 配置正确
🕐 测试时间: ${this.formatDate(new Date())}

如果看到此消息，说明通知系统工作正常！`;

      await this.sendMessage(testMessage);
      console.log('📱 Telegram 连接测试成功');
      return true;

    } catch (error) {
      console.error('📱 Telegram 连接测试失败:', error.message);
      throw error;
    }
  }
}

module.exports = TelegramNotifier;
