const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  // 直接查询 trades 表
  const { data: allTrades, error } = await supabase
    .from('trades')
    .select('experiment_id, token_symbol, trade_direction, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  console.log('=== 最近20条交易记录 ===\n');
  if (error) {
    console.log('查询失败:', error.message);
    return;
  }

  for (const t of allTrades || []) {
    const expId = t.experiment_id.substring(0, 8);
    console.log(`${expId}... | ${t.token_symbol} ${t.trade_direction} | ${t.created_at}`);
  }

  // 按实验分组统计
  const byExp = new Map();
  for (const t of allTrades || []) {
    byExp.set(t.experiment_id, (byExp.get(t.experiment_id) || 0) + 1);
  }

  console.log('\n=== 按实验分组 ===\n');
  for (const [expId, count] of byExp) {
    // 查询实验类型
    const { data: exp } = await supabase
      .from('experiments')
      .select('trading_mode, status')
      .eq('id', expId)
      .single();

    console.log(`${expId.substring(0, 8)}... | ${exp?.trading_mode || 'unknown'} | ${count} 条交易 | 状态: ${exp?.status || 'unknown'}`);
  }
})();
