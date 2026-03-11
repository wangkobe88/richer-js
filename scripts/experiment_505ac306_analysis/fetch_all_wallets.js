/**
 * 健壮的钱包数据获取脚本 - 增加超时和重试
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';

// 加载数据
const tokenEarlyParticipants = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'token_early_participants_all.json'), 'utf8'));
const existingWalletData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wallet_data.json'), 'utf8'));

// 提取所有钱包地址
const allWalletAddresses = new Set();
Object.values(tokenEarlyParticipants).forEach(data => {
  data.participants.forEach(addr => allWalletAddresses.add(addr));
});

// 已有钱包
const existingAddresses = new Set(existingWalletData.map(w => w.address.toLowerCase()));

// 找出缺失的钱包
const missingAddresses = Array.from(allWalletAddresses).filter(addr => !existingAddresses.has(addr.toLowerCase()));

console.log('='.repeat(80));
console.log('健壮的钱包数据获取');
console.log('='.repeat(80));
console.log(`总钱包数: ${allWalletAddresses.size}`);
console.log(`已有数据: ${existingWalletData.length}`);
console.log(`缺失钱包: ${missingAddresses.length}`);

// HTTP POST 工具 - 带超时
function post(url, data, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const options = {
      hostname: 'localhost',
      port: 3010,
      path: url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: timeout
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'timeout' });
    });

    req.on('error', (e) => {
      resolve({ success: false, error: e.message });
    });

    req.write(postData);
    req.end();
  });
}

// 获取单个钱包数据 - 带重试
async function getWalletData(address) {
  const maxRetries = 10;
  const delays = [1000, 2000, 3000, 5000, 8000, 10000, 15000, 20000, 30000]; // 逐渐增加延迟

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await post('/api/wallet/query', {
      walletAddress: address,
      chain: 'bsc'
    }, 30000); // 30秒超时

    if (response.success && response.data && response.data.walletInfo) {
      const info = response.data.walletInfo;
      const now = Math.floor(Date.now() / 1000);
      const walletAgeTimestamp = info.wallet_age || 0;
      const walletAgeDays = walletAgeTimestamp > 0 ? Math.floor((now - walletAgeTimestamp) / 86400) : 0;

      const tokens = response.data.tokens || [];
      let profitableTokens = 0, losingTokens = 0;
      tokens.forEach(t => {
        if (t.total_profit > 0) profitableTokens++;
        else if (t.total_profit < 0) losingTokens++;
      });

      return {
        address: address,
        total_balance: info.total_balance || 0,
        total_trades: (info.total_purchase || 0) + (info.total_sold || 0),
        wallet_age_days: walletAgeDays,
        total_tokens: tokens.length,
        profitable_tokens: profitableTokens,
        losing_tokens: losingTokens
      };
    }

    // 如果不是最后一次尝试，等待后重试
    if (attempt < maxRetries - 1) {
      const delay = delays[attempt] || 5000;
      console.log(`    [重试] ${address.slice(0, 10)}... 第${attempt + 1}次失败，等待${delay}ms后重试`);
      await sleep(delay);
    }
  }

  console.log(`    [失败] ${address.slice(0, 10)}... 已重试${maxRetries}次，仍失败`);
  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 批量获取 - 串行处理避免限流
async function fetchMissingWallets() {
  const fetchedWallets = [];
  const failedAddresses = [];

  console.log(`\n开始获取 ${missingAddresses.length} 个钱包数据...`);
  console.log(`(每个钱包最多重试10次，超时30秒)`);

  const startTime = Date.now();

  for (let i = 0; i < missingAddresses.length; i++) {
    const address = missingAddresses[i];

    // 每10个显示一次进度
    if ((i + 1) % 10 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = ((i + 1) / elapsed).toFixed(2);
      process.stdout.write(`\r  进度: ${i + 1}/${missingAddresses.length} (成功: ${fetchedWallets.length}, 失败: ${failedAddresses.length}) | ${elapsed}秒 | ${rate}个/秒`);
    }

    const wallet = await getWalletData(address);
    if (wallet) {
      fetchedWallets.push(wallet);
    } else {
      failedAddresses.push(address);
    }

    // 每个钱包之间添加小延迟避免限流
    await sleep(200);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\r  完成: ${missingAddresses.length}/${missingAddresses.length} (成功: ${fetchedWallets.length}, 失败: ${failedAddresses.length}) | 用时: ${elapsed}秒`);

  return { fetchedWallets, failedAddresses };
}

// 主函数
async function main() {
  const { fetchedWallets, failedAddresses } = await fetchMissingWallets();

  console.log(`\n获取结果:`);
  console.log(`  成功: ${fetchedWallets.length} 个`);
  console.log(`  失败: ${failedAddresses.length} 个`);
  console.log(`  成功率: ${(fetchedWallets.length / missingAddresses.length * 100).toFixed(1)}%`);

  // 合并数据
  const allWalletData = [...existingWalletData, ...fetchedWallets];
  const totalWallets = allWalletData.length;
  const coverageRate = (totalWallets / allWalletAddresses.size * 100).toFixed(1);

  // 保存
  fs.writeFileSync(
    path.join(DATA_DIR, 'wallet_data_complete.json'),
    JSON.stringify(allWalletData, null, 2)
  );

  console.log(`\n✅ 已保存 ${totalWallets} 个钱包数据到 wallet_data_complete.json`);
  console.log(`   数据覆盖率: ${coverageRate}%`);

  // 显示统计
  console.log(`\n完整钱包数据统计:`);
  const avgBalance = allWalletData.reduce((s, w) => s + (w.total_balance || 0), 0) / allWalletData.length;
  const avgTrades = allWalletData.reduce((s, w) => s + (w.total_trades || 0), 0) / allWalletData.length;
  const avgAge = allWalletData.reduce((s, w) => s + (w.wallet_age_days || 0), 0) / allWalletData.length;
  console.log(`  总数: ${allWalletData.length}`);
  console.log(`  平均余额: ${avgBalance.toFixed(2)} BNB`);
  console.log(`  平均交易数: ${avgTrades.toFixed(0)}`);
  console.log(`  平均年龄: ${avgAge.toFixed(0)} 天`);

  if (failedAddresses.length > 0) {
    console.log(`\n失败的钱包地址 (前10个):`);
    failedAddresses.slice(0, 10).forEach(addr => {
      console.log(`  ${addr}`);
    });
  }
}

main().catch(console.error);
