/**
 * TokenCorpusEnricher - 新代币叙事语料补采
 *
 * WSS TokenCreate 链上事件只带链上字段（name/symbol/totalSupply/creator），
 * 叙事分析需要的语料（twitter URL/website/介绍）需另抓平台附属信息：
 *   - four.meme：自家 API GET /meme-api/v1/private/token/get（老 token 会清库，
 *     数据窗口约 1 天，只能发现时实时抓；当天 token 语料覆盖实测 6/6）
 *   - flap：TokenCreated 事件的 meta → metadata JSON。meta 两种形态：
 *     IPFS URL/裸 CID（主流；内容寻址永不过期，官方 ipfs.io 网关正迁移
 *     service worker，用 pinata/4everland）与 S3 直链
 *     （meta-7777.s3.amazonaws.com/metadata/*.json，实测约占 1%，直接 GET）
 *
 * 语义（fire-and-forget，永不抛错）：
 *   - 成功 → 返回语料字段对象（含 corpus 留痕），调用方合并进
 *     experiment_tokens.raw_api_data（键名对齐 extractInfo/jev-state-builder
 *     读取点：twitterUrl/webUrl/description + intro_en 双写）
 *   - 无语料/失败/超时 → 返回 null，raw_api_data 保持链上字段，不影响交易链路
 *   - four.meme 空 data（极新 token API 未就绪）延迟重试 1 次，仍空放弃
 *   - 并发上限信号量（发现高峰几十 token/min × 单次百毫秒级，上限 3 防突发）
 */

const axios = require('axios');
const { FourMemeTokenAPI } = require('../../core/fourmeme-api/token-api');

/** 默认配置（引擎侧 mergedWsConfig().corpusEnrich 覆盖） */
const DEFAULT_OPTIONS = {
  enabled: true,
  concurrency: 3,
  fourmemeRetryDelayMs: 10 * 1000,
  ipfsGateways: [
    'https://gateway.pinata.cloud/ipfs/',
    'https://4everland.io/ipfs/',
  ],
};

/** IPFS fetch 超时（毫秒） */
const IPFS_TIMEOUT_MS = 15 * 1000;

class TokenCorpusEnricher {
  /**
   * @param {Object} [options] - corpusEnrich 配置段（与 DEFAULT_OPTIONS 深浅合并）
   * @param {Object} logger - 引擎 logger（info/warn 签名 logger.info(experimentId, tag, msg)）
   * @param {string} experimentId - 实验 ID（日志归属）
   */
  constructor(options = {}, logger = null, experimentId = null) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.logger = logger;
    this.experimentId = experimentId;

    this._fourMemeApi = new FourMemeTokenAPI();
    this._ipfsClient = axios.create({ timeout: IPFS_TIMEOUT_MS });

