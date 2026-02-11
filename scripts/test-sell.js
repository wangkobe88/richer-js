/**
 * 测试卖出代币
 * 实验: 7c5c6fa5-6dcf-43fe-b7f1-0d9c79f2c248
 * 代币: 0xcd29dfc4626e669c77325d6a257026cc0cfe4444
 * 卖出数量: 1/4 持仓
 */

// 先加载环境变量（指定 .env 文件路径）
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const { ethers } = require('ethers');
const { createClient } = require('@supabase/supabase-js');
const { CryptoUtils } = require('../src/utils/CryptoUtils');

// 配置
const SUPABASE_URL = 'https://jbhgrhwcznukmsprimlx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpiaGdyaHdjem51a21zcHJpbWx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEwNTU5ODEsImV4cCI6MjA1NjYzMTk4MX0.A_P9jMctmr-apy32S_fljjtCmWBrQfIr6iSppVCEMm8';
const EXPERIMENT_ID = '7c5c6fa5-6dcf-43fe-b7f1-0d9c79f2c248';
const TOKEN_ADDRESS = '0xcd29dfc4626e669c77325d6a257026cc0cfe4444';

// BSC RPC
const BSC_RPC = 'https://bsc-dataseed.binance.org';

// 初始化加密工具
const cryptoUtils = new CryptoUtils();

// FourMeme 合约地址（从项目中获取的正确地址）
const HELPER_ADDRESS = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034';
const PLATFORM_ADDRESS = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';
const TOKEN_ADDRESS_CHECKSUM = ethers.getAddress(TOKEN_ADDRESS);

// PancakeSwap Router 地址
const PANCAKESWAP_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const PANCAKESWAP_FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

// ABIs
const HELPER_ABI = [
    'function trySell(address token, uint256 amount) external view returns (address tokenManager, address quote, uint256 funds, uint256 fee)'
];

const TOKEN_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)'
];

const PLATFORM_ABI = [
    'function sellToken(uint256 origin, address token, uint256 amount, uint256 minFunds) external',
    'function _tokenInfos(address) view returns (address base, address quote, uint256 template, uint256 totalSupply, uint256 maxOffers, uint256 maxRaising, uint256 launchTime, uint256 offers, uint256 funds, uint256 lastPrice, uint256 K, uint256 T, uint256 status)'
];

// PancakeSwap Router ABI
const PANCAKESWAP_ROUTER_ABI = [
    'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
    'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external'
];

// PancakeSwap Factory ABI
const PANCAKESWAP_FACTORY_ABI = [
    'function getPair(address tokenA, address tokenB) external view returns (address pair)'
];

