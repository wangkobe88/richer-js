/**
 * 获取回测实验的完整配置
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function getBacktestConfig() {
  const backtestExperimentId = '8a4ea415-6df6-499c-a659-b47fda546de5';

  // 获取回测实验
  const { data: backtestExp, error } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', backtestExperimentId)
    .maybeSingle();

  if (error) {
    console.log('Error:', error);
    return;
  }

  if (!backtestExp) {
    console.log('实验不存在');
    return;
  }

  console.log('=== 回测实验信息 ===\n');
  console.log('ID:', backtestExp.id);
  console.log('name:', backtestExp.name);
  console.log('source_experiment_id:', backtestExp.source_experiment_id);
  console.log('');

  if (backtestExp.source_experiment_id) {
    // 获取源实验
    const { data: sourceExp } = await supabase
      .from('experiments')
      .select('*')
      .eq('id', backtestExp.source_experiment_id)
      .maybeSingle();

    if (sourceExp) {
      console.log('=== 源实验信息 ===\n');
      console.log('ID:', sourceExp.id);
      console.log('name:', sourceExp.name);
      console.log('mode:', sourceExp.mode);
      console.log('');

      // 获取源实验的代币数据
      const { data: sourceTokens } = await supabase
        .from('experiment_tokens')
        .select('*')
        .eq('experiment_id', sourceExp.id)
        .eq('token_address', '0x6b0fd53e4676b99dd80051b73cb7260d926c4444')
        .maybeSingle();

      if (sourceTokens) {
        console.log('=== 源实验的代币数据 ===\n');
        console.log('token_created_at:', sourceTokens.token_created_at);
        console.log('launch_at:', sourceTokens.launch_at);

        if (sourceTokens.token_created_at) {
          const tokenCreateTime = Math.floor(new Date(sourceTokens.token_created_at).getTime() / 1000);
          console.log('');
          console.log('tokenCreateTime (秒):', tokenCreateTime);
          console.log('tokenCreateTime (日期):', new Date(tokenCreateTime * 1000).toLocaleString());

          // 计算时间差
          const checkTime = 1773077512; // 从信号数据获取的检查时间
          const timeGap = checkTime - tokenCreateTime;
          console.log('');
          console.log('=== 时间差计算 ===\n');
          console.log('checkTime:', checkTime);
          console.log('tokenCreateTime:', tokenCreateTime);
          console.log('timeGap:', timeGap, '秒');
          console.log('');
          console.log('判断: timeGap <= 120?', timeGap <= 120);
          console.log('应该使用方法:', timeGap <= 120 ? 'real_early (前30笔)' : 'relative (前30% = 90笔)');
        }
      }
    }
  }
}

getBacktestConfig().catch(console.error);
