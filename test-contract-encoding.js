/**
 * 测试合约调用编码问题（简化版）
 */

const { ethers } = require('ethers');

const TOKEN_ADDRESS = '0xe72bd5e09c70638629d722ecc59d087fee5b4444';
const PLATFORM_ADDRESS = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';

async function main() {
    console.log('========================================');
    console.log('测试合约调用编码');
    console.log('========================================\n');

    // 创建 provider
    const provider = new ethers.JsonRpcProvider('https://bsc-dataseed1.binance.org');

    // 创建一个随机钱包（用于测试编码，不实际发送交易）
    const wallet = ethers.Wallet.createRandom().connect(provider);

    console.log('Platform 地址:', PLATFORM_ADDRESS);
    console.log('Token 地址:', TOKEN_ADDRESS);

    // 测试卖出数量（879074 代币）
    const sellAmount = ethers.parseUnits('879074.238414', 18);
    const minFunds = ethers.parseUnits('0.001', 18); // 0.001 BNB

    console.log('卖出数量:', ethers.formatUnits(sellAmount, 18), 'tokens');
    console.log('minFunds:', ethers.formatEther(minFunds), 'BNB');

    // 方式1: 使用完整的 v2PlatformAbi
    console.log('\n----------------------------------------');
    console.log('方式1: 使用完整 ABI');
    console.log('----------------------------------------');

    const v2PlatformAbi = [
        'function sellToken(uint256 origin, address token, uint256 amount, uint256 minFunds) external',
        'function sellToken(address token, uint256 amount) external',
        'function sellToken(address token, uint256 amount, uint256 minFunds) external',
        'function sellToken(uint256 origin, address token, uint256 amount, uint256 minFunds, uint256 feeRate, address feeRecipient) external',
        'function sellToken(uint256 origin, address token, address from, uint256 amount, uint256 minFunds, uint256 feeRate, address feeRecipient) external'
    ];

    const contract1 = new ethers.Contract(PLATFORM_ADDRESS, v2PlatformAbi, wallet);

    try {
        console.log('\n构建交易数据（使用完整 ABI）...');
        const tx1 = await contract1.sellToken.populateTransaction(
            0,
            TOKEN_ADDRESS,
            sellAmount,
            minFunds
        );
        console.log('✅ 交易数据长度:', tx1.data.length);
        console.log('✅ 函数选择器:', tx1.data.substring(0, 10));
        console.log('✅ 预期: 0x0da74935 (4参数版本)');

        // 检查是否正确编码
        if (tx1.data.startsWith('0x0da74935')) {
            console.log('✅ 匹配！');
        } else {
            console.log('❌ 不匹配！');
        }

        // 打印完整数据的前100个字符
        console.log('数据预览:', tx1.data.substring(0, 100) + '...');
    } catch (error) {
        console.log('❌ 错误:', error.message);
    }

    // 方式2: 使用单独的 4 参数 ABI
    console.log('\n----------------------------------------');
    console.log('方式2: 使用单独的 4 参数 ABI');
    console.log('----------------------------------------');

    const fourParamSellAbi = ['function sellToken(uint256 origin, address token, uint256 amount, uint256 minFunds) external'];
    const contract2 = new ethers.Contract(PLATFORM_ADDRESS, fourParamSellAbi, wallet);

    try {
        const tx2 = await contract2.sellToken.populateTransaction(
            0,
            TOKEN_ADDRESS,
            sellAmount,
            minFunds
        );
        console.log('✅ 交易数据长度:', tx2.data.length);
        console.log('✅ 函数选择器:', tx2.data.substring(0, 10));

        if (tx2.data.startsWith('0x0da74935')) {
            console.log('✅ 匹配！');
        } else {
            console.log('❌ 不匹配！');
        }

        // 对比两种方式生成的数据
        console.log('\n对比两种方式:');
        console.log('方式1 长度:', tx1.data.length);
        console.log('方式2 长度:', tx2.data.length);
        console.log('是否相同:', tx1.data === tx2.data ? '✅ 相同' : '❌ 不同');

    } catch (error) {
        console.log('❌ 错误:', error.message);
    }

    // 方式3: 直接编码
    console.log('\n----------------------------------------');
    console.log('方式3: 手动编码函数调用');
    console.log('----------------------------------------');

    try {
        const iface = new ethers.Interface([
            'function sellToken(uint256 origin, address token, uint256 amount, uint256 minFunds) external'
        ]);

        const encodedData = iface.encodeFunctionData('sellToken', [
            0,
            TOKEN_ADDRESS,
            sellAmount,
            minFunds
        ]);

        console.log('✅ 编码数据长度:', encodedData.length);
        console.log('✅ 函数选择器:', encodedData.substring(0, 10));

        if (encodedData.startsWith('0x0da74935')) {
            console.log('✅ 匹配！');
        } else {
            console.log('❌ 不匹配！');
        }
    } catch (error) {
        console.log('❌ 错误:', error.message);
    }

    console.log('\n========================================');
    console.log('结论');
    console.log('========================================');
    console.log('如果上述所有方式都能正确编码，说明 ethers.js 库工作正常。');
    console.log('生产环境中 "data: 空" 的问题可能是因为：');
    console.log('1. 合约实例创建时使用了错误的参数');
    console.log('2. wallet 没有正确初始化为 Signer');
    console.log('3. 调用合约时参数类型不匹配');
}

main().catch(console.error);
