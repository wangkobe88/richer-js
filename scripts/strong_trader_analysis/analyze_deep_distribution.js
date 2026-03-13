/**
 * 深入分析钱包数据分布
 * 制定合理的强短线交易者阈值
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const walletData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wallet_data_valid.json'), 'utf8'));

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[idx];
}

function formatUSD(value) {
  if (Math.abs(value) >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  return `$${value.toFixed(2)}`;
}

async function main() {
  console.log('=== 深入分析钱包数据分布 ===\n');

  // 提取各维度数据
  const profits = walletData.map(w => w.total_profit || 0);
  const profitsAbs = walletData.map(w => Math.abs(w.total_profit || 0));
  const purchaseCount = walletData.map(w => w.total_purchase || 0);
  const soldCount = walletData.map(w => w.total_sold || 0);
  const totalTrades = walletData.map(w => w.total_trades || 0);

  // 计算sold/purchase比率（交易次数比）
  const soldPurchaseRatio = walletData.map(w => {
    const purchase = w.total_purchase || 0;
    const sold = w.total_sold || 0;
    return purchase > 0 ? sold / purchase : 0;
  });

  // 只统计有卖出记录的钱包
  const soldPurchaseRatioWithSales = soldPurchaseRatio.filter(r => r > 0);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【维度1: 总盈亏 total_profit】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const profitStats = {
    min: Math.min(...profits),
    max: Math.max(...profits),
    avg: profits.reduce((a,b) => a+b, 0) / profits.length
  };
  console.log(`范围: ${formatUSD(profitStats.min)} ~ ${formatUSD(profitStats.max)}`);
  console.log(`平均值: ${formatUSD(profitStats.avg)}`);
  console.log(`盈利钱包: ${profits.filter(p => p > 0).length} (${(profits.filter(p => p > 0).length / profits.length * 100).toFixed(1)}%)`);
  console.log(`亏损钱包: ${profits.filter(p => p < 0).length} (${(profits.filter(p => p < 0).length / profits.length * 100).toFixed(1)}%)`);

  // 盈亏绝对值分位数
  console.log('\n|total_profit| 分位数:');
  for (const p of [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.97, 0.99]) {
    const val = percentile(profitsAbs, p);
    const count = profitsAbs.filter(v => v >= val).length;
    console.log(`  Top${Math.floor((1-p)*100)}%: >= ${formatUSD(val)} (count: ${count}, ${(count/profitsAbs.length*100).toFixed(1)}%)`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【维度2: 卖出/买入次数比 sold/purchase】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`有卖出记录的钱包: ${soldPurchaseRatioWithSales.length} (${(soldPurchaseRatioWithSales.length / walletData.length * 100).toFixed(1)}%)`);

  console.log('\nsold/purchase 分位数 (仅统计有卖出的钱包):');
  for (const p of [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.97, 0.99]) {
    const val = percentile(soldPurchaseRatioWithSales, p);
    const count = soldPurchaseRatioWithSales.filter(v => v >= val).length;
    console.log(`  Top${Math.floor((1-p)*100)}%: >= ${(val*100).toFixed(2)}% (count: ${count}, ${(count/soldPurchaseRatioWithSales.length*100).toFixed(1)}%)`);
  }

  // 分析大于某阈值的钱包数量
  console.log('\n大于某阈值的钱包占比:');
  const ratioThresholds = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.5, 2.0];
  ratioThresholds.forEach(t => {
    const count = soldPurchaseRatioWithSales.filter(r => r >= t).length;
    console.log(`  sold/purchase >= ${t}: ${count} 个 (${(count/soldPurchaseRatioWithSales.length*100).toFixed(1)}%)`);
  });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【维度3: 总交易次数 total_trades】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  console.log('\ntotal_trades 分位数:');
  for (const p of [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.97, 0.99]) {
    const val = percentile(totalTrades, p);
    const count = totalTrades.filter(v => v >= val).length;
    console.log(`  Top${Math.floor((1-p)*100)}%: >= ${Math.floor(val)} (count: ${count}, ${(count/totalTrades.length*100).toFixed(1)}%)`);
  }

  // 交易次数大于某阈值
  console.log('\n大于某阈值的钱包占比:');
  const tradeThresholds = [50, 100, 200, 300, 500, 800, 1000, 1500, 2000, 3000, 5000];
  tradeThresholds.forEach(t => {
    const count = totalTrades.filter(v => v >= t).length;
    console.log(`  total_trades >= ${t}: ${count} 个 (${(count/totalTrades.length*100).toFixed(1)}%)`);
  });

  // 用户示例钱包的数据
  const exampleWallets = [
    '0x2ce9d43d1cba6ae31d7f07bfe0098dfa2d833373',
    '0xa83b73f5644cde337b61da79589f10ea15548811',
    '0x7a2363a401b2340c7941dd2eeff0196a5078d2e6'
  ];

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【用户示例钱包的数据】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  exampleWallets.forEach(w => {
    const found = walletData.find(d => d.address.toLowerCase() === w.toLowerCase());
    if (found) {
      const ratio = (found.total_sold / (found.total_purchase || 1)).toFixed(2);
      const profitPercentile = (profitsAbs.filter(v => v < Math.abs(found.total_profit)).length / profitsAbs.length * 100).toFixed(1);
      const tradesPercentile = (totalTrades.filter(v => v < found.total_trades).length / totalTrades.length * 100).toFixed(1);

      console.log(`\n${w.slice(0, 20)}...:`);
      console.log(`  |profit|: ${formatUSD(Math.abs(found.total_profit))} (Top ${(100-profitPercentile).toFixed(1)}%)`);
      console.log(`  sold/purchase: ${ratio} (sold=${found.total_sold}, purchase=${found.total_purchase})`);
      console.log(`  trades: ${found.total_trades} (Top ${(100-tradesPercentile).toFixed(1)}%)`);
    }
  });

  // 建议阈值
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【建议阈值】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('根据数据分布和用户示例钱包，以下是几个阈值方案：\n');

  const thresholds = [
    {
      name: '宽松 (会包含较多普通交易者)',
      profitAbs: 2000,
      soldPurchaseRatio: 0.3,
      totalTrades: 50,
      description: '适合初步筛选'
    },
    {
      name: '中等 (平衡方案)',
      profitAbs: 10000,
      soldPurchaseRatio: 0.5,
      totalTrades: 200,
      description: '推荐使用'
    },
    {
      name: '严格 (接近用户示例)',
      profitAbs: 50000,
      soldPurchaseRatio: 0.7,
      totalTrades: 500,
      description: '仅保留顶级交易者'
    },
    {
      name: '非常严格 (用户示例水平)',
      profitAbs: 100000,
      soldPurchaseRatio: 0.8,
      totalTrades: 1000,
      description: '仅保留极少数顶级交易者'
    }
  ];

  thresholds.forEach(t => {
    const count = walletData.filter(w => {
      const profitAbsOK = Math.abs(w.total_profit || 0) >= t.profitAbs;
      const ratioOK = (w.total_sold / (w.total_purchase || 1)) >= t.soldPurchaseRatio;
      const tradesOK = (w.total_trades || 0) >= t.totalTrades;
      return profitAbsOK && ratioOK && tradesOK;
    }).length;

    console.log(`${t.name}:`);
    console.log(`  |profit| >= $${t.profitAbs}, sold/purchase >= ${t.soldPurchaseRatio}, trades >= ${t.totalTrades}`);
    console.log(`  符合条件: ${count} 个钱包 (${(count/walletData.length*100).toFixed(1)}%)`);
    console.log(`  说明: ${t.description}`);
    console.log('');
  });

  // 保存分析结果
  const analysis = {
    total_wallets: walletData.length,
    profit_distribution: {
      p90: percentile(profitsAbs, 0.9),
      p95: percentile(profitsAbs, 0.95),
      p97: percentile(profitsAbs, 0.97),
      p99: percentile(profitsAbs, 0.99)
    },
    sold_purchase_ratio_distribution: {
      p90: percentile(soldPurchaseRatioWithSales, 0.9),
      p95: percentile(soldPurchaseRatioWithSales, 0.95),
      p97: percentile(soldPurchaseRatioWithSales, 0.97),
      p99: percentile(soldPurchaseRatioWithSales, 0.99)
    },
    total_trades_distribution: {
      p90: percentile(totalTrades, 0.9),
      p95: percentile(totalTrades, 0.95),
      p97: percentile(totalTrades, 0.97),
      p99: percentile(totalTrades, 0.99)
    },
    threshold_suggestions: thresholds
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'deep_wallet_distribution_analysis.json'),
    JSON.stringify(analysis, null, 2)
  );

  console.log('✅ 深入分析结果已保存到 data/deep_wallet_distribution_analysis.json');
}

main().catch(console.error);
