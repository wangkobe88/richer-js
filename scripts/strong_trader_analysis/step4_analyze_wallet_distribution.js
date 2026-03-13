/**
 * 步骤4: 分析钱包数据分布
 * 建议强短线交易者的阈值
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const INPUT_FILE = path.join(DATA_DIR, 'wallet_data_valid.json');

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
  console.log('=== 步骤4: 分析钱包数据分布 ===\n');

  if (!fs.existsSync(INPUT_FILE)) {
    console.error('请先运行 step3_fetch_wallet_data.js');
    return;
  }

  const data = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  console.log(`分析 ${data.length} 个钱包的数据\n`);

  // 提取各维度数据
  const profits = data.map(w => w.total_profit || 0);
  const profitsAbs = data.map(w => Math.abs(w.total_profit || 0));
  const purchaseCount = data.map(w => w.total_purchase || 0);
  const soldCount = data.map(w => w.total_sold || 0);
  const totalTrades = data.map(w => w.total_trades || 0);
  const soldPurchaseRatio = data.map(w => {
    const purchase = w.total_purchase || 0;
    const sold = w.total_sold || 0;
    return purchase > 0 ? sold / purchase : 0;
  });
  const balances = data.map(w => w.total_balance || 0);
  const winRates = data.map(w => w.total_win_ratio || 0);

  // 统计各维度分布
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【维度1: 总盈亏 total_profit】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const profitStats = {
    min: Math.min(...profits),
    max: Math.max(...profits),
    median: percentile(profits, 0.5),
    avg: profits.reduce((a, b) => a + b, 0) / profits.length
  };

  console.log(`范围: ${formatUSD(profitStats.min)} ~ ${formatUSD(profitStats.max)}`);
  console.log(`中位数: ${formatUSD(profitStats.median)}`);
  console.log(`平均值: ${formatUSD(profitStats.avg)}`);
  console.log(`盈利钱包: ${profits.filter(p => p > 0).length} (${(profits.filter(p => p > 0).length / profits.length * 100).toFixed(1)}%)`);
  console.log(`亏损钱包: ${profits.filter(p => p < 0).length} (${(profits.filter(p => p < 0).length / profits.length * 100).toFixed(1)}%)`);

  console.log('\n分位数:');
  for (const p of [0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99]) {
    console.log(`  ${Math.floor(p * 100)}%: ${formatUSD(percentile(profits, p))}`);
  }

  // 盈亏绝对值分布
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【维度2: 盈亏绝对值 |total_profit|】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`中位数: ${formatUSD(percentile(profitsAbs, 0.5))}`);
  console.log(`平均值: ${formatUSD(profitsAbs.reduce((a, b) => a + b, 0) / profitsAbs.length)}`);

  console.log('\n分位数:');
  for (const p of [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.97, 0.99]) {
    const val = percentile(profitsAbs, p);
    const count = profitsAbs.filter(v => v >= val).length;
    console.log(`  ${Math.floor(p * 100)}%: ${formatUSD(val)} (>=此值: ${count}个钱包, ${(count/profitsAbs.length*100).toFixed(1)}%)`);
  }

  // 卖出/买入比分布
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【维度3: 卖出/买入比 sold/purchase】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const validRatio = soldPurchaseRatio.filter(r => r > 0);  // 排除0

  console.log(`中位数: ${(percentile(validRatio, 0.5) * 100).toFixed(1)}%`);
  console.log(`平均值: ${(validRatio.reduce((a, b) => a + b, 0) / validRatio.length * 100).toFixed(1)}%`);
  console.log(`有卖出记录的钱包: ${validRatio.length} (${(validRatio.length / soldPurchaseRatio.length * 100).toFixed(1)}%)`);

  console.log('\n分位数:');
  for (const p of [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.97, 0.99]) {
    const val = percentile(validRatio, p);
    const count = validRatio.filter(v => v >= val).length;
    console.log(`  ${Math.floor(p * 100)}%: ${(val * 100).toFixed(1)}% (>=此值: ${count}个钱包, ${(count/validRatio.length*100).toFixed(1)}%)`);
  }

  // 总交易次数分布
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【维度4: 总交易次数 total_trades】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`中位数: ${percentile(totalTrades, 0.5)}`);
  console.log(`平均值: ${(totalTrades.reduce((a, b) => a + b, 0) / totalTrades.length).toFixed(0)}`);

  console.log('\n分位数:');
  for (const p of [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.97, 0.99]) {
    const val = percentile(totalTrades, p);
    const count = totalTrades.filter(v => v >= val).length;
    console.log(`  ${Math.floor(p * 100)}%: ${Math.floor(val)} (>=此值: ${count}个钱包, ${(count/totalTrades.length*100).toFixed(1)}%)`);
  }

  // 建议阈值
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【阈值建议】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 根据用户提供的示例钱包，应该是非常活跃的交易者
  // 示例: total_profit绝对值大，sold/purchase也较大

  console.log('根据数据分布，以下是几个阈值方案：\n');

  const thresholds = [
    {
      name: '宽松 (会包含较多普通交易者)',
      profitAbs: 500,
      soldPurchaseRatio: 0.2,
      totalTrades: 10,
      description: '适合初步筛选'
    },
    {
      name: '中等',
      profitAbs: 2000,
      soldPurchaseRatio: 0.4,
      totalTrades: 50,
      description: '平衡召回率和精确率'
    },
    {
      name: '严格 (仅保留最活跃的交易者)',
      profitAbs: 5000,
      soldPurchaseRatio: 0.5,
      totalTrades: 100,
      description: '适合识别"强"短线交易者'
    },
    {
      name: '非常严格 (接近用户示例)',
      profitAbs: 10000,
      soldPurchaseRatio: 0.6,
      totalTrades: 200,
      description: '仅保留顶级交易者'
    }
  ];

  thresholds.forEach(t => {
    const count = data.filter(w => {
      const profitAbsOK = Math.abs(w.total_profit) >= t.profitAbs;
      const ratioOK = (w.total_sold / (w.total_purchase || 1)) >= t.soldPurchaseRatio;
      const tradesOK = w.total_trades >= t.totalTrades;
      return profitAbsOK && ratioOK && tradesOK;
    }).length;

    console.log(`${t.name}:`);
    console.log(`  |profit| >= $${t.profitAbs}, sold/purchase >= ${t.soldPurchaseRatio}, trades >= ${t.totalTrades}`);
    console.log(`  符合条件: ${count} 个钱包 (${(count/data.length*100).toFixed(1)}%)`);
    console.log(`  说明: ${t.description}`);
    console.log('');
  });

  // 保存分析结果
  const analysis = {
    total_wallets: data.length,
    profit_distribution: {
      min: profitStats.min,
      max: profitStats.max,
      median: profitStats.median,
      avg: profitStats.avg,
      percentiles: {
        p50: percentile(profits, 0.5),
        p75: percentile(profits, 0.75),
        p90: percentile(profits, 0.9),
        p95: percentile(profits, 0.95),
        p99: percentile(profits, 0.99)
      }
    },
    profit_abs_distribution: {
      p70: percentile(profitsAbs, 0.7),
      p80: percentile(profitsAbs, 0.8),
      p90: percentile(profitsAbs, 0.9),
      p95: percentile(profitsAbs, 0.95),
      p97: percentile(profitsAbs, 0.97),
      p99: percentile(profitsAbs, 0.99)
    },
    sold_purchase_ratio_distribution: {
      p70: percentile(validRatio, 0.7),
      p80: percentile(validRatio, 0.8),
      p90: percentile(validRatio, 0.9),
      p95: percentile(validRatio, 0.95),
      p97: percentile(validRatio, 0.97),
      p99: percentile(validRatio, 0.99)
    },
    total_trades_distribution: {
      p70: percentile(totalTrades, 0.7),
      p80: percentile(totalTrades, 0.8),
      p90: percentile(totalTrades, 0.9),
      p95: percentile(totalTrades, 0.95),
      p97: percentile(totalTrades, 0.97),
      p99: percentile(totalTrades, 0.99)
    },
    threshold_suggestions: thresholds
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'step4_wallet_distribution_analysis.json'),
    JSON.stringify(analysis, null, 2)
  );

  console.log('✅ 分析结果已保存到 data/step4_wallet_distribution_analysis.json');
}

main().catch(console.error);
