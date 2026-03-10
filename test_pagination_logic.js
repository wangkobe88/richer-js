const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function testPaginationLogic() {
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const targetAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  console.log('=== 模拟 BacktestEngine 的分页查询逻辑 ===\n');

  // 分页查询所有代币
  const PAGE_SIZE = 1000;
  let allTokensData = [];
  let page = 0;

  while (true) {
    const start = page * PAGE_SIZE;
    const end = start + PAGE_SIZE - 1;

    const { data: pageData, error: pageError } = await supabase
      .from('experiment_tokens')
      .select('token_address, discovered_at')
      .eq('experiment_id', sourceExpId)
      .range(start, end);

    if (pageError) {
      console.log(`❌ 查询失败 (页 ${page + 1}):`, pageError.message);
      break;
    }

    if (!pageData || pageData.length === 0) {
      break;
    }

    allTokensData = allTokensData.concat(pageData);
    page++;

    console.log(`页 ${page}: 加载了 ${pageData.length} 个代币`);

    if (pageData.length < PAGE_SIZE) {
      break;
    }

    if (page >= 20) {
      console.log('⚠️  已达到最大查询页数限制');
      break;
    }
  }

  console.log('');
  console.log('=== 结果 ===');
  console.log('总共加载:', allTokensData.length, '个代币');
  console.log('分页数:', page);
  console.log('');

  // 存储 token 创建时间到 Map
  const tokenCreatedTimes = new Map();
  for (const row of allTokensData || []) {
    if (row.discovered_at) {
      tokenCreatedTimes.set(row.token_address, row.discovered_at);
    }
  }

  console.log('Map 大小:', tokenCreatedTimes.size);
  console.log('');

  // 检查 1$ 代币
  const tokenCreateTime = tokenCreatedTimes.get(targetAddress);
  if (tokenCreateTime) {
    console.log('✅ 1$ 代币已加载!');
    console.log('   discovered_at:', tokenCreateTime);
  } else {
    console.log('❌ 1$ 代币未加载');
  }
}

testPaginationLogic().catch(console.error);
