const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkSignalMetadata() {
  const experimentId = '9e227ea2-4c0c-4864-8d8e-3b92779dd794';
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  // 获取信号
  const { data: signals, error } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.log('Error:', error);
    return;
  }

  if (!signals || signals.length === 0) {
    console.log('没有找到信号');
    return;
  }

  const signal = signals[0];
  console.log('=== 信号信息 ===\n');
  console.log('ID:', signal.id);
  console.log('Token:', signal.token_address);
  console.log('Symbol:', signal.symbol);
  console.log('Direction:', signal.direction);
  console.log('Status:', signal.status);
  console.log('Created at:', signal.created_at);
  console.log('');

  const metadata = signal.metadata || {};
  console.log('=== Metadata 字段 ===\n');
  const fields = Object.keys(metadata);
  console.log('字段列表:');
  fields.forEach(f => console.log('  -', f));
  console.log('');

  if (metadata.tokenCreateTime !== undefined) {
    console.log('✅ tokenCreateTime 存在');
    console.log('   值:', metadata.tokenCreateTime);
    console.log('   日期:', metadata.tokenCreateTime ? new Date(metadata.tokenCreateTime * 1000).toLocaleString() : 'null');
  } else {
    console.log('❌ tokenCreateTime 不存在');
  }

  console.log('');

  if (metadata.preBuyCheckFactors) {
    console.log('=== PreBuyCheckFactors (早期大户) ===\n');
    const whaleFactors = [
      'earlyWhaleCount',
      'earlyWhaleSellRatio',
      'earlyWhaleMethod',
      'earlyWhaleFirstSellTime',
      'earlyWhaleAverageSellTime'
    ];
    whaleFactors.forEach(f => {
      if (metadata.preBuyCheckFactors[f] !== undefined) {
        console.log(`${f}:`, metadata.preBuyCheckFactors[f]);
      }
    });
  }
}

checkSignalMetadata().catch(console.error);
