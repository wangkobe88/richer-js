/**
 * 检查信号数据结构
 * 了解预检查数据实际保存的位置
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function checkSignalStructure() {
  const experimentId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  // 获取一个买入信号的完整数据
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .limit(1);

  if (signals && signals.length > 0) {
    const signal = signals[0];

    console.log('【信号数据结构】\n');
    console.log('信号字段:');
    console.log('  id:', signal.id);
    console.log('  token_address:', signal.token_address);
    console.log('  token_symbol:', signal.token_symbol);
    console.log('  action:', signal.action);
    console.log('  created_at:', signal.created_at);
    console.log('');

    console.log('metadata 结构:');
    console.log(JSON.stringify(signal.metadata, null, 2));
    console.log('');

    // 检查是否有 factors
    if (signal.metadata && signal.metadata.factors) {
      console.log('factors 字段:');
      console.log(JSON.stringify(signal.metadata.factors, null, 2));
      console.log('');

      const factors = signal.metadata.factors;

      console.log('预检查相关字段:');
      console.log('  preBuyCheck:', factors.preBuyCheck || '不存在');
      console.log('  earlyTradesChecked:', factors.earlyTradesChecked || '不存在');
      console.log('  holdersCount:', factors.holdersCount || '不存在');
      console.log('  maxHoldingRatio:', factors.maxHoldingRatio || '不存在');
      console.log('');
    }

    // 获取对应的交易数据，对比metadata
    const { data: trades } = await supabase
      .from('trades')
      .select('*')
      .eq('experiment_id', experimentId)
      .eq('token_address', signal.token_address)
      .eq('trade_direction', 'buy')
      .limit(1);

    if (trades && trades.length > 0) {
      const trade = trades[0];
      console.log('对应交易的metadata:');
      console.log(JSON.stringify(trade.metadata, null, 2));
    }
  }
}

checkSignalStructure().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
