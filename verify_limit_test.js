const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function verifyLimit() {
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const targetAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  console.log('=== 验证 limit(10000) 能否获取所有代币 ===\n');

  // 1. 获取总数
  const { count, error: countError } = await supabase
    .from('experiment_tokens')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', sourceExpId);

  if (countError) {
    console.log('获取总数失败:', countError.message);
    return;
  }

  console.log('源实验代币总数:', count);
  console.log('');

  // 2. 模拟 BacktestEngine 的查询（使用 limit(10000)）
  const { data: tokensData, error: queryError } = await supabase
    .from('experiment_tokens')
    .select('token_address, discovered_at')
    .eq('experiment_id', sourceExpId)
    .limit(10000);

  if (queryError) {
    console.log('查询失败:', queryError.message);
    return;
  }

  console.log('limit(10000) 查询结果:', tokensData?.length, '个代币');
  console.log('');

  // 3. 验证是否获取了所有代币
  if (tokensData?.length === count) {
    console.log('✅ 获取了所有代币!');
  } else {
    console.log('⚠️  只获取了部分代币');
    console.log('   总数:', count);
    console.log('   获取:', tokensData?.length);
    console.log('   差值:', count - tokensData?.length);
  }
  console.log('');

  // 4. 检查 1$ 代币是否在查询结果中
  const tokenData = tokensData?.find(t => t.token_address === targetAddress);
  if (tokenData) {
    console.log('✅ 1$ 代币在查询结果中!');
    console.log('   discovered_at:', tokenData.discovered_at);
  } else {
    console.log('❌ 1$ 代币不在查询结果中');
  }
}

verifyLimit().catch(console.error);
