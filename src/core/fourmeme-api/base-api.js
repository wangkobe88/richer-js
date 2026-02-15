/**
 * Four.meme API 基础类
 * 提供通用的HTTP请求功能
 *
 * API文档: https://four.meme/meme-api/v1/private/
 */

const axios = require('axios');

class FourMemeAPIError extends Error {
    constructor(message, code = null) {
        super(message);
        this.name = 'FourMemeAPIError';
        this.code = code;
    }
}

/**
 * Four.meme API 基类
 */
class BaseFourMemeAPI {
    constructor(baseURL = 'https://four.meme', timeout = 30000) {
        this.baseURL = baseURL;

        this.client = axios.create({
            baseURL,
            timeout,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        // 响应拦截器
        this.client.interceptors.response.use(
            response => {
                // Four.meme API 返回格式: { code: 0, msg: "success", data: {...} }
                const result = response.data;
                if (result.code !== 0 && result.code !== '0') {
                    throw new FourMemeAPIError(
                        result.msg || result.message || 'API请求失败',
                        result.code
                    );
                }
                return result;
            },
            error => {
                if (error.response) {
                    throw new FourMemeAPIError(
                        `API请求失败: ${error.response.status} - ${error.response.data?.msg || error.response.data?.message || error.message}`,
                        error.response.status
                    );
                } else if (error.request) {
                    throw new FourMemeAPIError('网络请求失败，请检查网络连接');
                } else {
                    throw new FourMemeAPIError(`请求配置错误: ${error.message}`);
                }
            }
        );
    }

    async _makeRequest(method, endpoint, options = {}) {
        try {
            const config = {
                method: method.toLowerCase(),
                url: endpoint,
                ...options
            };
            const response = await this.client.request(config);
            // 响应拦截器已经处理了 response，直接返回 response
            // response 现在是 { code: 0, msg: "success", data: {...} }
            return response;
        } catch (error) {
            if (error instanceof FourMemeAPIError) throw error;
            throw new FourMemeAPIError(`请求失败: ${error.message}`);
        }
    }
}

module.exports = { FourMemeAPIError, BaseFourMemeAPI };
