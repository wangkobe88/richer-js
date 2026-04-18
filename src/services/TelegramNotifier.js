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

      let message;
      if (signal.action === 'buy') {
        // 买入信号：获取叙事分析数据和信号序号
        const narrativeInfo = await this.getNarrativeInfo(signal.token_address);
        const buySignalIndex = await this._getBuySignalIndex(signal);
        message = this.formatBuySignalMessage(signal, tokenInfo, narrativeInfo, experimentInfo, buySignalIndex);
      } else {
        // 卖出信号：仅持仓/收益
        message = this.formatSellSignalMessage(signal, tokenInfo, experimentInfo);
      }

      // 发送消息（带重试）
      await this.sendWithRetry(message);

      console.log(`📱 Telegram通知发送成功: ${signal.token_symbol} ${signal.action}`);

    } catch (error) {
      console.error(`📱 Telegram通知发送失败:`, error.message);
      // 不抛出错误，避免影响交易流程
    }
  }

  /**
   * 获取该代币在当前实验中的买入信号序号
   * @private
   */
  async _getBuySignalIndex(signal) {
    if (!this.dbManager) return null;
    try {
      const supabase = this.dbManager.getClient();
      const { count, error } = await supabase
        .from('strategy_signals')
        .select('*', { count: 'exact', head: true })
        .eq('token_address', signal.token_address)
        .eq('experiment_id', signal.experiment_id)
        .eq('action', 'buy')
        .lte('created_at', signal.created_at);
      if (error || count == null) return null;
      return count;
    } catch {
      return null;
    }
  }

  /**
   * 格式化买入信号通知消息（叙事分析内容）
   */
  formatBuySignalMessage(signal, tokenInfo, narrativeInfo, experimentInfo, buySignalIndex) {
    const metadata = signal.metadata || {};
    const tf = metadata.trendFactors || {};
    const executed = signal.executed === true;
    const executionStatus = executed ? '✅已执行' : '🚫被拒绝';
    const tokenSymbol = signal.token_symbol || 'UNKNOWN';
    const shortAddress = this.shortenAddress(signal.token_address);

    // 头部（含信号序号）
    const indexStr = buySignalIndex ? `#${buySignalIndex} ` : '';
    let message = `――――――――――――――\n🟢 买入 ${indexStr}【${executionStatus}】 | *${tokenSymbol}* | \`${shortAddress}\` | ${(signal.chain || 'bsc').toUpperCase()}\n\n`;

    // 市值信息（紧凑一行）
    const priceParts = [];
    const rf = metadata.regularFactors || {};
    const fdv = rf.fdv ?? tf.fdv ?? null;
    if (fdv != null) {
      priceParts.push(`市值: \`${this.formatNumber(fdv, 1)}\``);
    }
    if (tf.earlyReturn != null) {
      priceParts.push(`涨幅: \`${this.formatPercent(tf.earlyReturn)}\``);
    }
    if (priceParts.length > 0) {
      message += `💵 ${priceParts.join(' | ')}\n`;
    }

    // === 叙事分析核心内容 ===
    if (narrativeInfo) {
      const summary = narrativeInfo.summary || {};

      // 评级行
      const ratingLabels = { high: '高质量', mid: '中等', low: '低质量', unrated: '未评级' };
      const ratingEmojis = { high: '🚀', mid: '📊', low: '📉', unrated: '❓' };
      const ratingLabel = ratingLabels[summary.rating] || '未知';
      const ratingEmoji = ratingEmojis[summary.rating] || '❓';
      const scoreStr = summary.score != null
        ? ` | 分数: \`${summary.score.toFixed(1)}\``
        : '';

      message += `\n${ratingEmoji} *叙事评级: ${ratingLabel}*${scoreStr}\n`;

      // 综合原因（截取前300字）
      if (summary.reason) {
        const truncatedReason = summary.reason.length > 300
          ? summary.reason.substring(0, 300) + '...'
          : summary.reason;
        message += `${truncatedReason}\n`;
      }

      // 各阶段摘要
      const stageOrder = ['prestage', 'stage1', 'stage2', 'stage3'];
      const stageLabels = {
        prestage: '预处理',
        stage1: '事件分析',
        stage2: '关联性',
        stage3: '质量评估'
      };

      for (const stageName of stageOrder) {
        const stage = narrativeInfo[stageName];
        if (!stage) continue;

        const label = stageLabels[stageName];
        const passIcon = stage.pass === true ? '✅' : stage.pass === false ? '❌' : '⚪';
        const scorePart = stage.score != null ? ` \`${stage.score.toFixed(1)}\`` : '';
        const catPart = stage.category ? ` [${stage.category}]` : '';
        message += `${passIcon} ${label}${catPart}${scorePart}\n`;

        if (stage.reason) {
          const shortReason = stage.reason.length > 120
            ? stage.reason.substring(0, 120) + '...'
            : stage.reason;
          message += `   ${shortReason}\n`;
        }
      }
    } else {
      message += `\n❓ 无叙事分析数据\n`;
    }

    // 拒绝原因（仅被拒绝时显示）
    if (!executed) {
      const pr = metadata.preBuyCheckResult || {};
      const executionReason = metadata.execution_reason || signal.execution_reason
        || pr.reason || pr.checkReason || '未知原因';
      message += `\n🚫 ${executionReason}\n`;
    }

    // 链接
    const gmgnUrl = this.buildGMGNUrl(signal.token_address, signal.chain);
    const expId = signal.experiment_id || metadata.experiment_id;
    const signalsUrl = `${this.webBaseUrl}/experiment/${expId}/signals`;
    message += `\n🔗 [GMGN](${gmgnUrl}) | [信号](${signalsUrl})`;

    return message;
  }

  /**
   * 格式化卖出信号通知消息（持仓/收益信息）
   */
  formatSellSignalMessage(signal, tokenInfo, experimentInfo) {
    const metadata = signal.metadata || {};
    const executed = signal.executed === true;
    const executionStatus = executed ? '✅已执行' : '🚫被拒绝';
    const tokenSymbol = signal.token_symbol || 'UNKNOWN';
    const shortAddress = this.shortenAddress(signal.token_address);
    const tf = metadata.trendFactors || {};

    // 头部
    let message = `――――――――――――――\n🔴 卖出【${executionStatus}】 | *${tokenSymbol}* | \`${shortAddress}\` | ${(signal.chain || 'bsc').toUpperCase()}\n\n`;

    // === 持仓/收益信息 ===
    const holdingParts = [];
    const rf = metadata.regularFactors || {};

    if (rf.fdv != null || tf.fdv != null) {
      holdingParts.push(`市值: \`${this.formatNumber(rf.fdv ?? tf.fdv, 1)}\``);
    }

    if (metadata.profitPercent != null) {
      const profitIcon = metadata.profitPercent >= 0 ? '📈' : '📉';
      holdingParts.push(`利润: ${profitIcon}\`${this.formatPercent(metadata.profitPercent)}\``);
    }

    if (metadata.holdDuration != null) {
      const durationMinutes = Math.floor(metadata.holdDuration / 60000);
      const durationHours = Math.floor(durationMinutes / 60);
      if (durationHours > 0) {
        holdingParts.push(`持仓: \`${durationHours}时${durationMinutes % 60}分\``);
      } else {
        holdingParts.push(`持仓: \`${durationMinutes}分\``);
      }
    }

    if (metadata.cards) {
      const cardsText = metadata.cards === 'all' ? '全部' : `${metadata.cards}卡`;
      holdingParts.push(`卖出: \`${cardsText}\``);
    }

    if (holdingParts.length > 0) {
      message += `💰 ${holdingParts.join(' | ')}\n`;
    }

    // 拒绝原因
    if (!executed) {
      const executionReason = metadata.execution_reason || '未知原因';
      message += `🚫 ${executionReason}\n`;
    }

    // 链接
    const gmgnUrl = this.buildGMGNUrl(signal.token_address, signal.chain);
    const expId = signal.experiment_id || metadata.experiment_id;
    const signalsUrl = `${this.webBaseUrl}/experiment/${expId}/signals`;
    message += `\n🔗 [GMGN](${gmgnUrl}) | [信号](${signalsUrl})`;

    return message;
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
   * 获取叙事分析信息（完整结构化数据）
   * @param {string} tokenAddress - 代币地址
   * @returns {Object|null} 叙事分析结果
   */
  async getNarrativeInfo(tokenAddress) {
    if (!this.dbManager) {
      return null;
    }

    try {
      const supabase = this.dbManager.getClient();
      const { data, error } = await supabase
        .from('token_narrative')
        .select('pre_check_result, prestage_result, stage1_result, stage2_result, stage3_result, stage_final_result, analyzed_at')
        .eq('token_address', tokenAddress.toLowerCase())
        .order('analyzed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      // 使用 NarrativeAnalyzer.buildLLMAnalysis 统一解析，与实验引擎/前端保持一致
      const { NarrativeAnalyzer } = await import('../narrative/analyzer/NarrativeAnalyzer.mjs');
      return NarrativeAnalyzer.buildLLMAnalysis(data);
    } catch (error) {
      console.error('获取叙事信息失败:', error.message);
      return null;
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
      disable_web_page_preview: true
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
