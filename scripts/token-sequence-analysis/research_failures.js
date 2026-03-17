/**
 * 失败案例分析
 * 专门研究那些"本应该成功"但失败的代币
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
 * 分析"假阳性"代币
 * 即：具有高净流入、多钱包等"好"特征，但涨幅很低的代币
 */
function falsePositiveAnalysis(sequences) {
  console.log('========================================');
  console.log('"假阳性"代币分析');
  console.log('========================================\n');

  // 计算每个代币的特征
  const tokenFeatures = sequences.map(seq => {
    const uniqueWallets = new Set(seq.sequence.map(([w]) => w));
    const totalBuy = seq.sequence.reduce((sum, [, a]) => a > 0 ? sum + a : sum, 0);
    const totalSell = seq.sequence.reduce((sum, [, a]) => a < 0 ? sum + Math.abs(a) : sum, 0);

    // 前30秒的净流入
    const earlyTrades = seq.sequence.slice(0, 10);
    const earlyNetFlow = earlyTrades.reduce((sum, [, a]) => a > 0 ? sum + a : sum + a, 0);

    return {
      address: seq.token_address,
      symbol: seq.token_symbol,
      change: seq.max_change_percent,
      length: seq.sequence.length,
      unique_wallets: uniqueWallets.size,
      net_flow: totalBuy - totalSell,
      early_net_flow: earlyNetFlow,
      buy_sell_ratio: totalSell > 0 ? totalBuy / totalSell : totalBuy,
      first_is_buy: seq.sequence.length > 0 && seq.sequence[0][1] > 0
    };
  });

  // 定义阈值
  const thresholds = {
    high_net_flow: 2000,      // 高净流入
    many_wallets: 100,        // 多钱包
    low_change: 50            // 低涨幅
  };

  // 找出"假阳性"代币
  const falsePositives = tokenFeatures.filter(t =>
    t.net_flow >= thresholds.high_net_flow &&
    t.unique_wallets >= thresholds.many_wallets &&
    t.change < thresholds.low_change
  );

  console.log(`定义: 净流入 >= $${thresholds.high_net_flow} AND 唯一钱包 >= ${thresholds.many_wallets} AND 涨幅 < ${thresholds.low_change}%`);
  console.log(`找到 ${falsePositives.length} 个"假阳性"代币\n`);

  if (falsePositives.length === 0) {
    console.log('没有找到符合条件的代币，调整阈值...\n');

    // 放宽条件
    const relaxed = tokenFeatures.filter(t =>
      t.net_flow >= 1000 &&
      t.unique_wallets >= 50 &&
      t.change < 30
    );

    console.log(`放宽条件后: 净流入 >= $1000 AND 唯一钱包 >= 50 AND 涨幅 < 30%`);
    console.log(`找到 ${relaxed.length} 个代币\n`);

    relaxed.slice(0, 20).forEach((t, i) => {
      console.log(`${i + 1}. ${t.symbol}: +${t.change.toFixed(1)}%`);
      console.log(`   净流入: $${t.net_flow.toFixed(0)}, 钱包数: ${t.unique_wallets}, 序列长度: ${t.length}`);
    });

    return relaxed;
  }

  // 分析假阳性代币的特征
  console.log('【假阳性代币列表】\n');

  falsePositives.sort((a, b) => b.net_flow - a.net_flow);

  falsePositives.slice(0, 20).forEach((t, i) => {
    console.log(`${i + 1}. ${t.symbol}: +${t.change.toFixed(1)}%`);
    console.log(`   净流入: $${t.net_flow.toFixed(0)}, 钱包数: ${t.unique_wallets}, 序列长度: ${t.length}`);
    console.log(`   买卖比: ${t.buy_sell_ratio.toFixed(2)}, 首笔买入: ${t.first_is_buy ? '是' : '否'}`);
  });

  // 对比：找出相同特征但成功的高涨幅代币
  console.log('\n【对比分析：相同特征的高涨幅代币】\n');

  const truePositives = tokenFeatures.filter(t =>
    t.net_flow >= thresholds.high_net_flow &&
    t.unique_wallets >= thresholds.many_wallets &&
    t.change >= 200
  ).sort((a, b) => b.change - a.change);

  console.log(`找到 ${truePositives.length} 个"真阳性"代币\n`);

  truePositives.slice(0, 10).forEach((t, i) => {
    console.log(`${i + 1}. ${t.symbol}: +${t.change.toFixed(1)}%`);
    console.log(`   净流入: $${t.net_flow.toFixed(0)}, 钱包数: ${t.unique_wallets}, 序列长度: ${t.length}`);
  });

  // 比较假阳性和真阳性的差异
  console.log('\n【假阳性 vs 真阳性 特征对比】\n');

  const avgStats = (tokens) => ({
    avgChange: tokens.reduce((sum, t) => sum + t.change, 0) / tokens.length,
    avgNetFlow: tokens.reduce((sum, t) => sum + t.net_flow, 0) / tokens.length,
    avgWallets: tokens.reduce((sum, t) => sum + t.unique_wallets, 0) / tokens.length,
    avgLength: tokens.reduce((sum, t) => sum + t.length, 0) / tokens.length,
    avgBuySellRatio: tokens.reduce((sum, t) => sum + t.buy_sell_ratio, 0) / tokens.length,
    firstBuyRate: tokens.filter(t => t.first_is_buy).length / tokens.length
  });

  const fpStats = avgStats(falsePositives);
  const tpStats = avgStats(truePositives);

  console.log('假阳性（低涨幅）:');
  console.log(`  平均涨幅: ${fpStats.avgChange.toFixed(1)}%`);
  console.log(`  平均净流入: $${fpStats.avgNetFlow.toFixed(0)}`);
  console.log(`  平均钱包数: ${fpStats.avgWallets.toFixed(1)}`);
  console.log(`  平均序列长度: ${fpStats.avgLength.toFixed(1)}`);
  console.log(`  平均买卖比: ${fpStats.avgBuySellRatio.toFixed(2)}`);
  console.log(`  首笔买入比例: ${(fpStats.firstBuyRate * 100).toFixed(1)}%`);

  console.log('\n真阳性（高涨幅）:');
  console.log(`  平均涨幅: ${tpStats.avgChange.toFixed(1)}%`);
  console.log(`  平均净流入: $${tpStats.avgNetFlow.toFixed(0)}`);
  console.log(`  平均钱包数: ${tpStats.avgWallets.toFixed(1)}`);
  console.log(`  平均序列长度: ${tpStats.avgLength.toFixed(1)}`);
  console.log(`  平均买卖比: ${tpStats.avgBuySellRatio.toFixed(2)}`);
  console.log(`  首笔买入比例: ${(tpStats.firstBuyRate * 100).toFixed(1)}%`);

  // 计算差异
  console.log('\n差异:');
  console.log(`  序列长度: ${((tpStats.avgLength - fpStats.avgLength) / fpStats.avgLength * 100).toFixed(1)}% (真阳性更长)`);
  console.log(`  买卖比: ${((tpStats.avgBuySellRatio - fpStats.avgBuySellRatio) / fpStats.avgBuySellRatio * 100).toFixed(1)}% (真阳性更高)`);

  return { falsePositives, truePositives, fpStats, tpStats };
}

