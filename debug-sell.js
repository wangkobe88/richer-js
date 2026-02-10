/**
 * 调试卖出失败问题
 */

const { ethers } = require('ethers');
const { CryptoUtils } = require('./src/utils/CryptoUtils');
const FourMemeDirectTrader = require('./src/trading-engine/traders/implementations/FourMemeDirectTrader');

// 代币地址
const TOKEN_ADDRESS = '0xca72921a60245b79dde4b1a0f466063884714444';
const EXPERIMENT_ID = 'e3b38443-b34f-488a-bdf4-4b23c3f9e585';

async function main() {
    console.log('========================================');
    console.log('调试 FourMeme 卖出问题');
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
    console.log('配置:', JSON.stringify(experiment.config, null, 2));

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
        console.log('\n私钥解密成功');
        console.log('钱包地址:', new ethers.Wallet(privateKey).address);
    } catch (error) {
        console.error('私钥解密失败:', error.message);
        process.exit(1);
    }

    // 初始化交易器
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
    console.log('\nFourMeme 交易器初始化成功');

    // 检查代币余额
    console.log('\n----------------------------------------');
    console.log('检查代币余额');
    console.log('----------------------------------------');

    const provider = trader.provider;
    const wallet = trader.wallet;
    const tokenContract = new ethers.Contract(TOKEN_ADDRESS, [
        'function balanceOf(address) view returns (uint256)',
        'function decimals() view returns (uint8)',
        'function symbol() view returns (string)',
        'function name() view returns (string)',
        'function allowance(address owner, address spender) view returns (uint256)',
        'function approve(address spender, uint256 amount) returns (bool)'
    ], provider);

    const balance = await tokenContract.balanceOf(wallet.address);
    const decimals = await tokenContract.decimals();
    const symbol = await tokenContract.symbol();
    const name = await tokenContract.name();

    console.log('代币名称:', name);
    console.log('代币符号:', symbol);
    console.log('代币精度:', decimals);
    console.log('代币余额:', ethers.formatUnits(balance, decimals));

    // 检查授权
    const platformAddress = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';
    const allowance = await tokenContract.allowance(wallet.address, platformAddress);
    console.log('当前授权额度:', ethers.formatUnits(allowance, decimals));

    // 如果授权不足，先授权（使用 MaxUint256 确保后续可以卖出全部余额）
    if (allowance < balance) {
        console.log('\n需要授权...');
        const tokenContractWithWallet = tokenContract.connect(wallet);
        // 使用 MaxUint256 而不是 balance，避免后续卖出时授权不足
        const approveTx = await tokenContractWithWallet.approve(platformAddress, ethers.MaxUint256);
        console.log('授权交易已发送:', approveTx.hash);
        await approveTx.wait();
        console.log('授权成功！');
    }

    // 预估卖出
    console.log('\n----------------------------------------');
    console.log('预估卖出结果');
    console.log('----------------------------------------');

    try {
        const helperContract = new ethers.Contract(
            '0x475aBAee0b29F2eAFa55C34B8F8265919C8758C1',
            ['function trySell(address token, uint256 amount) view returns (tuple(address tokenManager, uint256 funds, uint256 fee))'],
            provider
        );

        const sellEstimate = await helperContract.trySell(TOKEN_ADDRESS, balance);
        console.log('预估获得 BNB:', ethers.formatEther(sellEstimate.funds));
        console.log('预估费用:', ethers.formatEther(sellEstimate.fee));
        console.log('预估净收入:', ethers.formatEther(sellEstimate.funds - sellEstimate.fee));
        console.log('TokenManager:', sellEstimate.tokenManager);
    } catch (error) {
        console.error('预估失败:', error.message);
    }

    // 尝试卖出（卖出用户当时卖出的相同数量 609292.49 tokens）
    console.log('\n----------------------------------------');
    console.log('尝试卖出 (使用用户相同的参数)');
    console.log('----------------------------------------');

    const userSellAmount = BigInt('609292492857000000000000');
    const userMinFunds = BigInt('3010414165648553'); // 0.003010414165648553 BNB

    console.log('目标卖出数量:', ethers.formatUnits(userSellAmount, decimals));
    console.log('当前余额:', ethers.formatUnits(balance, decimals));
    console.log('用户使用的 minFunds:', ethers.formatEther(userMinFunds), 'BNB');

    // 检查余额是否足够
    let sellAmount;
    let minFunds;
    if (balance < userSellAmount) {
        console.log('\n余额不足，按比例计算卖出参数');
        sellAmount = balance * 80n / 100n; // 卖出 80%
        minFunds = (sellAmount * userMinFunds) / userSellAmount;
        console.log('实际卖出数量:', ethers.formatUnits(sellAmount, decimals));
        console.log('计算出的 minFunds:', ethers.formatEther(minFunds), 'BNB');
    } else {
        sellAmount = userSellAmount;
        minFunds = userMinFunds;
        console.log('余额足够，使用用户相同的参数');
    }

    // 方式1: 4参数版本 (用户成功使用的方法，使用相同的 minFunds)
    console.log('\n[尝试1] 4参数版本，使用用户相同的 minFunds...');
    try {
        const platformContract = new ethers.Contract(
            platformAddress,
            ['function sellToken(uint256 origin, address token, uint256 amount, uint256 minFunds) payable'],
            wallet
        );

        const tx = await platformContract.sellToken(
            0,
            TOKEN_ADDRESS,
            sellAmount,
            minFunds,  // 使用用户相同的 minFunds
            {
                gasLimit: 300000,
                gasPrice: ethers.parseUnits('10', 'gwei')
            }
        );
        console.log('交易已发送:', tx.hash);

        const receipt = await tx.wait();
        console.log('交易状态:', receipt.status === 1 ? '成功' : '失败');
        console.log('Gas 使用:', receipt.gasUsed.toString());

        if (receipt.status === 1) {
            console.log('✅ 卖出成功！');

            // 继续测试 FourMemeDirectTrader
            console.log('\n========================================');
            console.log('测试 FourMemeDirectTrader');
            console.log('========================================');

            // 检查新的余额
            const newBalance = await tokenContract.balanceOf(wallet.address);
            console.log('卖出后余额:', ethers.formatUnits(newBalance, decimals));

            if (newBalance > 0) {
                // 使用 FourMemeDirectTrader 卖出剩余余额的 1/4
                const traderSellAmount = newBalance / 4n;
                console.log('\n使用 FourMemeDirectTrader 卖出 1/4 余额...');
                console.log('卖出数量:', ethers.formatUnits(traderSellAmount, decimals));

                const traderResult = await trader.sellToken(TOKEN_ADDRESS, traderSellAmount);
                console.log('FourMemeDirectTrader 结果:', JSON.stringify(traderResult, null, 2));

                if (traderResult.success) {
                    console.log('\n✅ FourMemeDirectTrader 卖出成功！');
                    console.log('交易哈希:', traderResult.transactionHash);
                    console.log('Gas 使用:', traderResult.gasUsed);
                } else {
                    console.log('\n❌ FourMemeDirectTrader 卖出失败:', traderResult.error);
                }
            } else {
                console.log('余额为 0，无需继续测试');
            }

            return;
        }
    } catch (error) {
        console.error('失败:', error.message);
        console.error('错误代码:', error.code);
        console.error('错误数据:', error.data);
    }

    // 方式2: 2参数版本
    console.log('\n[尝试2] 2参数版本 sellToken(address token, uint256 amount)...');
    try {
        const platformContract = new ethers.Contract(
            platformAddress,
            ['function sellToken(address token, uint256 amount) payable'],
            wallet
        );

        const tx = await platformContract.sellToken(
            TOKEN_ADDRESS,
            sellAmount,
            {
                gasLimit: 300000,
                gasPrice: ethers.parseUnits('10', 'gwei')
            }
        );
        console.log('交易已发送:', tx.hash);

        const receipt = await tx.wait();
        console.log('交易状态:', receipt.status === 1 ? '成功' : '失败');
        console.log('Gas 使用:', receipt.gasUsed.toString());

        if (receipt.status === 1) {
            console.log('✅ 卖出成功！');
            return;
        }
    } catch (error) {
        console.error('失败:', error.message);
        console.error('错误代码:', error.code);
        console.error('错误数据:', error.data);
    }

    // 方式3: 6参数版本
    console.log('\n[尝试3] 6参数版本 sellToken(uint256 origin, address token, uint256 amount, uint256 minFunds, uint256 feeRate, address feeRecipient)...');
    try {
        const platformContract = new ethers.Contract(
            platformAddress,
            ['function sellToken(uint256 origin, address token, uint256 amount, uint256 minFunds, uint256 feeRate, address feeRecipient) payable'],
            wallet
        );

        const tx = await platformContract.sellToken(
            0,
            TOKEN_ADDRESS,
            sellAmount,
            0,  // minFunds = 0，不设置滑点保护
            0,  // feeRate = 0
            wallet.address,
            {
                gasLimit: 300000,
                gasPrice: ethers.parseUnits('10', 'gwei')
            }
        );
        console.log('交易已发送:', tx.hash);

        const receipt = await tx.wait();
        console.log('交易状态:', receipt.status === 1 ? '成功' : '失败');
        console.log('Gas 使用:', receipt.gasUsed.toString());

        if (receipt.status === 1) {
            console.log('✅ 卖出成功！');
            return;
        }
    } catch (error) {
        console.error('失败:', error.message);
        console.error('错误代码:', error.code);
        console.error('错误数据:', error.data);
    }

    console.log('\n========================================');
    console.log('三种方式都失败了');
    console.log('========================================');

    // 检查代币是否被 FourMeme 支持
    console.log('\n----------------------------------------');
    console.log('检查代币在 FourMeme 平台的状态');
    console.log('----------------------------------------');

    try {
        const helperContract = new ethers.Contract(
            '0xF251F83e40a78868FcfA3FA4599Dad6494E46034',
            [
                'function trySell(address token, uint256 amount) view returns (tuple(address tokenManager, uint256 funds, uint256 fee))',
                'function isTokenSupported(address token) view returns (bool)',
                'function getTokenInfo(address token) view returns (tuple(bool isSupported, address quote, uint256 lastPrice, uint256 tradingFeeRate, uint256 tokenManager))'
            ],
            provider
        );

        // 检查代币信息
        console.log('查询代币信息...');
        const tokenInfo = await helperContract.getTokenInfo(TOKEN_ADDRESS);
        console.log('代币信息:');
        console.log('  是否支持:', tokenInfo.isSupported);
        console.log('  报价代币:', tokenInfo.quote);
        console.log('  最后价格:', ethers.formatEther(tokenInfo.lastPrice));
        console.log('  交易费率:', Number(tokenInfo.tradingFeeRate) / 10000, '%');
        console.log('  TokenManager:', tokenInfo.tokenManager);

        // 尝试预估卖出
        console.log('\n尝试预估卖出...');
        const sellEstimate = await helperContract.trySell(TOKEN_ADDRESS, sellAmount);
        console.log('预估结果:');
        console.log('  TokenManager:', sellEstimate.tokenManager);
        console.log('  预估获得 BNB:', ethers.formatEther(sellEstimate.funds));
        console.log('  预估费用:', ethers.formatEther(sellEstimate.fee));
        console.log('  预估净收入:', ethers.formatEther(sellEstimate.funds - sellEstimate.fee));

        // 检查 TokenManager 版本
        const platformAddress = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';
        if (sellEstimate.tokenManager.toLowerCase() !== platformAddress.toLowerCase()) {
            console.log('\n⚠️ 警告: 代币由不同的 TokenManager 管理！');
            console.log('  预期:', platformAddress);
            console.log('  实际:', sellEstimate.tokenManager);
        }

    } catch (error) {
        console.error('查询失败:', error.message);
    }
}

main().catch(console.error);
