/**
 * 检查源实验的 experiment_tokens 表
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkExperimentTokens() {
  // 先找一个源虚拟实验
  const { data: experiments } = await supabase
    .from('experiments')
    .select('id, name, mode, source_experiment_id')
    .eq('mode', 'virtual')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!experiments || experiments.length === 0) {
    console.log('没有找到虚拟实验');
    return;
  }

  const virtualExpId = experiments[0].id;
  console.log('=== 源虚拟实验 ===\n');
  console.log('ID:', virtualExpId);
  console.log('名称:', experiments[0].name);
  console.log('');

  // 获取该实验的代币数据
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', virtualExpId)
    .limit(1);

  if (tokens && tokens.length > 0) {
    console.log('=== Experiment Tokens 字段 ===\n');
    const fields = Object.keys(tokens[0]);
    console.log('字段列表:');
    fields.forEach(f => console.log('  -', f));
    console.log('');

    console.log('示例数据:');
    console.log('token_address:', tokens[0].token_address);
    console.log('token_created_at:', tokens[0].token_created_at);
    console.log('launch_at:', tokens[0].launch_at);
  } else {
    console.log('没有找到代币数据');
  }
}

checkExperimentTokens().catch(console.error);
