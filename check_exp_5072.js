/**
 * 检查实验 5072373e 的源实验
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkExp5072() {
  const expId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  const { data: exp } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', expId)
    .maybeSingle();

  console.log('=== 实验信息 ===\n');
  console.log('ID:', exp?.id);
  console.log('名称:', exp?.name);
  console.log('模式:', exp?.mode);
  console.log('源实验ID:', exp?.source_experiment_id);
  console.log('');

  if (exp?.source_experiment_id) {
    // 获取源实验的代币数据
    const { data: tokens } = await supabase
      .from('experiment_tokens')
      .select('*')
      .eq('experiment_id', exp.source_experiment_id)
      .limit(3);

    console.log('源实验的代币数据:');
    if (tokens && tokens.length > 0) {
      console.log('找到', tokens.length, '个代币\n');
      tokens.forEach((t, i) => {
        console.log(`代币 ${i + 1}:`);
        console.log('  token_address:', t.token_address);
        console.log('  token_created_at:', t.token_created_at);
        console.log('  launch_at:', t.launch_at);
        console.log('');
      });
    }
  }
}

checkExp5072().catch(console.error);
