/**
 * GMGN 代币安全检测服务
 * 调用 GMGN OpenAPI 获取代币安全审计数据，提取为预检查因子
 *
 * 缓存策略：
 *   1. 内存缓存（30s TTL）- 避免同一会话内重复请求
 *   2. 数据库缓存（contract_security_raw_data 字段）- 合约安全数据基本不变，持久化避免跨实验重复请求
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
 */

const { GMGNTokenAPI } = require('../../core/gmgn-api');

class GMGNSecurityService {
  /**
   * @param {Object} [supabase] - Supabase 客户端实例（用于 DB 缓存读写）
   * @param {Object} [logger] - Logger 实例（用于文件日志）
   */
  constructor(supabase = null, logger = null) {
    this._supabase = supabase;
    this._logger = logger;
    this._api = null;
    this._cache = new Map();
    this._cacheTTL = 30000; // 30秒内存缓存
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
   * 优先从 DB 缓存读取，无数据时调用 API 并写入 DB
   * @param {string} tokenAddress - 代币地址
   * @param {string} chain - 链标识 (eth/bsc/sol/base)
   * @returns {Promise<Object>} 安全检测因子
   */
  async performSecurityCheck(tokenAddress, chain) {
    // GMGN API 使用短链名: ethereum->eth, solana->sol
    const gmgnChain = this._normalizeChain(chain);
    const cacheKey = `${gmgnChain}:${tokenAddress}`;
    const cached = this._getCached(cacheKey);
    if (cached) {
      this._log('info', 'GMGN安全检测: 使用内存缓存', { token: tokenAddress?.slice(0, 10) + '...', chain: gmgnChain });
      return cached;
    }

    // 1. 尝试从 DB 缓存读取
    const dbData = await this._loadFromDB(tokenAddress, gmgnChain);
    if (dbData) {
      this._log('info', 'GMGN安全检测: 使用DB缓存', { token: tokenAddress?.slice(0, 10) + '...', chain: gmgnChain });
      const result = this._extractFactors(dbData.security, dbData.info);
      this._setCache(cacheKey, result);
      return result;
    }

    // 2. DB 无数据，调用 API
    const api = this._getApi();
    if (!api) {
      this._log('warn', 'GMGN安全检测: API未初始化（缺少GMGN_API_KEY），返回空值', { token: tokenAddress?.slice(0, 10) + '...' });
      return this.getEmptyFactorValues();
    }

    try {
      this._log('info', 'GMGN安全检测: 调用API', { token: tokenAddress?.slice(0, 10) + '...', chain: gmgnChain, hasProxy: !!process.env.GMGN_SOCKS_PROXY });

      // 顺序调用，避免并行请求触发频率限制
      const security = await api.getTokenSecurity(gmgnChain, tokenAddress);

      // [暂不用] getTokenInfo 只提供 holderCount 和 liquidity，当前条件表达式未使用
      // await new Promise(resolve => setTimeout(resolve, 500));
      // let info = null;
      // try {
      //   info = await api.getTokenInfo(gmgnChain, tokenAddress);
      // } catch (infoErr) {
      //   this._log('warn', 'GMGN安全检测: getTokenInfo失败，使用部分数据', { token: tokenAddress?.slice(0, 10) + '...', error: infoErr.message });
      // }
      const info = null;

      // 3. 将原始数据写入 DB 缓存
      await this._saveToDB(tokenAddress, gmgnChain, security, info);

      const result = this._extractFactors(security, info);
      this._log('info', 'GMGN安全检测: API调用成功', {
        token: tokenAddress?.slice(0, 10) + '...',
        chain: gmgnChain,
        gmgnSecurityAvailable: result.gmgnSecurityAvailable,
        gmgnIsHoneypot: result.gmgnIsHoneypot,
        gmgnIsOpenSource: result.gmgnIsOpenSource,
        gmgnIsRenounced: result.gmgnIsRenounced,
        gmgnBuyTax: result.gmgnBuyTax,
        gmgnSellTax: result.gmgnSellTax,
        gmgnLpLocked: result.gmgnLpLocked,
        gmgnTop10HolderRate: result.gmgnTop10HolderRate,
        gmgnHolderCount: result.gmgnHolderCount,
        gmgnLiquidity: result.gmgnLiquidity
      });
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
   * 从 DB 读取缓存的 GMGN 安全数据
   * @private
   */
  async _loadFromDB(tokenAddress, chain) {
    if (!this._supabase) return null;
    try {
      const { data, error } = await this._supabase
        .from('experiment_tokens')
        .select('contract_security_raw_data')
        .eq('token_address', tokenAddress)
        .not('contract_security_raw_data', 'is', null)
        .limit(1);
      if (error || !data || data.length === 0) return null;
      const raw = data[0].contract_security_raw_data;
      if (!raw || !raw.security) return null;
      return raw;
    } catch (err) {
      this._log('warn', 'GMGN安全检测: DB缓存读取失败', { token: tokenAddress?.slice(0, 10) + '...', error: err.message });
      return null;
    }
  }

  /**
   * 将 GMGN 安全原始数据写入 DB 缓存
   * @private
   */
  async _saveToDB(tokenAddress, chain, security, info) {
    if (!this._supabase) return;
    try {
      const rawData = { security, info, chain, savedAt: Date.now() };
      const { error } = await this._supabase
        .from('experiment_tokens')
        .update({ contract_security_raw_data: rawData })
        .eq('token_address', tokenAddress);
      if (error) {
        this._log('warn', 'GMGN安全检测: DB缓存写入失败', { token: tokenAddress?.slice(0, 10) + '...', error: error.message });
      } else {
        this._log('info', 'GMGN安全检测: DB缓存写入成功', { token: tokenAddress?.slice(0, 10) + '...' });
      }
    } catch (err) {
      this._log('warn', 'GMGN安全检测: DB缓存写入异常', { token: tokenAddress?.slice(0, 10) + '...', error: err.message });
    }
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
