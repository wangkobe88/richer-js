/**
 * 所有6个代币的完整对比（含代币地址）
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/early-participants-analysis';

// 加载分类系统
const system = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'classification_system.json'), 'utf8'));

// 读取所有代币数据（v2优先）
function loadAllTokenData() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.match(/^token\d+_0x[a-f0-9]+.*\.json$/) && !f.includes('classification'))
    .sort();

  const tokenData = {};
  const v2Files = new Set();

  // 先收集v2文件
  files.forEach(f => {
    if (f.includes('_v2.json')) {
      v2Files.add(f.replace('_v2.json', '').replace(/^token\d+_/, ''));
    }
  });

  files.forEach(file => {
    const filePath = path.join(DATA_DIR, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    let wallets = [];
    let tokenAddress = '';

    if (data.wallets) {
      wallets = data.wallets;
      tokenAddress = data.tokenAddress;
    } else if (Array.isArray(data)) {
      wallets = data;
      const match = file.match(/0x[a-f0-9]+/);
      tokenAddress = match ? match[0] : file;
    }

    // 提取token索引
    const tokenMatch = file.match(/^token(\d+)_/);
    const tokenIndex = tokenMatch ? parseInt(tokenMatch[1]) : 0;

    // 优先使用v2版本
    const isV2 = file.includes('_v2.json');
    const existing = tokenData[tokenAddress];

    // 如果是v2版本，或者没有这个token的数据，则添加/更新
    if (isV2) {
      tokenData[tokenAddress] = {
        file,
        wallets,
        total_trades: data.totalTrades || 0,
        name: tokenAddress.slice(0, 10),
        address: tokenAddress,
        index: tokenIndex,
        isV2: true
      };
    } else if (!existing) {
      // 只有没有v2版本时才使用旧版本
      tokenData[tokenAddress] = {
        file,
        wallets,
        total_trades: data.totalTrades || 0,
        name: tokenAddress.slice(0, 10),
        address: tokenAddress,
        index: tokenIndex,
        isV2: false
      };
    }
  });

  return tokenData;
}

// 分类函数
function classifyWallet(wallet, system) {
  const balanceCat = system.dimensions.balance.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined)
      return wallet.total_balance >= c.min && wallet.total_balance < c.max;
    else if (c.max !== undefined) return wallet.total_balance < c.max;
    else return wallet.total_balance >= c.min;
  });

  const tradingCat = system.dimensions.trading.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined)
      return wallet.total_trades >= c.min && wallet.total_trades < c.max;
    else if (c.max !== undefined) return wallet.total_trades < c.max;
    else return wallet.total_trades >= c.min;
  });

  const ageCat = system.dimensions.age.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined)
      return wallet.wallet_age_days >= c.min && wallet.wallet_age_days < c.max;
    else if (c.max !== undefined) return wallet.wallet_age_days < c.max;
    else return wallet.wallet_age_days >= c.min;
  });

  const profitRatio = wallet.total_tokens > 0 ? (wallet.profitable_tokens || 0) / wallet.total_tokens : 0;
  const profitCat = system.dimensions.profitability.categories.find(c => {
    if (c.max !== undefined && c.min !== undefined)
      return profitRatio >= c.min && profitRatio < c.max;
    else if (c.max !== undefined) return profitRatio < c.max;
    else return profitRatio >= c.min;
  });

  const combo = [];
  system.combo_categories.forEach(comboCat => {
    const match = comboCat.rules.every(rule => {
      if (rule.dimension === 'balance') return balanceCat && balanceCat.name === rule.category;
      else if (rule.dimension === 'trading') return tradingCat && tradingCat.name === rule.category;
      else if (rule.dimension === 'age') return ageCat && ageCat.name === rule.category;
      else if (rule.dimension === 'profitability') return profitCat && profitCat.name === rule.category;
      return false;
    });
    if (match) combo.push(comboCat);
  });

  return { combo };
}

// 统计分类分布
function getTokenDistribution(wallets, system) {
  const categoryCounts = {};
  wallets.forEach(w => {
    const { combo } = classifyWallet(w, system);
    if (combo.length > 0) {
      combo.forEach(c => categoryCounts[c.name] = (categoryCounts[c.name] || 0) + 1);
    } else {
      categoryCounts['🐟 普通玩家'] = (categoryCounts['🐟 普通玩家'] || 0) + 1;
    }
  });
  return categoryCounts;
}

// 主函数
function main() {
  console.log('='.repeat(140));
  console.log('所有6个代币参与者分类对比表（含代币地址）');
  console.log('='.repeat(140));

  const tokenData = loadAllTokenData();
  const tokens = Object.values(tokenData).sort((a, b) => a.index - b.index);

  console.log(`\n共分析 ${tokens.length} 个代币\n`);

  // 为每个代币计算统计数据
  const tokenStats = tokens.map(token => {
    const categoryCounts = getTokenDistribution(token.wallets, system);
    const total = token.wallets.length;
    return {
      index: token.index,
      address: token.address,
      name: token.name,
      wallets: total,
      trades: token.total_trades,
      whale: ((categoryCounts['🏆 巨鲸'] || 0) / total * 100).toFixed(1),
      smartMoney: ((categoryCounts['💎 聪明钱老鸟'] || 0) / total * 100).toFixed(1),
      bot: ((categoryCounts['🤖 疑似机器人'] || 0) / total * 100).toFixed(1),
      hft: ((categoryCounts['🎲 高频交易者'] || 0) / total * 100).toFixed(1),
      newStar: ((categoryCounts['🌟 新星玩家'] || 0) / total * 100).toFixed(1),
      oldWinner: ((categoryCounts['🦅 老鸟赢家'] || 0) / total * 100).toFixed(1),
      largeTrader: ((categoryCounts['💰 大户'] || 0) / total * 100).toFixed(1),
      retail: ((categoryCounts['🐟 散户'] || 0) / total * 100).toFixed(1),
      normal: ((categoryCounts['🐟 普通玩家'] || 0) / total * 100).toFixed(1),
      // 综合评分
      score: (
        (categoryCounts['💎 聪明钱老鸟'] || 0) / total * 3 +
        (categoryCounts['🦅 老鸟赢家'] || 0) / total * 2 +
        (categoryCounts['🌟 新星玩家'] || 0) / total * 1 -
        (categoryCounts['🤖 疑似机器人'] || 0) / total * 2 -
        (categoryCounts['🐟 散户'] || 0) / total * 0.5
      ) * 100
    };
  });

  // 打印详细表格
  console.log('─'.repeat(140));
  console.log('[详细对比表]');
  console.log('─'.repeat(140));

  console.log('\n' +
    '序号'.padEnd(6) +
    '代币地址'.padEnd(45) +
    '钱包数'.padEnd(10) +
    '交易数'.padEnd(10) +
    '巨鲸'.padEnd(8) +
    '聪明钱'.padEnd(10) +
    '机器人'.padEnd(10) +
    '高频'.padEnd(8) +
    '新星'.padEnd(8) +
    '老鸟'.padEnd(8) +
    '散户'.padEnd(8) +
    '评分'.padEnd(10)
  );

  console.log('─'.repeat(140));

  tokenStats.forEach(t => {
    console.log(
      t.index.toString().padEnd(6) +
      t.address.padEnd(45) +
      t.wallets.toString().padEnd(10) +
      t.trades.toString().padEnd(10) +
      t.whale.padEnd(8) +
      t.smartMoney.padEnd(10) +
      t.bot.padEnd(10) +
      t.hft.padEnd(8) +
      t.newStar.padEnd(8) +
      t.oldWinner.padEnd(8) +
      t.retail.padEnd(8) +
      t.score.toFixed(1).padEnd(10)
    );
  });

  // 按评分排序
  console.log('\n' + '─'.repeat(140));
  console.log('[按综合质量评分排序]');
  console.log('─'.repeat(140));

  const byScore = [...tokenStats].sort((a, b) => b.score - a.score);

  console.log('\n' +
    '排名'.padEnd(8) +
    '代币地址'.padEnd(45) +
    '评分'.padEnd(10) +
    '聪明钱'.padEnd(10) +
    '机器人'.padEnd(10) +
    '新星'.padEnd(8) +
    '老鸟'.padEnd(8) +
    '散户'.padEnd(8) +
    '特征'
  );

  console.log('─'.repeat(140));

  byScore.forEach((t, i) => {
    const features = [];
    if (parseFloat(t.smartMoney) > 3) features.push('聪明钱多');
    if (parseFloat(t.bot) > 2) features.push('机器人多');
    if (parseFloat(t.newStar) > 25) features.push('新星多');
    if (parseFloat(t.oldWinner) > 4) features.push('老鸟多');
    if (parseFloat(t.retail) > 30) features.push('散户多');
    if (features.length === 0) features.push('均衡');

    console.log(
      (i + 1).toString().padEnd(8) +
      t.address.padEnd(45) +
      t.score.toFixed(1).padEnd(10) +
      t.smartMoney.padEnd(10) +
      t.bot.padEnd(10) +
      t.newStar.padEnd(8) +
      t.oldWinner.padEnd(8) +
      t.retail.padEnd(8) +
      features.join(', ')
    );
  });

  // 代币聚类
  console.log('\n' + '─'.repeat(140));
  console.log('[代币类型聚类]');
  console.log('─'.repeat(140));

  const highQuality = byScore.filter(t => t.score > 30);
  const midQuality = byScore.filter(t => t.score >= 20 && t.score <= 30);
  const lowQuality = byScore.filter(t => t.score < 20);
  const highBot = byScore.filter(t => parseFloat(t.bot) > 2);
  const highRetail = byScore.filter(t => parseFloat(t.retail) > 25);

  console.log(`\n🌟 高质量代币 (评分>30): ${highQuality.map(t => `代币${t.index}`).join(', ') || '无'}`);
  console.log(`📊 中等质量代币 (评分20-30): ${midQuality.map(t => `代币${t.index}`).join(', ')}`);
  console.log(`📉 低质量代币 (评分<20): ${lowQuality.map(t => `代币${t.index}`).join(', ') || '无'}`);
  console.log(`\n🤖 机器人较多 (>2%): ${highBot.map(t => `代币${t.index}(${t.bot}%)`).join(', ') || '无'}`);
  console.log(`🐟 散户较多 (>25%): ${highRetail.map(t => `代币${t.index}(${t.retail}%)`).join(', ')}`);

  console.log('\n' + '='.repeat(140));
}

main();
