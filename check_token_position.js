const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkTokenPosition() {
  const sourceExperimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const targetAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  // 获取所有代币（不分页）
  const { data: allTokens, count } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol', { count: 'exact' })
    .eq('experiment_id', sourceExperimentId);

  console.log('=== 源实验代币统计 ===\n');
  console.log('总代币数:', count);
  console.log('');

  // 找到 1$ 代币的位置
  const position = allTokens?.findIndex(t => t.token_address === targetAddress);
  if (position !== -1 && position !== undefined) {
    console.log('✅ 1$ 代币位置:', position + 1);
  } else {
    console.log('❌ 1$ 代币未找到');
  }
}

checkTokenPosition().catch(console.error);
