const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  // 直接查询所有交易
  const { data: trades } = await supabase
    .from('trades')
    .select('id, experiment_id, token_symbol, trade_direction, created_at, is_virtual_trade')
    .order('created_at', { ascending: false })
    .limit(50);

  console.log('=== 最近50条交易 ===\n');

  // 按实验分组
  const byExp = new Map();
  for (const t of trades || []) {
    if (!byExp.has(t.experiment_id)) {
      byExp.set(t.experiment_id, []);
    }
    byExp.get(t.experiment_id).push(t);
  }

  console.log(`共有 ${byExp.size} 个实验有交易数据\n`);

  // 查询每个实验的类型
  for (const [expId, trades] of byExp) {
    const { data: exp } = await supabase
      .from('experiments')
      .select('trading_mode, experiment_name')
      .eq('id', expId)
      .single();

    const mode = exp?.trading_mode || 'unknown';
    const name = exp?.experiment_name || '未知';

    console.log(`${expId.substring(0, 8)}... | ${mode.padEnd(10)} | ${trades.length} 条 | ${name.substring(0, 30)}`);

    // 显示该实验的第一条交易
    const first = trades[0];
    console.log(`  最新: ${first.token_symbol} ${first.trade_direction} | ${first.created_at}`);
    console.log('');
  }

  // 检查是否有回测实验的交易
  const backtestExps = Array.from(byExp.keys()).filter(async (expId) => {
    const { data: exp } = await supabase
      .from('experiments')
      .select('trading_mode')
      .eq('id', expId)
      .single();
    return exp?.trading_mode === 'backtest';
  });

  console.log(`\n回测实验交易: ${backtestExps.length > 0 ? backtestExps.join(', ') : '无'}`);
})();
