/**
 * 测试 AVE API 返回的 four.meme 代币数据
 */

const axios = require('axios');

async function testAveAPI() {
    const apiKey = process.env.AVE_API_KEY;

    const headers = {
        'Accept': '*/*'
    };
    if (apiKey) {
        headers['X-API-KEY'] = apiKey;
    }

    console.log('========================================');
    console.log('测试 AVE API - four.meme 新代币');
    console.log('========================================\n');
    console.log('API Key:', apiKey ? '已设置' : '未设置');
    console.log('');

    const client = axios.create({
        baseURL: 'https://prod.ave-api.com',
        timeout: 30000,
        headers
    });

    try {
        const params = {
            tag: 'fourmeme_in_new',
            chain: 'bsc',
            limit: 50,
            orderby: 'created_at'
        };

        console.log('请求参数:', JSON.stringify(params, null, 2));
        console.log('');

        const response = await client.get('/v2/tokens/platform', { params });
        const data = response.data?.data || [];

        console.log('========================================');
        console.log('API 返回结果');
        console.log('========================================');
        console.log('返回代币数量:', data.length);
        console.log('total:', response.data?.total || 'N/A');
        console.log('');

        if (data.length === 0) {
            console.log('⚠️ API 返回空数据！');
            return;
        }

        const now = Date.now();
        const ageRanges = {
            '0-30s': 0,
            '30-60s': 0,
            '1-2m': 0,
            '2-5m': 0,
            '5m+': 0
        };

        console.log('========================================');
        console.log('前 10 个代币详情');
        console.log('========================================\n');

        for (let i = 0; i < Math.min(10, data.length); i++) {
            const token = data[i];
            const createdAt = token.created_at || 0;
            const ageSeconds = (now - createdAt * 1000) / 1000;
            const ageMinutes = ageSeconds / 60;

            // 统计年龄分布
            if (ageSeconds < 30) {
                ageRanges['0-30s']++;
            } else if (ageSeconds < 60) {
                ageRanges['30-60s']++;
            } else if (ageSeconds < 120) {
                ageRanges['1-2m']++;
            } else if (ageSeconds < 300) {
                ageRanges['2-5m']++;
            } else {
                ageRanges['5m+']++;
            }

            const createdAtDate = new Date(createdAt * 1000);
            console.log(`${i + 1}. ${token.symbol || 'N/A'} (${token.name || 'N/A'})`);
            console.log('   地址:', token.token || 'N/A');
            console.log('   创建时间:', createdAtDate.toISOString());
            console.log('   年龄:', ageSeconds.toFixed(0), '秒 (' + ageMinutes.toFixed(1) + ' 分钟)');
            console.log('   current_price:', token.current_price_usd || 'N/A');
            console.log('   fdv:', token.fdv || 'N/A');
            console.log('');
        }

        console.log('========================================');
        console.log('年龄分布统计');
        console.log('========================================');
        console.log('0-30s:', ageRanges['0-30s']);
        console.log('30-60s:', ageRanges['30-60s']);
        console.log('1-2m:', ageRanges['1-2m']);
        console.log('2-5m:', ageRanges['2-5m']);
        console.log('5m+:', ageRanges['5m+']);
        console.log('');

        if (ageRanges['5m+'] === data.length) {
            console.log('⚠️ 所有代币都是 5 分钟以上！');
            console.log('这可能是：');
            console.log('1. API 端点或参数配置问题');
            console.log('2. Four.meme 平台最近没有新代币发布');
            console.log('3. API 返回的 created_at 字段有问题');
        } else if (ageRanges['0-30s'] > 0 || ageRanges['30-60s'] > 0) {
            console.log('✅ 有新代币！');
        }

    } catch (error) {
        console.error('请求失败:', error.message);
        if (error.response) {
            console.error('状态码:', error.response.status);
            console.error('响应数据:', error.response.data);
        }
    }
}

testAveAPI().catch(console.error);
