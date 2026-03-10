const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function testAlternativeQuery() {
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

  console.log('=== 测试不同的查询方法 ===\n');

  // 方法1：不设置 limit（看看默认行为）
  console.log('方法1: 不设置 limit');
  const { data: result1, error: error1 } = await supabase
    .from('experiment_tokens')
    .select('token_address')
    .eq('experiment_id', sourceExpId);
  console.log('  结果:', result1?.length || 0, '个代币');
  console.log('');

  // 方法2：使用 range
  console.log('方法2: 使用 range(0, 4999)');
  const { data: result2, error: error2 } = await supabase
    .from('experiment_tokens')
    .select('token_address')
    .eq('experiment_id', sourceExpId)
    .range(0, 4999);
  console.log('  结果:', result2?.length || 0, '个代币');
  console.log('');

  // 方法3：分页查询
  console.log('方法3: 分页查询（每次 1000）');
  let allTokens = [];
  let page = 0;
  while (true) {
    const start = page * 1000;
    const end = start + 999;
    
    const { data: pageData, error: pageError } = await supabase
      .from('experiment_tokens')
      .select('token_address, discovered_at')
      .eq('experiment_id', sourceExpId)
      .range(start, end);
    
    if (pageError || !pageData || pageData.length === 0) {
      break;
    }
    
    allTokens = allTokens.concat(pageData);
    page++;
    
    if (pageData.length < 1000) {
      break; // 最后一页
    }
    
    if (page >= 10) {
      console.log('  已查询 10 页，停止');
      break;
    }
  }
  console.log('  结果:', allTokens.length, '个代币（分', page, '页）');
  console.log('');
}

testAlternativeQuery().catch(console.error);
