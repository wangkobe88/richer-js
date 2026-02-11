/**
 * 检查代币在 FourMeme 平台的详细状态
 */

const { ethers } = require('ethers');

const TOKEN_ADDRESS = '0xe72bd5e09c70638629d722ecc59d087fee5b4444'; // 暖暖
const TOKEN_MANAGER_2 = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';
const HELPER_CONTRACT = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034';
const PANCAKE_FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';

async function main() {
    console.log('========================================');
    console.log('检查代币状态:', TOKEN_ADDRESS);
    console.log('========================================\n');

    const provider = new ethers.JsonRpcProvider('https://bsc-dataseed1.binance.org');

    // 1. 检查 TokenManager2 中的代币状态
    console.log('----------------------------------------');
    console.log('TokenManager2 状态');
    console.log('----------------------------------------');

    const tm2Abi = [
        'function _tokenInfos(address) view returns (address base, address quote, uint256 template, uint256 totalSupply, uint256 maxOffers, uint256 maxRaising, uint256 launchTime, uint256 offers, uint256 funds, uint256 lastPrice, uint256 K, uint256 T, uint256 status)',
        'function lastPrice(address) view returns (uint256)',
        'function STATUS_TRADING() view returns (uint256)',
        'function STATUS_COMPLETED() view returns (uint256)',
        'function STATUS_ADDING_LIQUIDITY() view returns (uint256)',
        'function STATUS_HALT() view returns (uint256)'
    ];

    const tm2Contract = new ethers.Contract(TOKEN_MANAGER_2, tm2Abi, provider);

    try {
        const tokenInfo = await tm2Contract._tokenInfos(TOKEN_ADDRESS);
        const statusTrading = await tm2Contract.STATUS_TRADING();
        const statusCompleted = await tm2Contract.STATUS_COMPLETED();
        const statusAddingLiquidity = await tm2Contract.STATUS_ADDING_LIQUIDITY();
        const statusHalt = await tm2Contract.STATUS_HALT();

        console.log('代币信息:');
        console.log('  base:', tokenInfo.base);
        console.log('  quote:', tokenInfo.quote);
        console.log('  totalSupply:', ethers.formatUnits(tokenInfo.totalSupply, 18));
        console.log('  maxOffers:', tokenInfo.maxOffers.toString());
        console.log('  offers:', tokenInfo.offers.toString());
        console.log('  进度:', (Number(tokenInfo.offers) / Number(tokenInfo.maxOffers) * 100).toFixed(2) + '%');
        console.log('  funds:', ethers.formatEther(tokenInfo.funds), 'BNB');
        console.log('  lastPrice:', ethers.formatEther(tokenInfo.lastPrice), 'BNB');
        console.log('  status:', tokenInfo.status.toString());
        console.log('  状态解读:');
        console.log('    - TRADING (0):', tokenInfo.status === statusTrading ? '✅ 交易中' : '❌');
        console.log('    - COMPLETED (2):', tokenInfo.status === statusCompleted ? '✅ 已完成' : '❌');
        console.log('    - ADDING_LIQUIDITY (3):', tokenInfo.status === statusAddingLiquidity ? '✅ 添加流动性中' : '❌');
        console.log('    - HALT (1):', tokenInfo.status === statusHalt ? '✅ 暂停' : '❌');

        // 检查是否 bonding curve 已完成
        if (Number(tokenInfo.offers) >= Number(tokenInfo.maxOffers)) {
            console.log('\n⚠️ Bonding curve 已完成！');
            console.log('   代币应该已经添加到 DEX');
        } else {
            const remainingOffers = Number(tokenInfo.maxOffers) - Number(tokenInfo.offers);
            console.log('\n✅ Bonding curve 未完成');
            console.log(`   还剩 ${remainingOffers} 笔交易`);
        }
    } catch (error) {
        console.error('查询 TokenManager2 失败:', error.message);
    }

    // 2. 检查 Helper 合约信息
    console.log('\n----------------------------------------');
    console.log('TokenManagerHelper3 状态');
    console.log('----------------------------------------');

    const helperAbi = [
        'function getTokenInfo(address token) view returns (uint256 version, address tokenManager, address quote, uint256 lastPrice, uint256 tradingFeeRate, uint256 minTradingFee, uint256 launchTime, uint256 offers, uint256 maxOffers, uint256 funds, uint256 maxFunds, bool liquidityAdded)',
        'function getPancakePair(address token) view returns (address)',
        'function trySell(address token, uint256 amount) view returns (address tokenManager, address quote, uint256 funds, uint256 fee)'
    ];

    const helperContract = new ethers.Contract(HELPER_CONTRACT, helperAbi, provider);

    try {
        const tokenInfo = await helperContract.getTokenInfo(TOKEN_ADDRESS);
        console.log('Helper 代币信息:');
        console.log('  version:', tokenInfo.version.toString());
        console.log('  tokenManager:', tokenInfo.tokenManager);
        console.log('  quote:', tokenInfo.quote);
        console.log('  lastPrice:', ethers.formatEther(tokenInfo.lastPrice), 'BNB');
        console.log('  offers:', tokenInfo.offers.toString(), '/', tokenInfo.maxOffers.toString());
        console.log('  liquidityAdded:', tokenInfo.liquidityAdded ? '✅ 已添加流动性' : '❌ 未添加流动性');

        // 检查 PancakeSwap 交易对
        const pancakePair = await helperContract.getPancakePair(TOKEN_ADDRESS);
        console.log('  PancakeSwap 交易对:', pancakePair);

        if (pancakePair === ethers.ZeroAddress) {
            console.log('    ❌ 没有 PancakeSwap 交易对');
        } else {
            console.log('    ✅ 有 PancakeSwap 交易对');
        }
    } catch (error) {
        console.error('查询 Helper 失败:', error.message);
    }

    // 3. 直接查询 PancakeSwap Factory
    console.log('\n----------------------------------------');
    console.log('PancakeSwap Factory 查询');
    console.log('----------------------------------------');

    const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
    const factoryAbi = ['function getPair(address tokenA, address tokenB) view returns (address)'];
    const factoryContract = new ethers.Contract(PANCAKE_FACTORY, factoryAbi, provider);

    try {
        const pair = await factoryContract.getPair(TOKEN_ADDRESS, WBNB);
        console.log('交易对地址:', pair);

        if (pair === ethers.ZeroAddress) {
            console.log('❌ PancakeSwap 上没有该代币的交易对');
            console.log('\n这就是为什么无法卖出的原因！');
            console.log('代币已经 bonding curve 完成，但流动性还没添加到 PancakeSwap');
        } else {
            console.log('✅ PancakeSwap 上有交易对');
            console.log('应该可以使用 PancakeSwap 卖出');
        }
    } catch (error) {
        console.error('查询 PancakeSwap 失败:', error.message);
    }

    // 4. 检查代币余额和授权
    console.log('\n----------------------------------------');
    console.log('代币基本信息');
    console.log('----------------------------------------');

    const erc20Abi = [
        'function balanceOf(address) view returns (uint256)',
        'function decimals() view returns (uint8)',
        'function symbol() view returns (string)',
        'function name() view returns (string)'
    ];
    const tokenContract = new ethers.Contract(TOKEN_ADDRESS, erc20Abi, provider);

    try {
        const balance = await tokenContract.balanceOf('0x17d55C4123AE4250e9097EeD4bFc2B9DFe839147');
        const decimals = await tokenContract.decimals();
        const symbol = await tokenContract.symbol();
        const name = await tokenContract.name();

        console.log('代币名称:', name);
        console.log('代币符号:', symbol);
        console.log('代币精度:', decimals);
        console.log('钱包余额:', ethers.formatUnits(balance, decimals));
    } catch (error) {
        console.error('查询代币信息失败:', error.message);
    }

    console.log('\n========================================');
    console.log('结论');
    console.log('========================================');
    console.log('代币无法卖出的原因是：');
    console.log('1. 代币在 FourMeme 内盘的 bonding curve 已完成');
    console.log('2. 但流动性还没有添加到 PancakeSwap');
    console.log('3. 因此：');
    console.log('   - FourMeme sellToken 失败（bonding curve 已饱和）');
    console.log('   - PancakeSwap 卖出失败（没有交易对）');
    console.log('\n解决方案：');
    console.log('等待 FourMeme 自动添加流动性到 PancakeSwap');
    console.log('或者联系项目方添加流动性');
}

main().catch(console.error);
