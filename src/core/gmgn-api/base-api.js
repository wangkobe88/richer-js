/**
 * GMGN API 基类
 * 提供通用的HTTP请求功能、认证、错误处理、限流重试
 *
 * API文档参考: https://github.com/GMGNAI/gmgn-skills
 * 基础URL: https://openapi.gmgn.ai
 *
 * 认证方式:
 *   Normal (token/market/portfolio): X-APIKEY + timestamp + client_id 查询参数
 *   Critical (swap/order/cooking): Normal + X-Signature (私钥签名)
 */

const axios = require('axios');
const crypto = require('crypto');
const https = require('https');
const dns = require('dns');

// 公共 DNS 服务器（用于预解析绕过 DNS 污染）
const PUBLIC_DNS_SERVERS = ['8.8.8.8', '1.1.1.1'];
const _resolvedIPs = {};

function createGMGNAgent(hostname) {
    return new https.Agent({
        lookup: (_host, options, callback) => {
            const ip = _resolvedIPs[hostname];
            if (ip) {
                if (options.all) {
                    callback(null, [{ address: ip, family: 4 }]);
                } else {
                    callback(null, ip, 4);
                }
            } else {
                dns.lookup(hostname, { ...options, family: 4 }, callback);
            }
        },
    });
}

/**
 * 预解析 GMGN API 域名的真实 IPv4 地址（绕过 DNS 污染）
 * @param {string} [hostname='openapi.gmgn.ai']
 * @returns {Promise<string>} 解析到的真实 IP
 */
async function preResolveGMGNHost(hostname = 'openapi.gmgn.ai') {
    return new Promise((resolve, reject) => {
        const resolver = new dns.Resolver();
        resolver.setServers(PUBLIC_DNS_SERVERS);
        resolver.resolve4(hostname, (err, addresses) => {
            if (err) return reject(err);
            _resolvedIPs[hostname] = addresses[0];
            resolve(addresses[0]);
        });
    });
}

class GMGNAPIError extends Error {
    constructor(message, { method = null, path = null, status = null, apiCode = null, apiError = null, apiMessage = null, resetAtUnix = null } = {}) {
        super(message);
        this.name = 'GMGNAPIError';
        this.method = method;
        this.path = path;
        this.status = status;
        this.apiCode = apiCode;
        this.apiError = apiError;
        this.apiMessage = apiMessage;
        this.resetAtUnix = resetAtUnix;
    }
}

const RATE_LIMIT_RETRY_BUFFER_MS = 1000;
const DEFAULT_RATE_LIMIT_AUTO_RETRY_MAX_WAIT_MS = 5000;

/**
 * 战壕(Trenches)平台列表
 */
const TRENCHES_PLATFORMS = {
    sol: [
        'Pump.fun', 'pump_mayhem', 'pump_mayhem_agent', 'pump_agent',
        'letsbonk', 'bonkers', 'bags', 'memoo', 'liquid', 'bankr', 'zora',
        'surge', 'anoncoin', 'moonshot_app', 'wendotdev', 'heaven', 'sugar',
        'token_mill', 'believe', 'trendsfun', 'trends_fun', 'jup_studio',
        'Moonshot', 'boop', 'ray_launchpad', 'meteora_virtual_curve', 'xstocks',
    ],
    bsc: [
        'fourmeme', 'fourmeme_agent', 'bn_fourmeme', 'four_xmode_agent',
        'flap', 'clanker', 'lunafun',
    ],
    base: [
        'clanker', 'bankr', 'flaunch', 'zora', 'zora_creator',
        'baseapp', 'basememe', 'virtuals_v2', 'klik',
    ],
};

const TRENCHES_QUOTE_ADDRESS_TYPES = {
    sol: [4, 5, 3, 1, 13, 0],
    bsc: [6, 7, 1, 16, 8, 3, 9, 10, 2, 17, 18, 0],
    base: [11, 3, 12, 13, 0],
};

/**
 * GMGN API 基类
 */
