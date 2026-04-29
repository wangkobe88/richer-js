/**
 * GMGN 代币安全检测服务
 * 调用 GMGN OpenAPI 获取代币安全审计数据，提取为预检查因子
 *
 * 策略：
 *   - 每次信号都调用 API 获取最新数据（安全检测只会收严，用最新数据判断）
 *   - 10s 内存缓存避免同一评估周期内重复调用
 *   - 原始 API 数据通过 _rawSecurity / _rawInfo 透传，由上层存入 strategy_signals 表
 *
 * 因子列表：
 *   gmgnSecurityAvailable   - 数据是否可用 (0/1)
 *   gmgnIsHoneypot          - 是否蜜罐 (true/false)
 *   gmgnIsOpenSource        - 合约是否开源 (true/false)
 *   gmgnIsRenounced         - 是否放弃合约权限 (true/false)
 *   gmgnHasBlacklist        - 是否有黑名单功能 (-1=未知/0=无/1=有)
 *   gmgnBuyTax              - 买入税率 (0~1)
 *   gmgnSellTax             - 卖出税率 (0~1)
 *   gmgnTop10HolderRate     - Top10 持仓占比 (0~1)
 *   gmgnHasAlert            - GMGN 是否标记风险警报 (true/false)
 *   gmgnPrivilegeCount      - 特权函数数量
 *   gmgnLpLocked            - LP 是否锁仓 (true/false)
 *   gmgnLpLockPercent       - LP 锁仓比例 (0~1)
 *   gmgnHolderCount         - 持有人数
 *   gmgnLiquidity           - 流动性 (USD)
 *   社交信息因子：
 *   hasTwitter / hasTelegram / hasWebsite / hasDiscord - 是否有社交链接
 *   socialLinkCount         - 社交链接总数 (0-4)
 *   hasAnySocial            - 是否有任何社交链接
 *   stat 市场统计因子：
 *   gmgnMarketCap           - 市值
 *   gmgnFdv                 - 完全稀释估值
 *   gmgnVolume24h / gmgnVolume7d - 24h/7d 交易量
 *   gmgnPriceChange24h      - 24h 涨幅 (%)
 *   gmgnAth                 - 历史最高价
 *   wallet_tags_stat 钱包标签因子：
 *   gmgnSmartMoneyCount/Percent - Smart Money 数量/占比
 *   gmgnSniperCount/Percent     - Sniper 数量/占比
 *   gmgnBotCount/Percent        - Bot 数量/占比
 *   gmgnRetailCount/Percent     - 散户数量/占比
 */

const { GMGNTokenAPI } = require('../../core/gmgn-api');

class GMGNSecurityService {
  /**
   * @param {Object} [supabase] - 已废弃，保留参数兼容性
   * @param {Object} [logger] - Logger 实例（用于文件日志）
   */
  constructor(supabase = null, logger = null) {
    this._logger = logger;
    this._api = null;
    this._cache = new Map();
    this._cacheTTL = 10000; // 10s 内存缓存
  }

  /**
   * 获取 GMGN API 实例（延迟初始化）
   * @private
   */
  _getApi() {
    if (!this._api) {
      const apiKey = process.env.GMGN_API_KEY;
      if (!apiKey) return null;
      const opts = { apiKey };
      const socksProxy = process.env.GMGN_SOCKS_PROXY;
      if (socksProxy) opts.socksProxy = socksProxy;
      this._api = new GMGNTokenAPI(opts);
    }
    return this._api;
  }

