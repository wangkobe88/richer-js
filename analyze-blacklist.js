require('dotenv').config({ path: './config/.env' });
const { dbManager } = require('./src/services/dbManager');

async function analyzeBlacklist() {
    const supabase = dbManager.getClient();
    const experimentId = 'b64fce6a-503c-4c1e-bee1-c6031cb9194b';

    console.log('分析实验 ' + experimentId + ' 的持有者黑名单命中情况\n');

    // 1. 查询 tokens 表中被标记的代币
    console.log('=== tokens 表中的黑名单标记 ===');
    const { data: tokens, error: tokenError } = await supabase
        .from('tokens')
        .select('address, symbol, bad_holder, negative_dev, holder_check_count')
        .eq('experiment_id', experimentId);

    if (tokenError) {
        console.error('查询 tokens 表失败:', tokenError);
    } else {
        console.log('tokens 表共 ' + (tokens?.length || 0) + ' 条记录');

        const badHolderCount = tokens?.filter(t => t.bad_holder === true).length || 0;
        const negativeDevCount = tokens?.filter(t => t.negative_dev === true).length || 0;
        const anyMarked = tokens?.filter(t => t.bad_holder === true || t.negative_dev === true).length || 0;

        console.log('  bad_holder: ' + badHolderCount);
        console.log('  negative_dev: ' + negativeDevCount);
        console.log('  任意标记: ' + anyMarked);
    }

    // 2. 获取钱包黑名单
    const { data: blacklistWallets } = await supabase
        .from('wallets')
        .select('address, category')
        .in('category', ['dev', 'pump_group', 'negative_holder']);

    const blacklistSet = new Set((blacklistWallets || []).map(w => w.address.toLowerCase()));

    console.log('\n=== 钱包黑名单统计 ===');
    console.log('黑名单钱包总数: ' + blacklistSet.size);
    const byCategory = {};
    (blacklistWallets || []).forEach(w => {
        byCategory[w.category] = (byCategory[w.category] || 0) + 1;
    });
    Object.entries(byCategory).forEach(([cat, count]) => {
        console.log('  ' + cat + ': ' + count);
    });

    // 3. 查询 token_holders 表
    console.log('\n=== token_holders 表中的黑名单检测 ===');
    const { data: holders } = await supabase
        .from('token_holders')
        .select('id, token_address, holder_data, checked_at')
        .eq('experiment_id', experimentId);

    // 统计每个代币的黑名单持有者数量
    const tokenBlacklistStats = new Map();

    for (const snapshot of (holders || [])) {
        const tokenAddr = snapshot.token_address;
        if (!tokenBlacklistStats.has(tokenAddr)) {
            tokenBlacklistStats.set(tokenAddr, {
                hasBlacklist: false,
                blacklistedHolders: 0,
                snapshots: 0
            });
        }
        const stats = tokenBlacklistStats.get(tokenAddr);
        stats.snapshots++;

        if (snapshot.holder_data?.holders) {
            for (const holder of snapshot.holder_data.holders) {
                const addr = holder.address?.toLowerCase();
                if (addr && blacklistSet.has(addr)) {
                    stats.hasBlacklist = true;
                    stats.blacklistedHolders++;
                }
            }
        }
    }

    const tokensWithBlacklist = Array.from(tokenBlacklistStats.entries())
        .filter(([_, stats]) => stats.hasBlacklist);

    console.log('共检查 ' + tokenBlacklistStats.size + ' 个不同代币');
    console.log('命中黑名单的代币数: ' + tokensWithBlacklist.length);
    console.log('命中率: ' + (tokensWithBlacklist.length / tokenBlacklistStats.size * 100).toFixed(2) + '%');

    // 显示命中的代币详情
    console.log('\n=== 命中黑名单的代币详情 ===');
    tokensWithBlacklist.forEach(([tokenAddr, stats], idx) => {
        const shortAddr = tokenAddr.slice(0, 10) + '...' + tokenAddr.slice(-6);
        console.log((idx+1) + '. ' + shortAddr);
        console.log('   快照数: ' + stats.snapshots + ', 黑名单持有者数: ' + stats.blacklistedHolders);
    });

    console.log('\n=== 总结 ===');
    console.log('实验代币总数: ' + tokenBlacklistStats.size);
    console.log('命中黑名单的代币数: ' + tokensWithBlacklist.length);
    console.log('未命中黑名单的代币数: ' + (tokenBlacklistStats.size - tokensWithBlacklist.length));
}

analyzeBlacklist().then(() => process.exit(0)).catch(err => {
    console.error('错误:', err);
    process.exit(1);
});
