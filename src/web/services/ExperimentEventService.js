/**
 * 实验事件写入服务
 * 将实验引擎产生的重要事件写入 experiment_events 表，替代 Telegram 通知
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

      // 获取叙事分析数据
      const narrativeInfo = await this._getNarrativeInfo(signal.token_address);

      // 构建 summary 和 details
      let summary = {};
      let details = {};

      if (action === 'buy') {
        const buySignalIndex = await this._getBuySignalIndex(signal);
        const result = await this._buildBuyEventData(signal, metadata, tf, rf, narrativeInfo, buySignalIndex, experimentInfo);
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
   * 构建买入事件数据
   * @private
   */
  async _buildBuyEventData(signal, metadata, tf, rf, narrativeInfo, buySignalIndex, experimentInfo) {
    const fdv = rf.fdv ?? tf.fdv ?? null;

    // 摘要（数字/布尔，便于筛选和展示）
    const summary = {};

    if (buySignalIndex != null) summary.signalIndex = buySignalIndex;
    if (fdv != null) summary.marketCap = fdv;
    if (tf.earlyReturn != null) summary.earlyReturn = tf.earlyReturn;

    // 叙事评级
    if (narrativeInfo) {
      const ns = narrativeInfo.summary || {};
      if (ns.rating) summary.narrativeRating = ns.rating;
      if (ns.numericRating != null) summary.narrativeNumericRating = ns.numericRating;
      if (ns.score != null) summary.narrativeScore = ns.score;
    }

    // 详情（文本/结构化）
    const details = {};

    if (narrativeInfo) {
      const ns = narrativeInfo.summary || {};
      if (ns.reason) details.narrativeReason = ns.reason;

      // 各阶段摘要
      const stageSummaries = {};
      const stageOrder = ['preCheck', 'prestage', 'stage1', 'stage2', 'stage3'];
      for (const stageName of stageOrder) {
        const stage = narrativeInfo[stageName];
        if (stage) {
          const stageEntry = {
            pass: stage.pass,
            score: stage.score ?? null,
            category: stage.category || null,
            reason: stage.reason || null
          };
          // preCheck 阶段携带 details（同名代币、语料复用等具体信息）
          if (stageName === 'preCheck' && stage.details) {
            stageEntry.details = stage.details;
          }
          stageSummaries[stageName] = stageEntry;
        }
      }
      if (Object.keys(stageSummaries).length > 0) {
        details.stageSummaries = stageSummaries;
      }
    }

    // 拒绝原因
    if (!signal.executed) {
      const pr = metadata.preBuyCheckResult || {};
      const executionReason = metadata.execution_reason || signal.execution_reason
        || pr.reason || pr.checkReason || null;
      if (executionReason) details.executionReason = executionReason;
    }

    // 语料来源（classified_urls）
    if (narrativeInfo?._classifiedUrls) {
      const classifiedUrls = narrativeInfo._classifiedUrls;
      const sourceUrls = {};

      // 收集各类来源URL
      for (const [platform, urls] of Object.entries(classifiedUrls)) {
        if (Array.isArray(urls) && urls.length > 0) {
          sourceUrls[platform] = urls.map(u => ({ url: u.url, type: u.type }));
        }
      }

      if (Object.keys(sourceUrls).length > 0) {
        details.sourceUrls = sourceUrls;
      }

      // 获取推文内容
      const tweetUrls = (classifiedUrls.twitter || [])
        .filter(u => u.type === 'tweet')
        .map(u => u.url);

      if (tweetUrls.length > 0) {
        const tweetContents = await this._fetchTweetContents(tweetUrls);
        if (tweetContents.length > 0) {
          details.tweetContents = tweetContents;
        }
      }
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

    // 收益数据（从 trendFactors 中读取）
    if (tf.profitPercent != null) summary.profitPercent = tf.profitPercent;
    if (tf.earlyReturn != null) summary.earlyReturn = tf.earlyReturn;
    if (tf.holdDuration != null) summary.holdDuration = tf.holdDuration;
    if (metadata.cards) summary.cards = metadata.cards === 'all' ? 'all' : metadata.cards;

    const details = {};
    // 价格详情
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
   * 获取叙事分析信息（包含 classified_urls）
   * @private
   */
  async _getNarrativeInfo(tokenAddress) {
    try {
      const supabase = this._getSupabase();
      const { data, error } = await supabase
        .from('token_narrative')
        .select('pre_check_result, prestage_result, stage1_result, stage2_result, stage3_result, stage_final_result, analyzed_at, classified_urls')
        .eq('token_address', tokenAddress.toLowerCase())
        .order('analyzed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) return null;

      const { NarrativeAnalyzer } = await import('../../narrative/analyzer/NarrativeAnalyzer.mjs');
      const result = NarrativeAnalyzer.buildLLMAnalysis(data);
      // 附加 classified_urls
      result._classifiedUrls = data.classified_urls || null;
      return result;
    } catch (err) {
      console.error('[EventService] 获取叙事信息失败:', err.message);
      return null;
    }
  }

  /**
   * 获取推文内容
   * @private
   */
  async _fetchTweetContents(urls) {
    try {
      const supabase = this._getSupabase();
      const { data, error } = await supabase
        .from('external_resource_cache')
        .select('url, content')
        .in('url', urls);

      if (error || !data) return [];

      return data
        .filter(d => d.content && (d.content.text || d.content.full_text))
        .map(d => ({
          url: d.url,
          text: (d.content.text || d.content.full_text || '').substring(0, 500),
          author: d.content.author_name || d.content.author_screen_name || null,
          authorFollowers: d.content.author_followers_count || null
        }));
    } catch (err) {
      return [];
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
