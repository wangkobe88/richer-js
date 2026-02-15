/**
 * Four.meme Token API
 * 用于获取代币信息和创建者地址
 *
 * API文档: https://four.meme/meme-api/v1/private/
 */

const { BaseFourMemeAPI } = require('./base-api');

/**
 * Four.meme Token API
 */
class FourMemeTokenAPI extends BaseFourMemeAPI {
    /**
     * 获取代币详细信息
     *
     * @param {string} tokenAddress - 代币地址
     * @returns {Promise<Object>} 代币详细信息
     */
    async getTokenInfo(tokenAddress) {
        if (!tokenAddress) {
            throw new Error('tokenAddress不能为空');
        }

        // 验证地址格式（BSC地址0x开头，42位）
        if (!tokenAddress.startsWith('0x') || tokenAddress.length !== 42) {
            throw new Error('无效的BSC代币地址格式');
        }

        const result = await this._makeRequest('GET', `/meme-api/v1/private/token/get`, {
            params: { address: tokenAddress }
        });

        const data = result.data || {};

        // 返回标准化的代币信息
        return {
            // 基本信息
            id: data.id,
            address: data.address,
            symbol: data.symbol,
            name: data.name,
            shortName: data.shortName,
            descr: data.descr,

            // 创建者信息（关键字段）
            userAddress: data.userAddress,
            userName: data.userName,
            userId: data.userId,

            // 价格信息
            currentPrice: data.tokenPrice?.price || null,
            priceIncrease: data.tokenPrice?.increase || null,
            marketCap: data.tokenPrice?.marketCap || null,
            tradingVolume: data.tokenPrice?.trading || null,

            // 代币信息
            totalAmount: data.totalAmount,
            saleAmount: data.saleAmount,
            b0: data.b0,
            t0: data.t0,

            // 时间信息
            launchTime: data.launchTime,
            createTime: data.createDate,

            // 链接信息
            imageUrl: data.image,
            webUrl: data.webUrl,
            twitterUrl: data.twitterUrl,
            tradeUrl: data.tradeUrl,

            // 状态信息
            status: data.status,
            showStatus: data.showStatus,
            oscarStatus: data.oscarStatus,
            version: data.version,
            dexType: data.dexType,

            // 原始数据（备用）
            raw: data
        };
    }

    /**
     * 获取创建者地址（兼容接口，保持与现有代码一致）
     *
     * @param {string} tokenAddress - 代币地址
     * @returns {Promise<Object>} 包含 creator_address 的对象
     */
    async getCreatorAddress(tokenAddress) {
        const tokenInfo = await this.getTokenInfo(tokenAddress);

        // 返回兼容 AVE API getContractRisk 的格式
        return {
            creator_address: tokenInfo.userAddress,
            token: tokenInfo.address,
            chain: 'bsc',
            token_name: tokenInfo.name,
            token_symbol: tokenInfo.symbol,

            // 额外信息
            user_id: tokenInfo.userId,
            user_name: tokenInfo.userName,
            launch_time: tokenInfo.launchTime,

            // 完整信息
            full_info: tokenInfo
        };
    }

    /**
     * 批量获取代币创建者地址
     *
     * @param {Array<string>} tokenAddresses - 代币地址数组
     * @returns {Promise<Object>} 地址映射对象 { address: creatorAddress }
     */
    async getBatchCreatorAddresses(tokenAddresses) {
        if (!tokenAddresses || tokenAddresses.length === 0) {
            return {};
        }

        const results = {};
        const promises = tokenAddresses.map(async (address) => {
            try {
                const info = await this.getCreatorAddress(address);
                results[address] = info.creator_address;
            } catch (error) {
                // 单个失败不影响整体
                results[address] = null;
            }
        });

        await Promise.all(promises);
        return results;
    }

    /**
     * 检查代币是否存在
     *
     * @param {string} tokenAddress - 代币地址
     * @returns {Promise<boolean>} 是否存在
     */
    async tokenExists(tokenAddress) {
        try {
            await this.getTokenInfo(tokenAddress);
            return true;
        } catch (error) {
            if (error.message.includes('不存在') || error.code === 404) {
                return false;
            }
            throw error;
        }
    }
}

module.exports = { FourMemeTokenAPI };
