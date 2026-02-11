/**
 * 测试合约调用编码问题
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

    // 测试私钥（从 debug-sell.js 中使用的相同实验）
    const privateKey = '0x7d2f3d7b5fc1275f981e44a130c0a8e9:fb14971968f191513b9bad22ac8659e7fe850257d87a5078ec56d6c18271989e400582d0d2e2843f8fd206c9c50584c9791294ec50ef0b557a8b5a8c8d993daff312154083e2c39d8e279a0314763c';

    // 解密私钥
    const { CryptoUtils } = require('./src/utils/CryptoUtils');
    const cryptoUtils = new CryptoUtils();
    const decryptedKey = cryptoUtils.decrypt(privateKey);
    const wallet = new ethers.Wallet(decryptedKey, provider);

    console.log('钱包地址:', wallet.address);
    console.log('Platform 地址:', PLATFORM_ADDRESS);
    console.log('Token 地址:', TOKEN_ADDRESS);

    // 测试卖出数量（879074 代币）
    const sellAmount = ethers.parseUnits('879074.238414', 18);
    console.log('\n卖出数量:', ethers.formatUnits(sellAmount, 18), 'tokens');

    // 方式1: 使用完整的 v2PlatformAbi
    console.log('\n----------------------------------------');
    console.log('方式1: 使用完整 ABI (v2PlatformAbi)');
    console.log('----------------------------------------');

    const v2PlatformAbi = [
        'function sellToken(uint256 origin, address token, uint256 amount, uint256 minFunds) external',
        'function sellToken(address token, uint256 amount) external',
        'function sellToken(address token, uint256 amount, uint256 minFunds) external',
        'function sellToken(uint256 origin, address token, uint256 amount, uint256 minFunds, uint256 feeRate, address feeRecipient) external',
        'function sellToken(uint256 origin, address token, address from, uint256 amount, uint256 minFunds, uint256 feeRate, address feeRecipient) external',
        'function _tokenInfos(address) view returns (address base, address quote, uint256 template, uint256 totalSupply, uint256 maxOffers, uint256 maxRaising, uint256 launchTime, uint256 offers, uint256 funds, uint256 lastPrice, uint256 K, uint256 T, uint256 status)'
    ];

    const contract1 = new ethers.Contract(PLATFORM_ADDRESS, v2PlatformAbi, wallet);

    try {
        // 先预估 - 使用 trySell
        const helperAbi = ['function trySell(address token, uint256 amount) view returns (address tokenManager, address quote, uint256 funds, uint256 fee)'];
        const helperAddress = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034';
        const helperContract = new ethers.Contract(helperAddress, helperAbi, provider);

        const sellEstimate = await helperContract.trySell(TOKEN_ADDRESS, sellAmount);
        console.log('预估结果:');
        console.log('  funds:', ethers.formatEther(sellEstimate.funds), 'BNB');
        console.log('  fee:', ethers.formatEther(sellEstimate.fee), 'BNB');
        console.log('  净收入:', ethers.formatEther(sellEstimate.funds - sellEstimate.fee), 'BNB');

        const minFunds = sellEstimate.funds > 0n ? (sellEstimate.funds * 95n) / 100n : 1n;
        console.log('  minFunds (95%):', ethers.formatEther(minFunds), 'BNB');

        // 构建 transaction 对象来查看 data
        console.log('\n构建交易数据...');
        const tx1 = await contract1.sellToken.populateTransaction(
            0,
            TOKEN_ADDRESS,
            sellAmount,
            minFunds,
            { gasLimit: 300000 }
        );
        console.log('交易数据长度:', tx1.data.length);
        console.log('交易数据前缀:', tx1.data.substring(0, 10));
        console.log('函数选择器:', tx1.data.substring(0, 10), '(应为 0x0da74935)');

        // 检查是否正确编码
        if (tx1.data.startsWith('0x0da74935')) {
            console.log('✅ 4参数版本 sellToken 编码正确');
        } else {
            console.log('❌ 函数选择器不匹配！');
        }

        // 尝试发送交易
        console.log('\n发送交易...');
        const txResponse = await contract1.sellToken(
            0,
            TOKEN_ADDRESS,
            sellAmount,
            minFunds,
            { gasLimit: 300000, gasPrice: ethers.parseUnits('10', 'gwei') }
        );
        console.log('交易已发送:', txResponse.hash);
        console.log('交易数据长度:', txResponse.data.length);

        const receipt = await txResponse.wait();
        console.log('交易状态:', receipt.status === 1 ? '成功 ✅' : '失败 ❌');
        console.log('Gas 使用:', receipt.gasUsed.toString());

    } catch (error) {
        console.log('错误:', error.message);
        if (error.transaction) {
            console.log('交易数据:', error.transaction.data || '(空!)');
            console.log('交易数据长度:', error.transaction.data?.length || 0);
        }
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
            1n, // minFunds
            { gasLimit: 300000 }
        );
        console.log('交易数据长度:', tx2.data.length);
        console.log('函数选择器:', tx2.data.substring(0, 10));

        if (tx2.data.startsWith('0x0da74935')) {
            console.log('✅ 函数选择器正确');
        } else {
            console.log('❌ 函数选择器错误');
        }
    } catch (error) {
        console.log('错误:', error.message);
    }

    console.log('\n========================================');
}

main().catch(console.error);
