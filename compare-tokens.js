/**
 * 对比两个代币的状态
 */

const { ethers } = require('ethers');

const TOKEN_OK = '0x8a92ec2aecddf18f0759c836842b200c2be04444';
const TOKEN_FAIL = '0xe72bd5e09c70638629d722ecc59d087fee5b4444';

const TOKEN_MANAGER_2 = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';
const HELPER_CONTRACT = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034';

async function checkToken(tokenAddress, label) {
    console.log('\n========================================');
    console.log(label);
    console.log('========================================');
    console.log('地址:', tokenAddress);

    const provider = new ethers.JsonRpcProvider('https://bsc-dataseed1.binance.org');

    const tm2Abi = [
        'function _tokenInfos(address) view returns (address base, address quote, uint256 template, uint256 totalSupply, uint256 maxOffers, uint256 maxRaising, uint256 launchTime, uint256 offers, uint256 funds, uint256 lastPrice, uint256 K, uint256 T, uint256 status)'
    ];
    const tm2Contract = new ethers.Contract(TOKEN_MANAGER_2, tm2Abi, provider);

    const helperAbi = [
        'function trySell(address token, uint256 amount) view returns (address tokenManager, address quote, uint256 funds, uint256 fee)',
        'function getPancakePair(address token) view returns (address)'
    ];
    const helperContract = new ethers.Contract(HELPER_CONTRACT, helperAbi, provider);

    const erc20Abi = [
        'function balanceOf(address) view returns (uint256)',
        'function decimals() view returns (uint8)',
        'function symbol() view returns (string)',
        'function name() view returns (string)'
    ];
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);

    const walletAddress = '0x17d55C4123AE4250e9097EeD4bFc2B9DFe839147';

    try {
        const symbol = await tokenContract.symbol();
        const name = await tokenContract.name();
        const balance = await tokenContract.balanceOf(walletAddress);

        console.log('\n基本信息:');
        console.log('  符号:', symbol);
        console.log('  名称:', name);
        console.log('  余额:', ethers.formatUnits(balance, 18));

        const tokenInfo = await tm2Contract._tokenInfos(tokenAddress);
        const progress = (Number(tokenInfo.offers) / Number(tokenInfo.maxOffers) * 100).toFixed(2);

        console.log('\nTokenManager2:');
        console.log('  offers:', ethers.formatUnits(tokenInfo.offers, 0));
        console.log('  maxOffers:', ethers.formatUnits(tokenInfo.maxOffers, 0));
        console.log('  进度:', progress + '%');
        console.log('  funds:', ethers.formatEther(tokenInfo.funds), 'BNB');
        console.log('  lastPrice:', ethers.formatEther(tokenInfo.lastPrice), 'BNB');

        // 测试卖出预估（使用余额的 1/4，类似之前的测试）
        const sellAmount = balance / 4n;
        const sellEstimate = await helperContract.trySell(tokenAddress, sellAmount);
        const netIncome = sellEstimate.funds - sellEstimate.fee;

        console.log('\n卖出预估 (卖出 1/4 余额):');
        console.log('  卖出数量:', ethers.formatUnits(sellAmount, 18));
        console.log('  预估获得:', ethers.formatEther(sellEstimate.funds), 'BNB');
        console.log('  预估费用:', ethers.formatEther(sellEstimate.fee), 'BNB');
        console.log('  净收入:', ethers.formatEther(netIncome), 'BNB');

        const pancakePair = await helperContract.getPancakePair(tokenAddress);
        console.log('\nPancakeSwap 交易对:', pancakePair);

        return {
            symbol,
            balance: parseFloat(ethers.formatUnits(balance, 18)).toFixed(2),
            progress: progress + '%',
            lastPrice: ethers.formatEther(tokenInfo.lastPrice),
            netIncome: ethers.formatEther(netIncome),
            hasPancakePair: pancakePair !== ethers.ZeroAddress
        };

    } catch (error) {
        console.error('错误:', error.message);
        return null;
    }
}

async function main() {
    const info1 = await checkToken(TOKEN_OK, '钟馗 (之前可以卖出)');
    const info2 = await checkToken(TOKEN_FAIL, '暖暖 (无法卖出)');

    console.log('\n========================================');
    console.log('对比总结');
    console.log('========================================');

    if (info1 && info2) {
        console.log('\n指标                  | ' + info1.symbol + '        | ' + info2.symbol);
        console.log('----------------------|-------------|-------------');
        console.log('余额                  | ' + info1.balance + '       | ' + info2.balance);
        console.log('Bonding Curve 进度    | ' + info1.progress + '    | ' + info2.progress);
        console.log('价格                  | ' + info1.lastPrice + ' | ' + info2.lastPrice);
        console.log('卖出净收入 (1/4余额)   | ' + info1.netIncome + ' | ' + info2.netIncome);
        console.log('PancakeSwap 对        | ' + (info1.hasPancakePair ? '✅ 有' : '❌ 无') + '        | ' + (info2.hasPancakePair ? '✅ 有' : '❌ 无'));

        // 分析差异
        console.log('\n关键差异分析:');
        if (parseFloat(info1.netIncome) > 0 && parseFloat(info2.netIncome) <= 0) {
            console.log('  ⚠️  暖暖的卖出净收入 <= 0！');
            console.log('  这可能是 FourMeme 合约拒绝交易的原因。');
        }
        if (parseFloat(info2.progress) > 95) {
            console.log('  ⚠️  暖暖的 bonding curve 进度已达 ' + info2.progress);
        }
        if (!info2.hasPancakePair) {
            console.log('  ⚠️  暖暖没有 PancakeSwap 交易对，无法使用备用方案');
        }
    }

    console.log('\n========================================');
}

main().catch(console.error);
