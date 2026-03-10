const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function findTokenRange() {
  const sourceExperimentId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const targetAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  // 分批查找
  const batchSize = 1000;
  let found = false;
  let batch = 0;

  while (!found && batch < 10) {
    const start = batch * batchSize;
    const end = start + batchSize - 1;

    const { data: tokens } = await supabase
      .from('experiment_tokens')
      .select('token_address, token_symbol')
      .eq('experiment_id', sourceExperimentId)
      .range(start, end);

    if (!tokens || tokens.length === 0) {
      console.log(`批次 ${batch + 1} (${start}-${end}): 没有数据`);
      break;
    }

    const index = tokens.findIndex(t => t.token_address === targetAddress);
    if (index !== -1) {
      console.log(`✅ 找到了！`);
      console.log(`批次: ${batch + 1} (${start}-${end})`);
      console.log(`批次内位置: ${index + 1}`);
      console.log(`全局位置: ${start + index + 1}`);
      console.log(`符号: ${tokens[index].token_symbol}`);
      found = true;
    } else {
      console.log(`批次 ${batch + 1} (${start}-${end}): 未找到 (${tokens.length} 个代币)`);
    }

    batch++;

    // 如果这一批数据少于 batch size，说明已经没有更多数据了
    if (tokens.length < batchSize) {
      break;
    }
  }

  if (!found) {
    console.log('❌ 在所有批次中都没有找到');
  }
}

findTokenRange().catch(console.error);
