require('dotenv').config({ path: './config/.env' });
const { dbManager } = require('./src/services/dbManager');

async function analyze() {
    const supabase = dbManager.getClient();
    const experimentId = '618e3bdf-e947-4ae1-b946-28cfcb6cb961';

    console.log('=== 代币状态分布 ===');
    const { data: tokens } = await supabase
        .from('experiment_tokens')
        .select('status')
        .eq('experiment_id', experimentId);

    const statusCount = {};
    if (tokens) {
        tokens.forEach(t => {
            statusCount[t.status] = (statusCount[t.status] || 0) + 1;
        });
    }

    console.log('总代币数:', tokens ? tokens.length : 0);
    Object.entries(statusCount).forEach(([status, count]) => {
        console.log(status + ': ' + count);
    });
    console.log('');

    console.log('=== 查询 token_holders 表中的黑名单数据 ===');
    const pageSize = 100;
    let offset = 0;
    let hasMore = true;
    let allSnapshots = [];

    while (hasMore) {
        const { data, error } = await supabase
            .from('token_holders')
            .select('*')
            .eq('experiment_id', experimentId)
            .range(offset, offset + pageSize - 1);

        if (error) {
            console.error('查询失败:', error);
            break;
        }

        if (data && data.length > 0) {
            allSnapshots = allSnapshots.concat(data);
            offset += pageSize;
            hasMore = data.length === pageSize;
        } else {
            hasMore = false;
        }
    }

    console.log('持有者快照总数:', allSnapshots.length);
    console.log('');

    // 找出有黑名单持有者的代币
    const tokensWithBlacklist = new Map();
    let totalBlacklistedHolders = 0;

    allSnapshots.forEach(snapshot => {
        const holderData = snapshot.holder_data;
        if (holderData && holderData.holders) {
            const blacklistedHolders = holderData.holders.filter(h =>
                h.category === 'pump_group' ||
                h.category === 'negative_holder' ||
                h.category === 'dev'
            );

            if (blacklistedHolders.length > 0) {
                const tokenAddr = snapshot.token_address;
                if (!tokensWithBlacklist.has(tokenAddr)) {
                    tokensWithBlacklist.set(tokenAddr, {
                        address: tokenAddr,
                        blacklistCount: blacklistedHolders.length,
                        blacklistHolders: blacklistedHolders,
                        snapshotId: snapshot.snapshot_id
                    });
                }
                totalBlacklistedHolders += blacklistedHolders.length;
            }
        }
    });

    console.log('有黑名单持有者的代币数:', tokensWithBlacklist.size);
    console.log('总黑名单持有者数:', totalBlacklistedHolders);
    console.log('');

    if (tokensWithBlacklist.size > 0) {
        // 获取这些代币的状态
        const tokenAddresses = Array.from(tokensWithBlacklist.keys());

        const { data: tokensWithStatus } = await supabase
            .from('experiment_tokens')
            .select('token_address, token_symbol, status, platform')
            .eq('experiment_id', experimentId)
            .in('token_address', tokenAddresses);

        console.log('=== 黑名单持有者代币状态详情 ===');
        let badHolderCount = 0;
        let monitoringCount = 0;
        let otherCount = 0;

        tokensWithBlacklist.forEach((info, addr) => {
            const token = tokensWithStatus ? tokensWithStatus.find(t => t.token_address === addr) : null;
            const symbol = token ? token.token_symbol : addr.substring(0, 10);
            const status = token ? token.status : 'not_found';
            const platform = token ? token.platform : 'unknown';

            console.log('代币: ' + symbol);
            console.log('  地址: ' + addr);
            console.log('  平台: ' + platform);
            console.log('  状态: ' + status);
            console.log('  黑名单持有者数: ' + info.blacklistCount);

            // 显示黑名单详情
            console.log('  黑名单详情:');
            info.blacklistHolders.forEach(bh => {
                console.log('    - ' + bh.category + ': ' + bh.address);
            });
            console.log('');

            if (status === 'bad_holder') badHolderCount++;
            else if (status === 'monitoring') monitoringCount++;
            else otherCount++;
        });

        console.log('=== 统计 ===');
        console.log('有黑名单持有者的代币总数:', tokensWithBlacklist.size);
        console.log('状态为 bad_holder:', badHolderCount);
        console.log('状态为 monitoring:', monitoringCount);
        console.log('其他状态:', otherCount);
    } else {
        console.log('没有找到有黑名单持有者的代币');
    }

    process.exit(0);
}

analyze().catch(err => {
    console.error('错误:', err);
    process.exit(1);
});