  /**
   * 执行代币安全检测
   * 每次都调用 API 获取最新数据，10s 内存缓存防重复
   * @param {string} tokenAddress - 代币地址
   * @param {string} chain - 链标识 (eth/bsc/sol/base)
   * @returns {Promise<Object>} 安全检测因子 + 原始 API 数据
   */
  async performSecurityCheck(tokenAddress, chain) {
    const gmgnChain = this._normalizeChain(chain);
    const api = this._getApi();
    if (!api) {
      this._log('warn', 'GMGN安全检测: API未初始化（缺少GMGN_API_KEY），返回空值', { token: tokenAddress?.slice(0, 10) + '...' });
      return this.getEmptyFactorValues();
    }

    // 1. 检查内存缓存（10s TTL）
    const cacheKey = `${tokenAddress}-${gmgnChain}`;
    const cached = this._getCached(cacheKey);
    if (cached) {
      this._log('info', 'GMGN安全检测: 使用内存缓存', { token: tokenAddress?.slice(0, 10) + '...' });
      return cached;
    }

    try {
      this._log('info', 'GMGN安全检测: 调用API获取实时数据', { token: tokenAddress?.slice(0, 10) + '...', chain: gmgnChain });

      // 2. 获取 security 数据
      let security = null;
      try {
        security = await api.getTokenSecurity(gmgnChain, tokenAddress);
      } catch (secErr) {
        this._log('warn', 'GMGN安全检测: getTokenSecurity失败', { token: tokenAddress?.slice(0, 10) + '...', error: secErr.message });
      }

      // 3. 获取 info 数据
      await new Promise(resolve => setTimeout(resolve, 500));
      let info = null;
      try {
        info = await api.getTokenInfo(gmgnChain, tokenAddress);
      } catch (infoErr) {
        this._log('warn', 'GMGN安全检测: getTokenInfo失败，使用部分数据', { token: tokenAddress?.slice(0, 10) + '...', error: infoErr.message });
      }

      // 4. 提取因子
      const factors = this._extractFactors(security, info);

      // 5. 附加原始 API 数据，供上层存入 strategy_signals 表
      const result = {
        ...factors,
        _rawSecurity: security,
        _rawInfo: info
      };

      this._log('info', 'GMGN安全检测: 完成', {
        token: tokenAddress?.slice(0, 10) + '...',
        chain: gmgnChain,
        gmgnSecurityAvailable: factors.gmgnSecurityAvailable,
        gmgnIsHoneypot: factors.gmgnIsHoneypot,
        gmgnSellTax: factors.gmgnSellTax,
        gmgnHasAlert: factors.gmgnHasAlert,
        gmgnTop10HolderRate: factors.gmgnTop10HolderRate
      });

      // 6. 写入内存缓存
      this._setCache(cacheKey, result);
      return result;
    } catch (err) {
      this._log('warn', 'GMGN安全检测: API调用失败', { token: tokenAddress?.slice(0, 10) + '...', error: err.message });
      return this.getEmptyFactorValues();
    }
  }

  /**
   * 日志输出（优先使用 logger 写文件日志，fallback 到 console）
   * @private
   */
  _log(level, message, data = {}) {
    if (this._logger && typeof this._logger[level] === 'function') {
      this._logger[level](`[GMGNSecurity] ${message}`, data);
    } else {
      const fn = level === 'warn' || level === 'error' ? console.warn : console.log;
      fn(`[GMGNSecurity] ${message}`, Object.keys(data).length > 0 ? JSON.stringify(data) : '');
    }
  }

  /**
   * 将链名转换为 GMGN API 格式
   * ethereum -> eth, solana -> sol, 其余不变
   * @private
   */
  _normalizeChain(chain) {
    const map = { ethereum: 'eth', solana: 'sol' };
    return map[chain] || chain;
  }