async function main() {
    console.log('========================================');
    console.log('测试卖出代币');
    console.log('========================================');
    console.log(`实验ID: ${EXPERIMENT_ID}`);
    console.log(`代币地址: ${TOKEN_ADDRESS}`);
    console.log('');

    // 初始化 Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // 获取实验配置
    console.log('📋 获取实验配置...');
    const { data: experiment, error: expError } = await supabase
        .from('experiments')
        .select('*')
        .eq('id', EXPERIMENT_ID)
        .single();

    if (expError || !experiment) {
        console.error('❌ 获取实验失败:', expError?.message);
        return;
    }

    console.log(`✅ 实验名称: ${experiment.name}`);
    console.log(`✅ 实验状态: ${experiment.status}`);

    // 解析配置获取私钥
    let privateKey;
    try {
        const config = typeof experiment.config === 'string'
            ? JSON.parse(experiment.config)
            : experiment.config;

        // 从 wallet 中获取私钥
        const encryptedKey = config?.wallet?.privateKey;
        if (!encryptedKey) {
            console.error('❌ 配置中没有找到钱包私钥');
            console.error('Config keys:', Object.keys(config));
            console.error('Wallet keys:', config?.wallet ? Object.keys(config.wallet) : 'null');
            return;
        }

        console.log(`   加密私钥前10字符: ${encryptedKey.substring(0, 10)}...`);
        console.log(`   加密私钥长度: ${encryptedKey.length}`);

        privateKey = cryptoUtils.decrypt(encryptedKey);
        console.log(`✅ 钱包私钥已解密`);
        console.log(`   私钥前10字符: ${privateKey.substring(0, 10)}...`);
    } catch (err) {
        console.error('❌ 解析配置失败:', err.message);
        console.error('   Stack:', err.stack);
        return;
    }

    // 连接到 BSC
    console.log('');
    console.log('🔗 连接到 BSC 网络...');
    const provider = new ethers.JsonRpcProvider(BSC_RPC);
    const wallet = new ethers.Wallet(privateKey, provider);
    console.log(`✅ 钱包地址: ${wallet.address}`);

    // 检查 BNB 余额
    const bnbBalance = await provider.getBalance(wallet.address);
    console.log(`✅ BNB 余额: ${ethers.formatEther(bnbBalance)} BNB`);

    // 连接代币合约
    console.log('');
    console.log('🪙 连接代币合约...');
    const tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, wallet);
    const symbol = await tokenContract.symbol();
    const decimals = await tokenContract.decimals();
    console.log(`✅ 代币符号: ${symbol}`);
    console.log(`✅ 代币精度: ${decimals}`);

    // 检查代币余额
    const tokenBalance = await tokenContract.balanceOf(wallet.address);
    const tokenBalanceFormatted = ethers.formatUnits(tokenBalance, decimals);
    console.log(`✅ 代币余额: ${tokenBalanceFormatted} ${symbol}`);

    // 计算 1/4 卖出数量
    let amountToSell = tokenBalance / 4n;

    // 舍入到 6 位小数（与成功交易一致）
    const amountFormatted = ethers.formatUnits(amountToSell, decimals);
    const amountRounded = Math.round(parseFloat(amountFormatted) * 1000000) / 1000000;
    amountToSell = ethers.parseUnits(amountRounded.toFixed(6), decimals);

    console.log('');
    console.log(`💰 卖出数量 (1/4): ${amountRounded} ${symbol}`);
    console.log(`   原始 amount: ${amountFormatted} ${symbol}`);
    console.log(`   舍入后: ${amountRounded.toFixed(6)} ${symbol}`);
    console.log(`   Wei: ${amountToSell.toString()}`);

    // 连接 Helper 合约
    console.log('');
    console.log('🔍 查询卖出预估...');
    const helperContract = new ethers.Contract(HELPER_ADDRESS, HELPER_ABI, provider);
    const estimate = await helperContract.trySell(TOKEN_ADDRESS_CHECKSUM, amountToSell);
    console.log(`   TokenManager: ${estimate.tokenManager}`);
    console.log(`   预估获得: ${ethers.formatEther(estimate.funds)} BNB`);
    console.log(`   预估费用: ${ethers.formatEther(estimate.fee)} BNB`);
    console.log(`   净收入: ${ethers.formatEther(estimate.funds - estimate.fee)} BNB`);

    // 检查授权
    console.log('');
    console.log('🔐 检查授权...');
    const currentAllowance = await tokenContract.allowance(wallet.address, PLATFORM_ADDRESS);
    console.log(`   当前授权额度: ${ethers.formatUnits(currentAllowance, decimals)} ${symbol}`);

    if (currentAllowance < amountToSell) {
        console.log('   授权额度不足，正在授权...');
        const approveTx = await tokenContract.approve(PLATFORM_ADDRESS, amountToSell);
        console.log(`   授权交易: ${approveTx.hash}`);
        await approveTx.wait();
        console.log('   ✅ 授权完成');
    } else {
        console.log('   ✅ 授权额度充足');
    }

    // 查询代币在 TokenManager 上的状态
    console.log('');
    console.log('📊 查询代币状态...');
    const platformContractForQuery = new ethers.Contract(PLATFORM_ADDRESS, PLATFORM_ABI, provider);
    try {
        const tokenInfo = await platformContractForQuery._tokenInfos(TOKEN_ADDRESS_CHECKSUM);
        console.log(`   代币状态: ${tokenInfo.status}`);
        console.log(`   总供应量: ${ethers.formatUnits(tokenInfo.totalSupply, 18)} ${symbol}`);
        console.log(`   最大筹集: ${ethers.formatEther(tokenInfo.maxRaising)} BNB`);
        console.log(`   已筹集: ${ethers.formatEther(tokenInfo.funds)} BNB`);
        console.log(`   Offers: ${tokenInfo.offers}`);
        console.log(`   上次价格: ${ethers.formatEther(tokenInfo.lastPrice)} BNB`);
        console.log(`   上架时间: ${tokenInfo.launchTime}`);

        // 检查时间限制
        const currentBlock = await provider.getBlockNumber();
        const currentBlockTime = (await provider.getBlock(currentBlock)).timestamp;
        const launchTime = Number(tokenInfo.launchTime);
        const timeSinceLaunch = currentBlockTime - launchTime;

        console.log(`   当前区块时间: ${currentBlockTime}`);
        console.log(`   距离上架: ${timeSinceLaunch} 秒 (${(timeSinceLaunch / 60).toFixed(2)} 分钟)`);

        // FourMeme 可能有买入后必须等待一段时间才能卖出的限制
        // 检查是否在等待期内
        if (timeSinceLaunch < 300) { // 5 分钟
            console.log(`   ⚠️ 代币上架不到 5 分钟，可能存在卖出限制`);
        }
        if (timeSinceLaunch < 60) { // 1 分钟
            console.log(`   ⚠️ 代币上架不到 1 分钟，GW 可能表示 "Gate Wait"（门控等待）`);
        }

        // 检查状态
        // 0 = active, 1 = completed, 2 = failed 等
        if (tokenInfo.status === 1n) {
            console.log(`   ⚠️ 代币状态为 completed (bonding curve 已饱和)`);
            console.log(`   这意味着代币已经不在内盘交易，需要通过 DEX 卖出`);
        }
    } catch (error) {
        console.log(`   查询失败: ${error.message}`);
    }

    // 计算最小接收金额（考虑滑点）
    const minFunds = (estimate.funds * 9900n) / 10000n; // 1% 滑点

    // 执行卖出
    console.log('');
    console.log('🚀 执行卖出 (4 参数版本)...');

    // 先使用 Interface 查看生成的交易数据
    const iface = new ethers.Interface(PLATFORM_ABI);
    const encodedData = iface.encodeFunctionData('sellToken', [
        0,                      // origin
        TOKEN_ADDRESS_CHECKSUM, // token
        amountToSell,           // amount
        minFunds                // minFunds
    ]);

    console.log(`   编码后的交易数据 (前100字符): ${encodedData.substring(0, 100)}...`);
    console.log(`   交易数据长度: ${encodedData.length}`);

    const platformContract = new ethers.Contract(PLATFORM_ADDRESS, PLATFORM_ABI, wallet);

    console.log(`   参数:`);
    console.log(`   - origin: 0`);
    console.log(`   - token: ${TOKEN_ADDRESS_CHECKSUM}`);
    console.log(`   - amount: ${amountToSell} (${ethers.formatUnits(amountToSell, decimals)} ${symbol})`);
    console.log(`   - minFunds: ${minFunds} (${ethers.formatEther(minFunds)} BNB)`);

    // 先尝试静态调用以获取更详细的错误信息
    console.log('');
    console.log('🔍 静态调用测试...');
    try {
        await provider.estimateGas({
            to: PLATFORM_ADDRESS,
            from: wallet.address,
            data: encodedData
        });
        console.log('   ✅ Gas 估算成功');
    } catch (estimateError) {
        console.log(`   ❌ Gas 估算失败: ${estimateError.message}`);
    }

    let tx;
    let sellSuccess = false;
    let sellMethod = '';

    try {
        tx = await platformContract.sellToken(
            0,                      // origin
            TOKEN_ADDRESS_CHECKSUM, // token
            amountToSell,           // amount
            minFunds,               // minFunds
            {
                gasLimit: 300000,
                gasPrice: ethers.parseUnits('5', 'gwei')  // 使用 5 Gwei，与成功的交易相同
            }
        );

        console.log(`   交易已发送 (FourMeme): ${tx.hash}`);
        console.log('   等待交易确认...');

        const receipt = await tx.wait();
        sellSuccess = true;
        sellMethod = 'FourMeme';

        console.log('');
        console.log('========================================');
        if (receipt.status === 1) {
            console.log('✅ 卖出成功！');
            console.log(`   区块号: ${receipt.blockNumber}`);
            console.log(`   Gas 使用: ${receipt.gasUsed.toString()}`);
            console.log(`   方法: ${sellMethod}`);
        } else {
            console.log('❌ 卖出失败');
            console.log(`   状态: ${receipt.status}`);
        }
        console.log('========================================');
        return;
    } catch (fourmemeError) {
        console.log(`   ❌ FourMeme 卖出失败: ${fourmemeError.message.substring(0, 100)}`);
        throw fourmemeError;
    }

    console.log('');
    console.log('========================================');
    if (receipt.status === 1) {
        console.log('✅ 卖出成功！');
        console.log(`   区块号: ${receipt.blockNumber}`);
        console.log(`   Gas 使用: ${receipt.gasUsed.toString()}`);
    } else {
        console.log('❌ 卖出失败');
        console.log(`   状态: ${receipt.status}`);
    }
    console.log('========================================');
}

main().catch(console.error);
