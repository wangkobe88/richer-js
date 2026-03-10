const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function findSpecificToken() {
  const sourceExperimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const targetAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  // 使用不同的查询方式
  console.log('=== 查询 1$ 代币 ===\n');

  // 1. 精确匹配
  let { data: token1 } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, discovered_at')
    .eq('experiment_id', sourceExperimentId)
    .eq('token_address', targetAddress)
    .maybeSingle();

  console.log('精确匹配结果:', token1 ? '✅ 找到' : '❌ 未找到');
  if (token1) {
    console.log('  地址:', token1.token_address);
    console.log('  discovered_at:', token1.discovered_at);
  }
  console.log('');

  // 2. 模糊搜索
  let { data: tokens2 } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, discovered_at')
    .eq('experiment_id', sourceExperimentId)
    .ilike('token_symbol', '%1%')
    .limit(10);

  console.log('符号包含 "1" 的代币:');
  tokens2?.forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.token_symbol} - ${t.token_address}`);
  });
}

findSpecificToken().catch(console.error);
