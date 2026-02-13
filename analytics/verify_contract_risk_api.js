/**
 * 验证 getContractRisk API 字段完整性
 * 用法: node analytics/verify_contract_risk_api.js <tokenAddress>
 * 示例: node analytics/verify_contract_risk_api.js 0x4014d8a22041475fa2748c8ea390d68ab50f4444
 */

const { AveTokenAPI } = require('../src/core/ave-api/token-api');

async function verifyContractRisk(tokenAddress) {
    const apiKey = process.env.AVE_API_KEY;
    if (!apiKey) {
        console.error('错误: 请设置 AVE_API_KEY 环境变量');
        process.exit(1);
    }

    const api = new AveTokenAPI('https://prod.ave-api.com', 30000, apiKey);

    // 构建 tokenId (格式: {token}-{chain})
    const tokenId = `${tokenAddress}-bsc`;

    console.log(`\n========================================`);
    console.log(`验证 getContractRisk API`);
    console.log(`========================================\n`);
    console.log(`代币地址: ${tokenAddress}`);
    console.log(`Token ID: ${tokenId}\n`);

    try {
        // 调用 API
        const result = await api.getContractRisk(tokenId);

        console.log(`\n✅ API 调用成功\n`);
        console.log(`========================================`);
        console.log(`返回字段统计`);
        console.log(`========================================\n`);

        // 统计字段
        const allFields = Object.keys(result);
        console.log(`总字段数: ${allFields.length}\n`);

        // 分类字段
        const fieldCategories = {
            '核心风险字段': [
                'is_honeypot', 'buy_tax', 'sell_tax', 'can_take_back_ownership',
                'has_mint_method', 'is_proxy', 'owner', 'creator_address',
                'risk_score', 'is_anti_whale', 'has_black_method', 'has_white_method',
                'hidden_owner', 'selfdestruct', 'trading_cooldown', 'transfer_pausable'
            ],
            '税务字段': ['buy_tax', 'sell_tax', 'transfer_tax'],
            'Gas相关': ['buy_gas', 'sell_gas', 'approve_gas'],
            '持仓分析': ['holders', 'creator_balance', 'creator_percent', 'owner_balance', 'owner_percent'],
            'DEX相关': ['is_in_dex', 'dex', 'pair_holders', 'pair_total', 'pair_lock_percent'],
            '分析方法': ['analysis_big_wallet', 'analysis_creator_gt_5percent', 'analysis_risk_score', 'analysis_scam_wallet'],
            '其他': []
        };

        // 打印分类字段
        for (const [category, fields] of Object.entries(fieldCategories)) {
            if (category === '其他') continue;

            const presentFields = fields.filter(f => result[f] !== undefined);
            const missingFields = fields.filter(f => result[f] === undefined);

            console.log(`【${category}】`);
            console.log(`  存在: ${presentFields.length}/${fields.length}`);
            if (missingFields.length > 0) {
                console.log(`  缺失: ${missingFields.join(', ')}`);
            }
            console.log('');
        }

        // 打印其他字段
        const otherFields = allFields.filter(f =>
            !Object.values(fieldCategories).flat().includes(f)
        );
        if (otherFields.length > 0) {
            console.log(`【其他字段】`);
            otherFields.forEach(f => {
                const value = result[f];
                const valueStr = typeof value === 'object' ? '[对象/数组]' : String(value);
                console.log(`  ${f}: ${valueStr}`);
            });
            console.log('');
        }

        console.log(`========================================`);
        console.log(`关键字段详情`);
        console.log(`========================================\n`);

        // 打印关键字段的值
        const keyFields = [
            'token', 'token_symbol', 'token_name', 'chain',
            'is_honeypot', 'buy_tax', 'sell_tax', 'risk_score',
            'creator_address', 'owner', 'holders'
        ];

        keyFields.forEach(field => {
            const value = result[field];
            if (value !== undefined) {
                const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
                console.log(`${field}: ${valueStr}`);
            } else {
                console.log(`${field}: [缺失]`);
            }
        });

        console.log(`\n========================================`);
        console.log(`完整原始数据 (JSON)`);
        console.log(`========================================\n`);
        console.log(JSON.stringify(result, null, 2));

    } catch (error) {
        console.error(`\n❌ API 调用失败: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

// 主入口
if (require.main === module) {
    const tokenAddress = process.argv[2];

    if (!tokenAddress) {
        console.error(`错误: 请提供代币地址`);
        console.error(`用法: node analytics/verify_contract_risk_api.js <tokenAddress>`);
        console.error(`示例: node analytics/verify_contract_risk_api.js 0x4014d8a22041475fa2748c8ea390d68ab50f4444`);
        process.exit(1);
    }

    verifyContractRisk(tokenAddress);
}

module.exports = { verifyContractRisk };
