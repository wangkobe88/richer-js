/**
 * 步骤3: 获取钱包盈亏数据
 * 使用本地 API /api/wallet/query
 * 保存所有钱包数据
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const DATA_DIR = path.join(__dirname, 'data');
const INPUT_FILE = path.join(DATA_DIR, 'wallet_list.json');

const API_BASE = 'http://localhost:3010';

// 本地API请求函数
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
  console.log('=== 步骤3: 获取钱包盈亏数据 ===\n');

  // 读取钱包列表
  if (!fs.existsSync(INPUT_FILE)) {
    console.error('请先运行 step2_fetch_early_trades.js');
    return;
  }

  const wallets = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  console.log(`处理 ${wallets.length} 个钱包...\n`);

  const results = [];
  const walletMap = new Map();  // 用于快速查找
  let successCount = 0;
  let failCount = 0;

  // 批量处理，避免API限流
  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];

    if ((i + 1) % 10 === 0 || i === wallets.length - 1) {
      process.stdout.write(`\r进度: ${i + 1}/${wallets.length} (${((i + 1) / wallets.length * 100).toFixed(1)}%)`);
    }

    try {
      const response = await postAPI('/api/wallet/query', {
        walletAddress: wallet,
        chain: 'bsc'
      });

      if (response.success && response.data) {
        const info = response.data.walletInfo || {};
        const tokens = response.data.tokens || [];

        // 计算盈利/亏损代币数
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
          raw_data: response.data  // 保存完整数据
        };

        results.push(walletData);
        walletMap.set(wallet.toLowerCase(), walletData);
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

    // 避免限流
    await sleep(200);
  }

  console.log(`\n\n完成: 成功 ${successCount}, 失败 ${failCount}`);

  // 保存完整数据
  fs.writeFileSync(
    path.join(DATA_DIR, 'step3_wallet_data.json'),
    JSON.stringify(results, null, 2)
  );

  console.log(`✅ 钱包数据已保存到 data/step3_wallet_data.json`);

  // 保存成功获取的钱包数据（用于后续分析）
  const successData = results.filter(r => !r.error);
  fs.writeFileSync(
    path.join(DATA_DIR, 'wallet_data_valid.json'),
    JSON.stringify(successData, null, 2)
  );

  console.log(`✅ 有效钱包数据已保存到 data/wallet_data_valid.json (${successData.length} 个)`);
}

main().catch(console.error);
