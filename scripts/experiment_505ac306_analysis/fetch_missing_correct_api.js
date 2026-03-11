/**
 * 使用正确的API补充获取缺失的2011个钱包数据
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
console.log('补充获取缺失钱包数据 (使用正确的API)');
console.log('='.repeat(80));
console.log(`总钱包数: ${allWalletAddresses.size}`);
console.log(`已有数据: ${existingWalletData.length}`);
console.log(`缺失钱包: ${missingAddresses.length}`);

// HTTP POST 工具
function post(url, data) {
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
      }
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

    req.on('error', (e) => {
      resolve({ success: false, error: e.message });
    });

    req.write(postData);
    req.end();
  });
}

// 获取单个钱包数据
async function getWalletData(address, retry = 0) {
  const response = await post('/api/wallet/query', {
    walletAddress: address,
    chain: 'bsc'
  });

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

  // 如果失败，重试
  if (retry < 3) {
    await sleep(500);
    return getWalletData(address, retry + 1);
  }

  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 批量获取
async function fetchMissingWallets() {
  const fetchedWallets = [];
  const failedAddresses = [];
  const batchSize = 10;

  console.log(`\n开始获取 ${missingAddresses.length} 个钱包数据...`);

  for (let i = 0; i < missingAddresses.length; i += batchSize) {
    const batch = missingAddresses.slice(i, i + batchSize);

    const promises = batch.map(async (addr) => {
      const wallet = await getWalletData(addr);
      if (wallet) {
        return wallet;
      } else {
        failedAddresses.push(addr);
        return null;
      }
    });

    const results = await Promise.all(promises);
    results.forEach(r => {
      if (r) fetchedWallets.push(r);
    });

    const processed = Math.min(i + batchSize, missingAddresses.length);
    process.stdout.write(`\r  进度: ${processed}/${missingAddresses.length} (成功: ${fetchedWallets.length}, 失败: ${failedAddresses.length})`);

    // 每10批休息一下
    if ((i / batchSize) % 10 === 0) {
      await sleep(1000);
    }
  }

  console.log(`\r  完成: ${missingAddresses.length}/${missingAddresses.length} (成功: ${fetchedWallets.length}, 失败: ${failedAddresses.length})`);

  return { fetchedWallets, failedAddresses };
}

// 主函数
async function main() {
  const { fetchedWallets, failedAddresses } = await fetchMissingWallets();

  console.log(`\n获取结果:`);
  console.log(`  成功: ${fetchedWallets.length} 个`);
  console.log(`  失败: ${failedAddresses.length} 个`);

  // 合并数据
  const allWalletData = [...existingWalletData, ...fetchedWallets];
  const totalWallets = allWalletData.length;

  // 保存
  fs.writeFileSync(
    path.join(DATA_DIR, 'wallet_data_complete.json'),
    JSON.stringify(allWalletData, null, 2)
  );

  console.log(`\n✅ 已保存 ${totalWallets} 个钱包数据到 wallet_data_complete.json`);
  console.log(`   数据覆盖率: ${(totalWallets / allWalletAddresses.size * 100).toFixed(1)}%`);

  // 显示统计
  console.log(`\n完整钱包数据统计:`);
  const avgBalance = allWalletData.reduce((s, w) => s + (w.total_balance || 0), 0) / allWalletData.length;
  const avgTrades = allWalletData.reduce((s, w) => s + (w.total_trades || 0), 0) / allWalletData.length;
  const avgAge = allWalletData.reduce((s, w) => s + (w.wallet_age_days || 0), 0) / allWalletData.length;
  console.log(`  总数: ${allWalletData.length}`);
  console.log(`  平均余额: ${avgBalance.toFixed(2)} BNB`);
  console.log(`  平均交易数: ${avgTrades.toFixed(0)}`);
  console.log(`  平均年龄: ${avgAge.toFixed(0)} 天`);
}

main().catch(console.error);
