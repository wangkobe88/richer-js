/**
 * 分析钱包年龄与代币质量的相关性
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

// 计算分位数
function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(Math.floor(sorted.length * p / 100), sorted.length - 1));
  return sorted[idx];
}

// 钱包年龄分类
function getAgeCategory(days) {
  if (days < 7) return 'new';
  if (days < 30) return 'recent';
  if (days < 90) return 'mature';
  if (days < 180) return 'old';
  return 'very_old';
}

function getAgeGroupName(group) {
  const names = {
    'new': '新钱包(<7天)',
    'recent': '较新(7-30天)',
    'mature': '1-3个月',
    'old': '3-6个月',
    'very_old': '老钱包(>6个月)'
  };
  return names[group] || group;
}

// 主函数
function main() {
  // 读取最新数据文件
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.match(/^experiment_.*\.json$/))
    .sort();

  const filePath = path.join(DATA_DIR, files[files.length - 1]);
  console.log(`读取数据文件: ${files[files.length - 1]}\n`);

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // 收集每个代币的钱包年龄统计
  const tokenAgeStats = [];

  data.tokens.forEach(token => {
    const wallets = token.earlyParticipants?.wallets || [];
    const validWallets = wallets.filter(w => w.wallet_age_days > 0);

    if (validWallets.length === 0) return;

    const ages = validWallets.map(w => w.wallet_age_days);
    ages.sort((a, b) => a - b);

    // 计算各年龄组占比
    const ageGroups = { new: 0, recent: 0, mature: 0, old: 0, very_old: 0 };
    validWallets.forEach(w => {
      const cat = getAgeCategory(w.wallet_age_days);
      ageGroups[cat]++;
    });

    tokenAgeStats.push({
      tokenSymbol: token.tokenSymbol,
      tokenAddress: token.tokenAddress,
      category: token.humanJudges?.category || 'unknown',
      totalWallets: validWallets.length,
      avgAge: ages.reduce((a, b) => a + b, 0) / ages.length,
      medianAge: ages[Math.floor(ages.length / 2)],
      p25Age: percentile(ages, 25),
      p75Age: percentile(ages, 75),
      newRatio: ageGroups.new / validWallets.length,
      recentRatio: ageGroups.recent / validWallets.length,
      matureRatio: ageGroups.mature / validWallets.length,
      oldRatio: ageGroups.old / validWallets.length,
      veryOldRatio: ageGroups.very_old / validWallets.length,
      oldPlusVeryOldRatio: (ageGroups.old + ageGroups.very_old) / validWallets.length
    });
  });

  // 按质量分组统计
  const byQuality = {
    low_quality: [],
    medium_quality: [],
    high_quality: [],
    unknown: []
  };

  tokenAgeStats.forEach(stat => {
    if (byQuality[stat.category]) {
      byQuality[stat.category].push(stat);
    } else {
      byQuality.unknown.push(stat);
    }
  });

  console.log('='.repeat(100));
  console.log('钱包年龄与代币质量相关性分析');
  console.log('='.repeat(100));

  // 显示各质量等级的代币数量
  console.log('\n[质量分布]');
  Object.entries(byQuality).forEach(([quality, tokens]) => {
    if (tokens.length > 0) {
      const qualityName = {
        'low_quality': '低质量',
        'medium_quality': '中质量',
        'high_quality': '高质量',
        'unknown': '未标注'
      }[quality] || quality;
      console.log(`  ${qualityName}: ${tokens.length} 个代币`);
    }
  });

  // ========== 1. 各质量等级的钱包年龄对比 ==========
  console.log('\n' + '─'.repeat(100));
  console.log('[1] 各质量等级钱包年龄指标对比');
  console.log('─'.repeat(100));

  const qualityMetrics = {};
  ['low_quality', 'medium_quality', 'high_quality'].forEach(quality => {
    const tokens = byQuality[quality];
    if (tokens.length === 0) return;

    qualityMetrics[quality] = {
      avgAge: tokens.reduce((sum, t) => sum + t.avgAge, 0) / tokens.length,
      medianAge: percentile(tokens.map(t => t.medianAge), 50),
      avgNewRatio: tokens.reduce((sum, t) => sum + t.newRatio, 0) / tokens.length,
      avgOldPlusVeryOldRatio: tokens.reduce((sum, t) => sum + t.oldPlusVeryOldRatio, 0) / tokens.length,
      count: tokens.length
    };
  });

  console.log('\n' + '质量等级'.padEnd(15) + '代币数'.padEnd(10) + '平均年龄'.padEnd(12) + '年龄中位数'.padEnd(12) + '新钱包占比'.padEnd(12) + '老钱包占比(>3个月)');
  console.log('─'.repeat(100));

  const qualityNames = {
    'low_quality': '低质量',
    'medium_quality': '中质量',
    'high_quality': '高质量'
  };

  ['low_quality', 'medium_quality', 'high_quality'].forEach(quality => {
    const metrics = qualityMetrics[quality];
    if (!metrics) return;

    console.log(
      qualityNames[quality].padEnd(15) +
      metrics.count.toString().padEnd(10) +
      metrics.avgAge.toFixed(1).padEnd(12) +
      metrics.medianAge.toFixed(1).padEnd(12) +
      (metrics.avgNewRatio * 100).toFixed(1).padEnd(12) + '%' +
      (metrics.avgOldPlusVeryOldRatio * 100).toFixed(1) + '%'
    );
  });

  // ========== 2. 详细统计表格 ==========
  console.log('\n' + '─'.repeat(100));
  console.log('[2] 各代币详细钱包年龄数据（按质量分组）');
  console.log('─'.repeat(100));

  ['low_quality', 'medium_quality', 'high_quality'].forEach(quality => {
    const tokens = byQuality[quality];
    if (tokens.length === 0) return;

    console.log(`\n【${qualityNames[quality]}】(${tokens.length}个代币)`);
    console.log('─'.repeat(100));

    // 按老钱包占比排序
    const sorted = [...tokens].sort((a, b) => b.oldPlusVeryOldRatio - a.oldPlusVeryOldRatio);

    console.log('\n' + '代币'.padEnd(25) + '钱包数'.padEnd(10) + '平均年龄'.padEnd(10) + '新钱包%'.padEnd(10) + '老钱包%'.padEnd(10) + '特征');
    console.log('─'.repeat(100));

    sorted.forEach(t => {
      const features = [];
      if (t.newRatio > 0.25) features.push('新钱包多');
      if (t.oldPlusVeryOldRatio > 0.4) features.push('老钱包多');
      if (t.avgAge > 120) features.push('平均年龄大');
      if (t.avgAge < 60) features.push('平均年龄小');
      if (features.length === 0) features.push('均衡');

      console.log(
        t.tokenSymbol.padEnd(25) +
        t.totalWallets.toString().padEnd(10) +
        t.avgAge.toFixed(0).padEnd(10) +
        (t.newRatio * 100).toFixed(1).padEnd(10) +
        (t.oldPlusVeryOldRatio * 100).toFixed(1).padEnd(10) +
        features.join(', ')
      );
    });

    // 统计该质量等级的汇总
    const avgMetrics = {
      totalWallets: tokens.reduce((sum, t) => sum + t.totalWallets, 0) / tokens.length,
      avgAge: tokens.reduce((sum, t) => sum + t.avgAge, 0) / tokens.length,
      newRatio: tokens.reduce((sum, t) => sum + t.newRatio, 0) / tokens.length,
      oldPlusVeryOldRatio: tokens.reduce((sum, t) => sum + t.oldPlusVeryOldRatio, 0) / tokens.length
    };

    console.log('\n  平均值:');
    console.log(`    平均钱包数: ${avgMetrics.totalWallets.toFixed(0)}`);
    console.log(`    平均年龄: ${avgMetrics.avgAge.toFixed(1)}天`);
    console.log(`    平均新钱包占比: ${(avgMetrics.newRatio * 100).toFixed(1)}%`);
    console.log(`    平均老钱包占比: ${(avgMetrics.oldPlusVeryOldRatio * 100).toFixed(1)}%`);
  });

  // ========== 3. 相关性分析结论 ==========
  console.log('\n' + '─'.repeat(100));
  console.log('[3] 相关性分析结论');
  console.log('─'.repeat(100));

  if (qualityMetrics.low_quality && qualityMetrics.high_quality) {
    const low = qualityMetrics.low_quality;
    const high = qualityMetrics.high_quality;

    console.log('\n指标对比 (低质量 vs 高质量):');

    const ageDiff = high.avgAge - low.avgAge;
    const ageChange = ((ageDiff / low.avgAge) * 100).toFixed(1);
    console.log(`  • 平均年龄: ${low.avgAge.toFixed(1)}天 → ${high.avgAge.toFixed(1)}天 (${ageChange > 0 ? '+' : ''}${ageChange}%)`);

    const newDiff = (high.avgNewRatio - low.avgNewRatio) * 100;
    console.log(`  • 新钱包占比: ${(low.avgNewRatio * 100).toFixed(1)}% → ${(high.avgNewRatio * 100).toFixed(1)}% (${newDiff > 0 ? '+' : ''}${newDiff.toFixed(1)}%)`);

    const oldDiff = (high.avgOldPlusVeryOldRatio - low.avgOldPlusVeryOldRatio) * 100;
    console.log(`  • 老钱包占比: ${(low.avgOldPlusVeryOldRatio * 100).toFixed(1)}% → ${(high.avgOldPlusVeryOldRatio * 100).toFixed(1)}% (${oldDiff > 0 ? '+' : ''}${oldDiff.toFixed(1)}%)`);

    console.log('\n结论:');
    if (ageDiff > 10) {
      console.log(`  ✓ 高质量代币的平均年龄比低质量代币高 ${ageDiff.toFixed(1)} 天`);
    } else if (ageDiff < -10) {
      console.log(`  ✓ 低质量代币的平均年龄比高质量代币高 ${Math.abs(ageDiff).toFixed(1)} 天`);
    } else {
      console.log(`  • 平均年龄差异不大 (${ageDiff.toFixed(1)}天)`);
    }

    if (oldDiff > 5) {
      console.log(`  ✓ 高质量代币的老钱包比例比低质量代币高 ${oldDiff.toFixed(1)}%`);
    } else if (oldDiff < -5) {
      console.log(`  ✓ 低质量代币的老钱包比例比高质量代币高 ${Math.abs(oldDiff).toFixed(1)}%`);
    } else {
      console.log(`  • 老钱包比例差异不大 (${oldDiff.toFixed(1)}%)`);
    }

    const hasPredictiveValue = Math.abs(ageDiff) > 10 || Math.abs(oldDiff) > 10;
    console.log(`\n  预测价值: ${hasPredictiveValue ? '✓ 有一定预测价值' : '✗ 预测价值有限'}`);
  }

  // ========== 4. 阈值建议 ==========
  console.log('\n' + '─'.repeat(100));
  console.log('[4] 基于钱包年龄的筛选建议');
  console.log('─'.repeat(100));

  // 找出高质量代币的典型特征
  if (byQuality.high_quality.length > 0) {
    const highQuality = byQuality.high_quality;
    const avgOldRatio = highQuality.reduce((sum, t) => sum + t.oldPlusVeryOldRatio, 0) / highQuality.length;
    const avgAge = highQuality.reduce((sum, t) => sum + t.avgAge, 0) / highQuality.length;

    console.log(`\n基于高质量代币 (${highQuality.length}个) 的特征:`);
    console.log(`  • 建议老钱包(>3个月)占比阈值: > ${(avgOldRatio * 100).toFixed(0)}%`);
    console.log(`  • 建议平均年龄阈值: > ${avgAge.toFixed(0)} 天`);

    // 找出符合这些条件的低质量代币（误判）
    const falsePositives = byQuality.low_quality.filter(t =>
      t.oldPlusVeryOldRatio > avgOldRatio && t.avgAge > avgAge
    );
    if (falsePositives.length > 0) {
      console.log(`\n  ⚠ 注意: ${falsePositives.length}个低质量代币也符合这些条件`);
      console.log(`    ${falsePositives.map(t => t.tokenSymbol).join(', ')}`);
    }
  }

  // 找出低质量代币的典型特征
  if (byQuality.low_quality.length > 0) {
    const lowQuality = byQuality.low_quality;
    const avgNewRatio = lowQuality.reduce((sum, t) => sum + t.newRatio, 0) / lowQuality.length;
    const avgAge = lowQuality.reduce((sum, t) => sum + t.avgAge, 0) / lowQuality.length;

    console.log(`\n基于低质量代币 (${lowQuality.length}个) 的特征:`);
    console.log(`  • 新钱包(<7天)占比阈值: > ${(avgNewRatio * 100).toFixed(0)}%`);
    console.log(`  • 平均年龄阈值: < ${avgAge.toFixed(0)} 天`);

    // 找出符合这些条件的高质量代币（漏判）
    const falseNegatives = byQuality.high_quality.filter(t =>
      t.newRatio > avgNewRatio && t.avgAge < avgAge
    );
    if (falseNegatives.length > 0) {
      console.log(`\n  ⚠ 注意: ${falseNegatives.length}个高质量代币也符合这些条件`);
      console.log(`    ${falseNegatives.map(t => t.tokenSymbol).join(', ')}`);
    }
  }

  console.log('\n' + '='.repeat(100));
}

main();
