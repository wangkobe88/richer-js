/**
 * 调试信号数据结构
 */

const { ExperimentDataService } = require('../src/web/services/ExperimentDataService');

async function debug(experimentId) {
  const dataService = new ExperimentDataService();

  const signals = await dataService.getSignals(experimentId, { limit: 10 });
  const trades = await dataService.getTrades(experimentId, { limit: 10 });

  console.log('=== 信号数据样例 ===');
  for (const signal of signals.slice(0, 3)) {
    console.log('Signal:', {
      id: signal.id,
      action: signal.action,
      signalType: signal.signalType,
      executed: signal.executed,
      tokenSymbol: signal.tokenSymbol,
      metadata: signal.metadata
    });
  }

  console.log('\n=== 交易数据样例 ===');
  for (const trade of trades.slice(0, 3)) {
    console.log('Trade:', {
      id: trade.id,
      direction: trade.tradeDirection,
      status: trade.tradeStatus,
      success: trade.success,
      tokenSymbol: trade.tokenSymbol,
      signalId: trade.signalId
    });
  }

  // 统计 action 的分布
  const actionCounts = {};
  for (const signal of signals) {
    const action = signal.action || 'null';
    actionCounts[action] = (actionCounts[action] || 0) + 1;
  }

  console.log('\n=== Action 分布 ===');
  console.log(actionCounts);

  // 统计 executed 的分布
  const executedCounts = { true: 0, false: 0, null: 0 };
  for (const signal of signals) {
    if (signal.executed === true) executedCounts.true++;
    else if (signal.executed === false) executedCounts.false++;
    else executedCounts.null++;
  }

  console.log('\n=== Executed 分布 ===');
  console.log(executedCounts);

  // 查找 executed === true 的信号
  const executedSignals = signals.filter(s => s.executed === true);
  console.log(`\n=== executed === true 的信号: ${executedSignals.length} ===`);
  for (const signal of executedSignals.slice(0, 5)) {
    console.log(`  ${signal.signalType} - ${signal.action} - ${signal.tokenSymbol}`);
  }
}

debug('2f9f0fa5-9b8b-4b6b-9e65-10342d1f0bdf').catch(console.error);
