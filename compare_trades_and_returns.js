const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function compareTradesAndReturns() {
  const oldExpId = '233e4d94-e771-463a-9296-a93483a9ce96'; // 修复前
  const newExpId = 'bd7e63a2-8f56-4dfd-baef-a1c70d435384'; // 修复后

  console.log('=== 对比交易数据 ===\n');

  // 获取旧实验的交易
  const { data: oldTrades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', oldExpId);

  // 获取新实验的交易
  const { data: newTrades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', newExpId);

  console.log('旧实验交易数:', oldTrades?.length || 0);
  console.log('新实验交易数:', newTrades?.length || 0);
  console.log('');

  // 计算盈亏
  const oldPnL = oldTrades?.reduce((sum, t) => sum + (t.pnl || 0), 0) || 0;
  const newPnL = newTrades?.reduce((sum, t) => sum + (t.pnl || 0), 0) || 0;

  console.log('=== 盈亏对比 ===\n');
  console.log('旧实验总盈亏:', oldPnL.toFixed(2), 'USDT');
  console.log('新实验总盈亏:', newPnL.toFixed(2), 'USDT');
  console.log('差异:', (newPnL - oldPnL).toFixed(2), 'USDT');
  console.log('');

  // 分析被过滤的信号
  console.log('=== 分析被预检查过滤的信号 ===\n');
  
  const { data: oldSignals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata, status')
    .eq('experiment_id', oldExpId);

  const { data: newSignals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata, status')
    .eq('experiment_id', newExpId);

  // 统计被预检查过滤的信号
  const oldFiltered = oldSignals?.filter(s => s.status === 'failed') || [];
  const newFiltered = newSignals?.filter(s => s.status === 'failed') || [];

  console.log('旧实验被过滤的信号:', oldFiltered.length);
  console.log('新实验被过滤的信号:', newFiltered.length);
  console.log('');

  // 分析被过滤的原因
  if (newFiltered.length > 0) {
    console.log('=== 新实验被过滤的原因分析 ===\n');
    const reasons = {};
    newFiltered.forEach(s => {
      const reason = s.metadata?.preBuyCheckResult?.reason || '未知';
      reasons[reason] = (reasons[reason] || 0) + 1;
    });
    
    Object.entries(reasons).forEach(([reason, count]) => {
      console.log(`  ${reason}: ${count}`);
    });
  }
}

compareTradesAndReturns().catch(console.error);
