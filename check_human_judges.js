const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function check() {
  const experimentId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 查看有 human_judges 数据的代币
  const { data: tokens, error } = await supabase
    .from('experiment_tokens')
    .select('token_symbol, human_judges')
    .eq('experiment_id', experimentId)
    .not('human_judges', 'is', null)
    .limit(10);

  if (error) {
    console.error('查询失败:', error);
    return;
  }

  console.log(`有 human_judges 的代币数量: ${tokens.length}\n`);

  for (const token of tokens) {
    console.log(`代币: ${token.token_symbol}`);
    console.log(`human_judges 类型: ${typeof token.human_judges}`);
    console.log(`human_judges 值: ${JSON.stringify(token.human_judges, null, 2)}`);
    console.log('---');
  }
}

check().catch(console.error);
