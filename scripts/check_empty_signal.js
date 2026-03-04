const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function check() {
  const { data, error } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', '65a68e5a-dfb5-4d52-a7cf-d088a5252e20')
    .eq('token_address', '0x438ed71e05a7ae7174e53b3a011cf643bbce4444')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    console.log('未找到信号');
    return;
  }

  const signal = data[0];
  const m = signal.metadata || {};

  console.log('代币:', signal.token_address);
  console.log('状态:', signal.status);
  console.log('原因:', signal.reason);
  console.log('');
  console.log('早期参与者检查状态:');
  console.log('  earlyTradesChecked:', m.earlyTradesChecked);
  console.log('  earlyTradesCheckTimestamp:', m.earlyTradesCheckTimestamp);
  console.log('  earlyTradesCheckDuration:', m.earlyTradesCheckDuration);
  console.log('');
  console.log('数据字段:');
  console.log('  earlyTradesTotalCount:', m.earlyTradesTotalCount);
  console.log('  earlyTradesDataFirstTime:', m.earlyTradesDataFirstTime);
  console.log('  earlyTradesDataLastTime:', m.earlyTradesDataLastTime);
  console.log('  earlyTradesDataCoverage:', m.earlyTradesDataCoverage);
  console.log('');
  console.log('完整metadata:');
  console.log(JSON.stringify(m, null, 2));
}

check();
