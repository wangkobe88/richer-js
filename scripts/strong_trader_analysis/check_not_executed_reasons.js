const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../config/.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkNotExecutedReasons() {
  // 获取回测实验的所有未执行信号
  // 不能直接查询 execution_reason，会导致返回空
  const { data: notExecuted } = await supabase
    .from('strategy_signals')
    .select('id, token_address, token_symbol, metadata')
    .eq('experiment_id', 'a2ee5c27-3788-48fa-8735-858cbc60fcad')
    .eq('executed', false);

  console.log('回测实验未执行信号数:', notExecuted?.length || 0);

  // 逐个获取 execution_reason
  const reasons = {};
  const strongTraderFiltered = [];

  for (let i = 0; i < (notExecuted?.length || 0); i++) {
    const signal = notExecuted[i];
    const { data: detail } = await supabase
      .from('strategy_signals')
      .select('execution_reason')
      .eq('id', signal.id)
      .single();

    const reason = detail?.execution_reason || 'unknown';
    reasons[reason] = (reasons[reason] || 0) + 1;

    if (reason.toLowerCase().includes('strongtrader') || reason.toLowerCase().includes('strong')) {
      strongTraderFiltered.push({
        symbol: signal.token_symbol,
        address: signal.token_address,
        reason: reason
      });
    }
  }

  console.log('\n=== 执行原因统计 ===');
  Object.entries(reasons).sort((a, b) => b[1] - a[1]).forEach(([reason, count]) => {
    console.log(`  ${reason}: ${count}`);
  });

  console.log('\n=== 被 strongTrader 过滤的代币 ===');
  console.log(`数量: ${strongTraderFiltered.length}`);
  strongTraderFiltered.forEach(t => {
    console.log(`  ${t.symbol}: ${t.reason}`);
  });
}

checkNotExecutedReasons().catch(console.error);
