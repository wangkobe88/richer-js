/**
 * 测试真实卖出场景（使用生产环境的相同参数）
 */

const { ethers } = require('ethers');
const { CryptoUtils } = require('./src/utils/CryptoUtils');
const FourMemeDirectTrader = require('./src/trading-engine/traders/implementations/FourMemeDirectTrader');

const TOKEN_ADDRESS = '0xe72bd5e09c70638629d722ecc59d087fee5b4444'; // 暖暖
const EXPERIMENT_ID = '26e88346-fd73-4122-bba0-0d23773e2bc6';
const SELL_AMOUNT = 879074.238414; // 生产环境中的余额

async function main() {
    console.log('========================================');
    console.log('测试真实卖出场景');
    console.log('========================================\n');

    // 加载配置
    const { dbManager } = require('./src/services/dbManager');
    const supabase = dbManager.getClient();

    // 获取实验配置
    const { data: experiment, error } = await supabase
        .from('experiments')
        .select('id, config')
        .eq('id', EXPERIMENT_ID)
        .single();

    if (error || !experiment) {
        console.error('无法加载实验配置:', error);
        process.exit(1);
    }

    console.log('实验 ID:', experiment.id);

    // 解密私钥
    let privateKey;
    try {
        const walletConfig = experiment.config?.wallet || {};
        const encryptedKey = walletConfig.privateKey;
        if (!encryptedKey) {
            console.error('实验配置中没有私钥');
            process.exit(1);
        }
        const cryptoUtils = new CryptoUtils();
        privateKey = cryptoUtils.decrypt(encryptedKey);
        console.log('私钥解密成功');
        console.log('钱包地址:', new ethers.Wallet(privateKey).address);
    } catch (error) {
        console.error('私钥解密失败:', error.message);
        process.exit(1);
    }

    // 初始化交易器（使用与生产环境相同的配置）
    const traderConfig = {
        network: {
            rpcUrl: 'https://bsc-dataseed1.binance.org',
            chainId: 56
        },
        fourmeme: {
            v2PlatformAddress: '0x5c952063c7fc8610FFDB798152D69F0B9550762b',
            tokenManagerHelper: '0x475aBAee0b29F2eAFa55C34B8F8265919C8758C1'
        }
    };

    const trader = new FourMemeDirectTrader(traderConfig);
    await trader.setWallet(privateKey);
    console.log('FourMeme 交易器初始化成功\n');

    // 检查代币余额
    console.log('----------------------------------------');
    console.log('检查代币余额');
    console.log('----------------------------------------');

    const provider = trader.provider;
    const wallet = trader.wallet;
    const tokenContract = new ethers.Contract(TOKEN_ADDRESS, [
        'function balanceOf(address) view returns (uint256)',
        'function decimals() view returns (uint8)',
        'function symbol() view returns (string)',
        'function name() view returns (string)'
    ], provider);

    const balance = await tokenContract.balanceOf(wallet.address);
    const decimals = await tokenContract.decimals();
    const symbol = await tokenContract.symbol();
    const name = await tokenContract.name();

    console.log('代币名称:', name);
    console.log('代币符号:', symbol);
    console.log('代币精度:', decimals);
    console.log('代币余额:', ethers.formatUnits(balance, decimals));

    if (parseFloat(ethers.formatUnits(balance, decimals)) < parseFloat(SELL_AMOUNT.toString())) {
        console.log('余额不足，无法进行测试');
        console.log('需要:', SELL_AMOUNT);
        console.log('当前:', ethers.formatUnits(balance, decimals));
        return;
    }

    // 卖出 1/4 余额（类似生产环境的策略）
    const sellAmount = ethers.parseUnits((SELL_AMOUNT / 4).toString(), 18);

    console.log('\n----------------------------------------');
    console.log('尝试卖出 1/4 余额');
    console.log('----------------------------------------');
    console.log('卖出数量:', ethers.formatUnits(sellAmount, 18), 'tokens');

    try {
        const result = await trader.sellToken(TOKEN_ADDRESS, sellAmount, {
            slippageTolerance: 5,
            gasPrice: 10
        });

        console.log('\n========================================');
        if (result.success) {
            console.log('✅ 卖出成功！');
            console.log('========================================');
            console.log('交易哈希:', result.transactionHash);
            console.log('Gas 使用:', result.gasUsed);
            console.log('实际收到:', result.actualReceived);
        } else {
            console.log('❌ 卖出失败！');
            console.log('========================================');
            console.log('错误:', result.error);
        }
    } catch (error) {
        console.log('\n========================================');
        console.log('❌ 卖出异常！');
        console.log('========================================');
        console.log('错误:', error.message);
        console.log('错误代码:', error.code);
        if (error.transaction) {
            console.log('交易数据:', error.transaction.data || '(空!)');
        }
    }
}

main().catch(console.error);
