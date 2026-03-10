const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkAddressCase() {
  const sourceExperimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const targetAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  // 获取所有代币地址
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol')
    .eq('experiment_id', sourceExperimentId)
    .limit(20);

  console.log('=== 数据库中的代币地址 ===\n');
  tokens.forEach((t, i) => {
    console.log(`${i + 1}. ${t.token_symbol}`);
    console.log('   ', t.token_address);
  });
  console.log('');

  // 检查目标地址
  console.log('=== 目标地址检查 ===\n');
  console.log('目标地址:', targetAddress);
  console.log('');

  // 精确匹配
  const exactMatch = tokens.find(t => t.token_address === targetAddress);
  console.log('精确匹配:', exactMatch ? '✅ 找到' : '❌ 未找到');

  // 小写匹配
  const lowerAddress = targetAddress.toLowerCase();
  const lowerMatch = tokens.find(t => t.token_address.toLowerCase() === lowerAddress);
  console.log('小写匹配:', lowerMatch ? '✅ 找到' : '❌ 未找到');
  if (lowerMatch) {
    console.log('   实际地址:', lowerMatch.token_address);
  }
}

checkAddressCase().catch(console.error);