  /**
   * 从 API 返回数据中提取因子
   * @private
   */
  _extractFactors(security, info) {
    const sec = security || {};
    const inf = info || {};
    const lockSummary = sec.lock_summary || {};
    const privileges = sec.privileges;

    // 社交信息提取
    const link = inf.link || {};
    const hasTwitter = !!(link.twitter_username);
    const hasTelegram = !!(link.telegram);
    const hasWebsite = !!(link.website);
    const hasDiscord = !!(link.discord);
    const socialLinkCount = [hasTwitter, hasTelegram, hasWebsite, hasDiscord].filter(Boolean).length;

    // stat 统计数据提取
    const stat = inf.stat || {};
    // wallet_tags_stat 钱包标签统计提取
    const walletTags = inf.wallet_tags_stat || {};

    return {
      gmgnSecurityAvailable: 1,
      gmgnIsHoneypot: sec.is_honeypot === true,
      gmgnIsOpenSource: sec.is_open_source === true,
      gmgnIsRenounced: sec.is_renounced === true,
      gmgnHasBlacklist: sec.blacklist === 1 ? 1 : (sec.blacklist === -1 ? -1 : 0),
      gmgnBuyTax: this._parseTax(sec.buy_tax),
      gmgnSellTax: this._parseTax(sec.sell_tax),
      gmgnTop10HolderRate: this._parseTax(sec.top_10_holder_rate),
      gmgnHasAlert: sec.is_show_alert === true,
      gmgnPrivilegeCount: Array.isArray(privileges) ? privileges.length : 0,
      gmgnLpLocked: lockSummary.is_locked === true,
      gmgnLpLockPercent: this._parseTax(lockSummary.lock_percent),
      gmgnHolderCount: inf.holder_count || 0,
      gmgnLiquidity: parseFloat(inf.liquidity) || 0,
      // 社交信息因子
      hasTwitter,
      hasTelegram,
      hasWebsite,
      hasDiscord,
      socialLinkCount,
      hasAnySocial: socialLinkCount > 0,
      // stat 市场统计因子
      gmgnMarketCap: parseFloat(stat.market_cap) || 0,
      gmgnFdv: parseFloat(stat.fdv) || 0,
      gmgnVolume24h: parseFloat(stat.volume_24h) || 0,
      gmgnVolume7d: parseFloat(stat.volume_7d) || 0,
      gmgnPriceChange24h: parseFloat(stat.price_change_24h) || 0,
      gmgnAth: parseFloat(stat.ath) || 0,
      // wallet_tags_stat 钱包标签因子
      gmgnSmartMoneyCount: parseInt(walletTags.smart_money_count) || 0,
      gmgnSmartMoneyPercent: this._parseTax(walletTags.smart_money_percent),
      gmgnSniperCount: parseInt(walletTags.sniper_count) || 0,
      gmgnSniperPercent: this._parseTax(walletTags.sniper_percent),
      gmgnBotCount: parseInt(walletTags.bot_count) || 0,
      gmgnBotPercent: this._parseTax(walletTags.bot_percent),
      gmgnRetailCount: parseInt(walletTags.retail_count) || 0,
      gmgnRetailPercent: this._parseTax(walletTags.retail_percent),
    };
  }

  /**
   * 解析税率/比例字段
   * @private
   */
  _parseTax(val) {
    if (val == null || val === '') return 0;
    const num = parseFloat(val);
    return isNaN(num) ? 0 : num;
  }

  /**
   * 获取空因子默认值
   */
  getEmptyFactorValues() {
    return {
      gmgnSecurityAvailable: 0,
      gmgnIsHoneypot: false,
      gmgnIsOpenSource: false,
      gmgnIsRenounced: false,
      gmgnHasBlacklist: -1,
      gmgnBuyTax: 0,
      gmgnSellTax: 0,
      gmgnTop10HolderRate: 0,
      gmgnHasAlert: false,
      gmgnPrivilegeCount: 0,
      gmgnLpLocked: false,
      gmgnLpLockPercent: 0,
      gmgnHolderCount: 0,
      gmgnLiquidity: 0,
      // 社交信息因子
      hasTwitter: false,
      hasTelegram: false,
      hasWebsite: false,
      hasDiscord: false,
      socialLinkCount: 0,
      hasAnySocial: false,
      // stat 市场统计因子
      gmgnMarketCap: 0,
      gmgnFdv: 0,
      gmgnVolume24h: 0,
      gmgnVolume7d: 0,
      gmgnPriceChange24h: 0,
      gmgnAth: 0,
      // wallet_tags_stat 钱包标签因子
      gmgnSmartMoneyCount: 0,
      gmgnSmartMoneyPercent: 0,
      gmgnSniperCount: 0,
      gmgnSniperPercent: 0,
      gmgnBotCount: 0,
      gmgnBotPercent: 0,
      gmgnRetailCount: 0,
      gmgnRetailPercent: 0,
    };
  }

  /**
   * 缓存读取
   * @private
   */
  _getCached(key) {
    const entry = this._cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > this._cacheTTL) {
      this._cache.delete(key);
      return null;
    }
    return entry.data;
  }

  /**
   * 缓存写入
   * @private
   */
  _setCache(key, data) {
    this._cache.set(key, { data, ts: Date.now() });
  }
}

module.exports = GMGNSecurityService;
