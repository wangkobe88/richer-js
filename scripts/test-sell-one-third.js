/**
 * 测试卖出 1/3 仓位的代币
 * 模拟交易引擎使用 FourMemeDirectTrader
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

// FourMeme 合约地址
const HELPER_ADDRESS = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034';
const PLATFORM_ADDRESS = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';
const TOKEN_ADDRESS_CHECKSUM = ethers.getAddress(TOKEN_ADDRESS);

// 初始化加密工具
const cryptoUtils = new CryptoUtils();

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
    'function sellToken(uint256 origin, address token, uint256 amount, uint256 minFunds) external'
];

async function main() {
    console.log('========================================');
    console.log('测试卖出 1/3 仓位的代币');
    console.log('========================================');
    console.log(`实验ID: ${EXPERIMENT_ID}`);
    console.log(`代币地址: ${TOKEN_ADDRESS}`);
    console.log('');

    // 初始化 Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // 获取实验配置
    console.log('📋 获取实验配置...');
    const { data: experiment } = await supabase
        .from('experiments')
        .select('*')
        .eq('id', EXPERIMENT_ID)
        .single();

    const config = typeof experiment.config === 'string'
        ? JSON.parse(experiment.config)
        : experiment.config;

    // 解析配置获取私钥
    const privateKey = cryptoUtils.decrypt(config.wallet.privateKey);

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

    // 检查代币余额
    const tokenBalance = await tokenContract.balanceOf(wallet.address);
    const tokenBalanceFormatted = ethers.formatUnits(tokenBalance, decimals);
    console.log(`✅ 代币符号: ${symbol}`);
    console.log(`✅ 代币精度: ${decimals}`);
    console.log(`✅ 代币余额: ${tokenBalanceFormatted} ${symbol}`);

    // 计算 1/3 卖出数量
    let amountToSell = tokenBalance / 3n;

    // 舍入到 6 位小数（FourMeme 合约要求）
    const amountFormatted = ethers.formatUnits(amountToSell, decimals);
    const amountRounded = Math.round(parseFloat(amountFormatted) * 1000000) / 1000000;
    amountToSell = ethers.parseUnits(amountRounded.toFixed(6), decimals);

    console.log('');
    console.log(`💰 卖出数量 (1/3): ${amountRounded} ${symbol}`);
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

    // 计算最小接收金额（考虑滑点）
    const minFunds = (estimate.funds * 9900n) / 10000n; // 1% 滑点

    // 执行卖出
    console.log('');
    console.log('🚀 执行卖出 (4 参数版本)...');

    const platformContract = new ethers.Contract(PLATFORM_ADDRESS, PLATFORM_ABI, wallet);

    console.log(`   参数:`);
    console.log(`   - origin: 0`);
    console.log(`   - token: ${TOKEN_ADDRESS_CHECKSUM}`);
    console.log(`   - amount: ${amountToSell} (${amountRounded} ${symbol})`);
    console.log(`   - minFunds: ${minFunds} (${ethers.formatEther(minFunds)} BNB)`);

    const tx = await platformContract.sellToken(
        0,                      // origin
        TOKEN_ADDRESS_CHECKSUM, // token
        amountToSell,           // amount
        minFunds,               // minFunds
        {
            gasLimit: 300000,
            gasPrice: ethers.parseUnits('5', 'gwei')
        }
    );

    console.log(`   交易已发送: ${tx.hash}`);
    console.log('   等待交易确认...');

    const receipt = await tx.wait();

    console.log('');
    console.log('========================================');
    if (receipt.status === 1) {
        console.log('✅ 卖出成功！');
        console.log(`   区块号: ${receipt.blockNumber}`);
        console.log(`   Gas 使用: ${receipt.gasUsed.toString()}`);
        console.log(`   交易哈希: ${receipt.hash}`);

        // 计算卖出后的余额
        const newBalance = await tokenContract.balanceOf(wallet.address);
        const newBalanceFormatted = ethers.formatUnits(newBalance, decimals);
        console.log(`   卖出后代币余额: ${newBalanceFormatted} ${symbol}`);
    } else {
        console.log('❌ 卖出失败');
        console.log(`   状态: ${receipt.status}`);
    }
    console.log('========================================');
}

main().catch(console.error);
