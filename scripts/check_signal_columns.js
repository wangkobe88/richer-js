const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  // 获取一个现有的信号来查看字段
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .limit(1);

  if (signals && signals.length > 0) {
    console.log('strategy_signals 表字段:');
    console.log(Object.keys(signals[0]).join(', '));
  } else {
    console.log('没有信号数据');
  }

  // 同样检查 trades 表
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .limit(1);

  if (trades && trades.length > 0) {
    console.log('\ntrades 表字段:');
    console.log(Object.keys(trades[0]).join(', '));
  } else {
    console.log('没有交易数据');
  }
})();
