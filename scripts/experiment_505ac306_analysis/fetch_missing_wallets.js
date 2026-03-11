/**
 * 补充获取缺失的2011个钱包数据
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
console.log('补充获取缺失钱包数据');
console.log('='.repeat(80));
console.log(`总钱包数: ${allWalletAddresses.size}`);
console.log(`已有数据: ${existingWalletData.length}`);
console.log(`缺失钱包: ${missingAddresses.length}`);

// HTTP 工具
function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    }).on('error', (e) => {
      resolve({ success: false, error: e.message });
    });
  });
}

// 获取单个钱包数据
async function getWalletData(address, retry = 0) {
  const url = `http://localhost:3010/api/wallets/${address}`;
  const response = await get(url);

  if (response.success && response.wallet) {
    return response.wallet;
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

  console.log(`\n开始获取 ${missingAddresses.length} 个钱包数据...`);

  for (let i = 0; i < missingAddresses.length; i++) {
    const address = missingAddresses[i];

    if ((i + 1) % 10 === 0) {
      process.stdout.write(`\r  进度: ${i + 1}/${missingAddresses.length} (成功: ${fetchedWallets.length})`);
    }

    const wallet = await getWalletData(address);
    if (wallet) {
      fetchedWallets.push(wallet);
    } else {
      failedAddresses.push(address);
    }

    // 每100个钱包休息一下
    if ((i + 1) % 100 === 0) {
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

  if (failedAddresses.length > 0) {
    console.log(`\n失败的钱包地址 (前10个):`);
    failedAddresses.slice(0, 10).forEach(addr => {
      console.log(`  ${addr}`);
    });
  }

  // 合并数据
  const allWalletData = [...existingWalletData, ...fetchedWallets];

  // 保存
  fs.writeFileSync(
    path.join(DATA_DIR, 'wallet_data_complete.json'),
    JSON.stringify(allWalletData, null, 2)
  );

  console.log(`\n✅ 已保存 ${allWalletData.length} 个钱包数据到 wallet_data_complete.json`);

  // 显示获取到的钱包的统计信息
  if (fetchedWallets.length > 0) {
    console.log(`\n新获取钱包统计:`);
    console.log(`  平均余额: ${(fetchedWallets.reduce((s, w) => s + (w.total_balance || 0), 0) / fetchedWallets.length).toFixed(2)} BNB`);
    console.log(`  平均交易数: ${(fetchedWallets.reduce((s, w) => s + (w.total_trades || 0), 0) / fetchedWallets.length).toFixed(0)}`);
    console.log(`  平均年龄: ${(fetchedWallets.reduce((s, w) => s + (w.wallet_age_days || 0), 0) / fetchedWallets.length).toFixed(0)} 天`);
  }
}

main().catch(console.error);
