require('dotenv').config({ path: './config/.env' });
const { dbManager } = require('./src/services/dbManager');

async function analyze() {
    const supabase = dbManager.getClient();
    const experimentId = '3fe54786-e010-42da-990e-80a5032124f3';

    console.log('=== 查询 token_holders 表中的黑名单数据 ===');

    // 查询有黑名单持有者信息的快照
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
                        snapshotCount: 0,
                        blacklistCount: blacklistedHolders.length,
                        blacklistHolders: blacklistedHolders
                    });
                }
            }
        }
    });

    console.log('有黑名单持有者的代币数:', tokensWithBlacklist.size);
    console.log('');

    if (tokensWithBlacklist.size > 0) {
        // 获取这些代币的状态
        const tokenAddresses = Array.from(tokensWithBlacklist.keys());

        const { data: tokens } = await supabase
            .from('experiment_tokens')
            .select('token_address, token_symbol, status')
            .eq('experiment_id', experimentId)
            .in('token_address', tokenAddresses);

        console.log('=== 黑名单持有者代币状态 ===');
        tokensWithBlacklist.forEach((info, addr) => {
            const token = tokens ? tokens.find(t => t.token_address === addr) : null;
            const symbol = token ? token.token_symbol : addr.substring(0, 10);
            const status = token ? token.status : 'unknown';
            const isBadHolder = status === 'bad_holder';

            console.log('代币: ' + symbol);
            console.log('  地址: ' + addr);
            console.log('  状态: ' + status + (isBadHolder ? ' ✓' : ' ✗ (应该是 bad_holder)'));
            console.log('  黑名单持有者数: ' + info.blacklistCount);

            // 显示黑名单详情
            info.blacklistHolders.forEach(bh => {
                console.log('    - ' + bh.category + ': ' + bh.address);
            });
            console.log('');
        });

        // 统计
        const badHolderCount = tokens ? tokens.filter(t => t.status === 'bad_holder').length : 0;
        console.log('=== 统计 ===');
        console.log('有黑名单持有者的代币:', tokensWithBlacklist.size);
        console.log('状态为 bad_holder 的代币:', badHolderCount);
        console.log('应该修复的数量:', tokensWithBlacklist.size - badHolderCount);

    } else {
        console.log('没有找到有黑名单持有者的代币');
    }

    process.exit(0);
}

analyze().catch(err => {
    console.error('错误:', err);
    process.exit(1);
});
