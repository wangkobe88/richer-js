/**
 * 步骤3: 获取钱包盈亏数据（累积版本）
 * 复用已有钱包数据，只查询新钱包
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const DATA_DIR = path.join(__dirname, 'data');
const INPUT_FILE = path.join(DATA_DIR, 'step2_early_trades.json');
const WALLET_DATA_FILE = path.join(DATA_DIR, 'wallet_data_valid.json');

const API_BASE = 'http://localhost:3010';

// 加载现有钱包数据
let existingWallets = new Map();
let existingWalletAddresses = new Set();

if (fs.existsSync(WALLET_DATA_FILE)) {
  try {
    const data = JSON.parse(fs.readFileSync(WALLET_DATA_FILE, 'utf8'));
    for (const w of data) {
      if (w.address && !w.error) {
        existingWallets.set(w.address.toLowerCase(), w);
        existingWalletAddresses.add(w.address.toLowerCase());
      }
    }
    console.log(`加载了 ${existingWallets.size} 个现有钱包数据`);
  } catch (e) {
    console.log('未找到现有钱包数据，将创建新文件');
  }
}

function postAPI(endpoint, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, API_BASE);
    const postData = JSON.stringify(data);

    const options = {
      hostname: url.hostname,
      port: url.port || 3010,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const protocol = url.protocol === 'https:' ? https : http;
    const req = protocol.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== 步骤3: 获取钱包盈亏数据（累积版本） ===\n');
  console.log(`现有钱包数据: ${existingWallets.size}\n`);

  // 读取钱包列表
  if (!fs.existsSync(INPUT_FILE)) {
    console.error('请先运行 step2_fetch_with_cache.js');
    process.exit(1);
  }

  const tradeData = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));

  // 提取所有钱包地址
  const walletSet = new Set();
  for (const result of tradeData.results) {
    for (const trade of result.trades || []) {
      const wallet = trade.wallet_address || trade.from_address;
      if (wallet) {
        walletSet.add(wallet.toLowerCase());
      }
    }
  }

  const allWallets = Array.from(walletSet);
  console.log(`本实验涉及钱包总数: ${allWallets.length}`);

  // 找出需要查询的新钱包
  const newWallets = allWallets.filter(w => !existingWalletAddresses.has(w));
  console.log(`其中新钱包: ${newWallets.length}`);
  console.log(`复用现有数据: ${allWallets.length - newWallets.length}\n`);

  if (newWallets.length === 0) {
    console.log('没有新钱包需要查询，跳过 API 调用');
  } else {
    // 查询新钱包数据
    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < newWallets.length; i++) {
      const wallet = newWallets[i];

      if ((i + 1) % 10 === 0 || i === newWallets.length - 1) {
        process.stdout.write(`\r进度: ${i + 1}/${newWallets.length} (${((i + 1) / newWallets.length * 100).toFixed(1)}%)`);
      }

      try {
        const response = await postAPI('/api/wallet/query', {
          walletAddress: wallet,
          chain: 'bsc'
        });

        if (response.success && response.data) {
          const info = response.data.walletInfo || {};
          const tokens = response.data.tokens || [];

          let profitableTokens = 0;
          let losingTokens = 0;
          tokens.forEach(t => {
            const profit = parseFloat(t.total_profit) || 0;
            if (profit > 0) profitableTokens++;
            else if (profit < 0) losingTokens++;
          });

          const walletData = {
            address: wallet,
            total_balance: parseFloat(info.total_balance) || 0,
            total_profit: parseFloat(info.total_profit) || 0,
            total_profit_ratio: parseFloat(info.total_profit_ratio) || 0,
            total_win_ratio: parseFloat(info.total_win_ratio) || 0,
            total_purchase: parseInt(info.total_purchase) || 0,
            total_sold: parseInt(info.total_sold) || 0,
            total_trades: (parseInt(info.total_purchase) || 0) + (parseInt(info.total_sold) || 0),
            wallet_age: parseInt(info.wallet_age) || 0,
            total_tokens: tokens.length,
            profitable_tokens: profitableTokens,
            losing_tokens: losingTokens,
            tokens_count: tokens.length,
            raw_data: response.data
          };

          results.push(walletData);
          existingWallets.set(wallet.toLowerCase(), walletData);
          existingWalletAddresses.add(wallet.toLowerCase());
          successCount++;
        } else {
          results.push({
            address: wallet,
            error: response.error || 'Unknown error'
          });
          failCount++;
        }

      } catch (error) {
        results.push({
          address: wallet,
          error: error.message
        });
        failCount++;
      }

      await sleep(200);
    }

    console.log(`\n\n新钱包查询完成: 成功 ${successCount}, 失败 ${failCount}`);
  }

  // 保存累积的钱包数据（去除 raw_data 字段以减小文件大小）
  const allWalletData = Array.from(existingWallets.values()).map(w => {
    const { raw_data, ...walletWithoutRaw } = w;
    return walletWithoutRaw;
  });
  fs.writeFileSync(WALLET_DATA_FILE, JSON.stringify(allWalletData, null, 2));
  console.log(`\n✅ 累积钱包数据已保存到 ${WALLET_DATA_FILE}`);
  console.log(`   总钱包数: ${allWalletData.length}`);
}

main().catch(error => {
  console.error('\n错误:', error);
  process.exit(1);
});
