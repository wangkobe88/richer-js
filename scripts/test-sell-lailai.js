/**
 * 测试卖出 "链来" 代币
 * 实验: a46d01ed-f5ed-4f39-a081-396ee7633a50
 */
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const { ethers } = require('ethers');
const { createClient } = require('@supabase/supabase-js');
const { CryptoUtils } = require('../src/utils/CryptoUtils');

const SUPABASE_URL = 'https://jbhgrhwcznukmsprimlx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpiaGdyaHdjem51a21zcHJpbWx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEwNTU5ODEsImV4cCI6MjA1NjYzMTk4MX0.A_P9jMctmr-apy32S_fljjtCmWBrQfIr6iSppVCEMm8';

const BSC_RPC = 'https://bsc-dataseed.binance.org';
const HELPER_ADDRESS = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034';
const PLATFORM_ADDRESS = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';

// 链来代币地址
const TOKEN_ADDRESS = '0x880d3a792773d16f84646ef817f1f6048d4444';
const TOKEN_ADDRESS_CHECKSUM = ethers.getAddress(TOKEN_ADDRESS);

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
    console.log('测试卖出 "链来" 代币');
    console.log('========================================');

    // 连接 BSC
    const provider = new ethers.JsonRpcProvider(BSC_RPC);

    // 获取钱包 - 从实验 ce2b995d 获取（它们使用同一个钱包）
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data: exp } = await supabase
        .from('experiments')
        .select('config')
        .eq('id', 'ce2b995d-99b0-485b-a959-0162a6718434')
        .single();

    const cryptoUtils = new CryptoUtils();
    const config = typeof exp.config === 'string' ? JSON.parse(exp.config) : exp.config;
    const privateKey = cryptoUtils.decrypt(config.wallet.privateKey);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log(`钱包地址: ${wallet.address}`);

    // 检查代币余额
    const tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, wallet);
    const symbol = await tokenContract.symbol();
    const decimals = await tokenContract.decimals();
    const tokenBalance = await tokenContract.balanceOf(wallet.address);
    const tokenBalanceFormatted = ethers.formatUnits(tokenBalance, decimals);

    console.log(`代币: ${symbol}`);
    console.log(`代币余额: ${tokenBalanceFormatted}`);

    if (tokenBalance === 0n) {
        console.log('❌ 代币余额为 0，无需卖出');
        return;
    }

    // 计算卖出数量（1/3）
    let amountToSell = tokenBalance / 3n;

    // 舍入到 6 位小数
    const amountFormatted = ethers.formatUnits(amountToSell, decimals);
    const amountRounded = Math.round(parseFloat(amountFormatted) * 1000000) / 1000000;
    amountToSell = ethers.parseUnits(amountRounded.toFixed(6), decimals);

    console.log(`\\n卖出数量 (1/3): ${amountRounded} ${symbol}`);
    console.log(`Wei: ${amountToSell.toString()}`);

    // 查询卖出预估
    console.log('\\n查询卖出预估...');
    const helperContract = new ethers.Contract(HELPER_ADDRESS, HELPER_ABI, provider);
    const estimate = await helperContract.trySell(TOKEN_ADDRESS_CHECKSUM, amountToSell);

    console.log(`TokenManager: ${estimate.tokenManager}`);
    console.log(`预估获得: ${ethers.formatEther(estimate.funds)} BNB`);
    console.log(`预估费用: ${ethers.formatEther(estimate.fee)} BNB`);
    console.log(`净收入: ${ethers.formatEther(estimate.funds - estimate.fee)} BNB`);

    // 检查授权
    console.log('\\n检查授权...');
    const currentAllowance = await tokenContract.allowance(wallet.address, PLATFORM_ADDRESS);
    console.log(`当前授权额度: ${ethers.formatUnits(currentAllowance, decimals)} ${symbol}`);

    if (currentAllowance < amountToSell) {
        console.log('授权额度不足，正在授权...');
        const approveTx = await tokenContract.approve(PLATFORM_ADDRESS, amountToSell);
        await approveTx.wait();
        console.log('✅ 授权完成');
    } else {
        console.log('✅ 授权额度充足');
    }

    // 计算最小接收金额
    const minFunds = (estimate.funds * 9900n) / 10000n;

    // 执行卖出
    console.log('\\n执行卖出...');
    const platformContract = new ethers.Contract(PLATFORM_ADDRESS, PLATFORM_ABI, wallet);

    const tx = await platformContract.sellToken(
        0,
        TOKEN_ADDRESS_CHECKSUM,
        amountToSell,
        minFunds,
        {
            gasLimit: 300000,
            gasPrice: ethers.parseUnits('5', 'gwei')
        }
    );

    console.log(`交易已发送: ${tx.hash}`);
    const receipt = await tx.wait();

    console.log('\\n========================================');
    if (receipt.status === 1) {
        console.log('✅ 卖出成功！');
        console.log(`区块号: ${receipt.blockNumber}`);
        console.log(`Gas 使用: ${receipt.gasUsed.toString()}`);

        // 卖出后余额
        const newBalance = await tokenContract.balanceOf(wallet.address);
        console.log(`卖出后余额: ${ethers.formatUnits(newBalance, decimals)} ${symbol}`);
    } else {
        console.log('❌ 卖出失败');
    }
    console.log('========================================');
}

main().catch(console.error);
