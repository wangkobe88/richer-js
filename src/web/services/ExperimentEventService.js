/**
 * 实验事件写入服务
 * 将实验引擎产生的重要事件写入 experiment_events 表
 * 叙事数据不再嵌入事件，由 /api/events 动态查询 token_narrative 表获取
 */

const { dbManager } = require('../../services/dbManager');

class ExperimentEventService {
  constructor() {
    this._supabase = null;
    this._webBaseUrl = process.env.WEB_BASE_URL || 'http://localhost:3010';
    this._gmgnBaseUrl = 'https://gmgn.ai';
  }

  /**
   * 获取 Supabase 客户端
   */
  _getSupabase() {
    if (!this._supabase) {
      this._supabase = dbManager.getClient();
    }
    return this._supabase;
  }

  /**
   * 写入事件
   * @param {Object} signal - 完整信号数据（来自 strategy_signals 表）
   * @param {Object} experimentInfo - 实验信息 { id, mode, name }
   */
  async createEvent(signal, experimentInfo) {
    try {
      const metadata = signal.metadata || {};
      const tf = metadata.trendFactors || {};
      const rf = metadata.regularFactors || {};
      const action = signal.action || 'unknown';
      const executed = signal.executed === true;

      // 构建 summary 和 details（不含叙事数据）
      let summary = {};
      let details = {};

      if (action === 'buy') {
        const buySignalIndex = await this._getBuySignalIndex(signal);
        const result = this._buildBuyEventData(signal, metadata, tf, rf, buySignalIndex, experimentInfo);
        summary = result.summary;
        details = result.details;
      } else {
        const result = this._buildSellEventData(signal, metadata, tf, rf, experimentInfo);
        summary = result.summary;
        details = result.details;
      }

      // 写入数据库
      const supabase = this._getSupabase();
      const { error } = await supabase
        .from('experiment_events')
        .insert({
          experiment_id: experimentInfo.id,
          experiment_name: experimentInfo.name || null,
          experiment_mode: experimentInfo.mode || null,
          token_address: signal.token_address,
          token_symbol: signal.token_symbol || null,
          action,
          executed,
          chain: signal.chain || 'bsc',
          summary,
          details
        });

      if (error) {
        console.error(`[EventService] 写入事件失败:`, error.message);
      }
    } catch (err) {
      console.error(`[EventService] 创建事件异常:`, err.message);
    }
  }

  /**
   * 构建买入事件数据（不含叙事数据）
   * @private
   */
  _buildBuyEventData(signal, metadata, tf, rf, buySignalIndex, experimentInfo) {
    const fdv = rf.fdv ?? tf.fdv ?? null;

    const summary = {};
    if (buySignalIndex != null) summary.signalIndex = buySignalIndex;
    if (fdv != null) summary.marketCap = fdv;
    if (tf.earlyReturn != null) summary.earlyReturn = tf.earlyReturn;

    const details = {};

    // 拒绝原因
    if (!signal.executed) {
      const pr = metadata.preBuyCheckResult || {};
      const executionReason = metadata.execution_reason || signal.execution_reason
        || pr.reason || pr.checkReason || null;
      if (executionReason) details.executionReason = executionReason;
    }

    // 链接
    details.gmgnUrl = this._buildGMGNUrl(signal.token_address, signal.chain);
    const expId = signal.experiment_id || metadata.experiment_id || experimentInfo.id;
    details.signalsUrl = `${this._webBaseUrl}/experiment/${expId}/signals`;

    return { summary, details };
  }

  /**
   * 构建卖出事件数据
   * @private
   */
  _buildSellEventData(signal, metadata, tf, rf, experimentInfo) {
    const fdv = rf.fdv ?? tf.fdv ?? null;

    const summary = {};
    if (fdv != null) summary.marketCap = fdv;

    // 收益数据
    if (tf.profitPercent != null) summary.profitPercent = tf.profitPercent;
    if (tf.earlyReturn != null) summary.earlyReturn = tf.earlyReturn;
    if (tf.holdDuration != null) summary.holdDuration = tf.holdDuration;
    if (metadata.cards) summary.cards = metadata.cards === 'all' ? 'all' : metadata.cards;

    const details = {};
    if (tf.buyPrice != null) details.buyPrice = tf.buyPrice;
    if (tf.currentPrice != null) details.sellPrice = tf.currentPrice;
    if (tf.highestPrice != null) details.highestPrice = tf.highestPrice;
    if (tf.drawdownFromHighest != null) details.drawdownFromHighest = tf.drawdownFromHighest;

    if (!signal.executed) {
      const executionReason = metadata.execution_reason || null;
      if (executionReason) details.executionReason = executionReason;
    }

    details.gmgnUrl = this._buildGMGNUrl(signal.token_address, signal.chain);
    const expId = signal.experiment_id || metadata.experiment_id || experimentInfo.id;
    details.signalsUrl = `${this._webBaseUrl}/experiment/${expId}/signals`;

    return { summary, details };
  }

  /**
   * 获取买入信号序号
   * @private
   */
  async _getBuySignalIndex(signal) {
    try {
      const supabase = this._getSupabase();
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
   * 构建 GMGN 链接
   * @private
   */
  _buildGMGNUrl(token, chain) {
    const chainMapping = {
      'bsc': 'bsc', 'binance-smart-chain': 'bsc',
      'eth': 'eth', 'ethereum': 'eth',
      'solana': 'sol', 'sol': 'sol',
      'base': 'base',
      'flap': 'bsc', 'bankr': 'bsc'
    };
    const chainName = chainMapping[(chain || 'bsc').toLowerCase()] || 'bsc';
    return `${this._gmgnBaseUrl}/${chainName}/token/${token}`;
  }
}

module.exports = ExperimentEventService;
