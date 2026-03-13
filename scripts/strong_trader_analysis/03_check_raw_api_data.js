/**
 * 步骤3: 检查 raw_api_data 是否包含 pair 信息
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function main() {
  console.log('=== 步骤3: 检查 raw_api_data 内容 ===\n');

  const expId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取几个代币的 raw_api_data
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, platform, raw_api_data')
    .eq('experiment_id', expId)
    .limit(3);

  if (!tokens || tokens.length === 0) {
    console.log('没有找到代币数据');
    return;
  }

  tokens.forEach(token => {
    console.log(`\n代币: ${token.token_symbol}`);
    console.log(`Platform: ${token.platform}`);
    console.log('-'.repeat(60));
    console.log('raw_api_data 内容:');
    console.log(JSON.stringify(token.raw_api_data, null, 2));
  });
}

main().catch(console.error);
