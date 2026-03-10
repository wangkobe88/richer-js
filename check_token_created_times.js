const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkSourceExperimentTokens() {
  // 检查回测实验的源实验
  const backtestExpId = '63d39534-cd5f-49c3-9b4f-e53c2a166fd9';
  
  const { data: backtestExp } = await supabase
    .from('experiments')
    .select('config')
    .eq('id', backtestExpId)
    .maybeSingle();

  if (!backtestExp) {
    console.log('回测实验不存在');
    return;
  }

  const sourceExpId = backtestExp.config?.backtest?.sourceExperimentId;
  console.log('回测实验:', backtestExpId);
  console.log('源实验:', sourceExpId);
  console.log('');

  // 获取源实验的代币数据
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, discovered_at')
    .eq('experiment_id', sourceExpId)
    .limit(5);

  if (!tokens || tokens.length === 0) {
    console.log('源实验没有代币数据');
    return;
  }

  console.log('=== 源实验代币数据 ===\n');
  tokens.forEach((t, i) => {
    console.log(`${i + 1}. ${t.token_symbol}`);
    console.log('   token_address:', t.token_address);
    console.log('   discovered_at:', t.discovered_at);
    console.log('');
  });
}

checkSourceExperimentTokens().catch(console.error);
