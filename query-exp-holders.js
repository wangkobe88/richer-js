/**
 * 查询实验代币持有者信息
 */

require('dotenv').config({ path: './config/.env' });
const { dbManager } = require('./src/services/dbManager');

async function queryExperimentHolders() {
    const supabase = dbManager.getClient();
    const tokenAddress = '0xc521addcf680165c55595e0193d4977dfce24444';

    console.log(`查询代币 ${tokenAddress} 的持有者信息...`);
    console.log(`获取首个快照数据\n`);

    // 1. 获取该代币的持有者数据（按时间升序，取第一个即最早的）
    const { data: holders, error } = await supabase
        .from('token_holders')
        .select('token_address, holder_data, checked_at, snapshot_id, experiment_id')
        .eq('token_address', tokenAddress)
        .order('checked_at', { ascending: true })
        .limit(1);

    if (error) {
        console.error('查询失败:', error);
        return;
    }

    if (!holders || holders.length === 0) {
        console.log('该实验没有持有者数据');
        return;
    }

    console.log(`找到 ${holders.length} 个快照\n`);

    // 2. 取第一个快照（最早的）
    const firstSnapshot = holders[0];

    if (!firstSnapshot) {
        console.log('未找到快照数据');
        return;
    }

    console.log(`首个快照:`);
    console.log(`  代币: ${firstSnapshot.token_address}`);
    console.log(`  时间: ${firstSnapshot.checked_at}`);
    console.log(`  实验ID: ${firstSnapshot.experiment_id}`);
    console.log('');

    // 3. 解析持有者数据，筛选持仓比例超过1%的
    const holdersList = firstSnapshot.holder_data?.holders || [];

    console.log('持仓比例超过 1% 的持有者:');
    console.log('---');

    console.log('持仓比例超过 1% 的持有者:');
    console.log('---');

    let count = 0;
    for (const holder of holdersList) {
        // 获取地址和比例
        const address = holder.address || holder.holder || '';
        const balanceRatio = holder.balance_ratio;

        // balance_ratio 是小数形式 (0-1)，如 0.92 表示 92%
        let ratio = 0;
        if (typeof balanceRatio === 'number') {
            ratio = balanceRatio;
        } else if (typeof balanceRatio === 'string') {
            // 如果是字符串，去掉百分号并除以100
            const cleaned = balanceRatio.replace('%', '').trim();
            ratio = (parseFloat(cleaned) || 0) / 100;
        }

        // 超过 1% 意味着 ratio > 0.01 (小数形式)
        if (ratio > 0.01) {
            count++;
            const percentStr = (ratio * 100).toFixed(2) + '%';
            console.log(`${count}. ${address}`);
            console.log(`   持仓比例: ${percentStr} (原始值: ${balanceRatio})`);
            console.log(`   持仓价值: $${holder.balance_usd?.toFixed(2) || holder.main_coin_balance?.toFixed(2) || 'N/A'}`);
            console.log('');
        }
    }

    console.log(`---`);
    console.log(`总计: ${count} 个持有者的持仓比例超过 1%`);
    console.log(`总持有者数: ${holdersList.length}`);
}

queryExperimentHolders().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('错误:', err);
    process.exit(1);
});
