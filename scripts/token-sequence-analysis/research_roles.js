/**
 * 钱包角色分析与序列模式挖掘
 * 研究不同钱包的行为模式及其与涨幅的关系
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
 * 分析钱包角色
 */
function walletRoleAnalysis(sequences) {
  console.log('========================================');
  console.log('钱包角色分析');
  console.log('========================================\n');

  // 为每个钱包计算行为特征
  const walletProfiles = {};

  sequences.forEach(seq => {
    const tokenReturn = seq.max_change_percent;
    const isHighReturn = tokenReturn >= 100;

    seq.sequence.forEach(([wallet, amount], idx) => {
      if (!walletProfiles[wallet]) {
        walletProfiles[wallet] = {
          tokens: new Set(),
          high_return_tokens: new Set(),
          total_buy: 0,
          total_sell: 0,
          buy_count: 0,
          sell_count: 0,
          first_positions: [],
          avg_position: 0,
          position_sum: 0,
          position_count: 0
        };
      }

      const profile = walletProfiles[wallet];
      profile.tokens.add(seq.token_address);
      if (isHighReturn) {
        profile.high_return_tokens.add(seq.token_address);
      }

      if (amount > 0) {
        profile.total_buy += amount;
        profile.buy_count++;
      } else {
        profile.total_sell += Math.abs(amount);
        profile.sell_count++;
      }

      // 记录位置
      const position = idx / seq.sequence.length;
      profile.position_sum += position;
      profile.position_count++;
    });
  });

  // 计算平均位置
  Object.values(walletProfiles).forEach(profile => {
    profile.avg_position = profile.position_count > 0 ? profile.position_sum / profile.position_count : 0;
    profile.net_amount = profile.total_buy - profile.total_sell;
    profile.token_count = profile.tokens.size;
    profile.high_return_count = profile.high_return_tokens.size;
    profile.high_return_rate = profile.token_count > 0 ? profile.high_return_count / profile.token_count : 0;
    profile.buy_sell_ratio = profile.sell_count > 0 ? profile.buy_count / profile.sell_count : profile.buy_count;
  });

  // 钱包角色分类
  console.log('钱包角色分类:\n');

  const roles = {
    early_birds: [],      // 早期参与者（平均位置 < 0.2）
    mid_participants: [], // 中期参与者（0.2 - 0.5）
    late_comers: [],     // 后期参与者（> 0.5）
    holders: [],         // 持有者（买卖比 > 2）
    flippers: [],        // 快进快出者（买卖比 < 0.5）
    whales: [],          // 巨鲸（总金额 > $5000）
    snipers: [],        // 狙击手（高成功率钱包）
    losers: []           // 失败者（低成功率钱包）
  };

  Object.entries(walletProfiles).forEach(([addr, profile]) => {
    if (profile.token_count < 3) return; // 忽略太少交易的钱包

    if (profile.avg_position < 0.2) {
      roles.early_birds.push({ address: addr, ...profile });
    } else if (profile.avg_position < 0.5) {
      roles.mid_participants.push({ address: addr, ...profile });
    } else {
      roles.late_comers.push({ address: addr, ...profile });
    }

    if (profile.buy_sell_ratio >= 2) {
      roles.holders.push({ address: addr, ...profile });
    } else if (profile.buy_sell_ratio < 0.5 && profile.buy_count + profile.sell_count >= 2) {
      roles.flippers.push({ address: addr, ...profile });
    }

    if (profile.total_buy + profile.total_sell > 5000) {
      roles.whales.push({ address: addr, ...profile });
    }

    if (profile.high_return_rate >= 0.7 && profile.token_count >= 10) {
      roles.snipers.push({ address: addr, ...profile });
    }

    if (profile.high_return_rate < 0.3 && profile.token_count >= 10) {
      roles.losers.push({ address: addr, ...profile });
    }
  });

  // 统计各角色的平均成功率
  const roleStats = [
    { name: '早期参与者', wallets: roles.early_birds },
    { name: '中期参与者', wallets: roles.mid_participants },
    { name: '后期参与者', wallets: roles.late_comers },
    { name: '持有者', wallets: roles.holders },
    { name: '快进快出者', wallets: roles.flippers },
    { name: '巨鲸', wallets: roles.whales },
    { name: '狙击手', wallets: roles.snipers },
    { name: '失败者', wallets: roles.losers }
  ];

  roleStats.forEach(({ name, wallets }) => {
    if (wallets.length === 0) return;

    const avgRate = wallets.reduce((sum, w) => sum + w.high_return_rate, 0) / wallets.length;
    const avgTokens = wallets.reduce((sum, w) => sum + w.token_count, 0) / wallets.length;
    const avgNet = wallets.reduce((sum, w) => sum + w.net_amount, 0) / wallets.length;

    console.log(`${name}:`);
    console.log(`  数量: ${wallets.length}`);
    console.log(`  平均成功率: ${(avgRate * 100).toFixed(1)}%`);
    console.log(`  平均参与代币数: ${avgTokens.toFixed(1)}`);
    console.log(`  平均净流入: $${avgNet.toFixed(0)}`);
    console.log('');
  });

  // 找出最有价值的狙击手
  console.log('最有价值的狙击手（成功率 >= 70%, 参与代币 >= 10）:\n');

  const topSnipers = roles.snipers
    .sort((a, b) => b.high_return_rate - a.high_return_rate)
    .slice(0, 15);

  topSnipers.forEach((sniper, i) => {
    console.log(`${i + 1}. ${sniper.address.slice(0, 10)}...`);
    console.log(`   成功率: ${(sniper.high_return_rate * 100).toFixed(1)}%`);
    console.log(`   参与代币: ${sniper.token_count}`);
    console.log(`   净流入: $${sniper.net_amount.toFixed(0)}`);
    console.log(`   平均位置: ${(sniper.avg_position * 100).toFixed(1)}%`);
  });

  // 分析快进快出者
  console.log('\n快进快出者分析:\n');

  if (roles.flippers.length > 0) {
    const flipperRate = roles.flippers.reduce((sum, w) => sum + w.high_return_rate, 0) / roles.flippers.length;
    console.log(`快进快出者平均成功率: ${(flipperRate * 100).toFixed(1)}%`);

    // 找出最成功的快进快出者
    const successfulFlippers = roles.flippers
      .filter(w => w.high_return_rate >= 0.5)
      .sort((a, b) => b.high_return_rate - a.high_return_rate)
      .slice(0, 10);

    console.log(`\n最成功的快进快出者（成功率 >= 50%）:`);
    successfulFlippers.forEach((flipper, i) => {
      console.log(`  ${i + 1}. ${flipper.address.slice(0, 10)}... - ${(flipper.high_return_rate * 100).toFixed(1)}% 成功率, ${flipper.token_count} 代币`);
    });
  }

  return { walletProfiles, roles };
}

