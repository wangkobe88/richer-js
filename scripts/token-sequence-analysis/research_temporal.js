/**
 * 时间分段分析
 * 研究不同时间段的钱包行为对涨幅的影响
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'processed');

function loadSequences() {
  const sequencesPath = path.join(DATA_DIR, 'all_sequences.json');
  const content = fs.readFileSync(sequencesPath, 'utf-8');
  const data = JSON.parse(content);
  return data.sequences;
}

/**
 * 分析不同时间段的特征与涨幅的相关性
 */
function temporalSegmentAnalysis(sequences) {
  console.log('========================================');
  console.log('时间分段分析');
  console.log('========================================\n');

  // 定义时间段（秒）
  const segments = [
    { name: '0-30s', start: 0, end: 30 },
    { name: '30-60s', start: 30, end: 60 },
    { name: '60-90s', start: 60, end: 90 },
    { name: '90-120s', start: 90, end: 120 },
    { name: '120-180s', start: 120, end: 180 },
  ];

  // 为每个代币提取每个时间段的特征
  const tokenFeatures = sequences.map(seq => {
    const features = {
      token_address: seq.token_address,
      token_symbol: seq.token_symbol,
      max_change_percent: seq.max_change_percent,
      segments: {}
    };

    segments.forEach(seg => {
      const segmentTrades = [];

      seq.sequence.forEach(([wallet, amount], idx) => {
        const time = idx * 3; // 假设每笔交易间隔3秒
        if (time >= seg.start && time < seg.end) {
          segmentTrades.push([wallet, amount]);
        }
      });

      // 计算该时间段的特征
      const uniqueWallets = new Set(segmentTrades.map(([w]) => w));
      const totalBuy = segmentTrades.reduce((sum, [, a]) => a > 0 ? sum + a : sum, 0);
      const totalSell = segmentTrades.reduce((sum, [, a]) => a < 0 ? sum + Math.abs(a) : sum, 0);
      const tradeCount = segmentTrades.length;

      features.segments[seg.name] = {
        trade_count: tradeCount,
        unique_wallets: uniqueWallets.size,
        total_buy: totalBuy,
        total_sell: totalSell,
        net_flow: totalBuy - totalSell,
        avg_buy_amount: tradeCount > 0 ? totalBuy / Math.max(1, segmentTrades.filter(([, a]) => a > 0).length) : 0
      };
    });

    return features;
  });

  // 计算每个时间段特征与涨幅的相关性
  console.log('【各时间段特征与涨幅的相关性】\n');

  const correlation = (xArr, yArr) => {
    const n = xArr.length;
    const meanX = xArr.reduce((a, b) => a + b, 0) / n;
    const meanY = yArr.reduce((a, b) => a + b, 0) / n;
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
      const dx = xArr[i] - meanX;
      const dy = yArr[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    return num / Math.sqrt(denX * denY);
  };

  const changes = tokenFeatures.map(f => f.max_change_percent);

  segments.forEach(seg => {
    console.log(`${seg.name}:`);

    const tradeCounts = tokenFeatures.map(f => f.segments[seg.name].trade_count);
    const uniqueWallets = tokenFeatures.map(f => f.segments[seg.name].unique_wallets);
    const netFlows = tokenFeatures.map(f => f.segments[seg.name].net_flow);
    const avgBuys = tokenFeatures.map(f => f.segments[seg.name].avg_buy_amount);

    console.log(`  交易次数 vs 涨幅: ${correlation(tradeCounts, changes).toFixed(3)}`);
    console.log(`  唯一钱包数 vs 涨幅: ${correlation(uniqueWallets, changes).toFixed(3)}`);
    console.log(`  净流入 vs 涨幅: ${correlation(netFlows, changes).toFixed(3)}`);
    console.log(`  平均买入额 vs 涨幅: ${correlation(avgBuys, changes).toFixed(3)}`);
    console.log('');
  });

  // 分析高涨幅代币在不同时间段的特征
  console.log('【高涨幅代币的时间段特征】\n');

  const highReturnTokens = tokenFeatures
    .filter(f => f.max_change_percent >= 500)
    .sort((a, b) => b.max_change_percent - a.max_change_percent)
    .slice(0, 10);

  segments.forEach(seg => {
    console.log(`${seg.name}:`);

    const values = highReturnTokens.map(f => f.segments[seg.name]);
    const avgTradeCount = values.reduce((sum, v) => sum + v.trade_count, 0) / values.length;
    const avgWallets = values.reduce((sum, v) => sum + v.unique_wallets, 0) / values.length;
    const avgNetFlow = values.reduce((sum, v) => sum + v.net_flow, 0) / values.length;

    console.log(`  平均交易次数: ${avgTradeCount.toFixed(1)}`);
    console.log(`  平均唯一钱包: ${avgWallets.toFixed(1)}`);
    console.log(`  平均净流入: $${avgNetFlow.toFixed(0)}`);
    console.log('');
  });

  // 分析低涨幅代币在不同时间段的特征
  console.log('【低涨幅代币的时间段特征】\n');

  const lowReturnTokens = tokenFeatures
    .filter(f => f.max_change_percent <= 60)
    .slice(0, 10);

  segments.forEach(seg => {
    console.log(`${seg.name}:`);

    const values = lowReturnTokens.map(f => f.segments[seg.name]);
    const avgTradeCount = values.reduce((sum, v) => sum + v.trade_count, 0) / values.length;
    const avgWallets = values.reduce((sum, v) => sum + v.unique_wallets, 0) / values.length;
    const avgNetFlow = values.reduce((sum, v) => sum + v.net_flow, 0) / values.length;

    console.log(`  平均交易次数: ${avgTradeCount.toFixed(1)}`);
    console.log(`  平均唯一钱包: ${avgWallets.toFixed(1)}`);
    console.log(`  平均净流入: $${avgNetFlow.toFixed(0)}`);
    console.log('');
  });

  return tokenFeatures;
}

/**
 * 分析"第一个钱包"的重要性
 */
function firstWalletAnalysis(sequences) {
  console.log('\n========================================');
  console.log('首个钱包分析');
  console.log('========================================\n');

  const tokenFirstWallet = sequences.map(seq => {
    if (seq.sequence.length === 0) return null;

    const [firstWallet, firstAmount] = seq.sequence[0];

    // 统计第一个钱包的特征
    const firstWalletTrades = seq.sequence.filter(([w]) => w === firstWallet);
    const totalBuy = firstWalletTrades.reduce((sum, [, a]) => a > 0 ? sum + a : sum, 0);
    const totalSell = firstWalletTrades.reduce((sum, [, a]) => a < 0 ? sum + Math.abs(a) : sum, 0);

    return {
      token_address: seq.token_address,
      token_symbol: seq.token_symbol,
      max_change_percent: seq.max_change_percent,
      first_wallet: firstWallet,
      first_amount: firstAmount,
      first_is_buy: firstAmount > 0,
      first_wallet_total_trades: firstWalletTrades.length,
      first_wallet_total_buy: totalBuy,
      first_wallet_total_sell: totalSell,
      first_wallet_net: totalBuy - totalSell
    };
  }).filter(Boolean);

  // 分析第一个钱包的类型
  console.log('第一个钱包类型分布:\n');

  const creatorBuys = tokenFirstWallet.filter(t => t.first_is_buy && t.first_wallet_total_trades === 1);
  const creatorSells = tokenFirstWallet.filter(t => !t.first_is_buy && t.first_wallet_total_trades === 1);
  const activeFirst = tokenFirstWallet.filter(t => t.first_wallet_total_trades > 1);

  console.log(`只在第一笔交易买入（可能是创建者）: ${creatorBuys.length} 个代币`);
  console.log(`  平均涨幅: ${creatorBuys.reduce((sum, t) => sum + t.max_change_percent, 0) / creatorBuys.length.toFixed(1)}%`);
  console.log(`  涨幅 >= 100%: ${creatorBuys.filter(t => t.max_change_percent >= 100).length} 个 (${(creatorBuys.filter(t => t.max_change_percent >= 100).length / creatorBuys.length * 100).toFixed(1)}%)`);

  console.log(`\n只在第一笔交易卖出（可能是抛售）: ${creatorSells.length} 个代币`);
  console.log(`  平均涨幅: ${creatorSells.reduce((sum, t) => sum + t.max_change_percent, 0) / creatorSells.length.toFixed(1)}%`);

  console.log(`\n第一个钱包持续交易: ${activeFirst.length} 个代币`);
  console.log(`  平均涨幅: ${activeFirst.reduce((sum, t) => sum + t.max_change_percent, 0) / activeFirst.length.toFixed(1)}%`);

  // 第一个钱包的买入金额与涨幅的关系
  const firstBuyAmounts = tokenFirstWallet.filter(t => t.first_is_buy).map(t => t.first_amount);
  const firstBuyChanges = tokenFirstWallet.filter(t => t.first_is_buy).map(t => t.max_change_percent);

  let num = 0, denX = 0, denY = 0;
  const meanX = firstBuyAmounts.reduce((a, b) => a + b, 0) / firstBuyAmounts.length;
  const meanY = firstBuyChanges.reduce((a, b) => a + b, 0) / firstBuyChanges.length;

  for (let i = 0; i < firstBuyAmounts.length; i++) {
    const dx = firstBuyAmounts[i] - meanX;
    const dy = firstBuyChanges[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const corr = num / Math.sqrt(denX * denY);
  console.log(`\n第一笔买入金额与涨幅的相关系数: ${corr.toFixed(3)}`);

  // 按第一笔买入金额分组统计
  console.log('\n按第一笔买入金额分组统计:\n');

  const amountGroups = [
    { name: '< $50', min: 0, max: 50 },
    { name: '$50-100', min: 50, max: 100 },
    { name: '$100-500', min: 100, max: 500 },
    { name: '$500-1000', min: 500, max: 1000 },
    { name: '> $1000', min: 1000, max: Infinity }
  ];

  amountGroups.forEach(group => {
    const groupTokens = tokenFirstWallet.filter(t =>
      t.first_is_buy && t.first_amount >= group.min && t.first_amount < group.max
    );

    if (groupTokens.length > 0) {
      const avgChange = groupTokens.reduce((sum, t) => sum + t.max_change_percent, 0) / groupTokens.length;
      const highReturnCount = groupTokens.filter(t => t.max_change_percent >= 100).length;

      console.log(`${group.name}: ${groupTokens.length} 个代币`);
      console.log(`  平均涨幅: ${avgChange.toFixed(1)}%`);
      console.log(`  涨幅 >= 100%: ${highReturnCount} 个 (${(highReturnCount / groupTokens.length * 100).toFixed(1)}%)`);
    }
  });
}

/**
 * 分析"狙击手"钱包
 */
function sniperAnalysis(sequences) {
  console.log('\n========================================');
  console.log('狙击手钱包分析');
  console.log('========================================\n');

  // 定义"狙击手"：在前10笔交易中出现，且买入金额较大
  const SNIPER_THRESHOLD = 100; // 最低买入金额
  const SNIPER_TIME_WINDOW = 10; // 前N笔交易

  // 统计每个钱包在不同代币中的"狙击"行为
  const walletSnipes = {}; // wallet -> { token_count, total_amount, tokens: [{symbol, amount, return}] }

  sequences.forEach(seq => {
    const firstTrades = seq.sequence.slice(0, SNIPER_TIME_WINDOW);

    firstTrades.forEach(([wallet, amount]) => {
      if (amount > SNIPER_THRESHOLD) {
        if (!walletSnipes[wallet]) {
          walletSnipes[wallet] = {
            token_count: 0,
            total_amount: 0,
            tokens: []
          };
        }
        walletSnipes[wallet].token_count++;
        walletSnipes[wallet].total_amount += amount;
        walletSnipes[wallet].tokens.push({
          symbol: seq.token_symbol,
          amount: amount,
          return: seq.max_change_percent
        });
      }
    });
  });

  // 找出最活跃的狙击手
  const topSnipers = Object.entries(walletSnipes)
    .map(([addr, data]) => ({ address: addr, ...data }))
    .sort((a, b) => b.token_count - a.token_count)
    .slice(0, 20);

  console.log('最活跃的狙击手钱包（在多个代币早期大额买入）:\n');

  topSnipers.forEach((sniper, i) => {
    const avgReturn = sniper.tokens.reduce((sum, t) => sum + t.return, 0) / sniper.tokens.length;
    const highReturnRate = sniper.tokens.filter(t => t.return >= 100).length / sniper.tokens.length;

    console.log(`${i + 1}. ${sniper.address.slice(0, 10)}...`);
    console.log(`   参与 ${sniper.token_count} 个代币`);
    console.log(`   总投入: $${sniper.total_amount.toFixed(0)}`);
    console.log(`   平均涨幅: ${avgReturn.toFixed(1)}%`);
    console.log(`   成功率（>=100%）: ${(highReturnRate * 100).toFixed(1)}%`);

    // 显示该狙击手参与的前5个代币
    console.log(`   代表性代币:`);
    sniper.tokens
      .sort((a, b) => b.return - a.return)
      .slice(0, 3)
      .forEach(t => {
        console.log(`     ${t.symbol} (+${t.return.toFixed(1)}%) - $${t.amount.toFixed(0)}`);
      });
    console.log('');
  });

  // 分析狙击手钱包的胜率分布
  const sniperWinRates = Object.values(walletSnipes).map(s => {
    const wins = s.tokens.filter(t => t.return >= 100).length;
    return wins / s.tokens.length;
  });

  sniperWinRates.sort((a, b) => b - a);

  console.log('狙击手胜率分布:\n');
  console.log(`  顶尖10%平均胜率: ${(sniperWinRates.slice(0, Math.floor(sniperWinRates.length * 0.1)).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(sniperWinRates.length * 0.1)) * 100).toFixed(1)}%`);
  console.log(`  中位数胜率: ${(sniperWinRates[Math.floor(sniperWinRates.length / 2)] * 100).toFixed(1)}%`);
  console.log(`  底部10%平均胜率: ${(sniperWinRates.slice(-Math.floor(sniperWinRates.length * 0.1)).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(sniperWinRates.length * 0.1)) * 100).toFixed(1)}%`);
}

async function main() {
  console.log('========================================');
  console.log('代币交易序列深度分析');
  console.log('========================================\n');

  const sequences = loadSequences();
  console.log(`✓ 读取 ${sequences.length} 个代币序列\n`);

  // 1. 时间分段分析
  const tokenFeatures = temporalSegmentAnalysis(sequences);

  // 2. 首个钱包分析
  firstWalletAnalysis(sequences);

  // 3. 狙击手分析
  sniperAnalysis(sequences);

  console.log('\n========================================');
  console.log('✓ 分析完成!');
  console.log('========================================\n');
}

main().catch(err => {
  console.error('分析失败:', err);
  process.exit(1);
});