    // 并发信号量
    this._active = 0;
    this._waiters = [];
  }

  /** 引擎日志（无 logger 时静默——enricher 独立脚本化使用时） */
  _log(level, msg) {
    if (this.logger?.[level]) {
      this.logger[level](this.experimentId, 'CorpusEnrich', msg);
    }
  }

  /** 并发槽内执行（超限排队） */
  async _withSlot(fn) {
    if (!this.options.enabled) return null;
    while (this._active >= this.options.concurrency) {
      await new Promise(resolve => this._waiters.push(resolve));
    }
    this._active++;
    try {
      return await fn();
    } finally {
      this._active--;
      const next = this._waiters.shift();
      if (next) next();
    }
  }

  /**
   * 补采语料（永不抛错）
   * @param {string} tokenAddress - 代币地址
   * @param {string} platform - 'fourmeme' | 'flap'
   * @param {string|null} [metaUrl] - flap 的 IPFS meta（URL 或裸 CID；fourmeme 不用）
   * @returns {Promise<Object|null>} 语料字段（含 corpus 留痕）；null = 无语料/失败/未启用
   */
  async enrich(tokenAddress, platform, metaUrl = null) {
    try {
      return await this._withSlot(() =>
        platform === 'flap' ? this._enrichFlap(metaUrl) : this._enrichFourMeme(tokenAddress));
    } catch (error) {
      this._log('warn', `语料补采失败 | ${tokenAddress} ${platform} ${error.message}`);
      return null;
    }
  }

  // ==================== four.meme ====================

  async _enrichFourMeme(tokenAddress) {
    let info = await this._fetchFourMeme(tokenAddress);
    if (!info) {
      // 极新 token API 可能未就绪，延迟重试 1 次
      await new Promise(r => setTimeout(r, this.options.fourmemeRetryDelayMs));
      info = await this._fetchFourMeme(tokenAddress);
      if (!info) {
        this._log('info', `four.meme API 无数据（重试后仍空）| ${tokenAddress}`);
        return null;
      }
    }

    const fields = {};
    if (info.twitterUrl) fields.twitterUrl = info.twitterUrl;
    if (info.webUrl) fields.webUrl = info.webUrl;
    if (info.descr) {
      fields.description = info.descr;
      fields.intro_en = info.descr; // jev-state-builder 读 intro_en/intro_cn，不读 description
    }
    if (info.name) fields.name = info.name;
    return {
      ...fields,
      corpus: { provider: 'fourmeme_api', fetchedAt: new Date().toISOString() },
    };
  }

  /** 空 data（老 token 清库/新 token 未就绪）返回 null，异常向上抛由 enrich 统一记日志 */
  async _fetchFourMeme(tokenAddress) {
    const info = await this._fourMemeApi.getTokenInfo(tokenAddress);
    return info && info.raw && Object.keys(info.raw).length > 0 ? info : null;
  }

  // ==================== flap（IPFS metadata）====================

  async _enrichFlap(metaUrl) {
    const cid = this._extractCid(metaUrl);
    let metadata;
    let corpus;
    if (cid) {
      metadata = await this._fetchIpfsJson(cid);
      if (!metadata) return null; // 网关均失败/非 JSON——已在 _fetchIpfsJson 记日志
      corpus = { provider: 'flap_ipfs', cid, fetchedAt: new Date().toISOString() };
    } else if (/^https?:\/\//i.test(metaUrl || '')) {
      // S3 等直链 metadata（同一套 JSON 键：twitter/website/description/name）
      metadata = await this._fetchJsonUrl(metaUrl);
      if (!metadata) return null;
      corpus = { provider: 'flap_meta_url', fetchedAt: new Date().toISOString() };
    } else {
      this._log('warn', `flap meta 无法解析出 CID | ${metaUrl}`);
      return null;
    }

    const fields = {};
    if (metadata.twitter) fields.twitterUrl = metadata.twitter;
    if (metadata.website) fields.webUrl = metadata.website;
    if (metadata.description) {
      fields.description = metadata.description;
      fields.intro_en = metadata.description; // 同 four.meme：双写对齐 Jev 键名
    }
    if (metadata.name) fields.name = metadata.name;
    return {
      ...fields,
      corpus,
    };
  }

  /** 直链 metadata JSON（S3 等）；失败/非 JSON 记日志返回 null */
  async _fetchJsonUrl(url) {
    try {
      const resp = await this._ipfsClient.get(url);
      if (resp.data && typeof resp.data === 'object') return resp.data;
      this._log('warn', `flap meta URL 返回非 JSON | ${url}`);
    } catch (error) {
      this._log('warn', `flap meta URL 取失败 | ${url} ${error.message}`);
    }
    return null;
  }

  /** meta（完整 URL 或裸 CID）→ CID；非 IPFS meta 返回 null */
  _extractCid(metaUrl) {
    if (!metaUrl || typeof metaUrl !== 'string') return null;
    const m = metaUrl.match(/(baf[a-z0-9]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{20,})/);
    return m ? m[1] : null;
  }

  /** 按配置网关顺序取 metadata JSON；均失败/非 JSON 记日志返回 null */
  async _fetchIpfsJson(cid) {
    for (const gateway of this.options.ipfsGateways) {
      try {
        const resp = await this._ipfsClient.get(`${gateway}${cid}`);
        if (resp.data && typeof resp.data === 'object') return resp.data;
      } catch (error) {
        this._log('warn', `IPFS 网关取失败 | ${gateway}${cid} ${error.message}`);
      }
    }
    return null;
  }
}

module.exports = { TokenCorpusEnricher };