/**
 * 序列模式分析
 */
function sequencePatternAnalysis(sequences) {
  console.log('\n========================================');
  console.log('序列模式分析');
  console.log('========================================\n');

  // 分析前3笔交易的模式
  const patterns = {};

  sequences.forEach(seq => {
    if (seq.sequence.length < 3) return;

    // 提取前3笔交易的模式
    const pattern = seq.sequence.slice(0, 3).map(([wallet, amount]) => {
      if (amount > 0) return 'B';  // Buy
      return 'S';  // Sell
    }).join('');

    if (!patterns[pattern]) {
      patterns[pattern] = {
        count: 0,
        high_return_count: 0,
        avg_change: 0,
        changes: []
      };
    }

    patterns[pattern].count++;
    patterns[pattern].changes.push(seq.max_change_percent);
    if (seq.max_change_percent >= 100) {
      patterns[pattern].high_return_count++;
    }
  });

  // 统计最常见的模式
  console.log('前3笔交易模式分析:\n');

  const patternList = Object.entries(patterns)
    .map(([pattern, data]) => ({
      pattern,
      ...data,
      avg_change: data.changes.reduce((a, b) => a + b, 0) / data.changes.length,
      high_return_rate: data.high_return_count / data.count
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  patternList.forEach(({ pattern, count, high_return_count, high_return_rate, avg_change }) => {
    const patternReadable = pattern.split('').map(c => c === 'B' ? '买入' : '卖出').join(' → ');
    console.log(`${patternReadable}:`);
    console.log(`  出现次数: ${count}`);
    console.log(`  高涨幅占比: ${(high_return_rate * 100).toFixed(1)}%`);
    console.log(`  平均涨幅: ${avg_change.toFixed(1)}%`);
    console.log('');
  });

  // 分析"连续买入"模式
  console.log('连续买入模式分析:\n');

  const consecutiveBuys = sequences.map(seq => {
    let maxConsecutiveBuys = 0;
    let currentStreak = 0;

    seq.sequence.forEach(([wallet, amount]) => {
      if (amount > 0) {
        currentStreak++;
        maxConsecutiveBuys = Math.max(maxConsecutiveBuys, currentStreak);
      } else {
        currentStreak = 0;
      }
    });

    return {
      token: seq.token_symbol,
      max_change: seq.max_change_percent,
      max_consecutive_buys: maxConsecutiveBuys,
      total_trades: seq.sequence.length
    };
  });

  // 分析连续买入次数与涨幅的关系
  const maxBuys = consecutiveBuys.map(c => c.max_consecutive_buys);
  const changes = consecutiveBuys.map(c => c.max_change);

  let num = 0, denX = 0, denY = 0;
  const meanX = maxBuys.reduce((a, b) => a + b, 0) / maxBuys.length;
  const meanY = changes.reduce((a, b) => a + b, 0) / changes.length;

  for (let i = 0; i < maxBuys.length; i++) {
    const dx = maxBuys[i] - meanX;
    const dy = changes[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const corr = num / Math.sqrt(denX * denY);
  console.log(`最大连续买入次数与涨幅的相关系数: ${corr.toFixed(3)}`);

  // 按连续买入次数分组统计
  console.log('\n按最大连续买入次数分组:\n');

  const groups = {
    '1-2': [],
    '3-5': [],
    '6-10': [],
    '>10': []
  };

  consecutiveBuys.forEach(c => {
    if (c.max_consecutive_buys <= 2) {
      groups['1-2'].push(c);
    } else if (c.max_consecutive_buys <= 5) {
      groups['3-5'].push(c);
    } else if (c.max_consecutive_buys <= 10) {
      groups['6-10'].push(c);
    } else {
      groups['>10'].push(c);
    }
  });

  Object.entries(groups).forEach(([range, tokens]) => {
    if (tokens.length === 0) return;

    const avgChange = tokens.reduce((sum, t) => sum + t.max_change, 0) / tokens.length;
    const highReturnRate = tokens.filter(t => t.max_change >= 100).length / tokens.length;

    console.log(`${range} 笔连续买入:`);
    console.log(`  代币数量: ${tokens.length}`);
    console.log(`  平均涨幅: ${avgChange.toFixed(1)}%`);
    console.log(`  高涨幅占比: ${(highReturnRate * 100).toFixed(1)}%`);
    console.log('');
  });

  return { patterns, consecutiveBuys };
}

/**
 * 分析"尖峰"模式
 */
function spikeAnalysis(sequences) {
  console.log('\n========================================');
  console.log('尖峰模式分析');
  console.log('========================================\n');

  // 找出"极简暴利"模式：交易少但涨幅高
  const minimalHighReturn = sequences.filter(s => s.sequence.length <= 5 && s.max_change_percent >= 200);

  console.log(`极简暴利模式（交易 <= 5 笔，涨幅 >= 200%）: ${minimalHighReturn.length} 个代币\n`);

  const sorted = minimalHighReturn.sort((a, b) => b.max_change_percent - a.max_change_percent).slice(0, 15);

  sorted.forEach((token, i) => {
    console.log(`${i + 1}. ${token.token_symbol}: +${token.max_change_percent.toFixed(1)}% | ${token.sequence.length} 笔交易`);

    // 分析交易模式
    const buys = token.sequence.filter(([, a]) => a > 0);
    const sells = token.sequence.filter(([, a]) => a < 0);
    const uniqueWallets = new Set(token.sequence.map(([w]) => w));

    console.log(`   买入: ${buys.length} 笔, 卖出: ${sells.length} 笔, 唯一钱包: ${uniqueWallets.size}`);
    console.log(`   模式: ${token.sequence.map(([, a]) => a > 0 ? 'B' : 'S').join(' → ')}`);
    console.log('');
  });

  // 分析这些"极简暴利"代币的共同特征
  const avgTrades = minimalHighReturn.reduce((sum, t) => sum + t.sequence.length, 0) / minimalHighReturn.length;
  const avgUniqueWallets = minimalHighReturn.reduce((sum, t) => sum + new Set(t.sequence.map(([w]) => w)).size, 0) / minimalHighReturn.length;

  console.log(`极简暴利模式平均特征:`);
  console.log(`  平均交易数: ${avgTrades.toFixed(1)}`);
  console.log(`  平均唯一钱包数: ${avgUniqueWallets.toFixed(1)}`);

  // 与其他代币对比
  const otherTokens = sequences.filter(s => s.sequence.length <= 5 && s.max_change_percent < 200);

  if (otherTokens.length > 0) {
    const otherAvgChange = otherTokens.reduce((sum, t) => sum + t.max_change_percent, 0) / otherTokens.length;
    console.log(`\n对比: 交易 <= 5 笔但涨幅 < 200% 的代币平均涨幅: ${otherAvgChange.toFixed(1)}%`);
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('钱包角色与序列模式深度分析');
  console.log('========================================\n');

  const sequences = loadSequences();
  console.log(`✓ 读取 ${sequences.length} 个代币序列\n`);

  // 1. 钱包角色分析
  const { walletProfiles, roles } = walletRoleAnalysis(sequences);

  // 2. 序列模式分析
  const { patterns, consecutiveBuys } = sequencePatternAnalysis(sequences);

  // 3. 尖峰模式分析
  spikeAnalysis(sequences);

  console.log('\n========================================');
  console.log('✓ 分析完成!');
  console.log('========================================\n');
}

main().catch(err => {
  console.error('分析失败:', err);
  process.exit(1);
});
