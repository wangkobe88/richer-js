const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkTableStructure() {
  // 尝试获取一条数据看看有哪些字段
  const { data: sample, error } = await supabase
    .from('experiment_tokens')
    .select('*')
    .limit(1);

  if (error) {
    console.log('Error:', error);
    return;
  }

  if (sample && sample.length > 0) {
    console.log('=== experiment_tokens 表字段 ===\n');
    Object.keys(sample[0]).forEach(f => console.log('  -', f));
  }
}

checkTableStructure().catch(console.error);