/**
 * 分析"假阴性"代币
 * 即：特征看起来不好，但实际涨幅很高的代币
 */
function falseNegativeAnalysis(sequences) {
  console.log('\n========================================');
  console.log('"假阴性"代币分析');
  console.log('========================================\n');

  const tokenFeatures = sequences.map(seq => {
    const uniqueWallets = new Set(seq.sequence.map(([w]) => w));
    const totalBuy = seq.sequence.reduce((sum, [, a]) => a > 0 ? sum + a : sum, 0);
    const totalSell = seq.sequence.reduce((sum, [, a]) => a < 0 ? sum + Math.abs(a) : sum, 0);

    return {
      address: seq.token_address,
      symbol: seq.token_symbol,
      change: seq.max_change_percent,
      length: seq.sequence.length,
      unique_wallets: uniqueWallets.size,
      net_flow: totalBuy - totalSell,
      buy_sell_ratio: totalSell > 0 ? totalBuy / totalSell : totalBuy
    };
  });

  // 找出"假阴性"代币：低净流入但高涨幅
  const falseNegatives = tokenFeatures.filter(t =>
    t.net_flow < 500 &&
    t.unique_wallets < 50 &&
    t.change >= 500
  ).sort((a, b) => b.change - a.change);

  console.log(`定义: 净流入 < $500 AND 唯一钱包 < 50 AND 涨幅 >= 500%`);
  console.log(`找到 ${falseNegatives.length} 个"假阴性"代币\n`);

  falseNegatives.slice(0, 20).forEach((t, i) => {
    console.log(`${i + 1}. ${t.symbol}: +${t.change.toFixed(1)}%`);
    console.log(`   净流入: $${t.net_flow.toFixed(0)}, 钱包数: ${t.unique_wallets}, 序列长度: ${t.length}`);
  });

  // 分析这些代币的特殊之处
  if (falseNegatives.length > 0) {
    console.log('\n【假阴性代币的特殊之处】\n');

    const avgLength = falseNegatives.reduce((sum, t) => sum + t.length, 0) / falseNegatives.length;
    const avgNetFlow = falseNegatives.reduce((sum, t) => sum + t.net_flow, 0) / falseNegatives.length;
    const avgWallets = falseNegatives.reduce((sum, t) => sum + t.unique_wallets, 0) / falseNegatives.length;

    console.log(`平均序列长度: ${avgLength.toFixed(1)}`);
    console.log(`平均净流入: $${avgNetFlow.toFixed(0)}`);
    console.log(`平均钱包数: ${avgWallets.toFixed(1)}`);

    // 对比所有代币的平均值
    const allAvgLength = tokenFeatures.reduce((sum, t) => sum + t.length, 0) / tokenFeatures.length;
    const allAvgNetFlow = tokenFeatures.reduce((sum, t) => sum + t.net_flow, 0) / tokenFeatures.length;
    const allAvgWallets = tokenFeatures.reduce((sum, t) => sum + t.unique_wallets, 0) / tokenFeatures.length;

    console.log('\n与所有代币对比:');
    console.log(`  序列长度: ${avgLength.toFixed(1)} vs ${allAvgLength.toFixed(1)} (${(avgLength / allAvgLength * 100).toFixed(1)}%)`);
    console.log(`  净流入: $${avgNetFlow.toFixed(0)} vs $${allAvgNetFlow.toFixed(0)} (${(avgNetFlow / allAvgNetFlow * 100).toFixed(1)}%)`);
    console.log(`  钱包数: ${avgWallets.toFixed(1)} vs ${allAvgWallets.toFixed(1)} (${(avgWallets / allAvgWallets * 100).toFixed(1)}%)`);
  }

  return falseNegatives;
}