class BaseGMGNAPI {
    /**
     * @param {Object} options
     * @param {string} options.baseURL - API 基础 URL
     * @param {number} options.timeout - 请求超时时间(ms)
     * @param {string} options.apiKey - GMGN API Key
     * @param {string} [options.privateKeyPem] - PEM 格式私钥(用于 critical auth)
     */
    constructor({ baseURL = 'https://openapi.gmgn.ai', timeout = 30000, apiKey, privateKeyPem = null } = {}) {
        this.baseURL = baseURL.replace(/\/$/, '');
        this.hostname = this.baseURL.replace(/^https?:\/\//, '');
        this.apiKey = apiKey;
        this.privateKeyPem = privateKeyPem;

        this.client = axios.create({
            timeout,
            headers: { 'Content-Type': 'application/json' },
            httpsAgent: createGMGNAgent(this.hostname),
            validateStatus: () => true,
        });
    }

    /**
     * 预解析域名真实 IP（绕过 DNS 污染）
     * @returns {Promise<void>}
     */
    async init() {
        await preResolveGMGNHost(this.hostname);
    }

    // ---- Normal Auth 请求 ----

    async _normalRequest(method, subPath, queryParams = {}, body = null) {
        const { timestamp, client_id } = this._buildAuthQuery();
        const query = { ...queryParams, timestamp, client_id };
        const headers = { 'X-APIKEY': this.apiKey };
        const bodyStr = body !== null ? JSON.stringify(body) : null;
        return this._executeRequest(method, subPath, query, headers, bodyStr, true);
    }

    // ---- Critical Auth 请求 ----

    async _criticalRequest(method, subPath, queryParams = {}, body = null) {
        if (!this.privateKeyPem) {
            throw new Error('GMGN_PRIVATE_KEY is required for critical-auth commands (swap, order, and follow-wallet commands)');
        }

        const { timestamp, client_id } = this._buildAuthQuery();
        const query = { ...queryParams, timestamp, client_id };
        const bodyStr = body !== null ? JSON.stringify(body) : '';
        const message = this._buildMessage(subPath, query, bodyStr, timestamp);
        const signature = this._sign(message, this.privateKeyPem);

        const headers = {
            'X-APIKEY': this.apiKey,
            'X-Signature': signature,
        };
        return this._executeRequest(method, subPath, query, headers, bodyStr || null, method !== 'POST');
    }

    // ---- 请求执行与重试 ----

    async _executeRequest(method, subPath, query, headers, body, autoRetryOnRateLimit) {
        const maxAttempts = autoRetryOnRateLimit ? 2 : 1;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const url = this._buildUrl(`${this.baseURL}${subPath}`, query);
                const response = await this.client.request({
                    method: method.toUpperCase(),
                    url,
                    headers,
                    ...(body ? { data: body } : {}),
                });
                return this._parseResponse(method, subPath, response);
            } catch (error) {
                const retryDelayMs = this._getRateLimitRetryDelayMs(error, attempt, maxAttempts, autoRetryOnRateLimit);
                if (retryDelayMs == null) {
                    throw error;
                }
                await this._sleep(retryDelayMs);
            }
        }
        throw new Error('Unexpected retry loop exit');
    }

    _parseResponse(method, path, response) {
        const { status, headers: respHeaders, data: rawData } = response;
        let json;

        if (typeof rawData === 'object' && rawData !== null) {
            json = rawData;
        } else {
            try {
                json = JSON.parse(rawData);
            } catch {
                throw new GMGNAPIError(`${method} ${path} failed: HTTP ${status} (non-JSON response)`, {
                    method, path, status,
                });
            }
        }

        if (json.code !== 0 && json.code !== '0') {
            const resetAtUnix = this._parseRateLimitReset(respHeaders['x-ratelimit-reset']);
            throw new GMGNAPIError(
                this._buildErrorMessage(method, path, status, json, resetAtUnix),
                {
                    method, path, status,
                    apiCode: json.code,
                    apiError: json.error,
                    apiMessage: json.message,
                    resetAtUnix,
                }
            );
        }

        return json.data;
    }

    // ---- 认证工具方法 ----

    _buildAuthQuery() {
        return {
            timestamp: Math.floor(Date.now() / 1000),
            client_id: crypto.randomUUID(),
        };
    }

    _buildMessage(subPath, queryParams, body, timestamp) {
        const sortedQs = Object.keys(queryParams)
            .sort()
            .flatMap((k) => {
                const v = queryParams[k];
                if (Array.isArray(v)) {
                    return [...v].sort().map((item) => `${k}=${item}`);
                }
                return [`${k}=${v}`];
            })
            .join('&');
        return `${subPath}:${sortedQs}:${body || ''}:${timestamp}`;
    }

    _sign(message, privateKeyPem) {
        const key = crypto.createPrivateKey(privateKeyPem);
        const msgBuf = Buffer.from(message, 'utf-8');

        if (key.asymmetricKeyType === 'ed25519') {
            const sig = crypto.sign(null, msgBuf, privateKeyPem);
            return sig.toString('base64');
        }

        const sig = crypto.sign('sha256', msgBuf, {
            key: privateKeyPem,
            padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
            saltLength: 32,
        });
        return sig.toString('base64');
    }

    // ---- URL 构建 ----

    _buildUrl(base, query) {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(query)) {
            if (Array.isArray(v)) {
                for (const item of v) params.append(k, String(item));
            } else {
                params.set(k, String(v));
            }
        }
        return `${base}?${params.toString()}`;
    }

    // ---- 限流处理 ----

    _getRateLimitRetryDelayMs(error, attempt, maxAttempts, autoRetryOnRateLimit) {
        if (!autoRetryOnRateLimit || attempt >= maxAttempts) return null;
        if (!(error instanceof GMGNAPIError)) return null;
        if (error.apiError !== 'RATE_LIMIT_EXCEEDED' && error.apiError !== 'RATE_LIMIT_BANNED') return null;
        if (error.resetAtUnix == null) return null;

        const waitMs = Math.max(error.resetAtUnix * 1000 - Date.now(), 0) + RATE_LIMIT_RETRY_BUFFER_MS;
        return waitMs <= DEFAULT_RATE_LIMIT_AUTO_RETRY_MAX_WAIT_MS ? waitMs : null;
    }

    _parseRateLimitReset(raw) {
        if (!raw || (typeof raw === 'string' && raw.trim() === '')) return undefined;
        const parsed = parseInt(raw, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    }

    _buildErrorMessage(method, path, status, json, resetAtUnix) {
        const parts = [`${method} ${path} failed: HTTP ${status}`];
        if (json.code != null) parts.push(`code=${json.code}`);
        if (json.error) parts.push(`error=${json.error}`);
        if (json.message) parts.push(`message=${json.message}`);

        let message = parts.join(' ');

        if (status === 429 && resetAtUnix != null) {
            const remainingSeconds = Math.max(Math.ceil((resetAtUnix * 1000 - Date.now()) / 1000), 0);
            message += `. Rate limit resets in ~${remainingSeconds}s. Repeated requests can extend the ban.`;
        }

        return message;
    }

    // ---- 战壕请求体构建 ----

    _buildTrenchesBody(chain, types, platforms, limit, filters) {
        const selectedTypes = types?.length ? types : ['new_creation', 'near_completion', 'completed'];
        const launchpad_platform = platforms?.length ? platforms : (TRENCHES_PLATFORMS[chain] || []);
        const quote_address_type = TRENCHES_QUOTE_ADDRESS_TYPES[chain] || [];
        const actualLimit = limit ?? 80;

        const section = {
            filters: ['offchain', 'onchain'],
            launchpad_platform,
            quote_address_type,
            launchpad_platform_v2: true,
            limit: actualLimit,
            ...filters,
        };

        const body = { version: 'v2' };
        for (const type of selectedTypes) {
            body[type] = { ...section };
        }
        return body;
    }

    _sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

module.exports = { GMGNAPIError, BaseGMGNAPI, TRENCHES_PLATFORMS, preResolveGMGNHost };
