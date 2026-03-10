const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeTokenReturns() {
  const oldExpId = '233e4d94-e771-463a-9296-a93483a9ce96';
  const newExpId = 'bd7e63a2-8f56-4dfd-baef-a1c70d435384';

  // 获取新实验中 70%-85% 区间的代币地址
  const { data: newSignals } = await supabase
    .from('strategy_signals')
    .select('token_address, token_symbol, metadata')
    .eq('experiment_id', newExpId);

  const signalsIn70to85 = newSignals.filter(s => {
    const ratio = s.metadata?.preBuyCheckFactors?.earlyWhaleSellRatio;
    return ratio >= 0.7 && ratio <= 0.85;
  });

  // 获取代币符号
  const tokenSymbols = signalsIn70to85.map(s => s.token_symbol).filter(s => s);

  console.log('=== 从 token-returns 页面获取数据 ===\n');
  console.log('代币符号:', tokenSymbols.join(', '));
  console.log('');

  console.log('请访问以下链接查看这些代币的回报数据：\n');
  tokenSymbols.forEach(symbol => {
    console.log(`http://localhost:3010/experiment/${oldExpId}/token-returns#symbol=${symbol}`);
  });
  console.log('');

  console.log('然后手动查看这些代币的：');
  console.log('- 最终回报率');
  console.log('- 是否盈利');
  console.log('- 持有期间最高价');
}

analyzeTokenReturnsFromPage().catch(console.error);
