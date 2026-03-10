/**
 * 检查源实验的数据
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkSourceExperiment() {
  const backtestExperimentId = '8a4ea415-6df6-499c-a659-b47fda546de5';

  // 获取回测实验的配置
  const { data: backtestExp } = await supabase
    .from('experiments')
    .select('source_experiment_id, config')
    .eq('id', backtestExperimentId)
    .single();

  console.log('=== 回测实验信息 ===\n');
  console.log('回测实验ID:', backtestExperimentId);
  console.log('源实验ID:', backtestExp.source_experiment_id);
  console.log('');

  // 获取源实验的代币数据
  const { data: sourceTokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', backtestExp.source_experiment_id)
    .eq('token_address', '0x6b0fd53e4676b99dd80051b73cb7260d926c4444')
    .maybeSingle();

  console.log('=== 源实验的代币数据 ===\n');
  if (sourceTokens) {
    console.log('token_address:', sourceTokens.token_address);
    console.log('token_created_at:', sourceTokens.token_created_at);
    console.log('launch_at:', sourceTokens.launch_at);
    console.log('');

    if (sourceTokens.token_created_at) {
      const tokenCreateTime = Math.floor(new Date(sourceTokens.token_created_at).getTime() / 1000);
      console.log('tokenCreateTime (秒):', tokenCreateTime);
      console.log('tokenCreateTime (日期):', new Date(tokenCreateTime * 1000).toLocaleString());
    }

    if (sourceTokens.launch_at) {
      console.log('launch_at (秒):', sourceTokens.launch_at);
      console.log('launch_at (日期):', new Date(sourceTokens.launch_at * 1000).toLocaleString());
    }
  } else {
    console.log('没有找到源实验的代币数据');
  }
}

checkSourceExperiment().catch(console.error);
