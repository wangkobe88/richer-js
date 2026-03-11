/**
 * 分析代币早期参与者
 * 1. 获取3分钟内早期交易
 * 2. 提取所有参与者钱包
 * 3. 获取钱包盈利数据
 * 4. 观察数据分布并分类
 */

const http = require('http');

function post(url, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(url, options, (res) => {
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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const tokenAddress = '0x30d31d1b0d4f1fb82e17f858497a523fb0dd4444';
  const chain = 'bsc';

  console.log('='.repeat(70));
  console.log(`代币早期参与者分析: ${tokenAddress}`);
  console.log('='.repeat(70));

  // 步骤1: 获取早期交易
  console.log('\n[步骤1] 获取3分钟内早期交易...');
  const tradesResponse = await post('http://localhost:3010/api/token-early-trades', {
    tokenAddress,
    chain,
    timeWindowMinutes: 3,
    limit: 1000
  });

  if (!tradesResponse.success) {
    console.error('获取交易失败:', tradesResponse.error);
    return;
  }

  const earlyTrades = tradesResponse.data.earlyTrades;
  console.log(`获取到 ${earlyTrades.length} 条交易记录`);

  // 步骤2: 提取所有唯一钱包地址
  const wallets = new Set();
  earlyTrades.forEach(trade => {
    if (trade.from_address) wallets.add(trade.from_address.toLowerCase());
    if (trade.to_address) wallets.add(trade.to_address.toLowerCase());
  });

  const walletList = Array.from(wallets);
  console.log(`\n[步骤2] 提取到 ${walletList.length} 个唯一钱包地址`);

  // 步骤3: 获取每个钱包的盈利数据（使用本地API）
  console.log('\n[步骤3] 获取钱包盈利数据...');
  console.log('使用本地API，每次请求间隔1秒避免限流\n');

  const walletData = [];
  let processedCount = 0;
  let errorCount = 0;

  for (const wallet of walletList) {
    try {
      const response = await post('http://localhost:3010/api/wallet/query', {
        walletAddress: wallet,
        chain
      });

      if (response.success && response.data) {
        const info = response.data.walletInfo;
        walletData.push({
          address: wallet,
          total_balance: info.total_balance || 0,
          total_unrealized_profit: info.total_unrealized_profit || 0,
          total_realized_profit: info.total_realized_profit || 0,
          total_all_profit: (info.total_unrealized_profit || 0) + (info.total_realized_profit || 0),
          total_tokens: response.data.tokens?.length || 0,
          profitable_tokens: 0,
          losing_tokens: 0,
          win_rate: info.total_win_ratio ? (info.total_win_ratio * 100).toFixed(2) + '%' : '0%',
          total_trades: (info.total_purchase || 0) + (info.total_sold || 0),
          wallet_age: 0, // AVE API可能不返回
          chain: chain
        });

        // 计算盈利/亏损代币数
        const tokens = response.data.tokens || [];
        tokens.forEach(t => {
          if (t.total_profit > 0) walletData[walletData.length - 1].profitable_tokens++;
          else if (t.total_profit < 0) walletData[walletData.length - 1].losing_tokens++;
        });

        processedCount++;

        if (processedCount % 10 === 0) {
          console.log(`已处理 ${processedCount}/${walletList.length} 个钱包...`);
        }
      }

      // 避免限流
      await sleep(1000);

    } catch (error) {
      errorCount++;
      if (errorCount <= 10) {
        console.error(`  钱包 ${wallet.slice(0, 10)}... 查询失败: ${error.message}`);
      }
    }
  }

  console.log(`\n成功获取 ${walletData.length} 个钱包的数据 (${errorCount} 个失败)`);

  // 保存原始数据
  const fs = require('fs');
  fs.writeFileSync('/tmp/early_participants_raw.json', JSON.stringify(walletData, null, 2));
  console.log('原始数据已保存到: /tmp/early_participants_raw.json');

  if (walletData.length === 0) {
    console.log('\n没有获取到任何钱包数据，无法继续分析。');
    return;
  }

  // 步骤4: 数据观察
  console.log('\n' + '='.repeat(70));
  console.log('[步骤4] 数据分布观察');
  console.log('='.repeat(70));

  // 4.1 基础统计
  console.log('\n[4.1 基础统计]');
  console.log(`总钱包数: ${walletData.length}`);

  // 4.2 盈利能力维度
  console.log('\n[4.2 盈利能力维度]');
  const profits = walletData.map(w => parseFloat(w.total_all_profit) || 0);
  const winRates = walletData.map(w => parseFloat(w.win_rate) || 0);

  profits.sort((a, b) => a - b);
  console.log(`总盈亏范围: $${profits[0].toFixed(2)} ~ $${profits[profits.length - 1].toFixed(2)}`);
  console.log(`总盈亏中位数: $${profits[Math.floor(profits.length / 2)].toFixed(2)}`);
  console.log(`总盈亏平均值: $${(profits.reduce((a, b) => a + b, 0) / profits.length).toFixed(2)}`);
  console.log(`盈利钱包数: ${profits.filter(p => p > 0).length} (${(profits.filter(p => p > 0).length / profits.length * 100).toFixed(1)}%)`);
  console.log(`亏损钱包数: ${profits.filter(p => p < 0).length} (${(profits.filter(p => p < 0).length / profits.length * 100).toFixed(1)}%)`);
  console.log(`持平钱包数: ${profits.filter(p => p === 0).length}`);

  console.log(`\n胜率范围: ${Math.min(...winRates).toFixed(2)}% ~ ${Math.max(...winRates).toFixed(2)}%`);
  console.log(`胜率中位数: ${winRates[Math.floor(winRates.length / 2)].toFixed(2)}%`);
  console.log(`胜率平均值: ${(winRates.reduce((a, b) => a + b, 0) / winRates.length).toFixed(2)}%`);

  // 盈利分布分位数
  console.log(`\n总盈亏分位数:`);
  console.log(`  10%: $${profits[Math.floor(profits.length * 0.1)].toFixed(2)}`);
  console.log(`  25%: $${profits[Math.floor(profits.length * 0.25)].toFixed(2)}`);
  console.log(`  50%: $${profits[Math.floor(profits.length * 0.5)].toFixed(2)}`);
  console.log(`  75%: $${profits[Math.floor(profits.length * 0.75)].toFixed(2)}`);
  console.log(`  90%: $${profits[Math.floor(profits.length * 0.9)].toFixed(2)}`);
  console.log(`  95%: $${profits[Math.floor(profits.length * 0.95)].toFixed(2)}`);

  // 4.3 资金规模维度
  console.log('\n[4.3 资金规模维度]');
  const balances = walletData.map(w => parseFloat(w.total_balance) || 0);
  balances.sort((a, b) => a - b);

  console.log(`持仓范围: $${balances[0].toFixed(2)} ~ $${balances[balances.length - 1].toFixed(2)}`);
  console.log(`持仓中位数: $${balances[Math.floor(balances.length / 2)].toFixed(2)}`);
  console.log(`持仓平均值: $${(balances.reduce((a, b) => a + b, 0) / balances.length).toFixed(2)}`);
  console.log(`持仓>$100k: ${balances.filter(b => b > 100000).length}`);
  console.log(`持仓>$10k: ${balances.filter(b => b > 10000).length}`);
  console.log(`持仓>$1k: ${balances.filter(b => b > 1000).length}`);
  console.log(`持仓>$100: ${balances.filter(b => b > 100).length}`);
  console.log(`持仓<$10: ${balances.filter(b => b < 10).length}`);

  console.log(`\n持仓分位数:`);
  console.log(`  10%: $${balances[Math.floor(balances.length * 0.1)].toFixed(2)}`);
  console.log(`  25%: $${balances[Math.floor(balances.length * 0.25)].toFixed(2)}`);
  console.log(`  50%: $${balances[Math.floor(balances.length * 0.5)].toFixed(2)}`);
  console.log(`  75%: $${balances[Math.floor(balances.length * 0.75)].toFixed(2)}`);
  console.log(`  90%: $${balances[Math.floor(balances.length * 0.9)].toFixed(2)}`);

  // 4.4 交易活跃维度
  console.log('\n[4.4 交易活跃维度]');
  const trades = walletData.map(w => w.total_trades || 0);
  trades.sort((a, b) => a - b);

  console.log(`交易次数范围: ${trades[0]} ~ ${trades[trades.length - 1]}`);
  console.log(`交易次数中位数: ${trades[Math.floor(trades.length / 2)]}`);
  console.log(`交易次数平均值: ${(trades.reduce((a, b) => a + b, 0) / trades.length).toFixed(0)}`);
  console.log(`交易>1000次: ${trades.filter(t => t > 1000).length}`);
  console.log(`交易>500次: ${trades.filter(t => t > 500).length}`);
  console.log(`交易>100次: ${trades.filter(t => t > 100).length}`);
  console.log(`交易>50次: ${trades.filter(t => t > 50).length}`);
  console.log(`交易<10次: ${trades.filter(t => t < 10).length}`);

  console.log(`\n交易次数分位数:`);
  console.log(`  10%: ${trades[Math.floor(trades.length * 0.1)]}次`);
  console.log(`  25%: ${trades[Math.floor(trades.length * 0.25)]}次`);
  console.log(`  50%: ${trades[Math.floor(trades.length * 0.5)]}次`);
  console.log(`  75%: ${trades[Math.floor(trades.length * 0.75)]}次`);
  console.log(`  90%: ${trades[Math.floor(trades.length * 0.9)]}次`);

  // 4.5 代币数量
  console.log('\n[4.5 持仓代币数量]');
  const tokenCounts = walletData.map(w => w.total_tokens || 0);
  tokenCounts.sort((a, b) => a - b);

  console.log(`代币数范围: ${tokenCounts[0]} ~ ${tokenCounts[tokenCounts.length - 1]}`);
  console.log(`代币数中位数: ${tokenCounts[Math.floor(tokenCounts.length / 2)]}`);
  console.log(`代币数平均值: ${(tokenCounts.reduce((a, b) => a + b, 0) / tokenCounts.length).toFixed(1)}`);
  console.log(`持仓>50个代币: ${tokenCounts.filter(c => c > 50).length}`);
  console.log(`持仓>20个代币: ${tokenCounts.filter(c => c > 20).length}`);
  console.log(`持仓>10个代币: ${tokenCounts.filter(c => c > 10).length}`);
  console.log(`持仓1个代币: ${tokenCounts.filter(c => c === 1).length}`);

  // 4.6 盈亏代币分布
  console.log('\n[4.6 盈亏代币分布]');
  const profitableCounts = walletData.map(w => w.profitable_tokens || 0);
  const losingCounts = walletData.map(w => w.losing_tokens || 0);

  console.log(`平均盈利代币数: ${(profitableCounts.reduce((a, b) => a + b, 0) / walletData.length).toFixed(1)}`);
  console.log(`平均亏损代币数: ${(losingCounts.reduce((a, b) => a + b, 0) / walletData.length).toFixed(1)}`);

  // 4.7 典型钱包示例
  console.log('\n[4.7 典型钱包示例]');

  // 按总盈亏排序，取前5和后5
  const sortedByProfit = [...walletData].sort((a, b) => b.total_all_profit - a.total_all_profit);

  console.log('\n最盈利的5个钱包:');
  sortedByProfit.slice(0, 5).forEach((w, i) => {
    console.log(`  ${i + 1}. ${w.address.slice(0, 10)}... 持仓$${w.total_balance.toFixed(0)} 盈利$${w.total_all_profit.toFixed(0)} 交易${w.total_trades}次 胜率${w.win_rate}`);
  });

  console.log('\n最亏损的5个钱包:');
  sortedByProfit.slice(-5).reverse().forEach((w, i) => {
    console.log(`  ${i + 1}. ${w.address.slice(0, 10)}... 持仓$${w.total_balance.toFixed(0)} 盈利$${w.total_all_profit.toFixed(0)} 交易${w.total_trades}次 胜率${w.win_rate}`);
  });

  // 按持仓排序
  const sortedByBalance = [...walletData].sort((a, b) => b.total_balance - a.total_balance);
  console.log('\n持仓最大的5个钱包:');
  sortedByBalance.slice(0, 5).forEach((w, i) => {
    console.log(`  ${i + 1}. ${w.address.slice(0, 10)}... 持仓$${w.total_balance.toFixed(0)} 盈利$${w.total_all_profit.toFixed(0)} 交易${w.total_trades}次`);
  });

  console.log('\n' + '='.repeat(70));
  console.log('数据观察完成！基于上述分布，接下来设计分类体系。');
  console.log('='.repeat(70));
}

main().catch(console.error);
