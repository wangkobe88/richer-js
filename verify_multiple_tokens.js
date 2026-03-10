const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function verifyMultipleTokens() {
  const sourceExperimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

  // 获取前 20 个代币
  const { data: tokens, error } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, discovered_at, raw_api_data')
    .eq('experiment_id', sourceExperimentId)
    .limit(20);

  if (error) {
    console.log('Error:', error);
    return;
  }

  if (!tokens || tokens.length === 0) {
    console.log('没有找到代币');
    return;
  }

  console.log(`=== 验证 ${tokens.length} 个代币 ===\n`);

  let matchCount = 0;
  let mismatchCount = 0;
  let noRawDataCount = 0;

  tokens.forEach((token, idx) => {
    const discoveredAt = token.discovered_at ? new Date(token.discovered_at).getTime() / 1000 : null;
    
    let launchAt = null;
    if (token.raw_api_data) {
      try {
        const rawData = typeof token.raw_api_data === 'string'
          ? JSON.parse(token.raw_api_data)
          : token.raw_api_data;
        launchAt = rawData.launch_at || null;
      } catch (e) {
        // 忽略解析错误
      }
    }

    const isMatch = discoveredAt === launchAt;
    const hasDiff = discoveredAt && launchAt && Math.abs(discoveredAt - launchAt) < 2; // 允许 2 秒误差

    console.log(`${idx + 1}. ${token.token_symbol || token.token_address.substring(0, 8)}...`);
    console.log(`   discovered_at: ${discoveredAt}`);
    console.log(`   launch_at:     ${launchAt}`);
    
    if (launchAt === null) {
      console.log(`   ⚠️  raw_api_data 中没有 launch_at`);
      noRawDataCount++;
    } else if (hasDiff) {
      console.log(`   ✅ 一致`);
      matchCount++;
    } else {
      const diff = Math.abs(discoveredAt - launchAt);
      console.log(`   ❌ 不一致 (差值: ${diff}秒)`);
      mismatchCount++;
    }
    console.log('');
  });

  console.log('=== 统计结果 ===\n');
  console.log('总数:', tokens.length);
  console.log('✅ 一致:', matchCount);
  console.log('❌ 不一致:', mismatchCount);
  console.log('⚠️  无 launch_at:', noRawDataCount);
  console.log('');
  console.log('一致率:', ((matchCount / tokens.length) * 100).toFixed(1) + '%');
}

verifyMultipleTokens().catch(console.error);
