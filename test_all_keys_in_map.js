const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function testAllKeysInMap() {
  const sourceExperimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const targetAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  // 1. 加载所有代币
  const { data: tokensData } = await supabase
    .from('experiment_tokens')
    .select('token_address, discovered_at')
    .eq('experiment_id', sourceExperimentId);

  // 2. 模拟 BacktestEngine 的逻辑
  const tokenCreatedTimes = new Map();
  for (const row of tokensData || []) {
    if (row.discovered_at) {
      tokenCreatedTimes.set(row.token_address, row.discovered_at);
    }
  }

  console.log('Map 大小:', tokenCreatedTimes.size);
  console.log('');

  // 3. 直接查询数据库中是否有这个地址
  const { data: targetToken } = await supabase
    .from('experiment_tokens')
    .select('token_address, discovered_at')
    .eq('experiment_id', sourceExperimentId)
    .eq('token_address', targetAddress)
    .maybeSingle();

  console.log('=== 数据库查询结果 ===');
  console.log('目标地址:', targetAddress);
  console.log('查询结果:', targetToken ? '✅ 找到' : '❌ 未找到');
  if (targetToken) {
    console.log('  token_address:', targetToken.token_address);
    console.log('  discovered_at:', targetToken.discovered_at);
    console.log('  会被添加到 Map:', !!targetToken.discovered_at);
  }
  console.log('');

  // 4. 检查 Map 中是否存在
  const mapResult = tokenCreatedTimes.get(targetAddress);
  console.log('=== Map 查询结果 ===');
  console.log('Map.get(目标地址):', mapResult || 'null');
  console.log('');

  // 5. 遍历 Map，看看前 10 个和后 10 个键
  console.log('=== Map 中的前 5 个键 ===');
  let count = 0;
  for (const [key, value] of tokenCreatedTimes.entries()) {
    if (count < 5) {
      console.log(`  ${count + 1}. ${key.substring(0, 20)}...`);
      count++;
    } else {
      break;
    }
  }

  // 6. 检查是否有 6b0fd 开头的
  console.log('');
  console.log('=== 搜索 6b0fd 开头的键 ===');
  let found = false;
  for (const [key, value] of tokenCreatedTimes.entries()) {
    if (key.toLowerCase().includes('6b0fd')) {
      console.log('  找到:', key);
      found = true;
    }
  }
  if (!found) {
    console.log('  ❌ 没有找到包含 6b0fd 的键');
  }

  // 7. 检查是否包含 1$ 符号
  console.log('');
  const { data: oneDollar } = await supabase
    .from('experiment_tokens')
    .select('token_address')
    .eq('experiment_id', sourceExperimentId)
    .eq('token_symbol', '1$')
    .maybeSingle();

  if (oneDollar) {
    console.log('=== 数据库中符号为 "1$" 的代币 ===');
    console.log('  地址:', oneDollar.token_address);
    console.log('  在 Map 中:', tokenCreatedTimes.has(oneDollar.token_address) ? '✅ 存在' : '❌ 不存在');
    if (tokenCreatedTimes.has(oneDollar.token_address)) {
      console.log('  值:', tokenCreatedTimes.get(oneDollar.token_address));
    }
  }
}

testAllKeysInMap().catch(console.error);
