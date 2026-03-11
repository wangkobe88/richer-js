/**
 * 综合所有代币数据，构建早期参与者分类系统
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/early-participants-analysis';

// 读取所有代币数据
function loadAllTokenData() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.startsWith('token') && f.endsWith('.json'))
    .sort();

  const allData = [];

  files.forEach(file => {
    const filePath = path.join(DATA_DIR, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // 处理不同格式的数据
    let wallets = [];
    let tokenAddress = '';

    if (data.wallets) {
      // 新格式 (token4-6)
      wallets = data.wallets;
      tokenAddress = data.tokenAddress;
    } else if (Array.isArray(data)) {
      // 旧格式 (token1-3)
      wallets = data;
      const match = file.match(/0x[a-f0-9]{8}/);
      tokenAddress = match ? match[0] : file;
    }

    wallets.forEach(w => {
      allData.push({
        ...w,
        token: tokenAddress,
        token_file: file
      });
    });
  });

  return allData;
}

// 计算分位数
function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p / 100);
  return sorted[idx];
}

// 构建分类系统
function buildClassificationSystem(wallets) {
  const balances = wallets.map(w => w.total_balance || 0);
  const trades = wallets.map(w => w.total_trades || 0);
  const ages = wallets.map(w => w.wallet_age_days || 0).filter(a => a > 0);
  const profitRatios = wallets
    .filter(w => w.total_tokens > 0)
    .map(w => (w.profitable_tokens || 0) / w.total_tokens);

  console.log('='.repeat(80));
  console.log('基于所有代币数据构建分类系统');
  console.log('='.repeat(80));
  console.log(`\n总钱包数: ${wallets.length}`);
  console.log(`有效年龄数据: ${ages.length}`);
  console.log(`有效盈亏比数据: ${profitRatios.length}`);

  // 维度1: 持仓规模
  console.log('\n' + '-'.repeat(80));
  console.log('[维度1: 持仓规模]');
  const balP10 = percentile(balances, 10);
  const balP25 = percentile(balances, 25);
  const balP50 = percentile(balances, 50);
  const balP75 = percentile(balances, 75);
  const balP90 = percentile(balances, 90);
  const balP95 = percentile(balances, 95);

  console.log(`  极小户: <= $${balP10.toFixed(0)} (P10)`);
  console.log(`  微型户: $${balP10.toFixed(0)} - $${balP25.toFixed(0)} (P10-P25)`);
  console.log(`  小户:   $${balP25.toFixed(0)} - $${balP50.toFixed(0)} (P25-P50)`);
  console.log(`  中户:   $${balP50.toFixed(0)} - $${balP75.toFixed(0)} (P50-P75)`);
  console.log(`  大户:   $${balP75.toFixed(0)} - $${balP90.toFixed(0)} (P75-P90)`);
  console.log(`  巨鲸:   > $${balP90.toFixed(0)} (P90+)`);

  // 维度2: 交易活跃度
  console.log('\n' + '-'.repeat(80));
  console.log('[维度2: 交易活跃度]');
  const trP25 = percentile(trades, 25);
  const trP50 = percentile(trades, 50);
  const trP75 = percentile(trades, 75);
  const trP90 = percentile(trades, 90);

  console.log(`  低频:   <= ${trP25}次 (P25)`);
  console.log(`  中频:   ${trP25} - ${trP50}次 (P25-P50)`);
  console.log(`  高频:   ${trP50} - ${trP75}次 (P50-P75)`);
  console.log(`  超高频: > ${trP75}次 (P75+)`);

  // 维度3: 钱包年龄
  console.log('\n' + '-'.repeat(80));
  console.log('[维度3: 钱包年龄]');
  const ageP25 = percentile(ages, 25);
  const ageP50 = percentile(ages, 50);
  const ageP75 = percentile(ages, 75);

  console.log(`  新钱包:  < ${ageP25}天 (P25)`);
  console.log(`  较新:    ${ageP25} - ${ageP50}天 (P25-P50)`);
  console.log(`  成熟:    ${ageP50} - ${ageP75}天 (P50-P75)`);
  console.log(`  老钱包:  > ${ageP75}天 (P75+)`);

  // 维度4: 盈利能力
  console.log('\n' + '-'.repeat(80));
  console.log('[维度4: 盈利代币占比]');
  const profP25 = percentile(profitRatios, 25);
  const profP50 = percentile(profitRatios, 50);
  const profP75 = percentile(profitRatios, 75);

  console.log(`  低胜率: <= ${(profP25 * 100).toFixed(0)}% (P25)`);
  console.log(`  中胜率: ${(profP25 * 100).toFixed(0)}% - ${(profP50 * 100).toFixed(0)}% (P25-P50)`);
  console.log(`  高胜率: > ${(profP50 * 100).toFixed(0)}% (P50+)`);

  // 构建分类规则
  const classificationSystem = {
    version: '1.0',
    created_at: new Date().toISOString(),
    data_source: {
      total_wallets: wallets.length,
      tokens_analyzed: 6
    },
    dimensions: {
      balance: {
        name: '持仓规模',
        categories: [
          { name: '极小户', max: balP10, description: `≤$${balP10.toFixed(0)}` },
          { name: '微型户', min: balP10, max: balP25, description: `$${balP10.toFixed(0)}-$${balP25.toFixed(0)}` },
          { name: '小户', min: balP25, max: balP50, description: `$${balP25.toFixed(0)}-$${balP50.toFixed(0)}` },
          { name: '中户', min: balP50, max: balP75, description: `$${balP50.toFixed(0)}-$${balP75.toFixed(0)}` },
          { name: '大户', min: balP75, max: balP90, description: `$${balP75.toFixed(0)}-$${balP90.toFixed(0)}` },
          { name: '巨鲸', min: balP90, description: `>$${balP90.toFixed(0)}` }
        ]
      },
      trading: {
        name: '交易活跃度',
        categories: [
          { name: '低频', max: trP25, description: `≤${trP25}次` },
          { name: '中频', min: trP25, max: trP50, description: `${trP25}-${trP50}次` },
          { name: '高频', min: trP50, max: trP75, description: `${trP50}-${trP75}次` },
          { name: '超高频', min: trP75, description: `>${trP75}次` }
        ]
      },
      age: {
        name: '钱包年龄',
        categories: [
          { name: '新钱包', max: ageP25, description: `<${ageP25}天` },
          { name: '较新', min: ageP25, max: ageP50, description: `${ageP25}-${ageP50}天` },
          { name: '成熟', min: ageP50, max: ageP75, description: `${ageP50}-${ageP75}天` },
          { name: '老钱包', min: ageP75, description: `>${ageP75}天` }
        ]
      },
      profitability: {
        name: '盈利能力',
        categories: [
          { name: '低胜率', max: profP25, description: `≤${(profP25 * 100).toFixed(0)}%` },
          { name: '中胜率', min: profP25, max: profP50, description: `${(profP25 * 100).toFixed(0)}%-${(profP50 * 100).toFixed(0)}%` },
          { name: '高胜率', min: profP50, description: `>${(profP50 * 100).toFixed(0)}%` }
        ]
      }
    },
    combo_categories: [
      {
        id: 'whale',
        name: '🏆 巨鲸',
        emoji: '🏆',
        description: '超大资金玩家',
        rules: [{ dimension: 'balance', category: '巨鲸' }],
        investment_insight: '机构级资金，可能是项目方或大户'
      },
      {
        id: 'smart_money',
        name: '💎 聪明钱老鸟',
        emoji: '💎',
        description: '经验丰富且盈利能力强',
        rules: [
          { dimension: 'age', category: '老钱包' },
          { dimension: 'balance', category: '大户' }
        ],
        investment_insight: '经验丰富的成功交易者，值得关注'
      },
      {
        id: 'new_wallet_bot',
        name: '🤖 疑似机器人',
        emoji: '🤖',
        description: '新钱包但交易频繁',
        rules: [
          { dimension: 'age', category: '新钱包' },
          { dimension: 'trading', category: '超高频' }
        ],
        investment_insight: '可能是批量操作的机器人账户'
      },
      {
        id: 'high_frequency_trader',
        name: '🎲 高频交易者',
        emoji: '🎲',
        description: '交易非常活跃',
        rules: [{ dimension: 'trading', category: '超高频' }],
        investment_insight: '专业交易者或套利者'
      },
      {
        id: 'profitable_newbie',
        name: '🌟 新星玩家',
        emoji: '🌟',
        description: '新钱包但胜率高',
        rules: [
          { dimension: 'age', category: '新钱包' },
          { dimension: 'profitability', category: '高胜率' }
        ],
        investment_insight: '新用户但表现出色，值得关注'
      },
      {
        id: 'experienced_winner',
        name: '🦅 老鸟赢家',
        emoji: '🦅',
        description: '老钱包且胜率高',
        rules: [
          { dimension: 'age', category: '老钱包' },
          { dimension: 'profitability', category: '高胜率' }
        ],
        investment_insight: '经验丰富的成功交易者'
      },
      {
        id: 'large_trader',
        name: '💰 大户',
        emoji: '💰',
        description: '资金较大的玩家',
        rules: [{ dimension: 'balance', category: '大户' }],
        investment_insight: '有实力的个人投资者'
      },
      {
        id: 'retail_investor',
        name: '🐟 散户',
        emoji: '🐟',
        description: '普通散户玩家',
        rules: [{ dimension: 'balance', category: '小户' }],
        investment_insight: '普通跟风投资者'
      }
    ]
  };

  return classificationSystem;
}

// 分类函数
function classifyWallet(wallet, system) {
  const results = [];

  // 先判断基础分类
  const balanceCat = system.dimensions.balance.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined) {
      return wallet.total_balance >= c.min && wallet.total_balance < c.max;
    } else if (c.max !== undefined) {
      return wallet.total_balance < c.max;
    } else {
      return wallet.total_balance >= c.min;
    }
  });

  const tradingCat = system.dimensions.trading.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined) {
      return wallet.total_trades >= c.min && wallet.total_trades < c.max;
    } else if (c.max !== undefined) {
      return wallet.total_trades < c.max;
    } else {
      return wallet.total_trades >= c.min;
    }
  });

  const ageCat = system.dimensions.age.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined) {
      return wallet.wallet_age_days >= c.min && wallet.wallet_age_days < c.max;
    } else if (c.max !== undefined) {
      return wallet.wallet_age_days < c.max;
    } else {
      return wallet.wallet_age_days >= c.min;
    }
  });

  const profitRatio = wallet.total_tokens > 0 ? wallet.profitable_tokens / wallet.total_tokens : 0;
  const profitCat = system.dimensions.profitability.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined) {
      return profitRatio >= c.min && profitRatio < c.max;
    } else if (c.max !== undefined) {
      return profitRatio < c.max;
    } else {
      return profitRatio >= c.min;
    }
  });

  // 检查组合分类
  system.combo_categories.forEach(combo => {
    const match = combo.rules.every(rule => {
      const cat = system.dimensions[rule.dimension].categories
        .find(c => c.name === rule.category);
      if (!cat) return false;

      if (rule.dimension === 'balance') {
        return balanceCat && balanceCat.name === rule.category;
      } else if (rule.dimension === 'trading') {
        return tradingCat && tradingCat.name === rule.category;
      } else if (rule.dimension === 'age') {
        return ageCat && ageCat.name === rule.category;
      } else if (rule.dimension === 'profitability') {
        return profitCat && profitCat.name === rule.category;
      }
      return false;
    });

    if (match) {
      results.push({
        id: combo.id,
        name: combo.name,
        emoji: combo.emoji,
        description: combo.description,
        insight: combo.investment_insight
      });
    }
  });

  return {
    wallet: wallet.address,
    basic_categories: {
      balance: balanceCat?.name || 'unknown',
      trading: tradingCat?.name || 'unknown',
      age: ageCat?.name || 'unknown',
      profitability: profitCat?.name || 'unknown'
    },
    combo_categories: results
  };
}

// 主函数
function main() {
  console.log('加载所有代币数据...');
  const allWallets = loadAllTokenData();
  console.log(`加载完成: ${allWallets.length} 个钱包\n`);

  // 构建分类系统
  const system = buildClassificationSystem(allWallets);

  // 保存分类系统
  const systemPath = path.join(DATA_DIR, 'classification_system.json');
  fs.writeFileSync(systemPath, JSON.stringify(system, null, 2));
  console.log(`\n分类系统已保存: ${systemPath}`);

  // 测试分类
  console.log('\n' + '='.repeat(80));
  console.log('[测试分类 - 样本钱包]');
  console.log('='.repeat(80));

  const samples = allWallets.slice(0, 10);
  samples.forEach(w => {
    const classification = classifyWallet(w, system);
    console.log(`\n${w.address.slice(0, 12)}...`);
    console.log(`  基础: ${classification.basic_categories.balance} / ${classification.basic_categories.trading} / ${classification.basic_categories.age}`);
    if (classification.combo_categories.length > 0) {
      classification.combo_categories.forEach(c => {
        console.log(`  -> ${c.emoji} ${c.name}: ${c.description}`);
        console.log(`     洞察: ${c.insight}`);
      });
    } else {
      console.log(`  -> 🐟 普通玩家`);
    }
  });

  // 统计各组合分类数量
  console.log('\n' + '='.repeat(80));
  console.log('[组合分类统计]');
  console.log('='.repeat(80));

  const categoryCounts = {};
  allWallets.forEach(w => {
    const classification = classifyWallet(w, system);
    if (classification.combo_categories.length > 0) {
      classification.combo_categories.forEach(c => {
        categoryCounts[c.name] = (categoryCounts[c.name] || 0) + 1;
      });
    } else {
      categoryCounts['🐟 普通玩家'] = (categoryCounts['🐟 普通玩家'] || 0) + 1;
    }
  });

  Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, count]) => {
      const pct = (count / allWallets.length * 100).toFixed(1);
      console.log(`  ${name}: ${count}个 (${pct}%)`);
    });

  console.log('\n' + '='.repeat(80));
  console.log('分类系统构建完成！');
  console.log('='.repeat(80));
}

main();
