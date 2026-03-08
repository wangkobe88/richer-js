/**
 * 详细分析遗漏的高质量代币和误判的低质量代币
 * 提供针对性的优化建议
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzeTokenDetails() {
  const experimentId = 'afed3289-2f89-4da5-88f1-1468d61f8b3d';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                  遗漏代币与误判代币详细分析                                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取数据
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, human_judges, token_symbol')
    .eq('experiment_id', experimentId)
    .not('human_judges', 'is', null);

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy');

  // 解析数据
  const signalDataMap = new Map();
  signals.forEach(signal => {
    try {
      let metadata = signal.metadata;
      if (typeof metadata === 'string') {
        metadata = JSON.parse(metadata);
      }
      signalDataMap.set(signal.token_address, {
        prebuy: metadata?.preBuyCheckFactors || {},
        trend: metadata?.trendFactors || {}
      });
    } catch (e) {}
  });

  const goodTokens = [], badTokens = [];
  tokens.forEach(token => {
    const category = token.human_judges?.category?.toLowerCase();
    const isGood = category === 'high_quality' || category === 'mid_quality';
    const isBad = category === 'low_quality';

    const data = signalDataMap.get(token.token_address);
    if (data && (isGood || isBad)) {
      const tokenData = {
        token: token.token_address,
        symbol: token.token_symbol,
        category,
        quality: isGood ? '高质量' : '低质量',
        ...data.prebuy,
        ...data.trend
      };
      if (isGood) goodTokens.push(tokenData);
      if (isBad) badTokens.push(tokenData);
    }
  });

  // 使用优化后的策略条件
  const optimizedCondition = (t) => {
    return t.holderBlacklistCount <= 5 &&
           t.holderWhitelistCount >= 22 &&
           t.devHoldingRatio < 15 &&
           t.maxHoldingRatio < 18 &&
           t.earlyTradesCountPerMin >= 90 &&
           t.earlyTradesVolumePerMin >= 7000 &&
           t.earlyTradesUniqueWallets >= 60;
  };

  const missedGoodTokens = goodTokens.filter(t => !optimizedCondition(t));
  const passedBadTokens = badTokens.filter(t => optimizedCondition(t));
  const passedGoodTokens = goodTokens.filter(t => optimizedCondition(t));
  const rejectedBadTokens = badTokens.filter(t => !optimizedCondition(t));

  console.log(`数据概况:`);
  console.log(`  中高质量代币: ${goodTokens.length} 个 (通过 ${passedGoodTokens.length}, 遗漏 ${missedGoodTokens.length})`);
  console.log(`  低质量代币: ${badTokens.length} 个 (拒绝 ${rejectedBadTokens.length}, 误判 ${passedBadTokens.length})\n`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 第一部分：遗漏的高质量代币分析
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    第一部分：遗漏的高质量代币分析                             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log(`遗漏数量: ${missedGoodTokens.length} 个\n`);

  if (missedGoodTokens.length > 0) {
    // 分析每个遗漏代币不满足的条件
    console.log('详细分析:\n');

    const conditions = {
      holderBlacklistCount: { name: '黑名单数量 <= 5', threshold: 5 },
      holderWhitelistCount: { name: '白名单数量 >= 22', threshold: 22 },
      devHoldingRatio: { name: '开发者持仓 < 15%', threshold: 15 },
      maxHoldingRatio: { name: '最大持仓 < 18%', threshold: 18 },
      earlyTradesCountPerMin: { name: '交易数/分钟 >= 90', threshold: 90 },
      earlyTradesVolumePerMin: { name: '交易量/分钟 >= 7000', threshold: 7000 },
      earlyTradesUniqueWallets: { name: '独立钱包数 >= 60', threshold: 60 }
    };

    missedGoodTokens.forEach((token, index) => {
      console.log(`【${index + 1}. ${token.symbol}】(${token.category === 'high_quality' ? '高质量' : '中质量'})`);
      console.log(`  地址: ${token.token}`);

      // 找出不满足的条件
      const failedConditions = [];
      Object.entries(conditions).forEach(([key, config]) => {
        const value = token[key];
        if (value === null || value === undefined) {
          failedConditions.push({ name: config.name, reason: '数据缺失' });
        } else if (key.includes('Blacklist')) {
          if (value > config.threshold) {
            failedConditions.push({ name: config.name, value, threshold: config.threshold, reason: '超过阈值' });
          }
        } else if (key.includes('Ratio')) {
          if (value >= config.threshold) {
            failedConditions.push({ name: config.name, value, threshold: config.threshold, reason: '超过阈值' });
          }
        } else {
          if (value < config.threshold) {
            failedConditions.push({ name: config.name, value, threshold: config.threshold, reason: '低于阈值' });
          }
        }
      });

      console.log(`  不满足条件 (${failedConditions.length}个):`);
      failedConditions.forEach(c => {
        if (c.reason === '数据缺失') {
          console.log(`    - ${c.name}: ${c.reason}`);
        } else {
          console.log(`    - ${c.name}: ${c.value?.toFixed(2) || 'N/A'} (${c.reason})`);
        }
      });

      // 显示完整数据
      console.log(`  完整数据:`);
      console.log(`    黑名单: ${token.holderBlacklistCount || 'N/A'}, 白名单: ${token.holderWhitelistCount || 'N/A'}`);
      console.log(`    交易数/分: ${token.earlyTradesCountPerMin?.toFixed(2) || 'N/A'}, 交易量/分: ${token.earlyTradesVolumePerMin?.toFixed(2) || 'N/A'}`);
      console.log(`    独立钱包: ${token.earlyTradesUniqueWallets || 'N/A'}, 钱包/分: ${token.earlyTradesWalletsPerMin?.toFixed(2) || 'N/A'}`);
      console.log(`    Dev持仓: ${token.devHoldingRatio?.toFixed(2) || 'N/A'}%, 最大持仓: ${token.maxHoldingRatio?.toFixed(2) || 'N/A'}%`);
      console.log('');
    });

    // 统计哪些条件最常导致遗漏
    console.log('遗漏原因统计:\n');
    const failCounts = {};
    Object.keys(conditions).forEach(key => {
      failCounts[key] = 0;
    });

    missedGoodTokens.forEach(token => {
      Object.entries(conditions).forEach(([key, config]) => {
        const value = token[key];
        if (value === null || value === undefined) {
          failCounts[key]++;
        } else if (key.includes('Blacklist')) {
          if (value > config.threshold) failCounts[key]++;
        } else if (key.includes('Ratio')) {
          if (value >= config.threshold) failCounts[key]++;
        } else {
          if (value < config.threshold) failCounts[key]++;
        }
      });
    });

    console.log('条件'.padEnd(30) + '遗漏数量');
    console.log('─'.repeat(42));
    Object.entries(conditions).forEach(([key, config]) => {
      const count = failCounts[key];
      const percent = (count / missedGoodTokens.length * 100).toFixed(1);
      console.log(`${config.name.padEnd(30)}${count} (${percent}%)`);
    });
    console.log('');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 第二部分：误判的低质量代币分析
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    第二部分：误判的低质量代币分析                             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log(`误判数量: ${passedBadTokens.length} 个\n`);

  if (passedBadTokens.length > 0) {
    passedBadTokens.forEach((token, index) => {
      console.log(`【${index + 1}. ${token.symbol}】(低质量)`);
      console.log(`  地址: ${token.token}`);
      console.log(`  满足条件的值:`);
      console.log(`    黑名单: ${token.holderBlacklistCount || 'N/A'}, 白名单: ${token.holderWhitelistCount || 'N/A'}`);
      console.log(`    交易数/分: ${token.earlyTradesCountPerMin?.toFixed(2) || 'N/A'}, 交易量/分: ${token.earlyTradesVolumePerMin?.toFixed(2) || 'N/A'}`);
      console.log(`    独立钱包: ${token.earlyTradesUniqueWallets || 'N/A'}, 钱包/分: ${token.earlyTradesWalletsPerMin?.toFixed(2) || 'N/A'}`);

      // 分析趋势因子，看看为什么这些低质量代币指标看起来不错
      console.log(`  趋势因子:`);
      console.log(`    早期收益率: ${token.earlyReturn?.toFixed(2) || 'N/A'}%`);
      console.log(`    TVL: ${token.tvl?.toFixed(2) || 'N/A'}`);
      console.log(`    FDV: ${token.fdv?.toFixed(2) || 'N/A'}`);
      console.log(`    持币地址: ${token.holders || 'N/A'}`);
      console.log(`    从最高点回撤: ${token.drawdownFromHighest?.toFixed(2) || 'N/A'}%`);
      console.log('');
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 第三部分：进一步优化建议
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    第三部分：进一步优化建议                                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('【观察 1】遗漏的高质量代币特征\n');

  // 分析遗漏代币的共同特征
  const conditions = {
    holderBlacklistCount: { name: '黑名单数量 <= 5', threshold: 5 },
    holderWhitelistCount: { name: '白名单数量 >= 22', threshold: 22 },
    devHoldingRatio: { name: '开发者持仓 < 15%', threshold: 15 },
    maxHoldingRatio: { name: '最大持仓 < 18%', threshold: 18 },
    earlyTradesCountPerMin: { name: '交易数/分钟 >= 90', threshold: 90 },
    earlyTradesVolumePerMin: { name: '交易量/分钟 >= 7000', threshold: 7000 },
    earlyTradesUniqueWallets: { name: '独立钱包数 >= 60', threshold: 60 }
  };

  const missedAvgValues = {};
  const passedAvgValues = {};

  Object.keys(conditions).forEach(key => {
    const missedValues = missedGoodTokens.map(t => t[key]).filter(v => v !== null && v !== undefined);
    const passedValues = passedGoodTokens.map(t => t[key]).filter(v => v !== null && v !== undefined);

    if (missedValues.length > 0) {
      missedAvgValues[key] = missedValues.reduce((a, b) => a + b, 0) / missedValues.length;
    }
    if (passedValues.length > 0) {
      passedAvgValues[key] = passedValues.reduce((a, b) => a + b, 0) / passedValues.length;
    }
  });

  console.log('遗漏 vs 通过的高质量代币平均值对比:\n');
  console.log('指标'.padEnd(28) + '遗漏均值'.padStart(12) + '通过均值'.padStart(12));
  console.log('─'.repeat(56));

  Object.entries(conditions).forEach(([key, config]) => {
    const missed = missedAvgValues[key];
    const passed = passedAvgValues[key];
    if (missed !== undefined && passed !== undefined) {
      console.log(
        config.name.padEnd(28) +
        (missed?.toFixed(2) || 'N/A').padStart(10) +
        (passed?.toFixed(2) || 'N/A').padStart(12)
      );
    }
  });
  console.log('');

  console.log('【观察 2】误判的低质量代币特征\n');

  // 分析误判代币是否有特殊模式
  if (passedBadTokens.length > 0) {
    const badAvgEarlyReturn = passedBadTokens.map(t => t.earlyReturn).filter(v => v !== null && v !== undefined);
    const badAvgTVL = passedBadTokens.map(t => t.tvl).filter(v => v !== null && v !== undefined);

    if (badAvgEarlyReturn.length > 0) {
      const avg = badAvgEarlyReturn.reduce((a, b) => a + b, 0) / badAvgEarlyReturn.length;
      console.log(`误判代币平均早期收益率: ${avg.toFixed(2)}%`);
    }
    if (badAvgTVL.length > 0) {
      const avg = badAvgTVL.reduce((a, b) => a + b, 0) / badAvgTVL.length;
      console.log(`误判代币平均TVL: ${avg.toFixed(2)}`);
    }

    console.log('\n分析: 误判的低质量代币可能在早期表现良好，');
    console.log('      但后续表现不佳。建议结合趋势条件进一步过滤。\n');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 第四部分：完整策略推荐
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    第四部分：完整策略配置推荐                                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('【方案 A：平衡优化版】（推荐）\n');
  console.log('// 购买前检查条件');
  console.log('preBuyCheckCondition = "');
  console.log('  holderBlacklistCount <= 5 AND');
  console.log('  holderWhitelistCount >= 22 AND');
  console.log('  devHoldingRatio < 15 AND');
  console.log('  maxHoldingRatio < 18 AND');
  console.log('  earlyTradesCountPerMin >= 90 AND');
  console.log('  earlyTradesVolumePerMin >= 7000 AND');
  console.log('  earlyTradesUniqueWallets >= 60');
  console.log('"\n');

  console.log('// 趋势条件（配合使用以进一步过滤误判）');
  console.log('trendCondition = "');
  console.log('  earlyReturn > 80 AND');
  console.log('  drawdownFromHighest >= -10 AND');
  console.log('  tvl >= 5000 AND');
  console.log('  holders >= 30 AND');
  console.log('  fdv >= 8000');
  console.log('"\n');

  console.log('预期效果:');
  console.log('  - 购买前检查: 召回率 ~69%, 精确率 ~61%');
  console.log('  - 配合趋势条件后: 精确率进一步提升\n');

  console.log('【方案 B：高召回版】（适合追求机会）\n');
  console.log('// 购买前检查条件');
  console.log('preBuyCheckCondition = "');
  console.log('  holderBlacklistCount <= 5 AND');
  console.log('  holderWhitelistCount >= 18 AND');
  console.log('  devHoldingRatio < 15 AND');
  console.log('  maxHoldingRatio < 18 AND');
  console.log('  earlyTradesCountPerMin >= 60 AND');
  console.log('  earlyTradesVolumePerMin >= 5500 AND');
  console.log('  earlyTradesUniqueWallets >= 45');
  console.log('"\n');

  console.log('预期效果:');
  console.log('  - 购买前检查: 召回率 ~75%, 精确率 ~44%');
  console.log('  - 需要更严格的风控和止损策略\n');

  console.log('【方案 C：高精度版】（适合保守投资）\n');
  console.log('// 购买前检查条件');
  console.log('preBuyCheckCondition = "');
  console.log('  holderBlacklistCount <= 3 AND');
  console.log('  holderWhitelistCount >= 30 AND');
  console.log('  devHoldingRatio < 10 AND');
  console.log('  maxHoldingRatio < 15 AND');
  console.log('  earlyTradesCountPerMin >= 120 AND');
  console.log('  earlyTradesVolumePerMin >= 10000 AND');
  console.log('  earlyTradesUniqueWallets >= 70');
  console.log('"\n');

  console.log('预期效果:');
  console.log('  - 购买前检查: 召回率 ~44%, 精确率 ~100%');
  console.log('  - 几乎不会买到低质量代币\n');

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('建议: 根据风险偏好选择方案，并在实盘中持续监控和调整。');
  console.log('═══════════════════════════════════════════════════════════════════════════');
}

analyzeTokenDetails().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
