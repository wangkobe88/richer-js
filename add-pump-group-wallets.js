/**
 * 添加流水盘钱包到 wallets 表
 */

require('dotenv').config({ path: './config/.env' });
const { dbManager } = require('./src/services/dbManager');

async function addPumpGroupWallets() {
    const supabase = dbManager.getClient();

    // 除了 0x5c952063c7fc8610ffdb798152d69f0b9550762b 之外的14个钱包
    const wallets = [
        '0x28cbbd6f7fa4ef1f64f406b93a62cdb7974f2995',
        '0xcca91b7c5f5943baabe57c0ff9fe7adcdb32744c',
        '0x1b5b9ef143a5bef667bc9cb6f1f11886798f1d0d',
        '0xe2b836c71a6882c356a70e746983e35cca0a0a66',
        '0x96fa59d379576ca269756fa36010474b924c3df5',
        '0x9f30569466a23fe49f1d5ea6d13890060897c649',
        '0xb23c6a9b392e2db54bb23dc4e7019142878a30c4',
        '0x767b7e6b6a78a79531502728652f01eccb8a8dee',
        '0x641a6ee2a836d09151ed960fdc33814c41f8008a',
        '0x01594830d3198d776667ab5245d83661ca385046',
        '0xf1a24764b7b98bf3bcd8a4f5e88168242a234429',
        '0xd3ab6528b85d61b5488e4a0e3a027b4d889935dc',
        '0x88c86e6057789dd22770f5bab3328fe3f093bbbd',
        '0x4fce08c32c391557e64f779bb4250694adde467c'
    ];

    const category = 'pump_group';
    const name = '流水盘早期持有者-0222';

    console.log(`准备添加 ${wallets.length} 个钱包到 wallets 表...`);
    console.log(`分类: ${category}`);
    console.log(`名称: ${name}`);
    console.log('');

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const address of wallets) {
        try {
            // 检查钱包是否已存在
            const { data: existing, error: checkError } = await supabase
                .from('wallets')
                .select('address, category, name')
                .eq('address', address)
                .maybeSingle();

            if (checkError) {
                console.error(`  ❌ 检查钱包 ${address} 失败:`, checkError.message);
                errorCount++;
                continue;
            }

            if (existing) {
                console.log(`  ⏭️  跳过已存在的钱包: ${address}`);
                console.log(`      当前分类: ${existing.category || '无'}, 名称: ${existing.name || '无'}`);
                skipCount++;
                continue;
            }

            // 插入新钱包
            const { data, error } = await supabase
                .from('wallets')
                .insert({
                    address: address,
                    category: category,
                    name: name
                })
                .select();

            if (error) {
                console.error(`  ❌ 插入钱包 ${address} 失败:`, error.message);
                errorCount++;
            } else {
                console.log(`  ✅ 成功添加: ${address}`);
                successCount++;
            }
        } catch (err) {
            console.error(`  ❌ 处理钱包 ${address} 时发生错误:`, err.message);
            errorCount++;
        }
    }

    console.log('');
    console.log('--- 操作完成 ---');
    console.log(`成功添加: ${successCount} 个`);
    console.log(`跳过已存在: ${skipCount} 个`);
    console.log(`失败: ${errorCount} 个`);
}

addPumpGroupWallets().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('错误:', err);
    process.exit(1);
});
