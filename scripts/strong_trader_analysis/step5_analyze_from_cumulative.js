/**
 * 步骤5: 最终分析 - 识别强势交易者
 * 基于累积的钱包数据
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const WALLET_FILE = path.join(DATA_DIR, 'wallet_data_valid.json');
const TRADE_FILE = path.join(DATA_DIR, 'step2_early_trades.json');

// 阈值设置
const THRESHOLDS = {
  profitAbs: 30000,        // |total_profit| >= $30000
  soldPurchaseRatio: 0.8,   // sold/purchase >= 0.8
  totalTrades: 500         // total_trades >= 500
};

function isStrongTrader(wallet) {
  const profitAbsOK = Math.abs(wallet.total_profit || 0) >= THRESHOLDS.profitAbs;
  const purchase = wallet.total_purchase || 0;
  const sold = wallet.total_sold || 0;
  const ratioOK = purchase > 0 && (sold / purchase) >= THRESHOLDS.soldPurchaseRatio;
  const tradesOK = (wallet.total_trades || 0) >= THRESHOLDS.totalTrades;
  return profitAbsOK && ratioOK && tradesOK;
}

async function main() {
  console.log('=== 步骤5: 最终分析 - 识别强势交易者 ===\n');
  console.log('阈值设置:');
  console.log(`  |profit| >= $${THRESHOLDS.profitAbs}`);
  console.log(`  sold/purchase >= ${THRESHOLDS.soldPurchaseRatio}`);
  console.log(`  total_trades >= ${THRESHOLDS.totalTrades}\n`);

  // 读取钱包数据
  if (!fs.existsSync(WALLET_FILE)) {
    console.error('请先运行 step3_fetch_cumulative.js');
    process.exit(1);
  }

  const walletData = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
  console.log(`总钱包数: ${walletData.length}\n`);

  // 识别强势交易者
  const strongTraders = [];
  const strongTraderSet = new Set();

  walletData.forEach(w => {
    if (isStrongTrader(w)) {
      strongTraderSet.add(w.address.toLowerCase());
      strongTraders.push(w);
    }
  });

  console.log(`识别到 ${strongTraders.length} 个强势交易者\n`);

  if (strongTraders.length > 0) {
    console.log('Top 10 按 |profit| 排序:');
    strongTraders
      .sort((a, b) => Math.abs(b.total_profit) - Math.abs(a.total_profit))
      .slice(0, 10)
      .forEach((w, i) => {
        const ratio = (w.total_sold / (w.total_purchase || 1)).toFixed(2);
        console.log(`  ${i+1}. ${w.address.slice(0,10)}... |profit|=$${Math.abs(w.total_profit).toFixed(0)} sold/purchase=${ratio} trades=${w.total_trades}`);
      });
  }

  // 分析代币参与度
  let tradeData;
  try {
    tradeData = JSON.parse(fs.readFileSync(TRADE_FILE, 'utf8'));
  } catch (e) {
    console.log('未找到交易数据文件，跳过代币参与度分析');
  }

  let tokenStats = [];
  if (tradeData && tradeData.results) {
    console.log('\n代币强势交易者参与度:');

    for (const result of tradeData.results) {
      const tokenWallets = new Set();
      for (const trade of result.trades || []) {
        const wallet = trade.wallet_address || trade.from_address;
        if (wallet) tokenWallets.add(wallet.toLowerCase());
      }

      const strongTraderCount = Array.from(tokenWallets).filter(w =>
        strongTraderSet.has(w)
      ).length;

      tokenStats.push({
        token_address: result.token_address,
        token_symbol: result.token_symbol,
        quality_label: result.quality_label || 'unlabeled',
        total_wallets: tokenWallets.size,
        strong_trader_count: strongTraderCount,
        strong_trader_ratio: tokenWallets.size > 0 ? strongTraderCount / tokenWallets.size : 0
      });
    }

    // 按参与度排序
    tokenStats.sort((a, b) => b.strong_trader_ratio - a.strong_trader_ratio);

    console.log('\nTop 10 高参与度代币:');
    tokenStats.slice(0, 10).forEach(t => {
      console.log(`  ${t.token_symbol}: ${t.strong_trader_count}/${t.total_wallets} (${(t.strong_trader_ratio * 100).toFixed(1)}%) - ${t.quality_label}`);
    });
  }

  // 保存结果
  const output = {
    thresholds: THRESHOLDS,
    total_wallets: walletData.length,
    strong_traders: {
      count: strongTraders.length,
      traders: strongTraders.map(w => ({
        address: w.address,
        total_profit: w.total_profit,
        total_purchase: w.total_purchase,
        total_sold: w.total_sold,
        total_trades: w.total_trades
      }))
    },
    token_stats: tokenStats
  };

  // 保存到实验特定的文件
  const tradeExpId = tradeData?.experiment_id || 'unknown';
  const outputFile = path.join(DATA_DIR, `${tradeExpId}_step5_final_analysis.json`);
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

  console.log(`\n✅ 分析结果已保存到 ${outputFile}`);
  console.log(`\n强势交易者列表 (${strongTraders.length} 个):`);
  strongTraders.forEach(w => console.log(`  ${w.address}`));
}

main().catch(error => {
  console.error('错误:', error);
  process.exit(1);
});
