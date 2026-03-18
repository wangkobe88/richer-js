/**
 * LLM客户端组件
 * 支持多种LLM提供商的统一接口
 */

class LLMClient {
    constructor(type = 'siliconflow', config = {}) {
        this.type = type;
        this.config = this.mergeConfig(config);
        this.stats = {
            calls: 0,
            totalTokens: 0,
            startTime: Date.now
        };

        // 简单的速率限制
        this.lastCall = 0;
        this.minDelay = this.config.delay || 200;
    }

    mergeConfig(userConfig) {
        const defaultConfig = {
            siliconflow: {
                baseUrl: 'https://api.siliconflow.cn/v1',
                model: 'deepseek-ai/DeepSeek-R1',
                maxTokens: 8192,
                timeout: 120000,
                delay: 200
            },
            deepseek: {
                baseUrl: 'https://api.deepseek.com/v1',
                model: 'deepseek-chat',
                maxTokens: 8192,
                timeout: 60000,
                delay: 500
            },
            openai: {
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-3.5-turbo',
                maxTokens: 4096,
                timeout: 60000,
                delay: 1000
            }
        };

        const typeConfig = defaultConfig[this.type] || defaultConfig.siliconflow;
        return { ...typeConfig, ...userConfig };
    }

    /**
     * 分析文本内容
     * @param {string} prompt - 提示词
     * @returns {Promise<string>} LLM响应
     */
    async analyze(prompt) {
        this.stats.calls++;

        // 简单的速率限制
        await this.applyRateLimit();

        const inputTokens = this.estimateTokens(prompt);

        try {
            console.log(`🤖 调用${this.type} API进行分析...`);
            console.log(`📝 输入: ${prompt.length.toLocaleString()} 字符 (约 ${inputTokens} tokens)`);

            const response = await this.makeRequest(prompt);
            const outputTokens = this.estimateTokens(response);

            this.stats.totalTokens += inputTokens + outputTokens;

            console.log('✅ LLM API调用成功');
            console.log(`📤 输出: ${response.length.toLocaleString()} 字符 (约 ${outputTokens} tokens)`);
            console.log(`🔢 总计使用: ${inputTokens + outputTokens} tokens`);

            return response.trim();

        } catch (error) {
            console.error(`❌ ${this.type} API调用失败:`, error.message);
            throw error;
        }
    }

    /**
     * 应用速率限制
     */
    async applyRateLimit() {
        const now = Date.now();
        const timeSinceLastCall = now - this.lastCall;

        if (timeSinceLastCall < this.minDelay) {
            const waitTime = this.minDelay - timeSinceLastCall;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        this.lastCall = Date.now();
    }

    /**
     * 发送API请求
     * @param {string} prompt - 提示词
     * @returns {Promise<string>} API响应
     */
    async makeRequest(prompt) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
            const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getApiKey()}`
                },
                body: JSON.stringify({
                    model: this.config.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.3,
                    max_tokens: this.config.maxTokens,
                    stream: false
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content;

            if (!content) {
                throw new Error('API返回了空内容');
            }

            // 使用API返回的准确token统计（如果有）
            if (data.usage) {
                const officialTokens = data.usage.total_tokens;
                if (officialTokens) {
                    console.log(`📊 官方Token统计: ${officialTokens} tokens`);
                }
            }

            return content;

        } catch (error) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                throw new Error('请求超时');
            }

            throw error;
        }
    }

    /**
     * 获取API密钥
     * @returns {string} API密钥
     */
    getApiKey() {
        return this.config.apiKey ||
               process.env.SILICONFLOW_API_KEY ||
               process.env.API_KEY ||
               process.env.DEEPSEEK_API_KEY ||
               '';
    }

    /**
     * 估算token数量
     * @param {string} text - 文本内容
     * @returns {number} 估算的token数量
     */
    estimateTokens(text) {
        if (!text) return 0;
        // 简单估算：平均4字符=1token
        return Math.ceil(text.length / 4);
    }

    /**
     * 获取使用统计
     * @returns {Object} 统计信息
     */
    getStats() {
        const runtime = Date.now() - this.stats.startTime;
        const minutes = Math.floor(runtime / 60000);

        return {
            ...this.stats,
            runtime: `${minutes}分${Math.floor((runtime % 60000) / 1000)}秒`,
            avgTokensPerCall: this.stats.calls > 0 ?
                Math.round(this.stats.totalTokens / this.stats.calls) : 0
        };
    }

    /**
     * 打印统计信息
     */
    printStats() {
        const stats = this.getStats();
        console.log('\n📊 LLM使用统计:');
        console.log(`  - 调用次数: ${stats.calls}`);
        console.log(`  - 总Token数: ${stats.totalTokens.toLocaleString()}`);
        console.log(`  - 平均每次: ${stats.avgTokensPerCall} tokens`);
        console.log(`  - 运行时间: ${stats.runtime}`);
    }

    /**
     * 重置统计信息
     */
    resetStats() {
        this.stats = {
            calls: 0,
            totalTokens: 0,
            startTime: Date.now()
        };
    }
}

// 创建客户端的工厂函数
LLMClient.create = function(type, config) {
    return new LLMClient(type, config);
};

// 验证API密钥格式
LLMClient.validateApiKey = function(apiKey) {
    return apiKey && typeof apiKey === 'string' && apiKey.startsWith('sk-') && apiKey.length > 20;
};

export default LLMClient;
