/**
 * 从信号中分析预检查因子
 * 对比通过和未通过预检查的代币
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function analyzeFromSignals() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    从信号分析预检查因子                                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // 获取所有买入信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .order('created_at', { ascending: true });

  // 获取交易数据计算收益
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  // 计算代币收益
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
    const profitPercent = (profit / totalBuy) * 100;

    tokenProfits.set(addr, {
      profitPercent,
      profit,
      hasSell: sellTrades.length > 0,
      symbol: buyTrades[0].token_symbol
    });
  }

  // 分析信号
  const passedSignals = [];
  const rejectedSignals = [];
  const noDataSignals = [];

  signals.forEach(signal => {
    const preBuyFactors = signal.metadata?.preBuyCheckFactors || {};
    const profit = tokenProfits.get(signal.token_address);

    // 检查是否有预检查数据
    const hasPreBuyData = Object.keys(preBuyFactors).length > 0 &&
                         (preBuyFactors.earlyTradesChecked === 1 ||
                          preBuyFactors.holdersCount > 0);

    const signalInfo = {
      symbol: signal.token_symbol,
      addr: signal.token_address,
      profitPercent: profit?.profitPercent || 0,
      hasTrades: !!profit,
      preBuyFactors,
      executionStatus: signal.metadata?.execution_status || 'unknown',
      executionReason: signal.metadata?.execution_reason || ''
    };

    if (!hasPreBuyData) {
      noDataSignals.push(signalInfo);
    } else if (signal.metadata?.execution_status === 'failed') {
      rejectedSignals.push(signalInfo);
    } else {
      passedSignals.push(signalInfo);
    }
  });

  console.log('【信号统计】\n');
  console.log(`总信号数: ${signals.length}`);
  console.log(`有预检查数据: ${passedSignals.length + rejectedSignals.length}`);
  console.log(`无预检查数据: ${noDataSignals.length}`);
  console.log(`通过预检查: ${passedSignals.length}`);
  console.log(`未通过预检查: ${rejectedSignals.length}`);
  console.log('');

  // 分析被拒绝的信号
  if (rejectedSignals.length > 0) {
    console.log('【未通过预检查的信号】\n');
    console.log('代币              Dev%    MaxHold%  Black  White  eTotal  eWal/Min  拒绝原因');
    console.log('─'.repeat(90));

    rejectedSignals.forEach(s => {
      const f = s.preBuyFactors;
      const devStr = (f.devHoldingRatio || 0).toFixed(1).padStart(6);
      const maxStr = (f.maxHoldingRatio || 0).toFixed(1).padStart(7);
      const blStr = (f.holderBlacklistCount || 0).toString().padStart(5);
      const whStr = (f.holderWhitelistCount || 0).toString().padStart(5);
      const eTotStr = (f.earlyTradesTotalCount || 0).toString().padStart(6);
      const eWalStr = (f.earlyTradesWalletsPerMin || 0).toFixed(1).padStart(7);
      const reason = s.executionReason.substring(0, 40) + '...';

      console.log(`${s.symbol.padEnd(16)} ${devStr}  ${maxStr}  ${blStr}  ${whStr}  ${eTotStr}  ${eWalStr}  ${reason}`);
    });
    console.log('');
  }

  // 分析通过预检查的信号
  if (passedSignals.length > 0) {
    console.log('【通过预检查的信号】\n');

    // 按收益分组
    const passedProfit = passedSignals.filter(s => s.profitPercent > 0);
    const passedLoss = passedSignals.filter(s => s.profitPercent <= 0);

    console.log(`通过后盈利: ${passedProfit.length}个`);
    console.log(`通过后亏损: ${passedLoss.length}个`);
    console.log('');

    if (passedLoss.length > 0) {
      console.log('【通过预检查但仍亏损的代币】\n');
      console.log('代币              收益%    Dev%    MaxHold%  Black  White  eTotal  eWal/Min');
      console.log('─'.repeat(75));

      passedLoss.forEach(s => {
        const f = s.preBuyFactors;
        const profitStr = s.profitPercent.toFixed(2).padStart(7);
        const devStr = (f.devHoldingRatio || 0).toFixed(1).padStart(6);
        const maxStr = (f.maxHoldingRatio || 0).toFixed(1).padStart(7);
        const blStr = (f.holderBlacklistCount || 0).toString().padStart(5);
        const whStr = (f.holderWhitelistCount || 0).toString().padStart(5);
        const eTotStr = (f.earlyTradesTotalCount || 0).toString().padStart(6);
        const eWalStr = (f.earlyTradesWalletsPerMin || 0).toFixed(1).padStart(7);

        console.log(`${s.symbol.padEnd(16)} ${profitStr}% ${devStr}  ${maxStr}  ${blStr}  ${whStr}  ${eTotStr}  ${eWalStr}`);
      });
      console.log('');

      // 分析这些代币的共同特征
      console.log('【特征分析】\n');

      const avgDev = passedLoss.reduce((sum, s) => sum + (s.preBuyFactors.devHoldingRatio || 0), 0) / passedLoss.length;
      const avgMaxHold = passedLoss.reduce((sum, s) => sum + (s.preBuyFactors.maxHoldingRatio || 0), 0) / passedLoss.length;
      const avgBlacklist = passedLoss.reduce((sum, s) => sum + (s.preBuyFactors.holderBlacklistCount || 0), 0) / passedLoss.length;
      const avgWallets = passedLoss.reduce((sum, s) => sum + (s.preBuyFactors.earlyTradesWalletsPerMin || 0), 0) / passedLoss.length;
      const totalCount = passedLoss.reduce((sum, s) => sum + (s.preBuyFactors.earlyTradesTotalCount || 0), 0);

      console.log(`  平均Dev持仓: ${avgDev.toFixed(1)}%`);
      console.log(`  平均最大持仓: ${avgMaxHold.toFixed(1)}%`);
      console.log(`  平均黑名单数: ${avgBlacklist.toFixed(1)}`);
      console.log(`  平均每分钟钱包数: ${avgWallets.toFixed(1)}`);
      console.log(`  早期总交易数: ${totalCount.toFixed(0)}`);
      console.log('');

      // 找出可疑特征
      const flags = [];
      if (avgDev > 20) flags.push('Dev持仓偏高');
      if (avgMaxHold > 25) flags.push('最大持仓偏高');
      if (avgBlacklist > 2) flags.push('黑名单持有者偏多');
      if (avgWallets < 20 && totalCount > 0) flags.push('交易活跃度低');

      if (flags.length > 0) {
        console.log(`  可疑特征: ${flags.join(', ')}`);
        console.log('');
      }
    }
  }

  console.log('═══════════════════════════════════════════════════════════════════════════');
}

analyzeFromSignals().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
