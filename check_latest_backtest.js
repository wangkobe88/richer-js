const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkLatestBacktest() {
  const experimentId = '233e4d94-e771-463a-9296-a93483a9ce96';
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  // 获取信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!signals || signals.length === 0) {
    console.log('没有找到信号');
    return;
  }

  const signal = signals[0];
  const metadata = signal.metadata || {};

  console.log('=== 信号信息 ===\n');
  console.log('ID:', signal.id);
  console.log('Created at:', signal.created_at);
  console.log('');

  console.log('=== Metadata ===\n');
  if (metadata.tokenCreateTime !== undefined) {
    console.log('tokenCreateTime:', metadata.tokenCreateTime);
    if (metadata.tokenCreateTime) {
      console.log('  日期:', new Date(metadata.tokenCreateTime * 1000).toLocaleString());
    }
  } else {
    console.log('❌ tokenCreateTime 不存在');
  }
  console.log('');

  if (metadata.preBuyCheckFactors) {
    console.log('preBuyCheckFactors 存在');
    console.log('  earlyWhaleCount:', metadata.preBuyCheckFactors.earlyWhaleCount);
    console.log('  earlyWhaleSellRatio:', metadata.preBuyCheckFactors.earlyWhaleSellRatio);
    console.log('  earlyWhaleMethod:', metadata.preBuyCheckFactors.earlyWhaleMethod);
  } else {
    console.log('❌ preBuyCheckFactors 不存在');
  }
}

checkLatestBacktest().catch(console.error);