/**
 * 分析"昙花一现"代币
 * 即：早期涨幅很高，但后来大幅回落的代币
 */
function flashInThePanAnalysis(sequences) {
  console.log('\n========================================');
  console.log('"昙花一现"代币分析');
  console.log('========================================\n');

  // 由于数据中没有最高价和当前价的区分，我们用另一种方式：
  // 找出那些早期买入集中，但之后大量卖出的代币

  const tokenFeatures = sequences.map(seq => {
    if (seq.sequence.length < 10) return null;

    const earlyTrades = seq.sequence.slice(0, Math.min(20, seq.sequence.length));
    const lateTrades = seq.sequence.slice(Math.min(20, seq.sequence.length));

    const earlyBuy = earlyTrades.reduce((sum, [, a]) => a > 0 ? sum + a : sum, 0);
    const earlySell = earlyTrades.reduce((sum, [, a]) => a < 0 ? sum + Math.abs(a) : sum, 0);
    const lateSell = lateTrades.reduce((sum, [, a]) => a < 0 ? sum + Math.abs(a) : sum, 0);

    // 如果早期买入多，后期卖出多，可能是"昙花一现"
    return {
      address: seq.token_address,
      symbol: seq.token_symbol,
      change: seq.max_change_percent,
      early_buy_ratio: earlyBuy / (earlyBuy + earlySell + 1),
      late_sell_intensity: lateSell / (seq.sequence.length - earlyTrades.length + 1),
      early_net_flow: earlyBuy - earlySell
    };
  }).filter(Boolean);

  // 找出"昙花一现"代币
  const flashInThePan = tokenFeatures.filter(t =>
    t.early_buy_ratio > 0.7 &&
    t.late_sell_intensity > 50 &&
    t.change < 100
  ).sort((a, b) => b.late_sell_intensity - a.late_sell_intensity);

  console.log(`定义: 早期买入比 > 70% AND 后期卖出强度 > $50/笔 AND 最终涨幅 < 100%`);
  console.log(`找到 ${flashInThePan.length} 个"昙花一现"代币\n`);

  flashInThePan.slice(0, 15).forEach((t, i) => {
    console.log(`${i + 1}. ${t.symbol}: +${t.change.toFixed(1)}%`);
    console.log(`   早期买入比: ${(t.early_buy_ratio * 100).toFixed(1)}%, 后期卖出强度: $${t.late_sell_intensity.toFixed(1)}/笔`);
  });

  return flashInThePan;
}

/**
 * 深度分析几个典型失败案例
 */
