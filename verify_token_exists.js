const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function verifyTokenExists() {
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const targetAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  console.log('=== 验证 1$ 代币是否存在 ===\n');
  console.log('源实验 ID:', sourceExpId);
  console.log('目标地址:', targetAddress);
  console.log('');

  // 方法1：直接查询
  const { data: token1, error: error1 } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', sourceExpId)
    .eq('token_address', targetAddress);

  console.log('方法1 - 直接查询:');
  console.log('  错误:', error1?.message || '无');
  console.log('  结果:', token1 && token1.length > 0 ? `✅ 找到 ${token1.length} 个` : '❌ 未找到');
  if (token1 && token1.length > 0) {
    console.log('  符号:', token1[0].token_symbol);
    console.log('  discovered_at:', token1[0].discovered_at);
  }
  console.log('');

  // 方法2：查询符号
  const { data: token2, error: error2 } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', sourceExpId)
    .eq('token_symbol', '1$');

  console.log('方法2 - 查询符号 "1$":');
  console.log('  错误:', error2?.message || '无');
  console.log('  结果:', token2 && token2.length > 0 ? `✅ 找到 ${token2.length} 个` : '❌ 未找到');
  if (token2 && token2.length > 0) {
    token2.forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.token_address}`);
    });
  }
}

verifyTokenExists().catch(console.error);
