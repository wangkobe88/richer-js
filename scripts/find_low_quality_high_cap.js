/**
 * 查找"低质量+高市值"的代币
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function findLowQualityHighCap() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                  查找"低质量+高市值"代币                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取所有代币及其标注
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId);

  // 获取交易数据计算收益
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId);

  const tokenProfits = new Map();
  const tokenTradeGroups = new Map();

  trades.forEach(trade => {
    if (!tokenTradeGroups.has(trade.token_address)) {
      tokenTradeGroups.set(trade.token_address, []);
    }
    tokenTradeGroups.get(trade.token_address).push(trade);
  });

  for (const [addr, tokenTrades] of tokenTradeGroups) {
    tokenTrades.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const buyTrades = tokenTrades.filter(t => t.trade_direction === 'buy');
    const sellTrades = tokenTrades.filter(t => t.trade_direction === 'sell');

    if (buyTrades.length === 0) continue;

    let totalBuy = 0, totalSell = 0;
    buyTrades.forEach(t => totalBuy += t.input_amount || 0);
    sellTrades.forEach(t => totalSell += t.output_amount || 0);

    const profit = totalSell - totalBuy;
    const profitPercent = totalBuy > 0 ? (profit / totalBuy) * 100 : 0;

    tokenProfits.set(addr, {
      profitPercent,
      symbol: buyTrades[0].token_symbol
    });
  }

  // 按人工标注分类
  const categories = {
    'fake_pump': [],
    'low_quality': [],
    'mid_quality': [],
    'high_quality': [],
    'no_user': [],
    'unknown': []
  };

  tokens.forEach(token => {
    const category = token.human_judges?.category || 'unknown';
    const profit = tokenProfits.get(token.token_address);

    if (profit) {
      categories[category].push({
        symbol: profit.symbol,
        address: token.token_address,
        profitPercent: profit.profitPercent,
        humanJudge: category,
        metadata: token.metadata
      });
    }
  });

  console.log('【按质量分类统计】\n');
  console.log('质量分类        数量');
  console.log('─'.repeat(40));
  Object.entries(categories).forEach(([cat, tokens]) => {
    if (tokens.length > 0) {
      const catLabel = {
        'fake_pump': '🎭流水盘',
        'low_quality': '📉低质量',
        'mid_quality': '📊中质量',
        'high_quality': '🚀高质量',
        'no_user': '👻无人玩',
        'unknown': '❓未标注'
      }[cat] || cat;
      console.log(`${catLabel.padEnd(15)} ${tokens.length}`);
    }
  });

  // 查找低质量的代币
  console.log('\n\n');
  console.log('【低质量代币列表】\n');

  const lowQualityTokens = categories['low_quality'];
  if (lowQualityTokens.length > 0) {
    console.log(`共 ${lowQualityTokens.length} 个低质量代币:\n`);

    lowQualityTokens.sort((a, b) => b.profitPercent - a.profitPercent).forEach((token, i) => {
      const profitLabel = token.profitPercent > 0 ? `+${token.profitPercent.toFixed(1)}%` : `${token.profitPercent.toFixed(1)}%`;
      console.log(`${(i + 1).toString().padStart(2)}. ${token.symbol.padEnd(12)} 收益:${profitLabel.padStart(7)}`);
    });
  }

  // 查找流水盘
  console.log('\n\n');
  console.log('【流水盘（fake_pump）代币列表】\n');

  const fakePumpTokens = categories['fake_pump'];
  if (fakePumpTokens.length > 0) {
    console.log(`共 ${fakePumpTokens.length} 个流水盘代币:\n`);

    fakePumpTokens.sort((a, b) => b.profitPercent - a.profitPercent).forEach((token, i) => {
      const profitLabel = token.profitPercent > 0 ? `+${token.profitPercent.toFixed(1)}%` : `${token.profitPercent.toFixed(1)}%`;
      console.log(`${(i + 1).toString().padStart(2)}. ${token.symbol.padEnd(12)} 收益:${profitLabel.padStart(7)}`);
    });
  } else {
    console.log('当前实验中没有人工标注为"流水盘"的代币。');
  }

  // 查找高收益但低质量的代币（危险的拉砸）
  console.log('\n\n');
  console.log('【危险代币：低质量但有正收益】\n');

  const dangerousTokens = lowQualityTokens.filter(t => t.profitPercent > 0);
  if (dangerousTokens.length > 0) {
    console.log(`共 ${dangerousTokens.length} 个低质量但有正收益的代币:\n`);

    dangerousTokens.sort((a, b) => b.profitPercent - a.profitPercent).forEach((token, i) => {
      const profitLabel = `+${token.profitPercent.toFixed(1)}%`;
      const riskLabel = token.profitPercent > 20 ? '⚠️ 高风险' : '⚡ 中风险';
      console.log(`${(i + 1).toString().padStart(2)}. ${token.symbol.padEnd(12)} 收益:${profitLabel.padStart(7)}  ${riskLabel}`);
    });
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
}

findLowQualityHighCap().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