function deepDiveFailureCases(sequences) {
  console.log('\n========================================');
  console.log('失败案例深度分析');
  console.log('========================================\n');

  // 找出3个最具代表性的失败案例：
  // 1. 高净流入但低涨幅
  // 2. 多钱包但低涨幅
  // 3. 长序列但低涨幅

  const tokenFeatures = sequences.map(seq => {
    const uniqueWallets = new Set(seq.sequence.map(([w]) => w));
    const totalBuy = seq.sequence.reduce((sum, [, a]) => a > 0 ? sum + a : sum, 0);
    const totalSell = seq.sequence.reduce((sum, [, a]) => a < 0 ? sum + Math.abs(a) : sum, 0);

    return {
      seq,
      address: seq.token_address,
      symbol: seq.token_symbol,
      change: seq.max_change_percent,
      length: seq.sequence.length,
      unique_wallets: uniqueWallets.size,
      net_flow: totalBuy - totalSell,
      net_flow_per_wallet: (totalBuy - totalSell) / uniqueWallets.size
    };
  });

  // 案例1：高净流入但低涨幅
  const case1 = tokenFeatures
    .filter(t => t.change < 50)
    .sort((a, b) => b.net_flow - a.net_flow)[0];

  if (case1) {
    console.log('【案例1：高净流入但低涨幅】');
    console.log(`${case1.symbol}: +${case1.change.toFixed(1)}%`);
    console.log(`  净流入: $${case1.net_flow.toFixed(0)}`);
    console.log(`  钱包数: ${case1.unique_wallets}`);
    console.log(`  序列长度: ${case1.length}\n`);

    // 分析前20笔交易
    console.log('  前20笔交易:');
    case1.seq.sequence.slice(0, 20).forEach(([wallet, amount], i) => {
      const action = amount > 0 ? '+' : '';
      console.log(`    ${i + 1}. ${wallet.slice(0, 10)}...: ${action}$${amount.toFixed(2)}`);
    });
  }

  // 案例2：多钱包但低涨幅
  const case2 = tokenFeatures
    .filter(t => t.change < 50 && t.unique_wallets >= 100)
    .sort((a, b) => b.unique_wallets - a.unique_wallets)[0];

  if (case2) {
    console.log('\n【案例2：多钱包但低涨幅】');
    console.log(`${case2.symbol}: +${case2.change.toFixed(1)}%`);
    console.log(`  钱包数: ${case2.unique_wallets}`);
    console.log(`  净流入: $${case2.net_flow.toFixed(0)}`);
    console.log(`  净流入/钱包: $${case2.net_flow_per_wallet.toFixed(2)}\n`);

    // 分析买卖分布
    let buyCount = 0, sellCount = 0;
    case2.seq.sequence.forEach(([, amount]) => {
      if (amount > 0) buyCount++;
      else sellCount++;
    });

    console.log(`  买入: ${buyCount} 笔, 卖出: ${sellCount} 笔`);
    console.log(`  买卖比: ${(buyCount / sellCount).toFixed(2)}`);
  }

  // 案例3：长序列但低涨幅
  const case3 = tokenFeatures
    .filter(t => t.change < 50 && t.length >= 200)
    .sort((a, b) => b.length - a.length)[0];

  if (case3) {
    console.log('\n【案例3：长序列但低涨幅】');
    console.log(`${case3.symbol}: +${case3.change.toFixed(1)}%`);
    console.log(`  序列长度: ${case3.length}`);
    console.log(`  钱包数: ${case3.unique_wallets}\n`);

    // 分析交易节奏
    const interval = 20;
    const segments = [];
    for (let i = 0; i < case3.seq.sequence.length; i += interval) {
      const segment = case3.seq.sequence.slice(i, i + interval);
      const netFlow = segment.reduce((sum, [, a]) => sum + a, 0);
      segments.push(netFlow);
    }

    console.log('  每20笔交易的净流入:');
    segments.slice(0, 10).forEach((flow, i) => {
      console.log(`    段${i + 1}: $${flow.toFixed(2)}`);
    });
  }
}

async function main() {
  console.log('========================================');
  console.log('失败案例分析');
  console.log('========================================\n');

  const sequences = loadSequences();
  console.log(`✓ 读取 ${sequences.length} 个代币序列\n`);

  // 1. 假阳性分析
  const { falsePositives, truePositives, fpStats, tpStats } = falsePositiveAnalysis(sequences);

  // 2. 假阴性分析
  const falseNegatives = falseNegativeAnalysis(sequences);

  // 3. 昙花一现分析
  const flashInThePan = flashInThePanAnalysis(sequences);

  // 4. 深度分析
  deepDiveFailureCases(sequences);

  console.log('\n========================================');
  console.log('✓ 分析完成!');
  console.log('========================================\n');
}

main().catch(err => {
  console.error('分析失败:', err);
  process.exit(1);
});
